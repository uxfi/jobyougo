import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  SUBMIT_CANDIDATES,
  APPLY_PAGE_SIGNALS,
  sendLabelKind,
  rankSubmitCandidates,
  classifyApplyPage,
  pageShowsIdentity,
} from '../lib/apply-submit.mjs';
import { settleCheckboxGroups } from '../lib/apply-completion.mjs';
import { acceptAdoptCandidate, isFormAppUrl } from '../extension/apply-tab-match.mjs';

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

const browser = await launchBrowser();
test.after(() => browser.close());

async function inPage(html, fn) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    return await page.evaluate(fn);
  } finally {
    await page.close();
  }
}

const form = (buttons, extra = '') => `<!doctype html><body>
  <header><nav><a href="/jobs">Jobs</a><button>Apply</button><button>Log in</button></nav></header>
  ${extra}
  <form id="f">
    <input data-co-i="0" name="email" value="a@b.c" style="width:200px;height:20px">
    <input data-co-i="1" name="name" value="Hugo" style="width:200px;height:20px">
    ${buttons}
  </form>
</body>`;

const rank = async (html) => rankSubmitCandidates([{ frameId: 0, ...(await inPage(html, SUBMIT_CANDIDATES)) }]);

test('labels: sends, Apply wordings, never-sends', () => {
  for (const t of ['Submit application', 'Send application', 'Envoyer ma candidature', 'Submit', 'Bewerbung absenden', 'Enviar candidatura', 'ENVIAR CANDIDATURA', 'Submit your application']) {
    assert.equal(sendLabelKind(t), 'send', t);
  }
  for (const t of ['Apply now', 'Apply', 'Postuler', 'Je postule', 'Candidater', 'Jetzt bewerben']) assert.equal(sendLabelKind(t), 'apply', t);
  for (const t of ['Send reply', 'Connect', 'Manage Cookie Settings', 'Log in', 'Add another', 'Upload file', 'Subscribe']) assert.equal(sendLabelKind(t), 'never', t);
  for (const t of ['Next', 'Continue', 'Suivant', 'Review application']) assert.equal(sendLabelKind(t), 'progress', t);
  assert.equal(sendLabelKind('Industrial Design'), 'other');
});

test('a tag chip inside the form is never the send when a Submit is there', async () => {
  const r = await rank(form('<button style="width:120px;height:30px">Industrial Design</button><button type="submit" style="width:120px;height:30px">Submit application</button>'));
  assert.equal(r.pick.text, 'Submit application');
  assert.equal(r.confidence, 'high');
});

test('a tag chip alone is only a low guess, left to the model', async () => {
  const r = await rank(form('<button style="width:120px;height:30px">Industrial Design</button>'));
  assert.ok(r.confidence === 'low' || r.confidence === 'none', r.confidence);
});

test('"Apply now" at the end of the filled form sends; the header Apply does not', async () => {
  const r = await rank(form('<button type="submit" style="width:120px;height:30px">Apply now</button>'));
  assert.equal(r.pick.text, 'Apply now');
  assert.equal(r.confidence, 'medium');
  assert.equal(r.ranked.find((c) => c.text === 'Apply').inChrome, true);
});

test('a chat widget and a cookie banner are never picked', async () => {
  const r = await rank(form('<button type="submit" style="width:120px;height:30px">Envoyer ma candidature</button>',
    '<div class="cookie-banner"><button style="width:120px;height:30px">Submit</button></div><div id="chat"><button style="width:120px;height:30px">Send reply</button></div>'));
  assert.equal(r.pick.text, 'Envoyer ma candidature');
});

test('a disabled send is reported, no stand-in clicked', async () => {
  const r = await rank(form('<button type="button" style="width:120px;height:30px">Add another</button><button type="submit" disabled style="width:120px;height:30px">Submit Application</button>'));
  assert.equal(r.pick, null);
  assert.equal(r.disabled.text, 'Submit Application');
});

test('an icon-only submit button of the form is a probable send', async () => {
  const r = await rank(form('<button type="submit" aria-label="" style="width:40px;height:40px"><svg width="20" height="20"></svg></button>'));
  assert.equal(r.confidence, 'medium');
});

const frame = (o) => ({ frameId: 0, url: 'https://x.test/jobs/1', title: '', headings: [], text: '', bodyLength: 4000, shortBody: '', captcha: '', challengeOpen: false, codeInputs: 0, otpBoxes: false, passwords: 0, fieldCount: 0, filledMarks: 0, ...o });

