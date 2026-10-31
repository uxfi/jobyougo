import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanOfferIdentity, safeCompanyHint, stripUnsourcedCompanyBlurb } from '../lib/email-target-guard.mjs';
import { buildApplicationEmailMessages, parseRecipient, withContact } from '../lib/application-email.mjs';

const CV = `# Hugo Vermot\n\n## Experience\n\n### Head of Product : OneAsset (Feb 2026 - present)\n- Shipped the investor app.\n`;
const VERTECH = `Hello,\n\nVertech Industrial Systems develops industrial automation solutions for manufacturing environments. I'm applying for the UX/UI Designer role.\n\nSince 2022, I've built and shipped AI-powered SaaS products. It is the kind of problem I want to solve.\n\nBest,\nHugo Vermot\nhttps://jobyougo.xyz/portfolio\nhttps://linkedin.com/in/hugovermot`;

test('company hint: own company dropped, other kept', () => {
  assert.equal(safeCompanyHint('OneAsset', CV), '');
  assert.equal(safeCompanyHint('Vertech Industrial Systems', CV), 'Vertech Industrial Systems');
});

test('no source read: invented company description cut, named by the company, its domain reading or its domain label', () => {
  for (const target of [{ company: 'Vertech Industrial Systems' }, { companyGuess: 'Vertech' }, { domain: 'jobs.vertech.com' }]) {
    const out = stripUnsourcedCompanyBlurb(VERTECH, { ...target, sourceText: '' });
    assert.equal(out.removed.length, 1);
    assert.doesNotMatch(out.body, /develops industrial automation/);
    assert.match(out.body, /^Hello,\n\nI'm applying for the UX\/UI Designer role\./);
    assert.match(out.body, /It is the kind of problem/);
    assert.match(out.body, /https:\/\/jobyougo\.xyz\/portfolio/);
    assert.doesNotMatch(out.body, /\[(Nom|Name|Company|Entreprise)[^\]]*\]/i);
    assert.doesNotMatch(out.body, /OneAsset/);
  }
});

test('posting or site read: body untouched', () => {
  const out = stripUnsourcedCompanyBlurb(VERTECH, { company: 'Vertech Industrial Systems', sourceText: 'We build automation software.' });
  assert.equal(out.body, VERTECH);
  assert.equal(out.removed.length, 0);
});

test('draft length stays within the budget after the cut', () => {
  const words = stripUnsourcedCompanyBlurb(VERTECH, { company: 'Vertech Industrial Systems' }).body.split(/\s+/).filter(Boolean).length;
  assert.ok(words < 180, String(words));
});

// ── WP5: request plumbing (2026-10-24) ─────────────────────────────────────

test('cleanOfferIdentity: page titles stored as roles lose the board\'s dressing', () => {
  const table = [
    ['Chess.com hiring Product Designer, Design Systems Job in Remote', 'Product Designer, Design Systems'],
    ['Lead UX Designer - Remote - Indeed.com', 'Lead UX Designer'],
    ['Staff Product Designer - Design Systems - 100% Remote - EMEA - London - Indeed.com', 'Staff Product Designer - Design Systems'],
    ['Senior UX Researcher (100% Remote Worldwide) - London - Indeed.com', 'Senior UX Researcher'],
    ['Sr. Product Designer (Remote, Europe Based) - Remote - Indeed.com', 'Sr. Product Designer'],
    ['Europace hiring (Senior) Product Designerin - remote (w/m/d) Job in Home office', '(Senior) Product Designerin'],
    ['Head of Product & Engineering (m/w/d) - 100 % Remote', 'Head of Product & Engineering'],
    ['UX Designer – Fokus digitale Gesundheitsprodukte & KI (m/w/d) - Home Office - Indeed.com', 'UX Designer – Fokus digitale Gesundheitsprodukte & KI'],
    ['Senior Product Manager France - Remote', 'Senior Product Manager France'],
    ['Product Designer (UI/UX) - Remote - Indeed.com', 'Product Designer (UI/UX)'],
    ['Senior Product Designer, Live', 'Senior Product Designer, Live'],
  ];
  for (const [role, want] of table) assert.equal(cleanOfferIdentity({ company: 'Acme', role }).role, want, role);
  // The company's own name around the role goes too.
  assert.equal(cleanOfferIdentity({ company: 'Tebex', role: 'Product Designer - Tebex - Remote - Indeed.com' }).role, 'Product Designer');
  assert.equal(cleanOfferIdentity({ company: 'BlaBlaCar', role: 'Lead Product Design – BlaBlaCar – Permanent contract – Fully-remote' }).role, 'Lead Product Design');
  assert.equal(cleanOfferIdentity({ company: 'Infinicept', role: 'Infinicept UI / UX Product Designer Job in Remote' }).role, 'UI / UX Product Designer');
  assert.equal(cleanOfferIdentity({ company: 'Multivision', role: 'UX Designer at Multivision :: Behance' }).role, 'UX Designer');
  // A board's name is no role.
  assert.equal(cleanOfferIdentity({ company: 'Dune', role: 'LinkedIn' }).role, '');
});

