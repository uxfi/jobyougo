// Screening questions decided from the candidate's own policy and the job's
// location, instead of one fixed answer per keyword. "Travel → No" said No to
// the quarterly offsites the profile accepts, "relocation → No" said No to a
// Bangkok role while the candidate can be based in Bangkok, and "work
// authorization → Yes" said Yes to the UK. Each answer here follows from
// config/profile.yml (authorized_in, remote_policy, onsite_availability) and
// the place the question is about.
import { fieldSearchText, normalizedFieldLabel } from './apply-fill-guards.mjs';
import { optionsAreYesNo } from './apply-option-match.mjs';
import {
  candidateIsIn,
  countryOf,
  expandCountryList,
  foldPlace,
  isEuCountry,
  namesEuropeanUnion,
  placesIn,
} from './apply-places.mjs';

const SPONSOR_RE = /sponsor|visa (support|transfer|sponsorship)|(need|require)[a-z]*[^.?]{0,40}\b(visa|work permit)\b|work permit (support|sponsorship)/;
// Visa as an immigration status, not "experience with Visa / Mastercard".
const AUTH_RE = /authori[sz]ed to work|authori[sz]ation to work|work authori[sz]ation|eligible to work|eligibility to work|right to work|legal(ly)? (right|entitled|authori[sz]ed|permitted|able|allowed) to work|legally work|permission to work|allowed to work|permitted to work|valid work permit|\bwork permit\b|\b(valid|current|work|hold an?|have an?|your) visa\b|\bvisa (status|type|category|holder)|permis de travail|autoris[ée]e? à travailler|droit de travailler|eu passport|european (union )?passport/;
// An open box that asks for the status itself ("What is your visa status?"),
// not an essay that happens to mention visas or sponsorship.
const STATUS_ASK_RE = /status|document|type of (visa|permit)|which (visa|permit)|what (visa|permit)|citizenship|nationality|statut/;
const RELOCATE_RE = /\brelocat|\b(willing|open|able|ready|happy|prepared)\b[^.?]{0,20}\bmov(e|ing) to\b|d[ée]m[ée]nag/;
// "Hybrid app", "on-site interview": not a work arrangement.
const ONSITE_RE = /\bhybrid\b(?! (apps?|application|mobile|cloud|framework|development))|in[- ]office|\bon[- ]?site\b(?! interview)|days? (a|per|each) week (in|at|from) (the |our )?office|(work|working) (from|in|at) (our|the) .{0,40}office|come (in)?to (the|our) office|\bcommut|pr[ée]sentiel|sur site/;
// Travel as something the job asks of you, not "the travel industry".
const TRAVEL_RE = /\b(willing|able|open|ready|happy|comfortable|available|prepared)\b[^.?]{0,30}\btravel|\btravel(l?ing)? (for|to|is|will|required|requirement|frequently|occasionally|regularly|up to|\d)|requires? (some |occasional |frequent |regular )?travel|\d+\s*%[^.?]{0,15}travel|business trips?|d[ée]placements?|off-?sites?\b|team[- ](building|retreats?|events?|gatherings?|on-?sites?)|visit(ing)? (our|the) .{0,40}(office|hq|headquarters)/;
const FREQUENT_TRAVEL_RE = /frequent|regular(ly)?|weekly|every week|each week|per week|monthly|every month|each month|a week per month|per month|par mois|chaque mois|\b([3-9]\d|100)\s*%|more than half/;
const DEICTIC_PLACE_RE = /this country|the country (where|in which|of the (role|job|position))|(job|role|position)'?s? (country|location)|where the (job|role|position) is|hiring location|specified location|this location|the location of (the|this) (job|role|position)|country you('re| are) applying (for|to)|country in which (this|the) (job|role|position)/;

const yes = (value = 'Yes') => ({ yesNo: 'yes', selectText: 'Yes', selectPrefer: /^(yes|oui)\b/i, value });
const no = (value = 'No') => ({ yesNo: 'no', selectText: 'No', selectPrefer: /^(no|non)\b/i, value });

// A lone tick box worded as a statement ("I am authorized to work in the
// EU"): ticked when true, left alone when not. Group rows ("Question —
// Option") are not statements and go to the resolver.
const isStatementBox = (f) => (f.type === 'checkbox' || f.role === 'checkbox' || f.role === 'switch')
  && !/\s[—–]\s/.test(String(f.label || ''));
const boxPlan = (ok) => (ok ? { check: true } : { skip: 'case non applicable au profil', answeredBlank: true });

