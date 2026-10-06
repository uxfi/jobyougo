// LLM fallback for the auto-apply form filler: answers ANY required field the
// deterministic classifier (regex + Section F) couldn't resolve — unanticipated
// questions, custom dropdowns, sensitive selects — so no required field is left
// empty. Best-effort: if the LLM is unavailable, the caller falls back to
// flagging the field for the human.
import { chat, MODELS } from './openrouter.mjs';

// Pull the answer object out of an LLM reply robustly: strip code fences, try a
// direct parse, then scan for each "{" and brace-match to its close (respecting
// strings/escapes) so a stray "{" in a preamble can't corrupt the whole batch.
export function extractJsonObject(raw) {
  if (!raw) return {};
  const text = String(raw).replace(/```(?:json)?/gi, '');
  try { const v = JSON.parse(text.trim()); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* scan below */ }
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            const v = JSON.parse(text.slice(i, j + 1));
            if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) return v;
          } catch { /* not this one — keep scanning from next "{" */ }
          break;
        }
      }
    }
  }
  return {};
}

import { STYLE_RULES, polishApplicationAnswer, methodizeProofText } from './application-writing.mjs';
import { writeFormAnswer } from './form-answer.mjs';
export { STYLE_RULES, polishApplicationAnswer, hasUnresolvedPlaceholder } from './application-writing.mjs';
import { fieldIsMulti } from './apply-fill-guards.mjs';

function isProseField(field) {
  if (field?.options?.length) return false;
  const kind = String(field?.kind || '');
  if (kind === 'dropdown' || kind === 'choice' || kind === 'checkbox' || kind === 'radio') return false;
  return true;
}

// fields: [{ i, label, kind, required, options: [{value,text}]|null }]
// styleGuide: the project's own copywriting guidelines (from modes/_profile.md);
// authoritative over the baked-in STYLE_RULES when provided.
// Returns { [i:string]: answerString } — only entries the model answered.
export async function resolveUnknownFields({ fields, spec, cvSummary = '', career = '', styleGuide = '' }) {
  if (!fields?.length) return {};
  const id = spec.identity || {};

  const regionLine = spec.region === 'asia'
    ? 'Based in Bangkok, Thailand (ICT, UTC+7). Already holds a work visa in Thailand. Does NOT require sponsorship or a visa transfer.'
    : 'Based in Paris, France (CET/CEST). French / EU citizen. Does NOT require sponsorship or a visa transfer.';

  const ctx = [
    `Name: ${id.fullName}`,
    `Email: ${id.email}`,
    id.phone && `Phone: ${id.phone}`,
    `Location: ${id.location}`,
    id.employment?.company && `Current employer: ${id.employment.company}`,
    id.employment?.title && `Current title: ${id.employment.title}`,
    id.employment?.startYear && `Current role start: ${id.employment.startMonth || '?'}/${id.employment.startYear}${id.employment.current ? ' (current)' : ''}`,
    id.pronouns && `Pronouns: ${id.pronouns}`,
    id.linkedin && `LinkedIn: ${id.linkedin}`,
    id.portfolio && `Portfolio: ${id.portfolio}`,
    id.github && `GitHub: ${id.github}`,
    id.salaryFormAnnual && `On salary/compensation form fields, type the single annual number ${id.salaryFormAnnual} only — no range, no currency letters, no min-max concatenation.`,
    id.salaryFormDaily && `On daily-rate / TJM fields, type ${id.salaryFormDaily} only.`,
    !id.salaryFormAnnual && id.salary && `Salary target: ${id.salary}`,
    `Availability: ${id.startDate || 'immediate'}; notice period: ${id.noticePeriod || 'none'}`,
    regionLine,
  ].filter(Boolean).join('\n');

  // Structured differentiators from profile.yml (narrative.*) — the candidate's
  // own "memory" of what makes them worth hiring, distinct from the raw CV text.
  const nar = spec.narrative || {};
  const differentiators = [
    nar.headline && `Headline: ${nar.headline}`,
    nar.exitStory && `Story: ${methodizeProofText(nar.exitStory)}`,
    nar.superpowers?.length && `Superpowers: ${nar.superpowers.map(methodizeProofText).filter(Boolean).join('; ')}`,
    nar.proofPoints?.length && `Proof points (methods/scope only — never quote headcounts, %, revenue, or date spans in free-text):\n${nar.proofPoints.map(p => {
      const method = methodizeProofText(p.heroMetric || '');
      return method ? `- ${p.name}: ${method}` : `- ${p.name}`;
    }).join('\n')}`,
  ].filter(Boolean).join('\n');

  const proseFields = fields.filter(f => isProseField(f));
  const choiceFields = fields.filter(f => !isProseField(f));

  // Choice fields ask for the option's NUMBER, not its text. A model asked to
  // echo option text verbatim routinely paraphrases instead ("more than 10
  // years" for an option literally labelled "10+ Years", "advanced" instead
  // of the option "Advanced (C1)") — the caller's option matching then finds
  // nothing and the field is left unfilled. Numbers can't be paraphrased.
  const fieldList = choiceFields.map(f => {
    const multi = fieldIsMulti(f);
    const opts = (f.options && f.options.length)
      ? `\n     OPTIONS (answer with the ${multi ? 'JSON array of the option NUMBERS you choose, e.g. [0,2]' : 'NUMBER of exactly one option, e.g. 2'} — never the option's own text): ${f.options.map((o, idx) => `${idx}=${JSON.stringify(o.text)}`).join(' | ')}`
      : '';
    const multiTag = multi ? ', MULTI-SELECT' : '';
    return `[${f.i}] (${f.kind}${multiTag}${f.required ? ', REQUIRED' : ''}) ${f.label}${opts}`;
  }).join('\n');

  const prompt = `You are completing a job application form AS the candidate, in the first person. Use ONLY the candidate facts below. Never invent employers, dates, titles, or credentials.

CANDIDATE:
${ctx}
FIELD RULES:
- A field WITH options: answer with the option's NUMBER (see the field's OPTIONS list), never its text. A MULTI-SELECT field: a JSON array of the chosen option NUMBERS (respect any "up to N" limit; pick the most relevant to the candidate's background).
- A checkbox field (often "Question — Option"): answer exactly "yes" to tick that option, or omit the key to leave it unticked. Do not answer with the option's name. Do not tick HubSpot, WordPress, Webflow, or Framer. Hiring-location checkboxes: EU countries only (candidate is in France, CET). Do not tick the UK.
- Nationality: French. For "areas of experience"-style multi-selects, pick the options closest to product management, design, and software/AI.
- Work history: current employer OneAsset, title Senior Product Designer / Product Lead, started February 2026, still current (tick "Current role" / leave end date empty). Never invent other employers for these fields.
- "Are you 18 or older?": Yes. "Have you previously worked at [this company]?": No.
- US state of residence: if Outside US / International / Other / N/A exists, pick that. Do not invent a US state. Postal code: omit if unknown.
- Visa/sponsorship: the candidate does NOT require sponsorship or a visa transfer, so answer "No". The candidate IS legally eligible/authorized to work where the role is based ONLY when the role is in France, the EU/EEA, or Thailand. For US / UK / GCC roles answer work-authorization No.
- Salary / compensation / expected pay: a single annual number only (the candidate figure in CANDIDATE above). Never a range, never two numbers concatenated, never currency text.
- Sensitive / demographic questions (gender, race, ethnicity, disability, LGBTQIA+, veteran status): choose the "prefer not to say" / "decline to answer" / "I don't wish to answer" option if one exists; otherwise the most neutral option.
- Consent / privacy / acknowledgement selects: choose the affirmative option ("Acknowledge", "I consent", "Yes") UNLESS it concerns processing sensitive self-identification data, in which case decline.
- Required does not mean permission to invent. If candidate facts cannot answer a question honestly, omit that index so the user can answer it.

Return ONLY a JSON object mapping each field index (as a string key) to the option NUMBER (or a JSON array of numbers for multi-select). Example: {"0": 2, "5": [0,3]}. Omit keys you cannot answer honestly.

FIELDS:
${fieldList}`;

  const out = {};
  const complete = (req) => chat({
    model: MODELS.QWEN,
    messages: [{ role: 'user', content: req.user }],
    systemPrompt: req.system,
    temperature: req.temperature,
    max_tokens: req.max_tokens,
  });
  if (proseFields.length) {
    const careerText = career || cvSummary;
    for (const field of proseFields) {
      try {
        const written = await writeFormAnswer({
          question: field.label,
          company: spec.company || '',
          role: spec.role || '',
          career: careerText,
          voice: String(styleGuide || '').slice(0, 700),
          facts: ctx,
          offerContext: differentiators,
          complete,
        });
        if (written.answer) out[String(field.i)] = written.answer;
      } catch (err) {
        console.warn(`[apply] form answer failed for field ${field.i}: ${err.message}`);
      }
    }
  }

  if (!choiceFields.length) return out;

  const raw = await chat({
    model: MODELS.QWEN,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    // scale with field count so large forms (e.g. Airtable's 20+ long-answer
    // questions) aren't truncated mid-JSON
    max_tokens: Math.min(1200, 200 + choiceFields.length * 40),
  });
  const parsed = extractJsonObject(raw);
  const fieldsByIndex = new Map(fields.map(f => [String(f.i), f]));
  // Translate a returned option NUMBER back to that option's own text — the
  // whole point of asking for numbers is that the caller's downstream
  // matching (radio click, react-select option pick) needs the option's
  // REAL text, not the model's word for it. A model that ignores the
  // instruction and answers with text anyway still gets a literal
  // case-insensitive match against the option list; anything that resolves
  // to neither is dropped rather than guessed at (same "leave it for the
  // human" contract as everywhere else in this file).
  const optionTextFor = (options, one) => {
    const s = String(one ?? '').trim();
    if (/^\d+$/.test(s)) {
      const idx = Number(s);
      return options[idx]?.text || null;
    }
    const low = s.toLowerCase();
    return options.find(o => (o.text || '').trim().toLowerCase() === low)?.text || null;
  };
  for (const [k, v] of Object.entries(parsed)) {
    const field = fieldsByIndex.get(String(k));
    const options = field?.options;
    if (options?.length) {
      if (Array.isArray(v)) {
        const arr = v.map(one => optionTextFor(options, one)).filter(Boolean);
        if (arr.length) out[String(k)] = arr;
      } else {
        const text = optionTextFor(options, v);
        if (text) out[String(k)] = text;
      }
      continue;
    }
    // A list the model saw without its options: a bare number is an option
    // index it cannot know ("0" landed in Yes/No and pronoun lists). Leave it
    // unanswered; the caller reads the real options and asks again.
    const isList = field?.kind === 'dropdown' || field?.kind === 'choice';
    if (isList && [v].flat().every(x => /^\s*\d+\s*$/.test(String(x)))) continue;
    if (Array.isArray(v)) {
      const arr = v.map(x => String(x).trim()).filter(Boolean);
      if (arr.length) out[String(k)] = arr;
    } else if (v != null && String(v).trim()) {
      out[String(k)] = polishApplicationAnswer(v);
    }
  }
  return out;
}
