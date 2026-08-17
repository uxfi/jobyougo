/**
 * Tests for lib/form-detect.mjs — runs the probe in a real Chromium.
 * Run: node tests/form-detect.test.mjs
 */
import { chromium } from 'playwright';
import { APPLICATION_FORM_PROBE, AUTH_AVOID_TEXT_RE, GUEST_TEXT_RE } from '../lib/form-detect.mjs';

const cases = [
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

  ['Barre de recherche seule', `
    <input type="text" name="search" placeholder="Search jobs">
    <input type="text" name="location" placeholder="Location">`, 'none'],
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let pass = 0, fail = 0;

for (const [name, body, expected] of cases) {
  // /apply dans l'URL pour les cas qui le mentionnent, sinon une URL neutre.
  const url = /URL \/apply/.test(name) ? 'https://x.test/jobs/1/apply' : 'https://x.test/jobs/1';
  await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: `<html><body>${body}</body></html>` }));
  await page.goto(url);
  const r = await page.evaluate(APPLICATION_FORM_PROBE);
  const ok = r.verdict === expected;
  ok ? pass++ : fail++;
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
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'OK   ' : 'ECHEC'}  ${label.padEnd(17)}"${text}" → ${got}`);
}

// ── Integration: choix du bouton sur une modale interstitielle ────────────
// Reproduit la logique de marquage de clickApplyAndFollow (apply-runner.mjs)
// pour verifier que le veto AUTH_AVOID s'applique bien APRES le match.
console.log('');
const MARK = ({ reSrc, avoidSrc }) => {
  const re = new RegExp(reSrc, 'i');
  const avoid = new RegExp(avoidSrc, 'i');
  const out = [];
  for (const el of document.querySelectorAll('a, button, [role="button"]')) {
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 80 || !re.test(t)) continue;
    if (avoid.test(t)) continue;
    out.push(t);
  }
  return out;
};

const b2 = await chromium.launch({ headless: true });
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
];
for (const [name, body, re, expected] of flows) {
  await p2.setContent(`<html><body>${body}</body></html>`);
  const got = await p2.evaluate(MARK, { reSrc: re.source, avoidSrc: AUTH_AVOID_TEXT_RE.source });
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'OK   ' : 'ECHEC'}  cliquerait ${JSON.stringify(got).padEnd(32)}${name}${ok ? '' : `  (attendu ${JSON.stringify(expected)})`}`);
}
await b2.close();

console.log(`\n${pass}/${pass + fail} tests conformes`);
process.exit(fail ? 1 : 0);