function clean(list) {
  return (list || []).map((x) => String(x || '').trim()).filter(Boolean);
}

/** What the profile allows: bases, countries authorized for work, on-site, travel. */
export function candidatePolicy(identity = {}) {
  const p = identity.policy || {};
  const bases = (Array.isArray(p.bases) && p.bases.length ? p.bases : [{ city: identity.city, country: identity.country }])
    .map((b) => ({ city: String(b?.city || '').trim(), country: countryOf(b?.country) || String(b?.country || '').trim() }))
    .filter((b) => b.city || b.country);
  const declared = clean(p.authorizedIn);
  let authorized = expandCountryList(declared);
  if (!authorized.size) {
    authorized = new Set();
    const home = countryOf(identity.country) || identity.country;
    if (home) authorized.add(home);
    if (isEuCountry(home) || identity.workAuthEU) for (const c of expandCountryList(['European Union'])) authorized.add(c);
  }
  const onsiteText = String(p.onsite || '');
  const remoteText = String(p.remote || '');
  return {
    bases,
    baseCountries: new Set(bases.map((b) => b.country).filter(Boolean)),
    baseCities: new Set(bases.map((b) => foldPlace(b.city)).filter(Boolean)),
    authorized,
    // "Open to on-site if based in Thailand" → on-site is fine in Thailand only.
    onsiteCountries: new Set(placesIn(onsiteText).countries),
    // No policy text means the historical default: full remote, no travel.
    remoteOnly: remoteText ? /full(y)?[\s-]*remote|remote only|100\s*%\s*remote|t[ée]l[ée]travail (complet|total)/i.test(remoteText) : true,
    travelOk: /travel/i.test(onsiteText) && !/\b(no|not|never)\b[^.]{0,20}travel/i.test(onsiteText),
  };
}

// Location lines of the report ("- **Localisation** : Hybrid · Berlin") and of
// the archived JD ("Location: London"), plus the role and the posting URL.
function locationLines(reportText = '') {
  return String(reportText || '')
    .split('\n')
    .filter((line) => /^\s*[-*]?\s*\**\s*(localisation|location|lieu|ville|pays|country|city|based in|work location|office)\b/i.test(line))
    // The candidate's own whereabouts ("Localisation actuelle (Phuket)") are not the job's.
    .filter((line) => !/candidat|\bhugo\b|\bcv\b|profil|actuel|current|match/i.test(line))
    .slice(0, 8)
    .join('\n');
}

/** Where the job is: countries, cities, and whether it is remote. */
export function offerLocationFromText({ role = '', url = '', reportText = '' } = {}) {
  let slug = '';
  try { slug = decodeURIComponent(String(url || '')); } catch { slug = String(url || ''); }
  slug = slug.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/[-_/.+]+/g, ' ');
  const lines = locationLines(reportText);
  const text = [role, slug, lines].filter(Boolean).join('\n');
  const found = placesIn(text);
  const head = `${role}\n${lines}`;
  // "Remote, mais résidence exigée en Suède" or "Hybrid · Remote" still ties
  // the job to a country: only a plain remote job is worked from home.
  const tied = /hybrid|hybride|on-?site|pr[ée]sentiel|pr[ée]sence|r[ée]sidence (exig|requi)|must (reside|live|be based)|resident/i.test(head);
  return {
    countries: found.countries,
    cities: found.cities.map((c) => c.city),
    remote: !tied && /\bremote\b|t[ée]l[ée]travail|full[- ]remote|à distance|anywhere/i.test(head),
  };
}

export function offerLocation(spec = {}) {
  if (spec.offerLocation && Array.isArray(spec.offerLocation.countries)) return spec.offerLocation;
  return offerLocationFromText({ role: spec.role, url: spec.jobUrl });
}

function questionText(f) {
  return String(f?.label || '').replace(/[*✱]/g, ' ').replace(/\s+/g, ' ').trim();
}

