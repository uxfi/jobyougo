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

import { STYLE_RULES, polishApplicationAnswer, methodizeProofText, fitToMaxLength } from './application-writing.mjs';
import { writeFormAnswer } from './form-answer.mjs';
export { STYLE_RULES, polishApplicationAnswer, hasUnresolvedPlaceholder } from './application-writing.mjs';
import { fieldIsMulti, isPersonalLegalQuestion, isPlaceIdentityField, isSecretCredentialField } from './apply-fill-guards.mjs';
import { documentedScaleFacts, mobileProofHint } from './prompt-budget.mjs';
import { bestAnswerFor, planFitsField } from './apply-classify.mjs';
import { policyPromptLines } from './apply-policy.mjs';
import { countryOf, placesIn } from './apply-places.mjs';

// The field-resolution model. A stronger one (APPLY_LLM_MODEL, e.g.
// anthropic/claude-haiku-4-5) reads screening questions better at a few
// tenths of a cent per form.
const APPLY_MODEL = process.env.APPLY_LLM_MODEL || MODELS.QWEN;

// A question that wants sentences. Everything else without options is a
// short factual box: "Where are your currently located?" got a career
// paragraph, then the canned fallback, when every text box went to the writer.
const NARRATIVE_ASK = /\b(tell|describe|explain|why|walk (us|me) through|share (an|a|one|your) (example|story|experience)|what (excites|motivates|interests|attracts|drew|inspires)|how (did|do|would|have|has) you (approach|handle|use|used|work|lead|deal|manage|design|build|apply|measure)|give (us )?an example|cover letter|lettre de motivation|motivation|pourquoi|d[ée]cri|expliqu|parlez|racontez|about yourself|anything else|additional information|summary)\b/i;

export function isProseField(field) {
  if (field?.options?.length) return false;
  const kind = String(field?.kind || '');
  if (kind === 'dropdown' || kind === 'choice' || kind === 'checkbox' || kind === 'radio' || kind === 'checkbox group') return false;
  const label = String(field?.label || '');
  if (/fluent in|do you speak|parlez-vous|langue maternelle|native speaker/i.test(label) && label.length < 80) {
    return false;
  }
  if (kind === 'long text') return true;
  return NARRATIVE_ASK.test(label) || label.length > 140;
}

function identityAnswerForField(field, spec) {
  const label = String(field?.label || '');
  const id = spec?.identity || {};
  if (/\b(salary|compensation|rémunération|salaire|expected pay|pretention)\b/i.test(label) && !/\bwhy\b/i.test(label)) {
    return String(id.salaryFormAnnual || id.salary || '').trim();
  }
  if (/\b(notice period|availability|disponib|préavis|preavis|start date|date de (début|prise|dispo))\b/i.test(label)) {
    return String(id.startDate || id.noticePeriod || '').trim();
  }
  return '';
}

const optionText = (o) => String(typeof o === 'string' ? o : o?.text || '').trim();

// "Question — Option" rows of one question, as collect-fields labels them.
function splitGroupLabel(label) {
  const parts = String(label || '').split(/\s+[—–]\s+/);
  if (parts.length < 2) return null;
  return { stem: parts.slice(0, -1).join(' — ').trim(), option: parts[parts.length - 1].trim() };
}

export function groupCheckboxes(fields) {
  const byStem = new Map();
  for (const field of fields) {
    if (field.kind !== 'checkbox') continue;
    const parts = splitGroupLabel(field.label);
    if (!parts) continue;
    const key = parts.stem.toLowerCase();
    if (!byStem.has(key)) byStem.set(key, { stem: parts.stem, rows: [] });
    byStem.get(key).rows.push({ field, option: parts.option });
  }
  const groups = [...byStem.values()].filter((g) => g.rows.length >= 2);
  const grouped = new Set(groups.flatMap((g) => g.rows.map((r) => r.field)));
  return { groups, singles: fields.filter((f) => !grouped.has(f)) };
}