test('closed offers: banner, ATS copy in other languages, Greenhouse redirect', () => {
  assert.equal(classifyApplyPage([frame({ headings: ['Cette offre n’est plus disponible'] })]).kind, 'closed');
  assert.equal(classifyApplyPage([frame({ text: 'Sorry, this job is no longer available. See similar jobs.' })]).kind, 'closed');
  assert.equal(classifyApplyPage([frame({ text: 'Diese Stellenanzeige ist leider nicht mehr verfügbar.' })]).kind, 'closed');
  assert.equal(classifyApplyPage([frame({ text: 'This position is no longer accepting applications' })]).kind, 'closed');
  assert.equal(classifyApplyPage([frame({ url: 'https://boards.greenhouse.io/acme?error=true', text: 'Current openings at Acme' })]).kind, 'closed');
  assert.equal(classifyApplyPage([frame({ title: 'Page not found', headings: ['404'] })]).kind, 'closed');
  // A live form with a closing date in its description is not closed.
  assert.equal(classifyApplyPage([frame({ fieldCount: 8, text: 'Product Designer. Applications close on 30 October.' })], { stage: 'form' }).kind, 'none');
  // Himalayas: a "Job expired?" report button by Apply and "Job expired"
  // badges under Similar jobs sit on live postings; a banner in the lead,
  // bare or phrased, still closes the offer.
  const himalayas = `Senior Freelance Product Designer · Clera · Remote · Apply now · Job expired? · About the role · ${'Clera builds AI tools for accounting teams. '.repeat(30)}· Similar jobs · Product Designer · Acme · Job expired`;
  assert.notEqual(classifyApplyPage([frame({ text: himalayas })]).kind, 'closed');
  assert.equal(classifyApplyPage([frame({ text: `This job has expired. ${himalayas}` })]).kind, 'closed');
  assert.equal(classifyApplyPage([frame({ headings: ['Job expired'], text: 'Senior Product Designer · Acme' })]).kind, 'closed');
  assert.equal(classifyApplyPage([frame({ text: 'Sorry, this posting has expired.' })]).kind, 'closed');
});

test('captcha: an unsolved widget or the image challenge waits for the user', () => {
  assert.equal(classifyApplyPage([frame({ captcha: 'recaptcha', fieldCount: 8 })], { stage: 'form' }).kind, 'captcha');
  assert.equal(classifyApplyPage([frame({ challengeOpen: true, fieldCount: 8 })], { stage: 'sent' }).kind, 'captcha');
  assert.equal(classifyApplyPage([frame({ captchaSolved: true, fieldCount: 8 })], { stage: 'form' }).kind, 'none');
  assert.equal(classifyApplyPage([frame({ shortBody: 'Just a moment... Verify you are human', bodyLength: 120 })]).kind, 'challenge');
});

test('e-mail code vs a form that only has an access-code field', () => {
  assert.equal(classifyApplyPage([frame({ otpBoxes: true, fieldCount: 6, headings: ['Check your email'], text: 'We sent a 6-digit code to h***@gmail.com' })], { stage: 'sent' }).kind, 'email_code');
  assert.equal(classifyApplyPage([frame({ codeInputs: 1, fieldCount: 12 })], { stage: 'form' }).kind, 'none');
  assert.equal(classifyApplyPage([frame({ headings: ['Enter the verification code'], codeInputs: 1, fieldCount: 1 })], { stage: 'sent' }).kind, 'email_code');
});

test('confirmation read in headings, not in the posting footer', () => {
  assert.equal(classifyApplyPage([frame({ headings: ['Thank you for applying!'] })], { stage: 'sent' }).kind, 'confirmed');
  assert.equal(classifyApplyPage([frame({ headings: ['Candidature envoyée'] })], { stage: 'sent' }).kind, 'confirmed');
  const footer = 'Senior designer. '.repeat(60) + 'Thank you for applying to Acme.';
  assert.equal(classifyApplyPage([frame({ fieldCount: 10, filledMarks: 10, text: footer })], { stage: 'sent' }).kind, 'none');
  assert.equal(classifyApplyPage([frame({ headings: ['Thank you for your interest in Acme'], fieldCount: 10 })], { stage: 'sent' }).kind, 'none');
});

test('an application waiting for an e-mail link', () => {
  assert.equal(classifyApplyPage([frame({ headings: ['Almost done'], text: 'Please confirm your email address to complete your application.' })], { stage: 'sent' }).kind, 'email_link');
});