// A yes/no question, whatever the widget: Yes|No options, a question that
// opens on "Are you / Do you…", or a statement on a choice widget whose
// options are not scraped yet ("This role requires relocation to Doha").
function isYesNoAsk(f) {
  const opts = (f.options || []).map((o) => String(typeof o === 'string' ? o : o?.text || '').trim())
    .filter((t) => t && !/^(select|choose|--|please|s[ée]lectionn)/i.test(t));
  if (opts.length) return optionsAreYesNo(opts) || opts.every((t) => /^(yes|no|oui|non)\b/i.test(t));
  const q = questionText(f);
  // The ask has to open a sentence: "Why do you want to move…" is not yes/no.
  const sentences = q.split(/(?<=[.?!:])\s+/).map((part) => part.replace(/^[\s•\-–—.)\d]+/, ''));
  if (sentences.some((part) => /^(are|do|does|did|will|would|can|could|have|has|is|should)\s+(you|your)\b|^(êtes|avez|pouvez|seriez|acceptez|accepteriez)[- ]vous\b/i.test(part))) return true;
  // "For the country you will be based in, do you require sponsorship?":
  // the ask sits after a comma. A place-question ("In which country, do you
  // reside?") already opened on a wh-word and is not this.
  if (sentences.some((part) => !/^(what|which|where|when|why|how|who|whom|whose|in which|for which)\b/i.test(part)
      && /,\s*(are|do|will|would|can|could|have|is)\s+you\b/i.test(part))) return true;
  if (/\byes\s*\/\s*no\b|\boui\s*\/\s*non\b/i.test(q)) return true;
  return String(f.tag || '').toLowerCase() === 'select' || f.type === 'radio' || f.role === 'combobox';
}

function targetPlaces(f, spec, s) {
  const q = questionText(f);
  // "…to work in the US (or country of your residence)?": home counts too.
  if (/\bor (in )?(the |your )?(country (of|where) (your )?(residence|you (live|reside|are based))|current (country|location)|home country|country of residence)/.test(s)) {
    return { eu: false, countries: [], cities: [], orHome: true };
  }
  const named = placesIn(q);
  if (namesEuropeanUnion(q)) return { eu: true, countries: named.countries, cities: named.cities.map((c) => c.city) };
  if (named.countries.length) return { eu: false, countries: named.countries, cities: named.cities.map((c) => c.city) };
  const offer = offerLocation(spec);
  if (!offer.remote && offer.countries.length) {
    return { eu: false, countries: offer.countries, cities: offer.cities || [], fromOffer: true, deictic: DEICTIC_PLACE_RE.test(s) };
  }
  return { eu: false, countries: [], cities: [], remoteOffer: offer.remote };
}

function authorizedFor(target, policy, identity) {
  if (target.eu) return [...expandCountryList(['European Union'])].every((c) => policy.authorized.has(c));
  if (target.countries.length) return target.countries.every((c) => policy.authorized.has(c));
  // Remote job or a country nobody named: the candidate works from home.
  const home = countryOf(identity.country) || identity.country;
  return !home || policy.authorized.has(home);
}

function workAuthPlan(f, spec, s) {
  const identity = spec.identity || {};
  const policy = candidatePolicy(identity);
  // "Do you live in Germany and are you allowed to work in Germany?", "Are you
  // currently living in the Netherlands and in possession of an EU passport?":
  // living there is part of the ask. "…or willing to relocate" is not.
  if (/(do you|are you)( currently)? (live|living|located|based|reside|residing) in/.test(s)
      && !/\bor\b[^.?]{0,30}\b(willing|open|able|ready|happy) to (relocat|move)/.test(s)
      && candidateIsIn(questionText(f), identity) === false) {
    return isStatementBox(f) ? boxPlan(false) : no();
  }
  const euCitizen = [...policy.authorized].some((c) => isEuCountry(c))
    || /\b(eu|european|french)\b[^.]{0,20}citizen|citoyen/i.test(String(identity.visaStatus || ''));
  // "EU passport OR a valid work permit…": holding the passport is the answer.
  if (/eu passport|european (union )?passport/.test(s)) {
    if (isStatementBox(f)) return boxPlan(euCitizen);
    return euCitizen ? yes() : null;
  }
  const target = targetPlaces(f, spec, s);
  const ok = authorizedFor(target, policy, identity);
  const visaText = String(identity.visaStatus || '').trim();
  const essay = (f.tag === 'textarea' || f.type === 'textarea') && questionText(f).length > 120;
  if (SPONSOR_RE.test(s) && !/without[^.?]{0,25}sponsor/.test(s)) {
    if (isStatementBox(f)) return boxPlan(!ok);
    if (!isYesNoAsk(f)) return essay ? null : { value: ok ? (visaText || 'No sponsorship needed') : 'Yes' };
    return ok ? no(visaText || 'No') : yes();
  }
  if (isStatementBox(f)) return boxPlan(ok);
  if (!isYesNoAsk(f)) return !essay && visaText && STATUS_ASK_RE.test(s) ? { value: visaText } : null;
  return ok ? yes() : no();
}

