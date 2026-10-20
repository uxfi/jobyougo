/**
 * Tool checklists ("Which tools do you use?" with Figma / Cursor / React…
 * rows): tick exactly the tools the candidate's own material names
 * (profile.yml screening.custom_answers, cv.md, the career digest). A tool
 * nobody wrote down is never ticked. Option text and source text are both
 * normalised (case, accents, ".js", "Vercel v0" → "v0", "Claude" ↔ "Claude Code").
 */

// key → { re: how the tool reads in an option or in the CV, implies: keys it also attests }
const TOOLS = {
  figma: { re: /\bfigma\b/ },
  sketch: { re: /\bsketch( ?app)?\b/ },
  adobexd: { re: /\badobe ?xd\b|\bxd\b/ },
  principle: { re: /\bprinciple( ?app)?\b/ },
  zeplin: { re: /\bzeplin\b/ },
  framer: { re: /\bframer\b(?! motion)/ },
  framermotion: { re: /\bframer motion\b/ },
  protopie: { re: /\bprotopie\b/ },
  invision: { re: /\binvision\b/ },
  miro: { re: /\bmiro\b/ },
  notion: { re: /\bnotion\b/ },
  jira: { re: /\bjira\b/ },
  webflow: { re: /\bwebflow\b/ },
  photoshop: { re: /\bphotoshop\b/ },
  illustrator: { re: /\billustrator\b/ },
  aftereffects: { re: /\bafter ?effects\b/ },
  cursor: { re: /\bcursor( ai| ide)?\b/ },
  claudecode: { re: /\bclaude ?code\b/, implies: ['claude'] },
  claude: { re: /\bclaude\b(?! ?code)|\banthropic\b/ },
  v0: { re: /\b(vercel )?v0(\.dev)?\b/ },
  lovable: { re: /\blovable\b/ },
  bolt: { re: /\bbolt(\.new)?\b/ },
  copilot: { re: /\b(github )?copilot\b/ },
  windsurf: { re: /\bwindsurf\b/ },
  chatgpt: { re: /\bchat ?gpt\b|\bgpt-?4o?\b|\bopenai\b/ },
  gemini: { re: /\bgemini\b/ },
  midjourney: { re: /\bmidjourney\b/ },
  flux: { re: /\bflux\b/ },
  runway: { re: /\brunway( ?ml)?\b/ },
  kling: { re: /\bkling\b/ },
  veo: { re: /\bveo ?\d?\b/ },
  stablediffusion: { re: /\bstable ?diffusion\b/ },
  openrouter: { re: /\bopenrouter\b/ },
  nextjs: { re: /\bnext ?\.?js\b/, implies: ['react'] },
  react: { re: /\breact(\.?js)?\b(?! native)/ },
  reactnative: { re: /\breact native\b/ },
  vue: { re: /\bvue(\.?js)?\b/ },
  angular: { re: /\bangular\b/ },
  svelte: { re: /\bsvelte\b/ },
  typescript: { re: /\btype ?script\b/ },
  javascript: { re: /\bjava ?script\b/ },
  html: { re: /\bhtml5?\b/ },
  css: { re: /\bcss3?\b/ },
  tailwind: { re: /\btailwind( ?css)?\b/ },
  shadcn: { re: /\bshadcn(\/ui)?\b/ },
  storybook: { re: /\bstorybook\b/ },
  github: { re: /\bgithub\b|\bgit\b/ },
  python: { re: /\bpython\b/ },
  swift: { re: /\bswift(ui)?\b/ },
  kotlin: { re: /\bkotlin\b/ },
  flutter: { re: /\bflutter\b/ },
  d3: { re: /\bd3(\.js)?\b/ },
  supabase: { re: /\bsupabase\b/ },
  vercel: { re: /\bvercel\b(?! v0)/ },
};

export function normToolText(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Keys of the tools an option names ("Next.js / React" → nextjs, react).
export function toolsInText(text) {
  const t = normToolText(text);
  const keys = [];
  for (const [key, def] of Object.entries(TOOLS)) {
    // "Next" alone is a word, not Next.js: the option or CV must say next.js / nextjs.
    if (key === 'nextjs' ? /\bnext ?\.?js\b/.test(t) : def.re.test(t)) keys.push(key);
  }
  // "Claude Code" is not also a bare "Claude" mention.
  return keys;
}

// Every tool the candidate's material attests, with the implied ones.
export function attestedTools(sourceText) {
  const set = new Set(toolsInText(sourceText));
  for (const key of [...set]) for (const extra of TOOLS[key]?.implies || []) set.add(extra);
  return set;
}

const NONE_ROW = /^(none|other|n\/?a|not applicable|no(ne)? of (the|these) (above)?|i don.?t use|aucun|autre)\b/i;

/**
 * options: [string]. Returns null when the list is not a tool checklist,
 * else { picks: [index], toolish: true } — picks may be empty (nothing
 * attested: the caller leaves a required list to the human).
 */
export function pickAttestedTools(options, sourceText) {
  const texts = (options || []).map((o) => String(typeof o === 'string' ? o : o?.text || '').trim());
  if (texts.length < 2) return null;
  const rows = texts.map((text) => ({ text, keys: NONE_ROW.test(text) ? [] : toolsInText(text) }));
  const named = rows.filter((r) => r.keys.length).length;
  // A tool checklist: most real rows name a tool and the rows are short.
  const real = rows.filter((r) => !NONE_ROW.test(r.text));
  if (!real.length || named < Math.max(2, Math.ceil(real.length * 0.6))) return null;
  if (real.some((r) => r.text.split(/\s+/).length > 8)) return null;
  const have = attestedTools(sourceText);
  const picks = [];
  rows.forEach((r, i) => { if (r.keys.length && r.keys.some((k) => have.has(k))) picks.push(i); });
  return { picks, toolish: true };
}