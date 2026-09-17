/**
 * Tests for lib/form-detect.mjs — runs the probe in a real Chromium.
 * Run: node tests/form-detect.test.mjs
 */
import { chromium } from 'playwright';
import { APPLICATION_FORM_PROBE, AUTH_AVOID_TEXT_RE, GUEST_TEXT_RE, MARK_PROGRESSION_CONTROLS, PAGE_SHOWS_APPLY_ENTRY } from '../lib/form-detect.mjs';
import { pass, fail } from './helpers.mjs';

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

const cases = [
  ['Ashby — overview sans champ malgré les classes ATS', `
    <div class="ashby-job-posting"><h1>Staff Engineer</h1>
    <h2>Why You Should Apply</h2><button role="tab">Application</button>
    <button>Apply for this Job</button></div>`, 'none'],

  ['Ashby — formulaire masqué sur la fiche offre', `
    <div class="ashby-job-posting"><h1>Staff Engineer</h1>
    <div style="display:none"><input name="name"><input type="email" name="email">
    <input type="file" name="resume"></div>
    <button role="tab">Application</button></div>`, 'none'],

  ['Greenhouse — vrai formulaire', `
    <div id="application_form">
      <h1>Apply for this job</h1>
      <input type="text" name="first_name" placeholder="First name">
      <input type="email" name="email">
      <input type="file" name="resume">
      <textarea name="cover_letter"></textarea>
    </div>`, 'application_form'],

  ['Ashby — formulaire SPA', `
    <div class="ashby-application-form-container">
      <h2>Application</h2>
      <input type="text" name="_systemfield_name">
      <input type="email" name="_systemfield_email">
      <input type="file" name="_systemfield_resume">
    </div>`, 'application_form'],

  ['Formulaire minimal sur URL /apply', `
    <h1>Apply</h1>
    <input type="text" name="full_name"><input type="email" name="email">
    <input type="file" name="cv">`, 'application_form'],

  // ── Les faux positifs qui cassaient le runner ───────────────────────────
  ['Mur d INSCRIPTION', `
    <h1>Create your account</h1>
    <p>Sign up to apply for this job</p>
    <input type="text" name="full_name" placeholder="Full name">
    <input type="email" name="email" placeholder="Email address">
    <input type="password" name="password">
    <button>Sign up</button>
    <a href="#">Already have an account? Log in</a>`, 'auth_wall'],

  ['Mur de CONNEXION', `
    <h1>Sign in</h1>
    <input type="email" name="email"><input type="password" name="password">
    <button>Log in</button><a href="#">Forgot your password?</a>`, 'auth_wall'],

  ['Inscription SANS champ password visible (OTP)', `
    <h1>Create an account to continue</h1>
    <input type="email" name="email" placeholder="Email">
    <input type="text" name="name" placeholder="Your name">
    <button>Sign up</button>`, 'auth_wall'],

  ['Newsletter en pied de page', `
    <h1>Senior Product Designer</h1><p>Job description.</p>
    <footer>
      <input type="text" name="name" placeholder="Your name">
      <input type="email" name="email" placeholder="Subscribe to our newsletter">
    </footer>`, 'none'],

  ['Page d offre sans formulaire', `
    <h1>Senior Product Designer</h1>
    <p>We are looking for a designer.</p>
    <a href="/apply">Apply now</a>`, 'none'],

  ['Deel Overview — Apply encore visible, CV caché dans l onglet Application', `
    <h1>Senior Staff Product Designer - AI</h1>
    <button role="tab">Overview</button>
    <button role="tab">Application</button>
    <p>Deel is the all-in-one payroll platform.</p>
    <button>Apply for this job</button>
    <div style="display:none">
      <input type="file" name="resume">
      <input name="first_name"><input type="email" name="email">
    </div>`, 'none'],

  ['Classes ATS + recherche + Apply — aperçu, pas le formulaire', `
    <div class="ashby-job-posting">
      <h1>Staff Engineer</h1>
      <input name="q" placeholder="Search jobs">
      <button>Apply for this job</button>
    </div>`, 'none'],

  ['Tabpanel Application fermé avec dropzone', `
    <div class="ashby-job-posting">
      <button role="tab" aria-selected="true">Overview</button>
      <button role="tab" id="app-tab" aria-selected="false">Application</button>
      <p>We are looking for a designer.</p>
      <div role="tabpanel" aria-labelledby="app-tab" aria-hidden="true">
        <p>Click or drag file to upload</p>
        <input type="file" name="resume">
        <input name="first_name"><input type="email" name="email">
      </div>
      <button>Apply for this job</button>
    </div>`, 'none'],

  ['Dropzone visible, input file en display none', `
    <h1>Apply</h1>
    <div>
      <p>Click or drag file to upload</p>
      <input type="file" name="resume" style="display:none">
      <input name="first_name"><input type="email" name="email">
    </div>`, 'application_form'],

  ['Barre de recherche seule', `
    <input type="text" name="search" placeholder="Search jobs">
    <input type="text" name="location" placeholder="Location">`, 'none'],
];

const browser = await launchBrowser();
const page = await browser.newPage();
let passed = 0, failed = 0;