test('cleanOfferIdentity: brackets before separators, Greenhouse titles, bare gender tags, the company as its own role', () => {
  const table = [
    // A " - " inside brackets is no separator: the ")" used to go.
    ['Duvo', 'Design Engineer (EU/UK Based - Remote)', 'Design Engineer'],
    ['Zeta Global', 'Remote Senior Product Designer, Design System (Remote) Job at', 'Senior Product Designer, Design System'],
    ['Pennylane', 'Product Designer (Confirmed/Senior) – Pennylane – Permanent contract –', 'Product Designer (Confirmed/Senior)'],
    ['Extend', 'Job Application for Product Designer II at Extend', 'Product Designer II'],
    ['Collective.work', 'UX/UI Designer confirmé H/F - CDI', 'UX/UI Designer confirmé'],
    ['Time to hire', 'Product Designer (m/f/d)- Physical Products & AI - home decor brand -', 'Product Designer - Physical Products & AI - home decor brand'],
    ['Baymard Institute', 'SaaS Product Designer (full-time remote, America & Europe) at Baymard', 'SaaS Product Designer'],
    // A title the tracker cut mid-bracket.
    ['General Assembly', 'Lead Learning Experience Designer - Europe, APAC (30 hour', 'Lead Learning Experience Designer - Europe, APAC'],
    // "UI/UX" is no gender tag; a lower-case "remote" opens a real title.
    ['Acme', 'Senior UI/UX Designer', 'Senior UI/UX Designer'],
    ['Acme', 'Remote sensing analyst', 'Remote sensing analyst'],
  ];
  for (const [company, role, want] of table) assert.equal(cleanOfferIdentity({ company, role }).role, want, role);
  // The company's name stored as the role: the company stays, the role goes.
  assert.deepEqual(cleanOfferIdentity({ company: 'Pennylane', role: 'Pennylane' }), { company: 'Pennylane', role: '' });
  assert.deepEqual(cleanOfferIdentity({ company: 'Choisir le service public', role: 'Choisir le service public' }), { company: 'Choisir le service public', role: '' });
  // The careers page's words around the company.
  assert.equal(cleanOfferIdentity({ company: 'Jobs bei Saypien', role: 'UX/UI Designer (AI) (m/w/d)' }).company, 'Saypien');
});

test('cleanOfferIdentity: the candidate\'s own company is never the company; the title\'s org takes its place', () => {
  assert.deepEqual(cleanOfferIdentity({ company: 'OneAsset', role: 'Chess.com hiring Product Designer, Design Systems Job in Remote', cv: CV }), { company: 'Chess.com', role: 'Product Designer, Design Systems' });
  assert.deepEqual(cleanOfferIdentity({ company: 'OneAsset', role: 'Product Designer - Remote - Indeed.com', cv: CV }), { company: '', role: 'Product Designer' });
  assert.equal(cleanOfferIdentity({ company: 'OneAsset', role: 'Product Designer (UI/UX) @ TENTENS Tech', cv: CV }).company, 'TENTENS Tech');
  // A tracker company that is not the candidate's stays, even when the title names another form of it.
  assert.equal(cleanOfferIdentity({ company: 'Pennylane SAS', role: 'Pennylane hiring Product Designer - Remote Europe Job in London, England', cv: CV }).company, 'Pennylane SAS');
  // A job title or a job board stored as the company.
  assert.equal(cleanOfferIdentity({ company: 'Senior Technical Product Manager', role: 'Senior Technical Product Manager' }).company, '');
  assert.equal(cleanOfferIdentity({ company: 'Glassdoor', role: 'Acme hiring Senior Designer Job in Paris | Glassdoor', jobUrl: 'https://www.glassdoor.fr/job-listing/x' }).company, 'Acme');
  // "Chess Com" from a Glassdoor slug reads as the site writes it.
  assert.equal(cleanOfferIdentity({ company: 'Chess Com', role: 'Product Designer' }).company, 'Chess.com');
  // "We're hiring" names no org.
  assert.equal(cleanOfferIdentity({ company: '', role: 'We\'re hiring Product Designers' }).company, '');
});

test('the guarded hints never tell the writer the candidate applies to their own company', () => {
  const offer = cleanOfferIdentity({ company: 'OneAsset', role: 'Vertech Industrial Systems hiring UX/UI Designer Job in Remote', cv: CV });
  const reader = withContact(parseRecipient('jobs@vertech.com'), { company: safeCompanyHint('OneAsset', CV) });
  const { user } = buildApplicationEmailMessages({ cv: CV, recipient: reader, roleHint: offer.role, companyHint: safeCompanyHint(offer.company, CV) });
  assert.doesNotMatch(user, /Company: OneAsset/);
  assert.match(user, /Company: Vertech Industrial Systems/);
  // With no hint at all, the domain's reading, never the tracker's own company.
  const bare = buildApplicationEmailMessages({ cv: CV, recipient: withContact(parseRecipient('jobs@vertech.com'), { company: safeCompanyHint('OneAsset', CV) }) });
  assert.doesNotMatch(bare.user, /Company: OneAsset/);
  assert.match(bare.user, /Company \(from the domain\): Vertech/);
});