// Rows the profile settles without a model: where the candidate works from,
// and "do you know anyone here?" (No).
export function groupAnswerFromProfile(group, id) {
  const stem = group.stem.toLowerCase();
  const rows = group.rows;
  if (/know anyone|relationship|related to|relatives?|family|connection|friend|personal relationship/.test(stem)
      || rows.some((r) => /^no\b[^a-z]*(i )?(don.?t|do not) know/i.test(r.option))) {
    const none = rows.find((r) => /^(no|none|not applicable|n\/a)\b|^i (don.?t|do not) (know|have)/i.test(r.option));
    return none ? [none] : null;
  }
  if (/location|countr|cit(y|ies)|office|based|work from|hub|region|where/.test(stem)) {
    const home = countryOf(id.country) || id.country;
    const city = String(id.city || '').toLowerCase();
    const mine = rows.filter((r) => {
      const found = placesIn(r.option, { codes: true });
      return (home && found.countries.includes(home)) || (city && found.cities.some((c) => c.city === city));
    });
    const remote = rows.filter((r) => /\b(remote|anywhere|fully remote|t[ée]l[ée]travail)\b/i.test(r.option));
    const picks = [...mine, ...remote];
    return picks.length ? picks : null;
  }
  return null;
}

// Country, nationality and dial-code lists: the candidate's own row, or
// nothing. These lists often arrive cut at 40 rows (Afghanistan… Austria),
// and the model then picked "Austria +43" for a candidate based in France.
// undefined = not a country list (the model decides); null = no own row.
export function ownCountryOption(field, id = {}) {
  const options = field?.options || [];
  if (options.length < 8) return undefined;
  const label = String(field.label || '').toLowerCase();
  const dialRows = options.filter((o) => /\+\d{1,4}\b/.test(optionText(o))).length;
  const nationality = /nationalit|citizenship|citoyennet/.test(label);
  if (!nationality && !/\b(country|pays|phone|dial|indicatif|calling code)\b/.test(label) && dialRows < options.length / 2) {
    return undefined;
  }
  const citizen = /\b(french|france)\b/i.test(String(id.visaStatus || '')) ? 'France' : '';
  const want = nationality ? (citizen || countryOf(id.country)) : (countryOf(id.country) || String(id.country || ''));
  if (!want) return undefined;
  const code = String(id.dialCode || '').trim();
  const row = options.find((o) => {
    const text = optionText(o);
    if (nationality && want === 'France' && /^(french|fran[cç]ais)/i.test(text)) return true;
    const found = placesIn(text, { codes: true });
    const named = found.explicit.includes(want) || (!found.explicit.length && found.countries.includes(want));
    return named && (!code || !/\+\d/.test(text) || text.includes(code));
  });
  return row ? optionText(row) : null;
}

function candidateFacts(spec) {
  const id = spec.identity || {};
  const edu = (id.education || [])[0];
  return [
    `Name: ${id.fullName}`,
    spec.narrative?.headline && `Headline: ${spec.narrative.headline}`,
    `Email: ${id.email}`,
    id.phone && `Phone: ${id.phone}`,
    `Location: ${id.location}`,
    id.employment?.company && `Current employer: ${id.employment.company}${id.employment.title ? ` — ${id.employment.title}` : ''}${id.employment.startYear ? ` (since ${id.employment.startMonth || '?'}/${id.employment.startYear}${id.employment.current ? ', current' : ''})` : ''}`,
    id.yearsExperience && `Years of professional experience: ${id.yearsExperience}`,
    edu && `Education: ${edu.degree}, ${edu.school}${edu.start || edu.end ? ` (${[edu.start, edu.end].filter(Boolean).join('–')})` : ''}`,
    Array.isArray(id.languages) && id.languages.length
      && `Languages: ${id.languages.map((l) => `${l.name} (${l.level})`).join(', ')}. "Fluent / do you speak" is Yes only for a listed language at native or professional level.`,
    id.visaStatus && `Nationality / status: ${id.visaStatus}`,
    `Availability: ${id.startDate || 'immediate'}; notice period: ${id.noticePeriod || 'none'}`,
    id.engagement && `Wanted engagement: ${id.engagement} (an employment contract, not freelance / B2B, unless the form only offers those)`,
    id.salaryFormAnnual && `Salary: ${id.salaryFormAnnual}${id.salaryCurrency ? ` ${id.salaryCurrency}` : ''} a year, one number. Monthly in the same currency: divide by 12. Another currency (THB, USD, GBP…): omit the field, never convert.`,
    id.salaryFormDaily && `Daily rate: ${id.salaryFormDaily}${id.salaryCurrency ? ` ${id.salaryCurrency}` : ''}.`,
    id.linkedin && `LinkedIn: ${id.linkedin}`,
    id.portfolio && `Portfolio: ${id.portfolio}`,
    id.github && `GitHub: ${id.github}`,
    id.pronouns && `Pronouns: ${id.pronouns}`,
  ].filter(Boolean).join('\n');
}

