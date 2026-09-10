/**
 * Tests for lib/challenge-detect.mjs
 * Run: node tests/challenge-detect.test.mjs
 */
import { detectChallenge, matchChallengeText } from '../lib/challenge-detect.mjs';
import { pass, fail } from './helpers.mjs';

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
  ['page Greenhouse longue avec script reCAPTCHA passif',
    { html: '<script src="https://www.google.com/recaptcha/api.js"></script><div class="grecaptcha-badge"></div>', text: LONG }, false],
  ['page longue avec SDK DataDome passif',
    { html: '<script src="https://js.datadome.co/tags.js"></script>', text: LONG }, false],
  ['page longue avec pixel Akamai passif',
    { html: '<img src="/akam/13/pixel_123">', text: LONG }, false],
  ['page longue avec SDK PerimeterX passif',
    { html: '<script src="https://client.perimeterx.net/PX123/main.min.js"></script>', text: LONG }, false],
  ['page longue avec SDK Kasada passif',
    { html: '<script src="https://api.kasada.io/p.js"></script>', text: LONG }, false],

  // ── Vrais challenges (doivent BLOQUER) ───────────────────────────────────
  ['challenge Cloudflare (infrastructure)',
    { html: '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>', text: 'Just a moment...' }, true],
  ['cf-mitigated sur page avec beaucoup de texte',
    { html: '<html cf-mitigated="challenge">', text: LONG }, true],
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
  ['DuckDuckGo captcha canard',
    { html: '<html>', text: 'Select all squares containing a duck' }, true],
  ['HTTP 403', { status: 403, html: 'x', text: 'x' }, true],
  ['HTTP 429', { status: 429, html: 'x', text: 'x' }, true],

  // ── Parite avec apply-runner.mjs (vendeurs + formulations) ───────────────
  ['Arkose Labs / FunCaptcha',
    { html: '<iframe src="https://client-api.arkoselabs.com/v2/x"></iframe>', text: 'x' }, true],
  ['AWS WAF',
    { html: '<iframe src="https://captcha.awswaf.com/x"></iframe>', text: 'x' }, true],
  ['Friendly Captcha',
    { html: '<div class="frc-captcha"></div>', text: 'x' }, true],
  ['GeeTest',
    { html: '<div class="geetest_holder"></div>', text: 'x' }, true],
  ['"Pardon our interruption" (Imperva)',
    { html: '<html>', text: 'Pardon our interruption as we verify you are a real person.' }, true],
  ['"Press and hold" (PerimeterX)',
    { html: '<html>', text: 'Press and hold to confirm you are human.' }, true],
  ['"Human verification"',
    { html: '<html>', text: 'Human verification required to continue.' }, true],
  ['"Request could not be satisfied" (CloudFront)',
    { html: '<html>', text: 'The request could not be satisfied.' }, true],

  // Le meme vocabulaire dans une VRAIE annonce longue ne doit pas bloquer.
  ['JD longue parlant de verification automatisee',
    { html: '<html>', text: 'You will design human verification flows and automated access controls. ' + LONG }, false],
];

for (const [name, input, expected] of cases) {
  const r = detectChallenge(input);
  const ok = r.blocked === expected;
  const details = `${r.blocked ? 'bloque' : 'passe'} ${name}`
    + `${r.marker ? ` [${r.reason}:${r.marker}]` : ''}`;
  if (ok) pass(details);
  else fail(`${details} (attendu ${expected ? 'bloque' : 'passe'})`);
}

// Regle de la page courte: le meme marqueur faible bascule selon la longueur.
const shortHit = matchChallengeText('access denied');
const longHit = matchChallengeText('access denied ' + LONG);
const lenRule = shortHit === 'access denied' && longHit === null;
if (lenRule) pass('regle page courte: marqueur faible actif <1500 chars, ignore au-dela');
else fail('regle page courte: marqueur faible actif <1500 chars, ignore au-dela');

const weakOff = matchChallengeText('access denied', { allowWeak: false });
if (weakOff === null) pass('allowWeak:false ignore les marqueurs faibles');
else fail(`allowWeak:false a matché ${weakOff}`);

const livenessCopy = matchChallengeText('Performing security verification. Ray ID: abc.', { allowWeak: false });
if (livenessCopy) pass(`copie liveness reconnue [${livenessCopy}]`);
else fail('copie liveness (performing security verification / ray id) non reconnue');
