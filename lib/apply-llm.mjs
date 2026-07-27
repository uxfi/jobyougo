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

// Distilled from modes/_profile.md, modes/question.md, modes/coverletter.md —
// the project's copywriting guidelines for any generated application text.
export const STYLE_RULES = `WRITING STYLE (mandatory for every free-text answer):
- Match the language of the field/question. Use native tech English for English fields, natural direct French for French fields.
- First person, present tense, active voice. Use contractions in English (I've, I'm, you're).
- Short sentences, action verbs. One idea per sentence. No passive voice. No padding: every sentence adds information.
- Lead with proof, not claims: "I built X that did Y", never "I'm great at X" or "I'm a passionate Z".
- Tone = Hugo voice / "I'm choosing you": direct, deliberate, selective. Never desperate, never arrogant.
- Make it sound like a builder/founder answering a competent hiring manager: shipped products, real users, hard decisions, systems, metrics.
- Default rhythm: proof first, then method or tradeoff, then why this company or role scope matters now.
- Open with a concrete hook (a specific signal from the role + a real proof point). No generic intros like "I'm writing to", "I'm drawn to", "I would love the opportunity".
- BANNED phrases: "passionate about", "excited to", "leverage", "synergy", "I believe", "I'm a strong communicator", "maps closely to", "translates to", "I would love the opportunity", "unique blend", "dynamic environment", "meaningful impact".
- BANNED punctuation/formatting: em dash, en dash, decorative hyphen chains, markdown, headings, bullets, numbered lists, semicolons used for drama.
- Avoid AI-shaped structures: no "not only... but also", no "whether... or...", no generic three-part lists, no abstract opener followed by a dash.
- Answer the LITERAL question. If it has sub-questions, answer each in order.
- 1 sentence for short fields. 2-3 sentences for long free-text unless the question clearly asks for more. Cover-letter fields can be 4-5 tight sentences.
- Name real products and real metrics from the candidate facts only. Never invent numbers, users, employers, or experience. If exact domain experience is missing, say so in a short clause then pivot to the closest real experience.
- Don't repeat the job title verbatim. No unnecessary hyphens.
- If an answer could be written by any senior candidate, rewrite it around a real project, a hard decision, or a verified metric.
- CRITICAL: every answer must be DISTINCT. If two questions are similar (e.g. "why this company?" vs "what interests you about this role?"), give genuinely different answers. One should be about the company/product, the other about the role/scope. Never reuse the same text twice.`;

const REPLACEMENTS = [
  [/\b[Ii]\s+am\s+excited\s+to\b/g, 'I want to'],
  [/\b[Ii]'m\s+excited\s+to\b/g, 'I want to'],
  [/\b[Ii]\s+am\s+drawn\s+to\b/g, 'I noticed'],
  [/\b[Ii]'m\s+drawn\s+to\b/g, 'I noticed'],
  [/\b[Ii]\s+am\s+thrilled\s+to\b/g, 'I want to'],
  [/\b[Ii]'m\s+thrilled\s+to\b/g, 'I want to'],
  [/\b[Ii]\s+would\s+love\s+the\s+opportunity\s+to\b/g, 'I want to'],
  [/\b[Ii]\s+believe\s+(that\s+)?/g, ''],
  [/\bleverage\b/gi, 'use'],
  [/\butilize\b/gi, 'use'],
  [/\bsynergies\b/gi, 'working systems'],
  [/\bsynergy\b/gi, 'fit'],
  [/\bmaps?\s+closely\s+to\b/gi, 'fits'],
  [/\btranslates?\s+to\b/gi, 'helps with'],
  [/\bunique\s+blend\s+of\b/gi, 'combination of'],
  [/\s+in\s+a\s+dynamic\s+environment\b/gi, ''],
  [/\bdynamic\s+environment\b/gi, 'role'],
  [/\bmeaningful\s+impact\b/gi, 'real product impact'],
  [/\bstrong\s+fit\b/gi, 'fit'],
];

function stripMarkdownStructure(text) {
  return text
    .replace(/```(?:json|markdown|md)?/gi, '')
    .replace(/```/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|[0-9]+[.)])\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function normalizeSentenceStarts(text) {
  return text.replace(/([.!?]\s+)([a-z])/g, (_, end, letter) => end + letter.toUpperCase());
}

// Deterministic cleanup for answers before they are typed into live forms. This
// removes visible AI-writing tells without changing facts or inventing detail.
export function polishApplicationAnswer(value) {
  let text = stripMarkdownStructure(String(value ?? ''));
  text = text
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*(?:answer|réponse|response)\s*:\s*/i, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/\s*;\s*/g, '. ')
    .replace(/\s*:{2,}\s*/g, ': ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/([,.!?]){2,}/g, '$1');
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
  text = text
    .replace(/\bnot only\b/gi, '')
    .replace(/\bbut also\b/gi, 'and')
    .replace(/[ \t]*\n+[ \t]*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return normalizeSentenceStarts(text);
}

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

  const styleGuideForPrompt = styleGuide ? String(styleGuide).replace(/\s*[—–]\s*/g, ', ').slice(0, 2500) : '';

  const prompt = `You are completing a job application form AS the candidate, in the first person. Use ONLY the candidate facts below. Never invent employers, dates, titles, or credentials.

CANDIDATE:
${ctx}

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
- Free-text fields: concise, specific, first person, 1-3 sentences, no markdown, no preamble. Apply the project voice guidelines above when provided.
- NEVER leave a REQUIRED field empty. If unsure on free-text, give a short honest answer grounded in the CV.

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
