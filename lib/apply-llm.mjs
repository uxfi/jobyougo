// LLM fallback for the auto-apply form filler: answers ANY required field the
// deterministic classifier (regex + Section F) couldn't resolve — unanticipated
// questions, custom dropdowns, sensitive selects — so no required field is left
// empty. Best-effort: if the LLM is unavailable, the caller falls back to
// flagging the field for the human.
import { chat, MODELS } from './openrouter.mjs';
import { pickAttestedTools } from './apply-tool-match.mjs';
import { customChoiceFor } from './apply-custom-choice.mjs';

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
  // A reply cut off mid-object (token limit): keep the complete "key": value
  // pairs instead of losing the whole batch.
  const start = text.indexOf('{');
  if (start >= 0) {
    const out = {};
    for (const m of text.slice(start).matchAll(/"([^"\n]{1,24})"\s*:\s*("(?:[^"\\]|\\.)*"|\[[^\]]*\]|-?\d+(?:\.\d+)?|true|false|null)/g)) {
      try { out[m[1]] = JSON.parse(m[2]); } catch { /* skip */ }
    }
    if (Object.keys(out).length) return out;
  }
  return {};
}

import { STYLE_RULES, polishApplicationAnswer, methodizeProofText, fitToMaxLength } from './application-writing.mjs';
import { currencyFromLabel } from './apply-salary.mjs';
import { writeFormAnswer } from './form-answer.mjs';
export { STYLE_RULES, polishApplicationAnswer, hasUnresolvedPlaceholder } from './application-writing.mjs';
import { fieldIsMulti, isPersonalLegalQuestion, isPlaceIdentityField, isSecretCredentialField, looksLikeDialCodeField, looksLikePhoneNumberField } from './apply-fill-guards.mjs';
import { documentedScaleFacts, mobileProofHint } from './prompt-budget.mjs';
import { bestAnswerFor, planFitsField } from './apply-classify.mjs';
import { policyPromptLines } from './apply-policy.mjs';
import { countryOf, countryOfNationality, demonymOf, placesIn } from './apply-places.mjs';

// Age, birth date, race, religion, orientation, disability, veteran status.
const DEMOGRAPHIC_RE = /\b(your )?age\b(?! ?(group|range)? ?(of|for) (the )?(company|team))|date of birth|birth ?date|date de naissance|fecha de nacimiento|geburtsdatum|\brace\b|ethnic|origine (ethnique|raciale)|religio|sexual orientation|lgbt|disab|handicap|veteran|transgender/i;
export function isDemographicQuestion(field = {}) {
  return DEMOGRAPHIC_RE.test(String(field.label || ''));
}

// The field-resolution model. Override with APPLY_LLM_MODEL.
const APPLY_MODEL = process.env.APPLY_LLM_MODEL || MODELS.QWEN;

// A question that wants sentences. Everything else without options is a
// short factual box: "Where are your currently located?" got a career
// paragraph, then the canned fallback, when every text box went to the writer.
const NARRATIVE_ASK = /\b(tell|describe|explain|why|walk (us|me) through|share (an|a|one|your) (example|story|experience)|what (excites|motivates|interests|attracts|drew|inspires)|how (did|do|would|have|has) you (approach|handle|use|used|work|lead|deal|manage|design|build|apply|measure)|give (us )?an example|cover letter|lettre de motivation|motivation|pourquoi|d[ée]cri|expliqu|parlez|racontez|about yourself|anything else|additional information|summary|por qu[eé]|cu[eé]nta(nos|me)|descr[ií]b\w*|expl[ií]ca\w*|warum|wieso|weshalb|erz[äa]hl\w*|beschreib\w*|perch[eé]|raccont\w*|descriv\w*)\b/i;

// "How many people have you managed?" is answered from the profile's
// people_management fact only: without it, the model wrote "No direct
// reports" for a founder who managed seven designers.
const MANAGEMENT_ASK = /how many (people|persons|employees|team members|reports)|direct reports|managed directly|gestionado directamente|personnes (encadr|manag|dirig)|team size|size of (the |your )?team|people (you )?(manage|managed|have managed)|mitarbeiter (gef[üu]hrt|geleitet)|persone (gestite|coordinate)/i;

