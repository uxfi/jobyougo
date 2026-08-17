/**
 * Tests for lib/challenge-detect.mjs
 * Run: node tests/challenge-detect.test.mjs
 */
import { detectChallenge, matchChallengeText } from '../lib/challenge-detect.mjs';

const LONG = 'ActBlue is hiring a Senior Product Manager. '.repeat(60); // >1500 chars

const cases = [
  // ── Faux positifs qui cassaient le pipeline (doivent PASSER) ──────────────
  ['page live + script email-decode Cloudflare',
    { html: '<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>', text: LONG }, false],
  ['page live avec <meta name="robots">',
    { html: '<meta name="robots" content="index,follow">', text: LONG }, false],
  ['careers page d une boite de ROBOTIQUE',
    { html: '<html>', text: 'We build robotics and robotic automation. ' + LONG }, false],
  ['careers page de Cloudflare elle-meme',
    { html: '<html>', text: 'Cloudflare is hiring. Work at Cloudflare. ' + LONG }, false],
  ['JD securite mentionnant "security check"',
    { html: '<html>', text: 'You will run a security check each release. ' + LONG }, false],
  ['page longue mentionnant captcha (article)',
    { html: '<html>', text: 'We discuss captcha design patterns. ' + LONG }, false],

  // ── Vrais challenges (doivent BLOQUER) ───────────────────────────────────
  ['challenge Cloudflare (infrastructure)',
    { html: '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>', text: 'Just a moment...' }, true],
  ['interstitiel texte "checking your browser"',
    { html: '<html>', text: 'Checking your browser before accessing the site.' }, true],
  ['reCAPTCHA',
    { html: '<div class="g-recaptcha" data-sitekey="x"></div>', text: 'Verify' }, true],
  ['hCaptcha',
    { html: '<div class="h-captcha"></div>', text: 'Verify' }, true],
  ['Cloudflare Turnstile',
    { html: '<div class="cf-turnstile"></div>', text: 'Verify' }, true],
  ['DataDome',
    { html: '<script src="https://geo.captcha-delivery.com/captcha/"></script>', text: 'x' }, true],
  ['PerimeterX',
    { html: '<div id="_px_captcha"></div>', text: 'x' }, true],
  ['Incapsula',
    { html: '<iframe src="/_Incapsula_Resource?SWCGHOEL"></iframe>', text: 'x' }, true],
  ['"I am not a robot" (phrase complete)',
    { html: '<html>', text: "Please confirm: I'm not a robot." }, true],
  ['captcha sur page COURTE',
    { html: '<html>', text: 'Please solve the captcha to continue.' }, true],
  ['access denied court',
    { html: '<html>', text: 'Access denied. You do not have permission.' }, true],
  ['DuckDuckGo anomaly-modal',
    { html: '<html>', text: 'anomaly-modal' }, true],
  ['HTTP 403', { status: 403, html: 'x', text: 'x' }, true],
  ['HTTP 429', { status: 429, html: 'x', text: 'x' }, true],
];

let pass = 0, fail = 0;
for (const [name, input, expected] of cases) {
  const r = detectChallenge(input);
  const ok = r.blocked === expected;
  ok ? pass++ : fail++;
  console.log(
    `  ${ok ? 'OK   ' : 'ECHEC'}  ${(r.blocked ? 'bloque' : 'passe').padEnd(7)}` +
    `${name}${ok ? '' : `  (attendu ${expected ? 'bloque' : 'passe'})`}` +
    `${r.marker ? `  [${r.reason}:${r.marker}]` : ''}`,
  );
}

// Regle de la page courte: le meme marqueur faible bascule selon la longueur.
const shortHit = matchChallengeText('access denied');
const longHit = matchChallengeText('access denied ' + LONG);
const lenRule = shortHit === 'access denied' && longHit === null;
console.log(`  ${lenRule ? 'OK   ' : 'ECHEC'}  regle page courte: marqueur faible actif <1500 chars, ignore au-dela`);
lenRule ? pass++ : fail++;

console.log(`\n${pass}/${pass + fail} tests conformes`);
process.exit(fail ? 1 : 0);
