// Fixes from Hugo's 2026-10-19 scan + pipeline + apply run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { postingStatusFromApi, leverPageStatus } from '../lib/posting-date.mjs';
import { preferLocalApplyCv, applyCvNameOf } from '../lib/apply-spec.mjs';
import { classifyField, isMarketingConsent } from '../lib/apply-classify.mjs';
import { isIntlTelInputPicker, formHasPhoneDialPicker } from '../lib/apply-fill-guards.mjs';
import { jdSufficiency, offerAnchor } from '../lib/jd-sufficiency.mjs';
import { portalsForProfile, hardwareDesignNegatives } from '../lib/scan-targeting.mjs';
import { explainTitle } from '../lib/scan-decision.mjs';

const LEVER = 'https://jobs.lever.co/airalo/f238e932-7dd9-4508-8790-e26a3563b13e';
const fakeFetch = (routes) => async (url) => {
  const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
  const [status, body] = hit ? hit[1] : [500, ''];
  return { status, ok: status >= 200 && status < 300, headers: new Map([['content-type', 'text/html']]), json: async () => JSON.parse(body || '{}'), text: async () => body };
};

test('Lever: an unlisted posting the API 404s is open when its page shows it', async () => {
  const fetchImpl = fakeFetch({
    'https://api.lever.co/': [404, ''],
    'https://jobs.lever.co/': [200, '<div class="posting-headline"><h2>Senior Product Designer, UX</h2></div><script type="application/ld+json">{"@type":"JobPosting","datePosted":"2026-07-10"}</script>'],
  });
  assert.deepEqual(await postingStatusFromApi(LEVER, { fetchImpl }), { date: '2026-07-10', closed: false });
});

test('Lever: closed only when the page itself is gone', async () => {
  const gone = fakeFetch({ 'https://api.lever.co/': [404, ''], 'https://jobs.lever.co/': [404, 'Not found'] });
  assert.deepEqual(await postingStatusFromApi(LEVER, { fetchImpl: gone }), { date: null, closed: true, closedBy: 'lever-page' });
  const flaky = fakeFetch({ 'https://api.lever.co/': [404, ''], 'https://jobs.lever.co/': [503, ''] });
  assert.equal((await postingStatusFromApi(LEVER, { fetchImpl: flaky })).closed, false);
  assert.equal((await leverPageStatus(async () => { throw new Error('net'); }, LEVER)).closed, false);
});

test('the owner apply CV is the one config/profile.yml names', () => {
  const stored = { candidate: { full_name: 'Hugo', apply_cv: 'Hugo_Vermot_CV-PRODUCT-AI-DESIGNER_compressed.pdf' } };
  const logs = [];
  const out = preferLocalApplyCv(stored, { candidate: { apply_cv: 'Hugo_Vermot_CV.pdf' } }, { log: (m) => logs.push(m) });
  assert.equal(applyCvNameOf(out), 'Hugo_Vermot_CV.pdf');
  assert.equal(out.candidate.full_name, 'Hugo');
  assert.equal(logs.length, 1);
  assert.equal(preferLocalApplyCv(stored, {}), stored, 'no local name keeps the stored one');
  const server = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /preferLocalApplyCv\(fillProfileGaps\(stored, localProfile\), localProfile/);
});

const id = { fullName: 'Hugo Vermot', firstName: 'Hugo', lastName: 'Vermot', email: 'h@example.com', phone: '+33 6 95 65 91 31', dialCode: '+33', country: 'France', screening: { consents: { futureRoles: false } } };
const spec = { identity: id, company: 'Flying Bisons', role: 'Product Designer', answers: [] };
const box = (label, extra = {}) => ({ type: 'checkbox', tag: 'input', label, name: '', idAttr: '', required: true, ...extra });

test('a required consent to process this application is ticked', () => {
  assert.equal(classifyField(box('I consent to the processing of my personal data for the purposes of the current recruitment process. *'), spec)?.check, true);
  assert.equal(classifyField(box('I agree to the Privacy Policy *'), spec)?.check, true);
});

test('a required consent bundling this application with future ones is left to the candidate', () => {
  const label = 'I consent to the processing of my personal data by Flying Bisons Sp. z o.o. based in Skierniewice, for the purposes of the current recruitment process and any future recruitment processes. *';
  const plan = classifyField(box(label), spec);
  assert.notEqual(plan?.check, true);
  assert.match(plan?.skip || '', /futurs recrutements : à cocher toi-même/);
});