export function isProseField(field) {
  if (field?.options?.length) return false;
  const kind = String(field?.kind || '');
  if (kind === 'dropdown' || kind === 'choice' || kind === 'checkbox' || kind === 'radio' || kind === 'checkbox group') return false;
  const label = String(field?.label || '');
  if (/fluent in|do you speak|parlez-vous|langue maternelle|native speaker/i.test(label) && label.length < 80) {
    return false;
  }
  if (kind === 'long text') return true;
  return NARRATIVE_ASK.test(label) || PORTFOLIO_TOUR.test(label) || label.length > 140;
}

// "Portfolio link + walkthrough" (Darkroom): the link plus a written tour.
const PORTFOLIO_TOUR = /portfolio[^?]{0,40}(walk ?through|walkthrough|tour|present)/i;

function identityAnswerForField(field, spec) {
  const label = String(field?.label || '');
  const id = spec?.identity || {};
  // "Any additional context for your salary expectations?" wants sentences,
  // not the bare number.
  if (/context|details?|explain|describe|tell us|comment|elaborate|why/i.test(label)) return '';
  if (/\b(salary|compensation|rémunération|salaire|expected pay|pretention|pretensi[oó]n|gehalt|salaris|stipendio)\b/i.test(label) && !/\bwhy\b/i.test(label)) {
    // Another currency is never converted; a monthly box gets a twelfth.
    const asked = currencyFromLabel(label);
    if (asked && id.salaryCurrency && asked !== id.salaryCurrency) return '';
    const annual = Number(String(id.salaryFormAnnual || '').replace(/[^\d]/g, ''));
    if (!annual) return String(id.salaryFormAnnual || id.salary || '').trim();
    if (/month|mensuel|mensual|monatlich|mensile|maandelijks/i.test(label)) return String(Math.round(annual / 12));
    return String(annual);
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
  if (/location|countr|cit(y|ies)|office|based|work from|hub|region|where/.test(stem)
      && !/hear|source|find|found|learn|came across|conociste|entendu|connu/.test(stem)) {
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
  // "Country of the position you are applying for" is the job's country,
  // not the candidate's: the model decides from the job location.
  if (!nationality && dialRows < options.length / 2
      && /\b(position|vacancy|job|role|office|hiring)\b/.test(label) && !/\byour (country|residence|home)\b|you (live|reside|are based)/.test(label)) {
    return undefined;
  }
  // The profile's nationality, else one written in the visa line ("French / EU citizen").
  const citizen = countryOfNationality(id.nationality || '')
    || countryOfNationality(String(id.visaStatus || '').match(/\w+(?=\s*(?:\/\s*\w+\s*)?citizen)/i)?.[0] || '');
  // Where the candidate lives is not a nationality: none known, the human answers.
  if (nationality && !citizen) return null;
  const want = nationality ? citizen : (countryOf(id.country) || String(id.country || ''));
  if (!want) return undefined;
  const code = String(id.dialCode || '').trim();
  const adjective = demonymOf(want);
  const row = options.find((o) => {
    const text = optionText(o);
    if (nationality && adjective && new RegExp(`^${adjective}\\b`, 'i').test(text)) return true;
    const found = placesIn(text, { codes: true });
    const named = found.explicit.includes(want) || (!found.explicit.length && found.countries.includes(want));
    return named && (!code || !/\+\d/.test(text) || text.includes(code));
  });
  if (row) return optionText(row);
  // A localised dial list ("Francia +33") names no country we know: the row
  // carrying the candidate's own code is still theirs.
  if (code && dialRows >= options.length / 2) {
    const bounded = new RegExp(`(^|\\W)${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`);
    const byCode = options.filter((o) => bounded.test(optionText(o)));
    if (byCode.length === 1) return optionText(byCode[0]);
  }
  return null;
}

// Facts the prompt used to hard-code (English level, use of AI), derived
// from the profile so another candidate's profile is not misdescribed.
function profileHints(spec) {
  const id = spec.identity || {};
  const lines = [];
  const english = (id.languages || []).find((l) => /^english$/i.test(String(l?.name || '')));
  if (english) {
    const level = String(english.level || '');
    const words = /native|bilingual|c2/i.test(level) ? 'native / C2'
      : /professional|fluent|advanced|c1/i.test(level) ? 'professional, C1 / Fluent / Advanced (not Native, not Beginner)'
        : /intermediate|b[12]|conversational/i.test(level) ? 'intermediate, B2 / Conversational'
          : /basic|beginner|a[12]|notions?|elementary/i.test(level) ? 'basic, A2 / Beginner'
            : level;
    if (words) lines.push(`- English: ${words}.`);
  }
  // The level the profile states (candidate.ai_proficiency), never a guess.
  if (id.aiProficiency) lines.push(`- Use of AI: ${id.aiProficiency}.`);
  return lines.join('\n');
}

// "(salaried employment, not freelance / B2B…)" only when the contract types
// the candidate takes say so.
function engagementNote(id) {
  const types = (id.contractTypes || []).join(' ');
  if (!types) return '';
  if (/freelance|contract|b2b|mission|fractional|ind[ée]pendant/i.test(types)) return ` (accepted contract types: ${id.contractTypes.join(', ')})`;
  return ' (an employment contract, not freelance / B2B, unless the form only offers those)';
}

// Skills or tools with their years, from candidate.skills.
function skillsLine(id) {
  const rows = (id.skills || []).filter((s) => s?.name).slice(0, 20);
  if (!rows.length) return '';
  return `Skills and tools: ${rows.map((s) => `${s.name}${s.years ? ` (${s.years} y)` : ''}${s.level ? ` [${s.level}]` : ''}`).join(', ')}. Years with one of these are the number given; any other tool: omit.`;
}

// "US state of residence" from identity.usState (lib/apply-spec.mjs): a base
// outside the US is "Outside US", a US base without a state is unknown.
export function usStateLine(id) {
  const state = String(id.usState || '').trim();
  if (/^outside us$/i.test(state)) return '- US state of residence: "Outside US" / "N/A" when offered, never a state.';
  if (state) return `- US state of residence: ${state}.`;
  return '- US state of residence: not in the facts, omit the field.';
}

// The screening answers the candidate gave once for every form.
function screeningLines(id) {
  const s = id.screening || {};
  const out = [];
  if (s.referredBy?.name) out.push(`Referred by: ${s.referredBy.name}${s.referredBy.email ? ` <${s.referredBy.email}>` : ''}`);
  if (s.previouslyEmployedAt?.length) out.push(`Previously employed at: ${s.previouslyEmployedAt.join(', ')}`);
  if (s.previouslyApplied?.length) out.push(`Previous applications: ${s.previouslyApplied.map((p) => `${p.company}${p.year ? ` (${p.year})` : ''}${p.interviewed ? ', interviewed' : ''}`).join('; ')}`);
  if (s.securityClearance) out.push(`Security clearance: ${s.securityClearance}`);
  if (s.drivingLicence?.has) out.push(`Driving licence: yes${s.drivingLicence.categories ? ` (${[].concat(s.drivingLicence.categories).join(', ')})` : ''}`);
  return out;
}

function candidateFacts(spec) {
  const id = spec.identity || {};
  const education = (id.education || []).slice(0, 3)
    .map((edu) => [edu.degree, edu.field && `in ${edu.field}`, edu.school && `, ${edu.school}`].filter(Boolean).join(' ')
      + ((edu.startYear || edu.endYear || edu.start || edu.end) ? ` (${[edu.startYear || edu.start, edu.endYear || edu.end].filter(Boolean).join('–')})` : ''))
    .filter((line) => line.trim());
  return [
    `Name: ${id.fullName}`,
    spec.narrative?.headline && `Headline: ${spec.narrative.headline}`,
    `Email: ${id.email}`,
    id.phone && `Phone: ${id.phone}`,
    `Location: ${id.location}${id.timezone ? ` (${id.timezone})` : ''}`,
    id.nationality && `Nationality: ${(id.nationalities?.length ? id.nationalities : [id.nationality]).join(', ')}`,
    id.workStatus && `Work status where based: ${id.workStatus}`,
    id.employment?.company && `Current employer: ${id.employment.company}${id.employment.title ? ` — ${id.employment.title}` : ''}${id.employment.startYear ? ` (since ${id.employment.startMonth || '?'}/${id.employment.startYear}${id.employment.current ? ', current' : ''})` : ''}`,
    id.yearsExperience && `Years of professional experience: ${id.yearsExperience}`,
    id.management && `People management: up to ${id.management.maxDirectReports} direct reports${id.management.context ? ` (${id.management.context})` : ''}; currently ${id.management.currentDirectReports} direct reports.`,
    education.length && `Education: ${education.join('; ')}`,
    id.certifications?.length && `Certifications: ${id.certifications.join(', ')}`,
    skillsLine(id),
    Array.isArray(id.languages) && id.languages.length
      && `Languages: ${id.languages.map((l) => `${l.name} (${l.level})`).join(', ')}. "Fluent / do you speak" is Yes only for a listed language at native or professional level.`,
    id.visaStatus && `Nationality / status: ${id.visaStatus}`,
    (id.startDate || id.noticePeriod) && `Availability: ${id.startDate || 'not stated'}; notice period: ${id.noticePeriod || 'not stated'}`,
    id.engagement && `Wanted engagement: ${id.engagement}${engagementNote(id)}`,
    id.daysPerWeek && `Days per week: ${id.daysPerWeek}`,
    id.salaryFormAnnual && `Salary: ${id.salaryFormAnnual}${id.salaryCurrency ? ` ${id.salaryCurrency}` : ''} a year, one number. Monthly in the same currency: divide by 12. Another currency (THB, USD, GBP…): omit the field, never convert.`,
    id.salaryFormDaily && `Daily rate: ${id.salaryFormDaily}${id.salaryCurrency ? ` ${id.salaryCurrency}` : ''}.`,
    id.linkedin && `LinkedIn: ${id.linkedin}`,
    id.portfolio && `Portfolio: ${id.portfolio}`,
    id.github && `GitHub: ${id.github}`,
    id.website && `Website: ${id.website}`,
    id.pronouns && `Pronouns: ${id.pronouns}`,
    ...screeningLines(id),
  ].filter(Boolean).join('\n');
}

// The candidate's own words that can attest a tool: screening answers, the
// CV summary and the career digest.
function toolSourceText(id, cvSummary = '', career = '') {
  const answers = (id.screening?.customAnswers || []).map((r) => `${r.question} ${r.answer}`).join('\n');
  const careerText = (career && typeof career === 'object') ? [career.text, career.digest].filter(Boolean).join('\n') : String(career || '');
  return [answers, cvSummary, careerText, (id.skills || []).join?.(', ') || ''].filter(Boolean).join('\n');
}

// "Question → answer" pairs the candidate wrote once (screening.custom_answers):
// a form question close to one of them takes that answer.
function customAnswersBlock(id) {
  const rows = (id.screening?.customAnswers || []).slice(0, 25);
  if (!rows.length) return '';
  return rows.map((row) => `- Q: ${row.question.replace(/\s+/g, ' ').slice(0, 160)}\n  A: ${row.answer.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
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
export async function resolveUnknownFields({ fields, spec, cvSummary = '', career = '', styleGuide = '', digest = '', answered = [], portfolio = '', chatFn = null }) {
  if (!fields?.length) return {};
  const id = spec.identity || {};
  const out = {};
  // Picks the model deduced from the evidence: { [key]: { why, source } }.
  // Not enumerable, so callers that walk the answers never see it.
  const inferred = {};
  Object.defineProperty(out, 'inferred', { value: inferred, enumerable: false });
  const rest = [];
  for (const field of fields) {
    // Passwords and legal history are the candidate's own statements; age,
    // birth date and the other demographic questions are never the model's
    // (it typed an invented age once). The deterministic rules decline them.
    if (isSecretCredentialField(field) || isPersonalLegalQuestion(field) || isDemographicQuestion(field)) continue;
    // Phone and dial-code slots are identity: the model answered the
    // widget's geo default ("Australia +61") when they reached it.
    if (looksLikeDialCodeField(field) || looksLikePhoneNumberField(field)) continue;
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

  const { groups, singles: allSingles } = groupCheckboxes(rest);
  // Tool checklists: tick the tools the candidate's own material names, never
  // one it does not; a required list with none of them goes to the human.
  const toolSource = toolSourceText(id, cvSummary, career);
  const openGroups = [];
  for (const group of groups) {
    const tools = pickAttestedTools(group.rows.map((r) => r.option), toolSource);
    if (tools) {
      for (const k of tools.picks) out[String(group.rows[k].field.i)] = 'yes';
      continue;
    }
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

  // Multi-select tool lists (a Greenhouse / Lever / Screenloop multi
  // select): same rule as the checkbox groups above.
  const singles = [];
  for (const f of allSingles) {
    const tools = fieldIsMulti(f) && f.options?.length ? pickAttestedTools(f.options, toolSource) : null;
    if (!tools) { singles.push(f); continue; }
    if (tools.picks.length) out[String(f.i)] = tools.picks.map((k) => optionText(f.options[k]));
  }
  const proseFields = singles.filter((f) => isProseField(f));
  const choiceFields = singles.filter((f) => !isProseField(f));

  const careerIndex = (career && typeof career === 'object') ? career : null;
  const sideNames = careerIndex?.sideNames || spec.sideNames || [];
  const employers = careerIndex?.employers || [];
  const ctx = candidateFacts(spec);

  const chatCall = chatFn || chat;
  const complete = (req) => chatCall({
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
      // "Portfolio link + walkthrough": the link, then a tour written from
      // the portfolio itself, not the bare URL.
      const tour = PORTFOLIO_TOUR.test(field.label) && id.portfolio;
      const fromIdentity = tour ? null : identityAnswerForField(field, spec);
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
          question: tour ? `${field.label} (start with the link ${id.portfolio}, then walk through two or three projects from the portfolio write-ups)` : field.label,
          company: spec.company || '',
          role: spec.role || '',
          // Full CV plus the portfolio write-ups: the facts a walkthrough or a
          // "why us" draws on. Nothing outside them is stated.
          career: portfolio ? `${careerText}\n\n## Portfolio (${id.portfolio || 'write-ups'})\n${String(portfolio).slice(0, 8000)}` : careerText,
          index: careerIndex || undefined,
          digest: digest || careerIndex?.digest || '',
          voice: String(styleGuide || '').slice(0, 1400),
          facts: ctx,
          offerContext,
          maxChars: max,
          ambition: [nar.headline, nar.nextRole].filter(Boolean).join('\n'),
          complete,
        });
        if (written.answer) {
          let text = written.answer;
          if (tour && !text.includes(id.portfolio)) text = fitToMaxLength(`${id.portfolio}\n\n${text}`, max);
          out[String(field.i)] = text;
          // Written by the model: the panel asks for a read.
          inferred[String(field.i)] = { why: 'réponse rédigée à partir du CV/portfolio/offre', source: 'CV + portfolio' };
        }
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
    // A list the candidate answered in profile.yml (custom_answers with
    // prefer_options): that row, no model.
    const mine = !fieldIsMulti(f) && f.options?.length
      ? customChoiceFor(f.label, f.options, id.screening?.customAnswers || [])
      : null;
    if (mine) { out[String(f.i)] = mine; continue; }
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

  // Full CV + portfolio copy, only when a list question needs a pick.
  const careerFull = (career && typeof career === 'object') ? String(career.text || '') : String(career || cvSummary || '');
  const evidence = asks.some((a) => a.options?.length)
    ? [careerFull && `CV:\n${careerFull.slice(0, 16000)}`, portfolio && `PORTFOLIO:\n${String(portfolio).slice(0, 14000)}`].filter(Boolean).join('\n\n')
    : '';
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

  // Titles, employers and dates: "more than 4 years as a Product Manager?"
  // was answered Yes with only the current title in sight.
  const careerLines = employers.slice(0, 8)
    .map((line) => `- ${String(line).replace(/^\s*-\s*/, '').replace(/\s+/g, ' ').slice(0, 110)}`)
    .join('\n');
  const prompt = `You fill a job application form as the candidate, in the first person. Use only the facts and policy below. Never invent employers, dates, titles, numbers, degrees or credentials.

CANDIDATE
${ctx}
${careerLines ? `\nCAREER (titles, employers, dates — the only work history)\n${careerLines}\n` : ''}
CANDIDATE POLICY (decides screening questions)
${policyPromptLines(id, spec)}
${[profileHints(spec), mobileProofHint(employers), `- Product scale:\n${scaleHint}`].filter(Boolean).join('\n')}
${customAnswersBlock(id) ? `\nTHE CANDIDATE'S OWN ANSWERS (use the answer of a question that asks the same thing)\n${customAnswersBlock(id)}\n` : ''}
${evidence ? `\nEVIDENCE (the candidate's full CV and portfolio write-ups: the only source for experience questions)\n${evidence}\n` : ''}
THE JOB
${spec.company || 'Company'} — ${spec.role || 'Role'}

${already ? `ALREADY ANSWERED ON THIS FORM (stay consistent with these)\n${already}\n\n` : ''}HOW TO ANSWER
- A field with OPTIONS: an object {"pick": N, "why": "<one short reason>", "source": "<where in CANDIDATE / OWN ANSWERS / EVIDENCE, quoted in a few words>"}; for a MULTI-SELECT "pick" is a JSON array of numbers. Choose the option the evidence supports best, even when no own answer matches the question word for word (experience with AI products, e-commerce or marketing, coding level, how often a tool is used…). In a multi-select choose only what clearly applies (usually 1 to 3 options), never all of them.
- Levels stay honest: never above what the evidence shows. Building code through AI tools ("vibe coding", Cursor / Claude Code) is not a senior or production front-end engineer; a tool the evidence shows in daily use is "Daily"; "led" only where the evidence says the candidate led or built it.
- Every field gets an answer. A subjective or personal option question (motivation, preference, how one works) still gets the option the evidence and the job fit best; a count or level the facts do not state exactly gets the closest honest option. Never invent employers, dates, titles or numbers.
- A field without options: a short JSON string, the bare value or one short sentence, in the language of the question (a Spanish question gets a Spanish answer). Never a career paragraph.
- A count the facts do not give exactly (years with one tool): the closest honest value the CV dates support.
- Consent, privacy or "I confirm" statements: the affirmative option. Marketing, newsletters, "contact me about other jobs": omit.
- Demographic questions (gender, race, disability, veteran…): the "prefer not to say" option, else omit.
- Have you worked for this company before? No, unless it is the current or a past employer above. Work-history fields: only the current employer above.
${usStateLine(id)}
- Areas of experience / industries / skills lists: the options closest to the candidate's target roles${(id.sectors || []).length ? ` and sectors (${id.sectors.join(', ')})` : ''} that the CV supports.
- Only a verification code, one-time password or password is omitted.

Return ONLY a JSON object mapping each field key to its answer, e.g. {"3": {"pick": 1, "why": "uses Cursor every day", "source": "own answer: AI tools"}, "g0": {"pick": [0, 2], "why": "…", "source": "…"}, "9": "Paris, France"}.

FIELDS
${fieldList}`;

  const raw = await chatCall({
    model: APPLY_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    // scale with field count so large forms (e.g. Airtable's 20+ long-answer
    // questions) aren't truncated mid-JSON; a pick carries its reason.
    max_tokens: Math.min(3000, 250 + asks.length * 110),
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
  for (const [rawKey, rawV] of Object.entries(parsed)) {
    // Keys echoed with their brackets ("[3]") still map to a field.
    const k = String(rawKey).replace(/^\s*\[|\]\s*$/g, '').trim();
    const ask = askByKey.get(k);
    if (!ask) continue;
    // {"pick", "why", "source"}: the pick is the answer, the reason is kept
    // so the panel shows it for review.
    let v = rawV;
    let reason = null;
    if (v && typeof v === 'object' && !Array.isArray(v) && 'pick' in v) {
      reason = { why: String(v.why || '').slice(0, 200), source: String(v.source || '').slice(0, 200) };
      v = v.pick;
      if (v == null || (Array.isArray(v) && !v.length)) continue;
    }
    // A count of people managed without the profile fact is a guess.
    if (!ask.group && MANAGEMENT_ASK.test(String(ask.field?.label || '')) && !id.management) continue;
    if (ask.group) {
      const rows = ask.group.rows;
      let picks = [...new Set([v].flat().map((one) => optionIndexFor(ask.options, one)).filter((idx) => idx >= 0))];
      // "Tick every country" is not a preference: keep the candidate's own
      // place when the model picked most of a long list, else nothing.
      if (rows.length >= 5 && picks.length > Math.max(3, Math.ceil(rows.length / 2))) {
        const home = countryOf(id.country) || id.country;
        picks = picks.filter((idx) => placesIn(rows[idx].option, { codes: true }).countries.includes(home));
      }
      for (const idx of picks) {
        out[String(rows[idx].field.i)] = 'yes';
        if (reason) inferred[String(rows[idx].field.i)] = reason;
      }
      continue;
    }
    const field = ask.field;
    const options = ask.options;
    if (options.length) {
      const list = [v].flat().map((one) => optionIndexFor(options, one)).filter((idx) => idx >= 0).map((idx) => optionText(options[idx]));
      if (!list.length) continue;
      out[String(k)] = Array.isArray(v) || ask.multi ? list : list[0];
      inferred[String(k)] = reason || { why: 'choisi par déduction', source: '' };
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
      // "N/A", "Unknown", "Not applicable" are the model declining, not answers.
      // "None" stays: it is a real answer to "Any non-compete agreements?".
      if (/^(n\/?a|unknown|not (applicable|specified|available|sure)|omit|skip|-+|null|undefined|unspecified|no answer)\.?$/i.test(String(v).trim())) continue;
      const text = polishApplicationAnswer(v, { sideNames });
      if (isList || shortAnswerFits(field, text, spec)) out[String(k)] = fitToMaxLength(text, field.maxLength);
    }
  }
  return out;
}
