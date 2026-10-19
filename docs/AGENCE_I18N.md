# Languages on /agence (v2 studio)

Since 2026-10-18 the site has no language switch. Each visitor gets the site in their own language, chosen by the server.

## How the language is chosen

The server decides on every request to `/agence` and `/agence/<page>` (`lib/agence-i18n.mjs`, `pickAgenceLang`). It takes the first of these that gives an answer:

1. `?lang=<code>` in the URL, for example `?lang=ja`. The choice is kept in the `v2studio-lang` cookie for a year. `?lang=auto` deletes the cookie.
2. The `v2studio-lang` cookie.
3. The browser languages (`Accept-Language`), in the visitor's order of preference. `de-AT` gives German and `fr-CA` gives French. `pt` gives Brazilian Portuguese, or European Portuguese in Portugal, Angola, Mozambique and Cape Verde. `zh` gives Simplified Chinese, or Traditional Chinese in Taiwan, Hong Kong and Macao.
4. The visitor's country (Vercel's `x-vercel-ip-country` header). It is used only when none of the browser's languages is supported, for example a Swahili browser in Japan gives Japanese.
5. English.

The server then writes `<html lang="…">` and injects `window.AG_I18N` at the `<!--agence-i18n-->` marker in the page shells (`ui/agence.html`, `ui/agence/page.html`). For a machine-translated language, that object includes the whole translation catalogue, so the page is never shown half in English. The responses carry `Vary: Accept-Language, Cookie`.

## Who writes what

- **English and French are written by hand**, as before: `ui/portfolio/agence-i18n.js`, plus the `{ en, fr }` pairs in agence-story, agence-data, agence-extras, agence-checkout, agence-work and story-ifaces. They are never machine-translated.
- **The other 39 languages** are machine translations of the English copy, listed in `AGENCE_LANGS`:
  - Western Europe: es, de, it, pt-BR, pt-PT, nl, sv, da, nb, fi, ca;
  - Central and Eastern Europe: pl, cs, sk, ro, hu, el, bg, hr, sl, lt, lv, et, uk, ru, tr;
  - Middle East and South Asia: ar, he, fa, hi, bn;
  - East and Southeast Asia: id, ms, th, vi, ja, ko, zh-Hans, zh-Hant.

  They live in `ui/portfolio/i18n/<code>.json`. Each entry is keyed by a hash of its English sentence.
- **On the page:** the scripts read the English copy, then `agTr(text)` / `agTrDeep(object)` swap in the translation. These functions are defined in the shells' head script; the key is computed the same way as `i18nKey()` on the server. A sentence with no translation stays in English.

## Updating the translations after a copy change

Edit the English (and French) copy as usual, then run:

```bash
node scripts/agence-translate.mjs
```

- **What it translates:** the script finds every English sentence on its own, without running the page code (acorn parser):
  - every string under the `en` key of an object that also has an `fr` key;
  - the literal argument of the `agTr('…')` / `ifaceTr('…')` calls.

  It sends only new or changed sentences to Qwen (`qwen/qwen3-235b-a22b-2507` through OpenRouter) and removes translations whose English sentence no longer exists.
- **Checks on each translation:** a translation is kept only if it keeps the source's HTML tags, `{placeholders}`, `|` separators and URLs. Em and en dashes become commas. Anything else stays in English.
  - Exception: `<br>` in the big headlines may move, so each headline breaks where the translated sentence breaks naturally.
  - The prompt also asks for no gender notation such as "Kund:innen".
  - **"AI":** `AI_TERMS` in the script names the term for each language (KI in German and Norwegian, IA in Spanish, ИИ in Russian, tekoäly in Finnish…). Other languages keep "AI". Giving only a few examples made the model use KI in Finnish, Polish or Estonian.
  - **Meaning notes:** `NOTES` maps an English string the model misreads to a note on what it means, sent along with that string. The hero headline needs one ("skips" is a verb).
- **Options:**
  - `--count` shows how much text there is (1,174 sentences and 55,000 characters on 2026-10-18);
  - `--langs de,ja` translates only some languages;
  - `--dry` lists what is missing without calling the API;
  - `--redo '<regex>'` translates again the English strings that match, even when a translation exists. To redo a whole language, delete its file and run again.
- **Cost:** a full run is about 1.2 million tokens, well under $1. After that, a run only costs the changed sentences.
- **A new string in the code:** wrap it in `agTr('…')` so the script finds it, or put it in a `{ en, fr }` dictionary.

## What stays in English or French

- **Terms of sale and legal notices** (`/agence/terms`, `/agence/legal`) stay in English and French only. A machine translation of a contract is not binding. In any other language, the page shows the English text, with a (translated) note saying so (`agence-legal.js`).
- **The order email** sent to the founder: in other languages its labels stay in English, with a "Visitor language: …" line. The visitor writes their brief in their own words.
- **Stripe:** the payment page opens in the visitor's language when Stripe offers it (`stripeLocale()` in `lib/agence-checkout.mjs`); otherwise Stripe picks one itself (`auto`). The line names on the invoice stay in English or French.
- **The assistant** answers in the visitor's language (`agencyLanguageInstruction`).

## Known limits

- **Arabic, Hebrew and Persian:** the layout is not mirrored. Each paragraph takes the direction of its own text (`unicode-bidi: plaintext`, class `rtl-text`).
- **Scripts the fonts lack:** Cabinet Grotesk and Boska only cover Latin. Cyrillic, Greek, Arabic, Hebrew, Indic scripts, Thai and CJK use the system fonts.
- **Search engines** see whatever the request asks for (the language of their `Accept-Language`). There are no separate URLs per language and no hreflang.
- **The local server** (`ui/server.mjs`) must be restarted to pick up the language detection. Until then, the page falls back to the old EN/FR behaviour based on the browser.
