#!/usr/bin/env node
/**
 * Machine translations for /agence (v2 studio). 2026-10-18.
 *
 * Collects every English string the agence pages can show, translates the missing ones with Qwen, and writes
 * ui/portfolio/i18n/<code>.json as { _meta, k: { <i18nKey(english)>: translation } }. lib/agence-i18n.mjs
 * inlines that file into the page for visitors whose language is neither English nor French (both are
 * written by hand and never machine-translated).
 *
 * What counts as copy (parsed with acorn, nothing is executed):
 *   - every string under the `en` key of an object that also has an `fr` key (TRANSLATIONS, STORY, SITES,
 *     COPY, the offers JSON, brands, the work data…), at any depth;
 *   - the literal argument of agTr('…') / ifaceTr('…') calls (one-off strings in code).
 * A translation is keyed by a hash of its English source, so editing an English string makes it "missing"
 * again and the old translation is pruned. Re-run after copy changes; only new strings cost anything.
 *
 * Usage:
 *   node scripts/agence-translate.mjs --count               list how many strings and characters there are
 *   node scripts/agence-translate.mjs                       all machine languages
 *   node scripts/agence-translate.mjs --langs de,es,ja      some of them
 *   options: --concurrency 6  --model qwen/qwen3-235b-a22b-2507  --dry (no API calls, report what is missing)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { isMainModule } from '../lib/is-main-module.mjs';
import { AGENCE_LANGS, MACHINE_LANGS, i18nKey } from '../lib/agence-i18n.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'ui', 'portfolio', 'i18n');
const SOURCES = [
  'ui/portfolio/agence-i18n.js',
  'ui/portfolio/agence-story.js',
  'ui/portfolio/agence-data.js',
  'ui/portfolio/agence-extras.js',
  'ui/portfolio/agence-checkout.js',
  'ui/portfolio/agence-work.js',
  'ui/portfolio/story-ifaces.js',
  'ui/portfolio/agence-legal.js',
];
const TR_CALLEES = new Set(['agTr', 'ifaceTr']);
const DEFAULT_MODEL = 'qwen/qwen3-235b-a22b-2507';
const BATCH_CHARS = 5000;
const BATCH_ITEMS = 40;

/* ── Extraction ── */
function propName(p) {
  if (!p || p.type !== 'Property' || p.computed) return null;
  if (p.key.type === 'Identifier') return p.key.name;
  if (p.key.type === 'Literal') return String(p.key.value);
  return null;
}
function stringOf(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}
function collectStrings(node, out) {
  if (!node || typeof node !== 'object') return;
  const s = stringOf(node);
  if (s != null) { out.push(s); return; }
  if (node.type === 'ObjectExpression') {
    for (const p of node.properties) if (p.type === 'Property') collectStrings(p.value, out);
    return;
  }
  if (node.type === 'ArrayExpression') {
    for (const el of node.elements) collectStrings(el, out);
  }
}
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, visit); }
    else if (v && typeof v.type === 'string') walk(v, visit);
  }
}
/** Worth translating: has letters, and is not a bare URL, email, colour, path or identifier. */
function isCopy(s) {
  const t = s.trim();
  if (!t || !/\p{L}/u.test(t)) return false;
  if (/^(https?:\/\/|mailto:|tel:|\/|#|\.\/)\S*$/i.test(t)) return false;
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(t)) return false;
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(t)) return false; // slugs and ids: "secret-touch", "cta_primary"
  return true;
}
export async function extractEnglish() {
  const found = new Map(); // key → { text, files:Set }
  for (const rel of SOURCES) {
    const src = await readFile(join(ROOT, rel), 'utf-8');
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true });
    const add = (s) => {
      if (!isCopy(s)) return;
      const k = i18nKey(s);
      if (!found.has(k)) found.set(k, { text: s, files: new Set() });
      found.get(k).files.add(rel);
    };
    walk(ast, (node) => {
      if (node.type === 'ObjectExpression') {
        const props = node.properties.filter((p) => p.type === 'Property');
        const en = props.find((p) => propName(p) === 'en');
        if (en && props.some((p) => propName(p) === 'fr')) {
          const list = [];
          collectStrings(en.value, list);
          list.forEach(add);
        }
      } else if (node.type === 'CallExpression') {
        const c = node.callee;
        const name = c.type === 'Identifier' ? c.name : (c.type === 'MemberExpression' && !c.computed ? c.property.name : '');
        if (TR_CALLEES.has(name)) {
          const s = stringOf(node.arguments[0]);
          if (s != null) add(s);
        }
      }
    });
  }
  return found;
}

