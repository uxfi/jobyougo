import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  AGENCE_LANGS, MACHINE_LANGS, i18nKey, matchLangTag, parseAcceptLanguage, pickAgenceLang, localizeAgenceHtml, agenceLanguageName,
} from '../lib/agence-i18n.mjs';
import { stripeLocale } from '../lib/agence-checkout.mjs';
import { extractEnglish } from '../scripts/agence-translate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The agTr / agTrDeep the page defines in its head script, run against a fake window. */
function pageRuntime(shell, AG_I18N) {
  const html = readFileSync(join(ROOT, shell), 'utf-8');
  const start = html.indexOf('(function () {', html.indexOf('window.SITE base fields'));
  const end = html.indexOf('</script>', start);
  const code = html.slice(start, end);
  const classes = new Set();
  const documentElement = { lang: 'en', classList: { add: (c) => classes.add(c) } };
  const window = { AG_I18N, location: { search: '' } };
  const ctx = vm.createContext({ window, document: { documentElement }, navigator: { language: 'en-US' }, URLSearchParams, Math, Object, Array, String });
  vm.runInContext(code, ctx);
  return { window, documentElement, classes };
}

test('i18nKey: the page computes the same key as the server and the translate script', () => {
  const samples = ['Start a project', 'Les détails<br>que l’IA oublie', 'Prix : {total}', '日本語', '😀 emoji', ''];
  const cat = Object.fromEntries(samples.map((s, i) => [i18nKey(s), `T${i}`]));
  const { window } = pageRuntime('ui/agence.html', { code: 'de', base: 'en', intl: 'de-DE', mt: true, rtl: false, cat });
  samples.forEach((s, i) => { if (s) assert.equal(window.agTr(s), `T${i}`, s); });
  assert.equal(window.agTr('not in the catalogue'), 'not in the catalogue');
  // JSON round trip: the result comes from another vm realm, so its prototypes differ.
  assert.deepEqual(JSON.parse(JSON.stringify(window.agTrDeep({ a: ['Start a project', 3], b: { c: '日本語' } }))), { a: ['T0', 3], b: { c: 'T3' } });
});

test('page head: EN and FR never go through the catalogue; machine languages flag the page', () => {
  const en = pageRuntime('ui/agence/page.html', { code: 'en', base: 'en', intl: 'en-US', mt: false, rtl: false });
  assert.equal(en.window.agTr('Start a project'), 'Start a project');
  assert.equal(en.window.SITE.initialLang, 'en');
  assert.ok(!en.classes.has('i18n-pending'));
  const fr = pageRuntime('ui/agence/page.html', { code: 'fr', base: 'fr', intl: 'fr-FR', mt: false, rtl: false });
  assert.equal(fr.window.SITE.initialLang, 'fr');
  assert.ok(fr.classes.has('i18n-pending'));
  const ar = pageRuntime('ui/agence/page.html', { code: 'ar', base: 'en', intl: 'ar', mt: true, rtl: true, cat: {} });
  assert.equal(ar.documentElement.lang, 'ar');
  assert.equal(ar.window.SITE.initialLang, 'en');
  assert.equal(ar.window.SITE.locale, 'ar');
  assert.ok(ar.classes.has('i18n-mt') && ar.classes.has('rtl-text') && ar.classes.has('i18n-pending'));
  const none = pageRuntime('ui/agence.html', undefined);
  assert.equal(none.window.SITE.initialLang, 'en');
});

test('matchLangTag: regional variants, legacy tags and unknown languages', () => {
  assert.equal(matchLangTag('de-AT'), 'de');
  assert.equal(matchLangTag('fr-CA'), 'fr');
  assert.equal(matchLangTag('EN_gb'), 'en');
  assert.equal(matchLangTag('pt'), 'pt-BR');
  assert.equal(matchLangTag('pt', 'PT'), 'pt-PT');
  assert.equal(matchLangTag('pt-AO'), 'pt-PT');
  assert.equal(matchLangTag('zh-HK'), 'zh-Hant');
  assert.equal(matchLangTag('zh-Hans-SG'), 'zh-Hans');
  assert.equal(matchLangTag('zh', 'TW'), 'zh-Hant');
  assert.equal(matchLangTag('nn'), 'nb');
  assert.equal(matchLangTag('iw'), 'he');
  assert.equal(matchLangTag('sw'), null);
  assert.equal(matchLangTag('*'), null);
});