function formAnswered(answered = []) {
  return (answered || [])
    .filter((row) => row?.label && row?.value && !String(row.value).includes('📎') && String(row.value).length <= 120)
    .slice(0, 15)
    .map((row) => `- ${String(row.label).replace(/\s+/g, ' ').slice(0, 70)}: ${String(row.value).replace(/\s+/g, ' ').slice(0, 60)}`)
    .join('\n');
}

// A short answer is kept only if it is the kind of value the box asks for.
function shortAnswerFits(field, value, spec) {
  const text = String(value || '').trim();
  if (!text || text.length > 220) return false;
  return planFitsField({ label: field.label, type: 'text', options: field.options || [] }, { value: text }, spec);
}

// fields: [{ i, label, kind, required, options: [{value,text}]|null, maxLength? }]
// styleGuide: the project's own copywriting guidelines (from modes/_profile.md);
// authoritative over the baked-in STYLE_RULES when provided.
// answered: [{ label, value }] already on the form, so answers stay consistent.
// Returns { [i:string]: answerString | answerString[] } — only entries answered.
export async function resolveUnknownFields({ fields, spec, cvSummary = '', career = '', styleGuide = '', digest = '', answered = [] }) {
  if (!fields?.length) return {};
  const id = spec.identity || {};
  const out = {};
  const rest = [];
  for (const field of fields) {
    // Passwords and legal history are the candidate's own statements.
    if (isSecretCredentialField(field) || isPersonalLegalQuestion(field)) continue;
    // A place box without options takes the location; a "Location" list is a
    // question with its own rows (Plancraft: Yes / No / travel / remote).
    if (!field.options?.length && field.kind !== 'checkbox' && isPlaceIdentityField(field)) {
      const city = String(id.location || id.city || '').trim();
      if (city) out[String(field.i)] = city;
      continue;
    }
    rest.push(field);
  }
  if (!rest.length) return out;

  const { groups, singles } = groupCheckboxes(rest);
  const openGroups = [];
  for (const group of groups) {
    const picks = groupAnswerFromProfile(group, id);
    if (picks) {
      for (const row of picks) out[String(row.field.i)] = 'yes';
    } else {
      openGroups.push(group);
    }
  }

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

  const proseFields = singles.filter((f) => isProseField(f));
  const choiceFields = singles.filter((f) => !isProseField(f));

  const careerIndex = (career && typeof career === 'object') ? career : null;
  const sideNames = careerIndex?.sideNames || spec.sideNames || [];
  const employers = careerIndex?.employers || [];
  const ctx = candidateFacts(spec);

  const complete = (req) => chat({
    model: APPLY_MODEL,
    messages: [{ role: 'user', content: req.user }],
    systemPrompt: req.system,
    temperature: req.temperature,
    max_tokens: req.max_tokens,
  });
  if (proseFields.length) {
    const careerText = careerIndex?.text || (typeof career === 'string' ? career : '') || cvSummary || '';
    const usedAnswers = new Set();
    const offerContext = [spec.reportSlice, differentiators].filter(Boolean).join('\n\n');
    for (const field of proseFields) {
      const max = Number(field.maxLength) > 0 ? Number(field.maxLength) : 0;
      const fromIdentity = identityAnswerForField(field, spec);
      if (fromIdentity) {
        out[String(field.i)] = fromIdentity;
        continue;
      }
      const fromReport = bestAnswerFor(field.label, spec.answers || [], usedAnswers, spec.sideNames || [], {
        company: spec.company,
        allowedNames: spec.employerNames || [],
      });
      if (fromReport?.answer) {
        usedAnswers.add(fromReport.question);
        out[String(field.i)] = fitToMaxLength(polishApplicationAnswer(fromReport.answer, { sideNames }), max);
        continue;
      }
      try {
        const written = await writeFormAnswer({
          question: field.label,
          company: spec.company || '',
          role: spec.role || '',
          career: careerText,
          index: careerIndex || undefined,
          digest: digest || careerIndex?.digest || '',
          voice: String(styleGuide || '').slice(0, 1400),
          facts: ctx,
          offerContext,
          maxChars: max,
          complete,
        });
        if (written.answer) out[String(field.i)] = written.answer;
      } catch (err) {
        console.warn(`[apply] form answer failed for field ${field.i}: ${err.message}`);
      }
    }
  }

  // Every option list, short factual box and open checkbox group goes into one
  // call. Lists are answered by option NUMBER: a model asked to echo option
  // text paraphrases it ("more than 10 years" for "10+ Years") and the
  // paraphrase then matches nothing.
  const modelChoices = [];
  for (const f of choiceFields) {
    const own = ownCountryOption(f, id);
    if (own === undefined) modelChoices.push(f);
    else if (own) out[String(f.i)] = own;
    // null: the candidate's country is not among the rows shown — left for the human.
  }
  const asks = [
    ...modelChoices.map((f) => ({ key: String(f.i), field: f, options: f.options || [], multi: fieldIsMulti(f), kind: f.kind })),
    ...openGroups.map((g, k) => ({
      key: `g${k}`,
      group: g,
      field: { label: g.stem, required: g.rows.some((r) => r.field.required) },
      options: g.rows.map((r) => ({ text: r.option })),
      multi: true,
      kind: 'checkbox group',
    })),
  ];
  if (!asks.length) return out;

  const scaleHint = documentedScaleFacts({
    digest: digest || careerIndex?.digest || '',
    employers,
    sideNames,
  });
  const fieldList = asks.map(({ key, field, options, multi, kind }) => {
    const opts = options.length
      ? `\n     OPTIONS (answer with ${multi ? 'a JSON array of option NUMBERS, e.g. [0,2]' : 'ONE option NUMBER, e.g. 2'}): ${options.map((o, idx) => `${idx}=${JSON.stringify(optionText(o))}`).join(' | ')}`
      : '\n     (no options: a short JSON string)';
    return `[${key}] (${kind || 'field'}${multi ? ', MULTI-SELECT' : ''}${field.required ? ', REQUIRED' : ''}) ${field.label}${opts}`;
  }).join('\n');
  const already = formAnswered(answered);

  const prompt = `You fill a job application form as the candidate, in the first person. Use only the facts and policy below. Never invent employers, dates, titles, numbers, degrees or credentials.

CANDIDATE
${ctx}

CANDIDATE POLICY (decides screening questions)
${policyPromptLines(id, spec)}
- English: professional, C1 / Fluent / Advanced (not Native, not Beginner).
- Use of AI: Practitioner, applies AI to complex work and refines prompts, context and tool choices; builds AI products.
${[mobileProofHint(employers), `- Product scale:\n${scaleHint}`].filter(Boolean).join('\n')}

THE JOB
${spec.company || 'Company'} — ${spec.role || 'Role'}

${already ? `ALREADY ANSWERED ON THIS FORM (stay consistent with these)\n${already}\n\n` : ''}HOW TO ANSWER
- A field with OPTIONS: the option NUMBER, or a JSON array of numbers for a MULTI-SELECT. Choose what is true for the candidate. In a multi-select choose only what clearly applies (usually 1 to 3 options), never all of them.
- A field without options: a short JSON string, the bare value or one short sentence. Never a career paragraph.
- Consent, privacy or "I confirm" statements: the affirmative option. Marketing, newsletters, "contact me about other jobs": omit.
- Demographic questions (gender, race, disability, veteran…): the "prefer not to say" option, else omit.
- Have you worked for this company before? No, unless it is the current or a past employer above. Work-history fields: only the current employer above.
- Phone country / dial code: the candidate's own country and code, never the widget's default. US state of residence: "Outside US" / "N/A" when offered, never a state.
- Areas of experience / industries / skills lists: the options closest to product design, UX, product management and AI or SaaS products.
- Anything the facts cannot answer honestly: omit that field so the candidate answers it.

Return ONLY a JSON object mapping each field key to its answer, e.g. {"3": 1, "g0": [0, 2], "9": "Paris, France"}.

FIELDS
${fieldList}`;

  const raw = await chat({
    model: APPLY_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    // scale with field count so large forms (e.g. Airtable's 20+ long-answer
    // questions) aren't truncated mid-JSON
    max_tokens: Math.min(1400, 200 + asks.length * 40),
  });
  const parsed = extractJsonObject(raw);
  const askByKey = new Map(asks.map((a) => [a.key, a]));
  // Translate a returned option NUMBER back to that option's own text — the
  // whole point of asking for numbers is that the caller's downstream
  // matching (radio click, react-select option pick) needs the option's
  // REAL text, not the model's word for it. A model that ignores the
  // instruction and answers with text anyway still gets a literal
  // case-insensitive match against the option list; anything that resolves
  // to neither is dropped rather than guessed at (same "leave it for the
  // human" contract as everywhere else in this file).
  const optionIndexFor = (options, one) => {
    const s = String(one ?? '').trim();
    if (/^\d+$/.test(s)) {
      const idx = Number(s);
      return idx < options.length ? idx : -1;
    }
    const low = s.toLowerCase();
    return options.findIndex((o) => optionText(o).toLowerCase() === low);
  };
  for (const [k, v] of Object.entries(parsed)) {
    const ask = askByKey.get(String(k));
    if (!ask) continue;
    if (ask.group) {
      const rows = ask.group.rows;
      let picks = [...new Set([v].flat().map((one) => optionIndexFor(ask.options, one)).filter((idx) => idx >= 0))];
      // "Tick every country" is not a preference: keep the candidate's own
      // place when the model picked most of a long list, else nothing.
      if (rows.length >= 5 && picks.length > Math.max(3, Math.ceil(rows.length / 2))) {
        const home = countryOf(id.country) || id.country;
        picks = picks.filter((idx) => placesIn(rows[idx].option, { codes: true }).countries.includes(home));
      }
      for (const idx of picks) out[String(rows[idx].field.i)] = 'yes';
      continue;
    }
    const field = ask.field;
    const options = ask.options;
    if (options.length) {
      const list = [v].flat().map((one) => optionIndexFor(options, one)).filter((idx) => idx >= 0).map((idx) => optionText(options[idx]));
      if (!list.length) continue;
      out[String(k)] = Array.isArray(v) || ask.multi ? list : list[0];
      continue;
    }
    // A list the model saw without its options: a bare number is an option
    // index it cannot know ("0" landed in Yes/No and pronoun lists). Leave it
    // unanswered; the caller reads the real options and asks again.
    const isList = field?.kind === 'dropdown' || field?.kind === 'choice';
    if (isList && [v].flat().every(x => /^\s*\d+\s*$/.test(String(x)))) continue;
    if (field?.kind === 'checkbox') {
      if (/^(yes|true|1|oui|checked)$/i.test(String(v).trim())) out[String(k)] = 'yes';
      continue;
    }
    if (Array.isArray(v)) {
      const arr = v.map(x => String(x).trim()).filter(Boolean);
      if (arr.length) out[String(k)] = arr;
    } else if (v != null && String(v).trim()) {
      const text = polishApplicationAnswer(v, { sideNames });
      if (isList || shortAnswerFits(field, text, spec)) out[String(k)] = fitToMaxLength(text, field.maxLength);
    }
  }
  return out;
}