for (const [name, body, expected] of cases) {
  // /apply dans l'URL pour les cas qui le mentionnent, sinon une URL neutre.
  const url = /URL \/apply/.test(name) ? 'https://x.test/jobs/1/apply' : 'https://x.test/jobs/1';
  await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: `<html><body>${body}</body></html>` }));
  await page.goto(url);
  const r = await page.evaluate(APPLICATION_FORM_PROBE);
  const ok = r.verdict === expected;
  ok ? passed++ : failed++;
  if (ok) pass(`form-detect probe: ${name}`);
  else fail(`form-detect probe: ${name} expected ${expected}, got ${r.verdict}`);
  console.log(
    `  ${ok ? 'OK   ' : 'ECHEC'}  ${r.verdict.padEnd(17)}${name}` +
    `${ok ? '' : `  (attendu ${expected})`}  [score ${r.score}${r.signals.length ? ' · ' + r.signals.join(',') : ''}${r.blockers.length ? ' · !' + r.blockers.join(',') : ''}]`,
  );
}
await browser.close();

// ── Vocabulaire de navigation ─────────────────────────────────────────────
console.log('');
const navCases = [
  ['Sign up', AUTH_AVOID_TEXT_RE, true, 'a eviter'],
  ['Create an account', AUTH_AVOID_TEXT_RE, true, 'a eviter'],
  ['Continue with Google', AUTH_AVOID_TEXT_RE, true, 'a eviter'],
  ['Se connecter', AUTH_AVOID_TEXT_RE, true, 'a eviter'],
  ['Apply now', AUTH_AVOID_TEXT_RE, false, 'a eviter'],
  ['Continue as guest', GUEST_TEXT_RE, true, 'chemin invite'],
  ['Apply without an account', GUEST_TEXT_RE, true, 'chemin invite'],
  ['Continuer sans compte', GUEST_TEXT_RE, true, 'chemin invite'],
  ['Apply on company website', GUEST_TEXT_RE, true, 'chemin invite'],
  ['Sign up', GUEST_TEXT_RE, false, 'chemin invite'],
];
for (const [text, re, expected, label] of navCases) {
  const got = re.test(text);
  const ok = got === expected;
  ok ? passed++ : failed++;
  if (ok) pass(`form-detect nav regex: ${label} "${text}"`);
  else fail(`form-detect nav regex: ${label} "${text}" expected ${expected}, got ${got}`);
  console.log(`  ${ok ? 'OK   ' : 'ECHEC'}  ${label.padEnd(17)}"${text}" → ${got}`);
}

// ── Integration: choix du bouton sur une modale interstitielle ────────────
// Exerce MARK_PROGRESSION_CONTROLS — la fonction EXACTE que apply-runner.mjs
// injecte, avec la meme charge utile. Une version re-implementee ici avait
// laisse passer un `ReferenceError: avoidSrc is not defined` en production.
console.log('');
const MARK = MARK_PROGRESSION_CONTROLS;

const b2 = await launchBrowser();
const p2 = await b2.newPage();
const flows = [
  ['Modale Jobicy (Sign Up and Apply / Continue as Guest)', `
     <button>Sign Up and Apply</button>
     <button>Continue as Guest</button>`, GUEST_TEXT_RE, ['Continue as Guest']],
  ['Modale sans accès invité', `
     <button>Sign up</button><button>Log in</button>`, GUEST_TEXT_RE, []],
  ['Page offre avec redirection externe', `
     <button>Sign up for job alerts</button>
     <a href="https://ats.example/apply">Apply on company website</a>`, GUEST_TEXT_RE, ['Apply on company website']],
  ['Onglet Application', `
     <button role="tab">Overview</button>
     <button role="tab">Application</button>
     <button>Apply for this job</button>`, /^(application|apply for this (job|position|role))$/i, ['Application', 'Apply for this job']],
];
for (const [name, body, re, expected] of flows) {
  await p2.setContent(`<html><body>${body}</body></html>`);
  const marked = await p2.evaluate(MARK, { reSrc: re.source, skip: [], avoidSrc: AUTH_AVOID_TEXT_RE.source });
  const got = marked.map(m => m.text);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  ok ? passed++ : failed++;
  if (ok) pass(`form-detect progression controls: ${name}`);
  else fail(`form-detect progression controls: ${name} expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  console.log(`  ${ok ? 'OK   ' : 'ECHEC'}  cliquerait ${JSON.stringify(got).padEnd(32)}${name}${ok ? '' : `  (attendu ${JSON.stringify(expected)})`}`);
}
await b2.close();

{
  const b3 = await launchBrowser();
  const p3 = await b3.newPage();
  await p3.setContent(`<html><body>
    <h1>Job</h1><button>Apply for this job</button>
  </body></html>`);
  const shown = await p3.evaluate(PAGE_SHOWS_APPLY_ENTRY);
  const ok = shown === true;
  ok ? passed++ : failed++;
  if (ok) pass('form-detect PAGE_SHOWS_APPLY_ENTRY: overview');
  else fail('form-detect PAGE_SHOWS_APPLY_ENTRY: overview expected true');
  await p3.setContent(`<html><body>
    <h1>Apply</h1><input type="email" name="email"><button>Submit application</button>
  </body></html>`);
  const hidden = await p3.evaluate(PAGE_SHOWS_APPLY_ENTRY);
  const ok2 = hidden === false;
  ok2 ? passed++ : failed++;
  if (ok2) pass('form-detect PAGE_SHOWS_APPLY_ENTRY: vrai formulaire');
  else fail('form-detect PAGE_SHOWS_APPLY_ENTRY: vrai formulaire expected false');
  await b3.close();
}

console.log(`\n${passed}/${passed + failed} tests conformes`);