test('parseAcceptLanguage: quality values first, then header order', () => {
  assert.deepEqual(parseAcceptLanguage('fr;q=0.5, de-DE, en;q=0.8, xx;q=0'), ['de-DE', 'en', 'fr']);
  assert.deepEqual(parseAcceptLanguage(''), []);
});

test('pickAgenceLang: ?lang, cookie, browser, country, English', () => {
  const al = 'sw-KE,sw;q=0.9,de;q=0.8,en;q=0.5';
  assert.equal(pickAgenceLang({ acceptLanguage: al }).code, 'de');
  assert.equal(pickAgenceLang({ acceptLanguage: 'sw', country: 'JP' }).code, 'ja');
  assert.equal(pickAgenceLang({ acceptLanguage: 'sw', country: 'KE' }).code, 'en');
  assert.equal(pickAgenceLang({}).code, 'en');
  const cookie = pickAgenceLang({ cookie: 'a=1; v2studio-lang=ko', acceptLanguage: al });
  assert.deepEqual([cookie.code, cookie.source], ['ko', 'cookie']);
  const q = pickAgenceLang({ query: 'IT', cookie: 'v2studio-lang=ko', acceptLanguage: al });
  assert.equal(q.code, 'it');
  assert.match(q.setCookie, /^v2studio-lang=it; Path=\/; Max-Age=31536000; SameSite=Lax$/);
  const auto = pickAgenceLang({ query: 'auto', cookie: 'v2studio-lang=ko', acceptLanguage: al });
  assert.equal(auto.code, 'de');
  assert.match(auto.setCookie, /Max-Age=0/);
  assert.equal(pickAgenceLang({ query: 'klingon', acceptLanguage: 'fr-FR' }).code, 'fr');
});

test('localizeAgenceHtml: lang attribute, safe inline JSON, English when a catalogue is missing', () => {
  const shell = '<html lang="en"><head><!--agence-i18n--></head></html>';
  const de = localizeAgenceHtml(shell, 'de', { k1: 'Hallo </script><b>' });
  assert.match(de, /<html lang="de">/);
  assert.ok(!de.includes('</script><b>'));
  const payload = JSON.parse(de.match(/window\.AG_I18N=(.*?);<\/script>/)[1]);
  assert.deepEqual(payload, { code: 'de', base: 'en', intl: 'de-DE', mt: true, rtl: false, cat: { k1: 'Hallo </script><b>' } });
  const fr = localizeAgenceHtml(shell, 'fr', null);
  assert.match(fr, /<html lang="fr">/);
  assert.ok(!fr.includes('"cat"'));
  const missing = localizeAgenceHtml(shell, 'ja', null);
  assert.match(missing, /<html lang="en">/);
  assert.equal(agenceLanguageName('zh-Hant'), 'Traditional Chinese');
  assert.equal(agenceLanguageName('??'), 'English');
});

test('stripeLocale: Stripe page language, auto when Stripe has none', () => {
  assert.equal(stripeLocale('fr'), 'fr');
  assert.equal(stripeLocale('de'), 'de');
  assert.equal(stripeLocale('pt-PT'), 'pt');
  assert.equal(stripeLocale('zh-Hant'), 'zh-TW');
  assert.equal(stripeLocale('ar'), 'auto');
  assert.equal(stripeLocale(''), 'en');
});

test('extractEnglish: dictionaries, {en, fr} pairs and agTr() literals', async () => {
  const found = await extractEnglish();
  const texts = new Set([...found.values()].map((v) => v.text));
  assert.ok(texts.has('Start a project'), 'nav_contact from agence-i18n.js');
  assert.ok(texts.has('month'), "agTr('month') in agence-data.js");
  assert.ok(texts.has('This page exists in English and French only. The English version below is the one that applies.'));
  for (const v of found.values()) assert.ok(/\p{L}/u.test(v.text), `no letter-less strings: ${v.text}`);
  assert.ok(found.size > 500);
});

test('catalogues: one file per machine language at most, each well formed', () => {
  const dir = join(ROOT, 'ui', 'portfolio', 'i18n');
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const code = file.replace(/\.json$/, '');
    assert.ok(MACHINE_LANGS.includes(code), `${file} is a machine language`);
    const json = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
    assert.equal(json._meta.lang, code);
    for (const [k, v] of Object.entries(json.k)) {
      assert.match(k, /^[0-9a-z]+$/);
      assert.equal(typeof v, 'string');
    }
  }
  assert.equal(AGENCE_LANGS.length, new Set(AGENCE_LANGS.map((l) => l.code)).size);
});
