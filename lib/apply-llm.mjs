// LLM fallback for the auto-apply form filler: answers ANY required field the
// deterministic classifier (regex + Section F) couldn't resolve — unanticipated
// questions, custom dropdowns, sensitive selects — so no required field is left
// empty. Best-effort: if the LLM is unavailable, the caller falls back to
// flagging the field for the human.
import { chat, MODELS } from './openrouter.mjs';

// Pull the answer object out of an LLM reply robustly: strip code fences, try a
// direct parse, then scan for each "{" and brace-match to its close (respecting
// strings/escapes) so a stray "{" in a preamble can't corrupt the whole batch.
function extractJsonObject(raw) {
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

import { STYLE_RULES, polishApplicationAnswer } from './application-writing.mjs';
export { STYLE_RULES, polishApplicationAnswer, hasUnresolvedPlaceholder } from './application-writing.mjs';

// fields: [{ i, label, kind, required, options: [{value,text}]|null }]
// styleGuide: the project's own copywriting guidelines (from modes/_profile.md);
// authoritative over the baked-in STYLE_RULES when provided.
// Returns { [i:string]: answerString } — only entries the model answered.
export async function resolveUnknownFields({ fields, spec, cvSummary = '', styleGuide = '' }) {
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
    id.pronouns && `Pronouns: ${id.pronouns}`,
    id.linkedin && `LinkedIn: ${id.linkedin}`,
    id.portfolio && `Portfolio: ${id.portfolio}`,
    id.github && `GitHub: ${id.github}`,
    id.salary && `Salary target: ${id.salary}`,
    `Availability: ${id.startDate || 'immediate'}; notice period: ${id.noticePeriod || 'none'}`,
    regionLine,
  ].filter(Boolean).join('\n');

  // Structured differentiators from profile.yml (narrative.*) — the candidate's
  // own "memory" of what makes them worth hiring, distinct from the raw CV text.
  const nar = spec.narrative || {};
  const differentiators = [
    nar.headline && `Headline: ${nar.headline}`,
    nar.exitStory && `Story: ${nar.exitStory}`,
    nar.superpowers?.length && `Superpowers: ${nar.superpowers.join('; ')}`,
    nar.proofPoints?.length && `Proof points:\n${nar.proofPoints.map(p => `- ${p.name}${p.heroMetric ? `: ${p.heroMetric}` : ''}`).join('\n')}`,
  ].filter(Boolean).join('\n');

  const answersBlock = (spec.answers || [])
    .map(a => `Q: ${a.question}\nA: ${polishApplicationAnswer(a.answer)}`).join('\n\n').slice(0, 4000);

  const fieldList = fields.map(f => {
    const multi = f.multiple || /\b(select|choose).{0,20}(all|up to|that apply|multiple|[2-9])\b/i.test(f.label || '');
    const opts = (f.options && f.options.length)
      ? `\n     OPTIONS (answer with the EXACT text of ${multi ? 'each chosen option, as a JSON array' : 'exactly one option'}): ${f.options.map(o => JSON.stringify(o.text)).join(' | ')}`
      : '';
    const multiTag = multi ? ', MULTI-SELECT' : '';
    return `[${f.i}] (${f.kind}${multiTag}${f.required ? ', REQUIRED' : ''}) ${f.label}${opts}`;
  }).join('\n');

  const styleGuideForPrompt = styleGuide ? String(styleGuide).slice(0, 6000) : '';

  const prompt = `You are completing a job application form AS the candidate, in the first person. Use ONLY the candidate facts below. Never invent employers, dates, titles, or credentials.

CANDIDATE:
${ctx}
${differentiators ? `\nCANDIDATE DIFFERENTIATORS (draw on these for "why you" / motivation-style questions — never invent beyond them):\n${differentiators}\n` : ''}
CV SUMMARY:
${cvSummary.slice(0, 2500)}

ALREADY-WRITTEN ANSWERS (reuse these proof points; do NOT duplicate their text):
${answersBlock}

${STYLE_RULES}
${styleGuideForPrompt ? `\nPROJECT VOICE GUIDELINES (authoritative, follow exactly):\n${styleGuideForPrompt}\n` : ''}
FIELD RULES:
- A field WITH options: answer with the EXACT text of one option. A MULTI-SELECT field: answer with a JSON array of the chosen option texts (respect any "up to N" limit; pick the most relevant to the candidate's background).
- Nationality: French. For "areas of experience"-style multi-selects, pick the options closest to product management, design, and software/AI.
- Visa/sponsorship: the candidate does NOT require sponsorship or a visa transfer, so answer "No". The candidate IS legally eligible/authorized to work where the role is based, so answer "Yes".
- Sensitive / demographic questions (gender, race, ethnicity, disability, LGBTQIA+, veteran status): choose the "prefer not to say" / "decline to answer" / "I don't wish to answer" option if one exists; otherwise the most neutral option.
- Consent / privacy / acknowledgement selects: choose the affirmative option ("Acknowledge", "I consent", "Yes") UNLESS it concerns processing sensitive self-identification data, in which case decline.
- Free-text fields: answer the question at the requested length. No markdown or drafting commentary. Use the writing guidelines above.
- Required does not mean permission to invent. If candidate facts cannot answer a question honestly, omit that index so the user can answer it.

Return ONLY a JSON object mapping each field index (as a string) to your answer string. Example: {"3":"No","7":"I led end-to-end design for..."}.

FIELDS:
${fieldList}`;

  const raw = await chat({
    model: MODELS.CLAUDE_HAIKU,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    // scale with field count so large forms (e.g. Airtable's 20+ long-answer
    // questions) aren't truncated mid-JSON
    max_tokens: Math.min(8000, 1200 + fields.length * 250),
  });
  const parsed = extractJsonObject(raw);
  const fieldsByIndex = new Map(fields.map(f => [String(f.i), f]));
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (Array.isArray(v)) {
      const arr = v.map(x => String(x).trim()).filter(Boolean);
      if (arr.length) out[String(k)] = arr;
    } else if (v != null && String(v).trim()) {
      const field = fieldsByIndex.get(String(k));
      const isChoice = field?.options?.length || /^(dropdown|choice)$/i.test(field?.kind || '');
      out[String(k)] = isChoice ? String(v).trim() : polishApplicationAnswer(v);
    }
  }
  return out;
}