function relocationOk(target, policy) {
  if (target.cities.length) return target.cities.some((city) => policy.baseCities.has(foldPlace(city)));
  if (target.countries.length) return target.countries.some((c) => policy.baseCountries.has(c));
  return false;
}

function onsiteOk(target, policy) {
  if (target.countries.length) {
    if (target.countries.every((c) => policy.onsiteCountries.has(c))) return true;
    return !policy.remoteOnly;
  }
  return !policy.remoteOnly;
}

/**
 * Yes/No (or a short value) for work authorization, sponsorship, relocation,
 * on-site / hybrid and travel questions. null when the field is none of
 * these, or when it is a pick list the remote-policy rules own.
 */
export function policyPlan(f, spec = {}) {
  if (!f || f.type === 'file') return null;
  const s = fieldSearchText(f);
  const label = normalizedFieldLabel(f);
  if (!label && !s.trim()) return null;
  const identity = spec.identity || {};
  const policy = candidatePolicy(identity);

  if (SPONSOR_RE.test(s) || AUTH_RE.test(s)) {
    // Group rows ("Which visas do you hold? — H-1B") are options, not asks.
    if ((f.type === 'checkbox' || f.role === 'checkbox') && !isStatementBox(f)) return null;
    // A pick list of statuses ("Citizen / Work visa / …") is not yes/no.
    if (Array.isArray(f.options) && f.options.length && !isYesNoAsk(f)) return null;
    return workAuthPlan(f, spec, s);
  }

  const relocate = RELOCATE_RE.test(s);
  const onsite = ONSITE_RE.test(s);
  const travel = TRAVEL_RE.test(s);
  if (!relocate && !onsite && !travel) return null;
  // Already in a listed country: the position is filled from home.
  if (/without[^.?]{0,40}relocation assistance|relocation assistance from|fill the position in one of the countries listed/.test(s)) {
    return isStatementBox(f) ? boxPlan(true) : yes();
  }
  const box = isStatementBox(f);
  if (!box && !isYesNoAsk(f)) return null;
  if ((f.type === 'checkbox' || f.role === 'checkbox') && !box) return null;
  const target = targetPlaces(f, spec, s);
  // "Are you based in, or willing to relocate to, Vienna?" — based there is a yes too.
  const basedThere = /(currently )?(based|located|living|live) in/.test(s)
    && target.cities.some((city) => policy.baseCities.has(foldPlace(city)));
  const answers = [];
  if (relocate) answers.push(basedThere || relocationOk(target, policy));
  if (onsite) answers.push(onsiteOk(target, policy));
  if (travel && !onsite) {
    const frequent = FREQUENT_TRAVEL_RE.test(s);
    answers.push(policy.travelOk && !frequent);
  }
  const ok = answers.every(Boolean);
  if (box) return boxPlan(ok);
  return ok ? yes() : no();
}

/** The same policy in words, for the model's prompt. */
export function policyPromptLines(identity = {}, spec = {}) {
  const policy = candidatePolicy(identity);
  const p = identity.policy || {};
  const authorizedNames = clean(p.authorizedIn).length ? clean(p.authorizedIn).join(', ') : [...policy.authorized].slice(0, 6).join(', ');
  const bases = policy.bases.map((b) => [b.city, b.country].filter(Boolean).join(', ')).join(' or ');
  const offer = offerLocation(spec);
  const where = offer.remote
    ? `remote${offer.countries.length ? ` (${offer.countries.join(', ')})` : ''}`
    : offer.countries.length ? [...offer.cities, ...offer.countries].join(', ') : 'not stated';
  return [
    `- Work authorization: allowed to work without sponsorship in ${authorizedNames}. Anywhere else (US, UK, Canada…) needs sponsorship: "authorized / right to work there?" is No and "require sponsorship there?" is Yes.`,
    `- Work mode: ${p.remote || (policy.remoteOnly ? 'full remote' : 'remote or hybrid')}.${p.onsite ? ` ${p.onsite}.` : ''} On-site or hybrid outside ${[...policy.onsiteCountries].join(', ') || 'those places'}: No.`,
    `- Bases: ${bases || identity.location || 'not stated'}. Relocation is Yes only to one of these bases.`,
    policy.travelOk ? '- Travel: occasional trips, offsites and team events are fine (Yes). Frequent travel (weekly, monthly, 30 %+): No.' : '- Travel: No.',
    `- This job is located: ${where}.`,
  ].join('\n');
}