test('in-page signals: a visible reCAPTCHA, not the floating badge', async () => {
  const sig = await inPage('<div class="g-recaptcha" style="width:300px;height:80px"></div><input name="x">', APPLY_PAGE_SIGNALS);
  assert.equal(sig.captcha, 'recaptcha');
  const badge = await inPage('<div class="grecaptcha-badge"><div class="g-recaptcha" style="width:300px;height:80px"></div></div>', APPLY_PAGE_SIGNALS);
  assert.equal(badge.captcha, '');
  const otp = await inPage(`${'<input maxlength="1" style="width:30px;height:30px">'.repeat(6)}`, APPLY_PAGE_SIGNALS);
  assert.equal(otp.otpBoxes, true);
});

test('a required checkbox question is one row, settled by one ticked box', () => {
  const q = 'Have you had any interaction with content from our RnD community? *';
  const boxes = ['N/A', 'Podcast', 'Blog Post'].map((o) => ({ type: 'checkbox', label: `${q} — ${o}`, checked: false, groupChecked: false }));
  const pending = boxes.map((b) => ({ label: b.label, reason: 'requis — sans réponse, à remplir manuellement' }));
  const open = settleCheckboxGroups(pending, boxes);
  assert.equal(open.length, 1);
  assert.equal(open[0].label, q);
  const done = boxes.map((b, i) => ({ ...b, checked: i === 0, groupChecked: true }));
  assert.deepEqual(settleCheckboxGroups(pending, done), []);
});

test('a Google Form or a Tally opened by Apply is the application, Google search is not', () => {
  assert.equal(isFormAppUrl('https://docs.google.com/forms/d/e/1FAIpQ/viewform?pli=1'), true);
  assert.equal(acceptAdoptCandidate({ url: 'https://docs.google.com/forms/d/e/1FAIpQ/viewform' }, { originUrl: 'https://dribbble.com/jobs/1-x' }, { trustedChild: true }).ok, true);
  assert.equal(acceptAdoptCandidate({ url: 'https://tally.so/r/XxVr9j' }, { originUrl: 'https://dribbble.com/jobs/1-x' }, { trustedChild: true }).ok, true);
  assert.equal(acceptAdoptCandidate({ url: 'https://www.google.com/search?q=x' }, {}, { trustedChild: true }).ok, false);
});

test('a French label in the first person is a send (Welcome to the Jungle)', () => {
  assert.equal(sendLabelKind('J’envoie ma candidature !'), 'send');
  assert.equal(sendLabelKind('Je soumets mon dossier'), 'send');
  assert.equal(sendLabelKind('Bewerbung jetzt abschicken'), 'send');
  assert.equal(sendLabelKind('Je candidate'), 'apply');
  for (const t of ['Voir ma candidature', 'Enregistrer ma candidature', 'Mes candidatures', 'Envoyez-moi des offres similaires']) {
    assert.notEqual(sendLabelKind(t), 'send', t);
  }
});

test('a signed-in platform: the e-mail it already shows is the identity', async () => {
  const sig = await inPage('<input type="email" value="hugo@x.com" readonly style="width:200px;height:20px">', APPLY_PAGE_SIGNALS);
  assert.deepEqual(sig.emailValues, ['hugo@x.com']);
  assert.equal(pageShowsIdentity([sig], 'other@x.com'), true);
  assert.equal(pageShowsIdentity([{ text: 'Connecté en tant que Hugo@X.com', emailValues: [] }], 'hugo@x.com'), true);
  assert.equal(pageShowsIdentity([{ text: 'Apply now', emailValues: [] }], 'hugo@x.com'), false);
});

test('a closed banner is read even when filter boxes look like a form (WTTJ)', () => {
  const page = frame({ fieldCount: 4, text: `${'Menu '.repeat(200)} This position is no longer available. Product Designer` });
  assert.equal(classifyApplyPage([page], { stage: 'navigate' }).kind, 'closed');
  assert.equal(classifyApplyPage([frame({ fieldCount: 3, title: 'Error 404', headings: ['Error 404', 'Page not found'] })], { stage: 'navigate' }).kind, 'closed');
  // Mid-form the lead still decides: a long JD mentioning it in the body stays open.
  assert.notEqual(classifyApplyPage([page], { stage: 'form' }).kind, 'closed');
});