test('the blurb guard keeps the candidate\'s own sentences and the paragraphs, and takes a curly \'s', () => {
  const body = [
    'Hello,',
    'Vertech designs industrial automation solutions. I\'m applying for the UX and UI Designer role.',
    'Creads.io is an AI advertising SaaS I built, with 1,200 users. Figma is my main tool.',
    'My CV is attached. Could we talk this week?',
    'Best,\nHugo Vermot',
  ].join('\n\n');
  const out = stripUnsourcedCompanyBlurb(body, { company: 'Vertech', domain: 'vertech.com', sourceText: '' });
  assert.deepEqual(out.removed, ['Vertech designs industrial automation solutions.']);
  assert.match(out.body, /Creads\.io is an AI advertising SaaS I built, with 1,200 users\. Figma is my main tool\./);
  assert.equal(out.body.split('\n\n').length, 5, out.body);
  assert.match(out.body, /^Hello,\n\nI'm applying for the UX and UI Designer role\.\n\nCreads\.io/);
  // The candidate's product or a tool as the company: the CV or the tool list says it is theirs.
  const cv = '# Hugo Vermot\n\n### Projects\n\n#### Creads.io : Founder (2024 - present)\n- AI advertising SaaS, 1,200 users.\n';
  const own = stripUnsourcedCompanyBlurb(body, { companyGuess: 'Creads', domain: 'creads.io', company: 'Creads.io', cv });
  assert.equal(own.removed.length, 0);
  const tool = stripUnsourcedCompanyBlurb('Hello,\n\nFigma is my main tool.\n\nBest,\nHugo', { company: 'Figma', domain: 'figma.com' });
  assert.equal(tool.removed.length, 0);
  // A curly apostrophe, and the last sentence of a paragraph: the break stays.
  const curly = stripUnsourcedCompanyBlurb('Hello,\n\nI\'m applying for the role. Vertech’s platform is used in 40 plants.\n\nCould we talk?', { domain: 'vertech.com' });
  assert.deepEqual(curly.removed, ['Vertech’s platform is used in 40 plants.']);
  assert.equal(curly.body, 'Hello,\n\nI\'m applying for the role.\n\nCould we talk?');
});

test('draftApplicationEmailRequest guards contact.company, cleans the hints, passes forwardTo and the profile language (source read as text)', () => {
  const source = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf-8');
  const start = source.indexOf('async function draftApplicationEmailRequest(');
  assert.ok(start > 0);
  const fn = source.slice(start, source.indexOf('\n}\n', start));
  assert.match(fn, /contact\.company = safeCompanyHint\(cleanOfferIdentity\(/);
  assert.match(fn, /cleanOfferIdentity\(\{ company: companyHint, role: roleHint, jobUrl, cv \}\)/);
  assert.match(fn, /roleHint: offer\.role/);
  assert.match(fn, /companyHint: safeCompanyHint\(offer\.company, cv\)/);
  assert.match(fn, /firstName: cleanString\(body\.forwardTo\.firstName\)\.slice\(0, 60\)/);
  assert.match(fn, /title: cleanString\(body\.forwardTo\.title\)\.slice\(0, 80\)/);
  assert.match(fn, /^\s+forwardTo,$/m);
  assert.match(fn, /profileLanguage: configuredOutputLanguage\(profileData\)/);
  assert.match(fn, /companyBrief\(\{ home, pages:/);
  assert.match(fn, /readAccountCv\(WRITE_ROOT, applyAccountOf\(userId\)\)/);
  assert.match(fn, /Aucun CV PDF sur votre compte : l\\'email dit qu\\'il est joint\. Générez-le dans Profil\./);
  assert.match(fn, /^\s+attachment,$/m);
  // The blurb guard runs inside the writer now, not after it.
  assert.doesNotMatch(fn, /stripUnsourcedCompanyBlurb\(/);
  assert.doesNotMatch(fn, /textFromFetchedHtml\(/);
});

test('both email modals remind to attach the PDF and keep a long mailto usable (page read as text)', () => {
  const page = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf-8');
  const fnText = name => {
    const start = page.indexOf(`function ${name}(`);
    assert.ok(start > 0, name);
    return page.slice(start, page.indexOf('\n}\n', start));
  };
  const links = fnText('setComposeLinks');
  assert.match(page, /const MAILTO_MAX = 1900;/);
  assert.match(links, /body\.replace\(\/\\r\?\\n\/g, '\\r\\n'\)/);
  assert.match(links, /Body copied: paste it into the message/);
  assert.match(fnText('renderEmailAttachment'), /Attach before sending: /);
  assert.match(fnText('cfComposeLinks'), /setComposeLinks\(/);
  assert.match(fnText('emailComposeLinks'), /setComposeLinks\(/);
  assert.match(fnText('cfRenderDraft'), /renderEmailAttachment\(document\.getElementById\('cf-draft'\), draft\.attachment\)/);
  assert.match(page, /renderEmailAttachment\(document\.getElementById\('email-result'\), draft\.attachment\)/);
});