/* ── Translation ── */
const TAG_RE = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
const PH_RE = /\{\w+\}/g;
const URL_RE = /https?:\/\/[^\s<>"')]+|[\w.+-]+@[\w-]+\.[\w.]+/g;
const signature = (s) => ({
  // <br> may move or change count: a headline breaks where the translated sentence breaks naturally.
  tags: (s.match(TAG_RE) || []).map((t) => t.replace(/\s+[^>]*/, '').toLowerCase()).filter((t) => !/^<br\/?>$/.test(t)).join(''),
  ph: (s.match(PH_RE) || []).sort().join(''),
  pipes: (s.match(/\|/g) || []).length,
  urls: (s.match(URL_RE) || []).map((u) => u.replace(/[.,;:!?]+$/, '')).sort().join(' '),
});
/** The translation keeps the source's tags, placeholders, "|" separators and URLs; dashes become commas. */
function checkTranslation(src, out) {
  if (typeof out !== 'string' || !out.trim()) return null;
  let t = out.replace(/\s*[—–]\s*/g, ', ');
  if (/^\s/.test(src) && !/^\s/.test(t)) t = ' ' + t;
  if (/\s$/.test(src) && !/\s$/.test(t)) t += ' ';
  const a = signature(src);
  const b = signature(t);
  if (a.tags !== b.tags || a.ph !== b.ph || a.pipes !== b.pipes || a.urls !== b.urls) return null;
  return t;
}
/* "AI" per language, spelled out: given a couple of examples, the model carried the German KI into Finnish,
   Polish, Estonian, Croatian and others. A language not listed keeps "AI", the everyday term on its tech sites. */
const AI_TERMS = {
  de: 'KI', nb: 'KI', es: 'IA', it: 'IA', 'pt-BR': 'IA', 'pt-PT': 'IA', ca: 'IA', ro: 'IA',
  ru: 'ИИ', bg: 'ИИ', uk: 'ШІ', fi: 'tekoäly', et: 'tehisintellekt', hu: 'MI', lv: 'MI', lt: 'DI', hr: 'UI', sl: 'UI',
  tr: 'yapay zekâ', ar: 'الذكاء الاصطناعي', fa: 'هوش مصنوعی', he: 'בינה מלאכותית',
};
/* Meaning notes for strings a model misreads, sent with the batch that holds them. The hero headline drops "that"
   for rhythm, and every language read "AI skips" as a noun ("the AI's jumps"). */
const NOTES = {
  'The details<br>AI skips are<br>the ones your<br><em>customers notice</em>':
    '"skips" is a verb here. Meaning: the details that AI leaves out are exactly the ones your customers notice.',
};
function systemPrompt(lang) {
  return [
    `You translate the website of v2 studio, a small AI design agency (redesign, UX, AI product prototypes, coaching), from English into ${lang.name}.`,
    `Write the copy a native ${lang.name} copywriter would write for a modern, friendly B2B studio: natural and idiomatic, warm and direct, never word for word. Address the reader the way such a studio usually does in ${lang.name}.`,
    'Keep the meaning, every claim, number, price, percentage and duration exactly. Do not add or drop information.',
    'Keep HTML tags as they are (same tags, same order, same attributes) and translate only the text between them. The one exception is <br>: it marks a line break in a big headline, so put the breaks where the translated sentence breaks naturally, about as many lines as the English. Text inside <em> is the emphasised end of the headline: keep that role.',
    AI_TERMS[lang.code]
      ? `Translate "AI" as "${AI_TERMS[lang.code]}" (inflect it if ${lang.name} grammar needs it), the same way everywhere.`
      : `Keep "AI" as "AI" in ${lang.name}, the same way everywhere. Never use another language's abbreviation such as KI or IA.`,
    'Use the plain, everyday form of words: no gender colons, stars or slashes (write Kunden, not Kund:innen).',
    'Keep placeholders in curly braces, like {total} or {n}, unchanged. Keep every "|" character: it splits a string into parts.',
    'Do not translate: URLs, email addresses, "v2 studio", people\'s names (Hugo, Hugo Vermot), and product or company names (Calendly, Stripe, Figma, Cursor, Claude Code, LinkedIn, LVMH, BMW, Renault, Shiseido…).',
    'Keep dollar amounts as written ($390). Keep "·" separators. Never use en dashes or em dashes.',
    'Buttons, labels and menu items stay as short as the English. Keep leading and trailing spaces.',
    'Reply with JSON only: {"t": [ ... ]}, one translated string per input string, same order, same count.',
  ].join('\n');
}
async function translateBatch(chat, model, lang, items) {
  const content = JSON.stringify(items.map((it) => it.text));
  const notes = items.map((it, i) => (NOTES[it.text] ? `${i + 1}: ${NOTES[it.text]}` : '')).filter(Boolean).join('\n');
  const raw = await chat({
    model,
    temperature: 0.2,
    max_tokens: 12000,
    systemPrompt: systemPrompt(lang),
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: `Translate these ${items.length} strings into ${lang.name}:\n${content}${notes ? `\n\nMeaning notes (string number: note):\n${notes}` : ''}` }],
  });
  const json = JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, ''));
  const arr = Array.isArray(json) ? json : json && Array.isArray(json.t) ? json.t : null;
  if (!arr || arr.length !== items.length) throw new Error(`expected ${items.length} strings, got ${arr ? arr.length : 'none'}`);
  return arr;
}
function batches(items) {
  const out = [];
  let cur = [];
  let chars = 0;
  for (const it of items) {
    if (cur.length && (cur.length >= BATCH_ITEMS || chars + it.text.length > BATCH_CHARS)) { out.push(cur); cur = []; chars = 0; }
    cur.push(it);
    chars += it.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}
async function pool(tasks, n) {
  let i = 0;
  const run = async () => { while (i < tasks.length) { const t = tasks[i++]; await t(); } };
  await Promise.all(Array.from({ length: Math.max(1, n) }, run));
}
async function readCatalog(code) {
  try {
    const json = JSON.parse(await readFile(join(OUT_DIR, `${code}.json`), 'utf-8'));
    return json && json.k && typeof json.k === 'object' ? json.k : {};
  } catch {
    return {};
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt; };
  const has = (name) => args.includes(`--${name}`);
  // --redo <regex>: translate again the English strings that match, even when a translation exists.
  const redo = opt('redo', '') ? new RegExp(opt('redo', '')) : null;
  const found = await extractEnglish();
  const all = [...found.entries()].map(([key, v]) => ({ key, text: v.text }));
  const chars = all.reduce((n, it) => n + it.text.length, 0);
  if (has('count')) {
    const perFile = {};
    for (const v of found.values()) for (const f of v.files) perFile[f] = (perFile[f] || 0) + 1;
    console.log(JSON.stringify({ strings: all.length, chars, perFile }, null, 2));
    return;
  }
  const wanted = opt('langs', '') ? opt('langs', '').split(',').map((s) => s.trim()).filter(Boolean) : MACHINE_LANGS;
  const langs = wanted.map((c) => AGENCE_LANGS.find((l) => l.code === c && MACHINE_LANGS.includes(c)));
  if (langs.some((l) => !l)) throw new Error(`unknown or hand-written language in --langs: ${wanted.join(',')}`);
  const model = opt('model', DEFAULT_MODEL);
  const concurrency = Number(opt('concurrency', '6')) || 6;
  const dry = has('dry');
  const { chat } = dry ? { chat: null } : await import('../lib/openrouter.mjs');
  await mkdir(OUT_DIR, { recursive: true });

  const state = new Map();
  const tasks = [];
  for (const lang of langs) {
    const old = await readCatalog(lang.code);
    const cat = {};
    for (const it of all) if (typeof old[it.key] === 'string') cat[it.key] = old[it.key];
    if (redo) for (const it of all) if (redo.test(it.text)) delete cat[it.key];
    const missing = all.filter((it) => !(it.key in cat));
    state.set(lang.code, { lang, cat, missing: missing.length, failed: 0 });
    if (dry) continue;
    for (const group of batches(missing)) {
      tasks.push(async () => {
        const st = state.get(lang.code);
        let out = null;
        try { out = await translateBatch(chat, model, lang, group); } catch (err) {
          console.warn(`[${lang.code}] batch of ${group.length} failed (${err.message}); retrying one by one`);
        }
        for (let i = 0; i < group.length; i++) {
          let t = out ? checkTranslation(group[i].text, out[i]) : null;
          if (t == null) {
            try { t = checkTranslation(group[i].text, (await translateBatch(chat, model, lang, [group[i]]))[0]); } catch { t = null; }
          }
          if (t == null) st.failed++;
          else st.cat[group[i].key] = t;
        }
        process.stdout.write(`[${lang.code}] +${group.length}  `);
      });
    }
  }
  await pool(tasks, concurrency);
  if (!dry) process.stdout.write('\n');

  for (const { lang, cat, missing, failed } of state.values()) {
    if (!dry) {
      const k = Object.fromEntries(Object.keys(cat).sort().map((key) => [key, cat[key]]));
      const meta = { lang: lang.code, name: lang.name, source: 'en', model, strings: Object.keys(k).length, of: all.length, generated: new Date().toISOString().slice(0, 10) };
      await writeFile(join(OUT_DIR, `${lang.code}.json`), JSON.stringify({ _meta: meta, k }, null, 0) + '\n');
    }
    console.log(`${lang.code.padEnd(8)} ${dry ? 'missing' : 'done'} ${dry ? missing : Object.keys(cat).length + '/' + all.length}${failed ? `  (${failed} kept in English: the translation broke a tag, placeholder or URL)` : ''}`);
  }
}

// Main CLI execution guard (repo convention: lib/is-main-module.mjs, #3170)
if (isMainModule(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