test('marketing, SMS and talent-pool consents are never ticked, even required', () => {
  for (const label of [
    'I agree to receive marketing communications *',
    'I consent to receive SMS / text messages about new jobs *',
    'Subscribe me to the newsletter',
  ]) {
    assert.ok(isMarketingConsent(label.toLowerCase()), label);
    assert.notEqual(classifyField(box(label), spec)?.check, true, label);
  }
  assert.notEqual(classifyField(box('Add me to your talent pool for future roles', { required: false }), spec)?.check, true);
});

test('"My information" (react-phone-number-input country list) is a phone picker left to the number', () => {
  const picker = { type: 'select-one', tag: 'select', label: 'My information', name: '', idAttr: '', required: false, options: [{ text: 'International' }, { text: 'Afghanistan' }, { text: 'Åland Islands' }, { text: 'Albania' }] };
  assert.equal(isIntlTelInputPicker(picker), true);
  assert.equal(isIntlTelInputPicker({ ...picker, options: [{ text: 'France +33' }, { text: 'Spain +34' }, { text: 'Italy +39' }] }), false);
  assert.equal(isIntlTelInputPicker({ type: 'select-one', label: 'Country', className: 'PhoneInputCountrySelect', options: [] }), true);
  assert.equal(formHasPhoneDialPicker([picker]), false);
  const phone = classifyField({ type: 'tel', tag: 'input', label: 'Phone number', name: 'phone', idAttr: '', required: true }, { ...spec, formHasDialPicker: false });
  assert.match(phone?.value || '', /^\+33/);
});

test('a thin job description is parked instead of being scored', () => {
  assert.equal(jdSufficiency('Specjalista UX/UI. Aplikuj.', { company: 'Eyzee S.A.', title: 'Specjalista UX/UI' }).ok, false);
  const offTopic = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40);
  assert.match(jdSufficiency(offTopic, { company: 'Eyzee S.A.', title: 'Specjalista UX/UI' }).reason, /never names/);
  const real = `Eyzee szuka osoby na stanowisko Specjalista UX/UI. ${'Projektowanie interfejsów, badania z użytkownikami, Figma, design system. '.repeat(30)}`;
  assert.equal(jdSufficiency(real, { company: 'Eyzee S.A.', title: 'Specjalista UX/UI' }).ok, true);
  assert.match(offerAnchor({ company: 'Eyzee S.A.', title: 'Specjalista UX/UI', url: 'https://justjoin.it/x' }), /Offer: Eyzee S\.A\. - Specjalista UX\/UI[\s\S]*are not the offer/);
});

test('chip-design titles do not pass a product-design profile', () => {
  const targeting = { primaryRoles: ['Senior Product Designer', 'Design Engineer'], archetypes: [] };
  const portals = portalsForProfile({ title_filter: { negative: ['Intern'] } }, { targeting });
  for (const title of ['DFT Engineer - GPU Logic Design Engineer', 'Physical Design Engineer', 'ASIC Design Verification Engineer', 'Senior FPGA Design Engineer']) {
    assert.equal(explainTitle(title, portals.title_filter).ok, false, title);
  }
  for (const title of ['Senior Product Designer', 'Design Engineer (Figma, React)', 'Senior Product Designer, GPU Cloud']) {
    assert.equal(explainTitle(title, portals.title_filter).ok, true, title);
  }
  assert.deepEqual(hardwareDesignNegatives(['ASIC Design Engineer']), [], 'a hardware profile keeps its titles');
});

test('the UI font sheet points at no missing file', () => {
  const css = readFileSync(new URL('../ui/assets/fonts.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, path] of css.matchAll(/url\('\/ui\/assets\/(fonts\/[^']+)'\)/g)) {
    // Fonts the repo ships must exist; the others must not be referenced.
    assert.ok(existsSync(new URL(`../ui/assets/${path}`, import.meta.url)) || !/caros/.test(path), path);
  }
  assert.doesNotMatch(css, /caros\.woff2/);
  assert.match(css, /--font-caros:\s*'Caros', 'Inter'/);
});

test('the scan modal names web searches and keeps API sources in "Fresh only"', () => {
  const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  assert.match(html, /renderScanGroup\('Job boards \(web search\)'/);
  assert.match(html, /function scanSelectionSummary/);
  assert.match(html, /c\.access === 'api' \|\| isFresh\(c\.lastScanned\)/);
});