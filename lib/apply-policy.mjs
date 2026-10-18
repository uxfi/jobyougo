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
  placeFromText,
  placesIn,
} from './apply-places.mjs';

const SPONSOR_RE = /sponsor|visa (support|transfer|sponsorship)|(need|require)[a-z]*[^.?]{0,40}\b(visa|work permit)\b|work permit (support|sponsorship)/;
// Visa as an immigration status, not "experience with Visa / Mastercard".
const AUTH_RE = /authori[sz]ed to work|authori[sz]ation to work|work authori[sz]ation|eligible to work|eligibility to work|right to work|legal(ly)? (right|entitled|authori[sz]ed|permitted|able|allowed) to work|legally work|permission to work|allowed to work|permitted to work|valid work permit|\bwork permit\b|\b(valid|current|work|hold an?|have an?|your) visa\b|\bvisa (status|type|category|holder)|permis de travail|autoris[ée]e? à travailler|autorisation de travail|droit de travailler|permiso de trabajo|derecho a trabajar|arbeitserlaubnis|arbeitsgenehmigung|werkvergunning|permesso di lavoro|eu passport|european (union )?passport/;
// The employer saying it does not sponsor ("We cannot sponsor visas", "visa
// sponsorship is not available"), not the candidate's own need: "I do not
// require sponsorship" is not one.
const SPONSOR_NOTE_RE = /\b(we|they|company|employer)\b[^.!?]{0,30}\b(not|unable|cannot|can't|won't)\b[^.!?]{0,30}\bsponsor|\bsponsor\w*\b[^.!?]{0,40}\b(not\s|un)(available|offered|provided|possible)\b|\bno (visa )?sponsorship\b[^.!?]{0,20}\b(available|offered|provided)\b/;
// A sentence ends on "." or "!" before a capital, never after a dotted
// abbreviation: "the U.S. without sponsorship", "(e.g. U.S. citizen)".
const SENTENCE_BREAK_RE = /(?<!(?:^|[\s(])(?:[A-Za-z]\.){1,3})(?<=[.!])\s+(?=[A-Z0-9"“'(])/;
const EXAMPLE_ASIDE_RE = /^\s*(e\.?\s?g\.?|for (example|instance)|such as)(?![a-z])/i;
// An open box that asks for the status itself ("What is your visa status?"),
// not an essay that happens to mention visas or sponsorship.
const STATUS_ASK_RE = /status|document|type of (visa|permit)|which (visa|permit)|what (visa|permit)|citizenship|nationality|statut/;
const RELOCATE_RE = /\brelocat|\b(willing|open|able|ready|happy|prepared)\b[^.?]{0,20}\bmov(e|ing) to\b|d[ée]m[ée]nag/;
// "Hybrid app", "on-site interview": not a work arrangement.
const ONSITE_RE = /\bhybrid\b(?! (apps?|application|mobile|cloud|framework|development))|in[- ]office|\bon[- ]?site\b(?! interview)|days? (a|per|each) week (in|at|from) (the |our )?office|(work|working) (from|in|at) (our|the) .{0,40}office|come (in)?to (the|our) office|\bcommut|pr[ée]sentiel|sur site/;
// Travel as something the job asks of you, not "the travel industry".
const TRAVEL_RE = /\b(willing|able|open|ready|happy|comfortable|available|prepared)\b[^.?]{0,30}\btravel|\btravel(l?ing)? (for|to|is|will|required|requirement|frequently|occasionally|regularly|up to|\d)|requires? (some |occasional |frequent |regular )?travel|\d+\s*%[^.?]{0,15}travel|business trips?|d[ée]placements?|off-?sites?\b|team[- ](building|retreats?|events?|gatherings?|on-?sites?)|visit(ing)? (our|the) .{0,40}(office|hq|headquarters)/;
const FREQUENT_TRAVEL_RE = /frequent|regular(ly)?|weekly|every week|each week|per week|monthly|every month|each month|a week per month|per month|par mois|chaque mois|\b([3-9]\d|100)\s*%|more than half/;
// "May we contact your current employer?" — a discreet search says No.
const CONTACT_EMPLOYER_RE = /\b(may|can|could) (we|the company|our team) contact your (current|present) (employer|manager|company)\b|\bcontact(ing)? your (current|present) (employer|manager)\b|\b(may|can|could) we (reach out to|speak (to|with)) your (current|present) (employer|manager)\b/;
// "Are you currently employed?" — not "employed by <the hiring company>",
// which apply-fill-guards answers as a former-employee check.
const EMPLOYED_ASK_RE = /\bare you (currently|presently) employed\b(?!\s+(by|at|for|with|in|as|here)\b)|\bdo you currently (have|hold) a (job|position)\b/;
const DEICTIC_PLACE_RE =/this country|the country (where|in which|of the (role|job|position))|(job|role|position)'?s? (country|location)|where the (job|role|position) is|hiring location|specified location|this location|the location of (the|this) (job|role|position)|country you('re| are) applying (for|to)|country in which (this|the) (job|role|position)/;

const yes = (value = 'Yes') => ({ yesNo: 'yes', selectText: 'Yes', selectPrefer: /^(yes|oui|s[ií]|ja|sim)(?![a-zà-ÿ])/i, value });
const no = (value = 'No') => ({ yesNo: 'no', selectText: 'No', selectPrefer: /^(no|non|nein|n[aã]o)(?![a-zà-ÿ]|-?binary)/i, value });

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
  // No base: the city and country, else the location text ("Berlin, Germany").
  const here = identity.city || identity.country ? { city: identity.city, country: identity.country } : placeFromText(identity.location);
  const bases = (Array.isArray(p.bases) && p.bases.length ? p.bases : [here])
    .map((b) => ({ city: String(b?.city || '').trim(), country: countryOf(b?.country) || String(b?.country || '').trim() }))
    .filter((b) => b.city || b.country);
  const declared = clean(p.authorizedIn);
  let authorized = expandCountryList(declared);
  if (!authorized.size) {
    authorized = new Set();
    const home = countryOf(here.country) || here.country;
    if (home) authorized.add(home);
    if (isEuCountry(home) || identity.workAuthEU) for (const c of expandCountryList(['European Union'])) authorized.add(c);
  }
  const onsiteText = String(p.onsite || '');
  const remoteText = String(p.remote || '');
  // Structured exceptions (lib/candidate-location.mjs) when the identity has
  // them, else the places the free text names ("Open to on-site if based in
  // Thailand" → on-site is fine in Thailand only).
  const exceptions = Array.isArray(p.onsiteExceptions) ? p.onsiteExceptions : null;
  const onsiteCountries = exceptions
    ? new Set(exceptions.map((e) => countryOf(e.country) || countryOf(e.city) || e.country).filter(Boolean))
    : new Set(placesIn(onsiteText).countries);
  const relocation = p.relocation;
  return {
    bases,
    home: countryOf(here.country) || here.country || '',
    baseCountries: new Set(bases.map((b) => b.country).filter(Boolean)),
    baseCities: new Set(bases.map((b) => foldPlace(b.city)).filter(Boolean)),
    authorized,
    onsiteCountries,
    // A stated policy decides; without one nothing is refused for work mode.
    remoteOnly: typeof p.fullRemoteOnly === 'boolean'
      ? p.fullRemoteOnly
      : (remoteText ? /full(y)?[\s-]*remote|remote only|100\s*%\s*remote|t[ée]l[ée]travail (complet|total)/i.test(remoteText) : false),
    travelOk: typeof p.travel?.offsites === 'boolean'
      ? p.travel.offsites
      : /travel/i.test(onsiteText) && !/\b(no|not|never)\b[^.]{0,20}travel/i.test(onsiteText),
    // true: anywhere; a list: those countries; otherwise only the bases.
    relocationCountries: Array.isArray(relocation) ? new Set(relocation.map((c) => countryOf(c) || c)) : null,
    relocationAnywhere: relocation === true,
  };
}

/**
 * A report line naming the candidate is about the candidate, not the job. The
 * full name and case-sensitive: a first name alone ("Max", "Will", "May") is a
 * word in offer lines ("Hybrid, max 2 office days"). null filters nothing, as
 * does a name that is also a place (Paris, Sydney, Austin).
 */
export function candidateNameRe(candidateName = '') {
  const name = String(candidateName || '').trim().replace(/\s+/g, ' ');
  if (name.length < 3 || countryOf(name)) return null;
  const pattern = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\d])${pattern}(?![\\p{L}\\d])`, 'u');
}

/**
 * The part of an evaluation report that describes the OFFER: the header and the
 * "A) Role summary" section. B) Match CV, C) Level, D) Comp and G) Legitimacy
 * discuss the candidate ("résident en Thaïlande", "aucune contrainte hors
 * Bangkok", "Localisation : Phuket (résident digital nomad)") and made European
 * jobs (Preply, Secfi, Factorial) read as Asian ones, so the form got Bangkok
 * and Thailand. A report without that structure is used whole, as before.
 */
export function offerPartOfReport(reportText = '') {
  const text = String(reportText || '');
  const sections = text.split(/^(?=## )/m);
  if (sections.length < 2 || !sections.some((part) => /^##\s+A\)/i.test(part))) return text;
  // The score line carries the evaluator's verdict ("hard fail: on-site outside Bangkok").
  return sections.filter((part, i) => i === 0 || /^##\s+A\)/i.test(part)).join('')
    .split('\n').filter((line) => !/^\s*\**score:?\**/i.test(line)).join('\n');
}

// Location lines of the report ("- **Localisation** : Hybrid · Berlin") and of
// the archived JD ("Location: London"), plus the role and the posting URL.
function locationLines(reportText = '', candidateName = '') {
  const nameRe = candidateNameRe(candidateName);
  return offerPartOfReport(reportText)
    .split('\n')
    .filter((line) => /^\s*[-*]?\s*\**\s*(localisation|location|lieu|ville|pays|country|city|based in|work location|office)\b/i.test(line))
    // The candidate's own whereabouts ("Localisation actuelle (…)") are not
    // the job's, nor the evaluator's verdict on them ("Anywhere → compatible
    // avec …", "anywhere in Europe — exclut …"): those lines made a worldwide
    // job one of the candidate's own countries. Lines naming the candidate too.
    .filter((line) => !/candidat|\bcv\b|profil|actuel|current|match|compatib|exclu|mention|→|->|cependant|however/i.test(line) && !(nameRe && nameRe.test(line)))
    .slice(0, 8)
    .join('\n');
}

/** Where the job is: countries, cities, and whether it is remote. */
export function offerLocationFromText({ role = '', url = '', reportText = '', candidateName = '' } = {}) {
  let slug = '';
  try { slug = decodeURIComponent(String(url || '')); } catch { slug = String(url || ''); }
  slug = slug.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/[-_/.+]+/g, ' ');
  const lines = locationLines(reportText, candidateName);
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

// The sentence that ends on the first "?", without the note under it or the
// line before it. Teamtailor's "Do you have the Right to Work in the country
// you are applying to? Please note, if you do not have the right to work … and
// visa sponsorship is not available, your application will be rejected
// automatically" is a right-to-work ask: the sponsorship in the note sent it
// down the sponsorship branch, whose "No" (no sponsorship needed) knocked out
// an EU citizen applying to a Paris / remote Europe role (2026-10-16). Same
// for "We cannot sponsor visas. Do you have the right to work in Germany?".
// A statement (no "?") keeps every sentence but the employer's notes: "Right
// to work in the UK (visa sponsorship is not available)" and "I confirm I
// have the right to work… Visa sponsorship is not available." answered Yes
// for the UK and No for the EU. Examples in brackets ("(e.g. U.S. citizen or
// green card holder)") are not the ask either. The case is kept: placesIn
// reads "US" / "UK" as upper-case codes only.
// `before` is the lead-in ahead of the asking sentence ("You must have the
// right to work in the EU. Will you require sponsorship?"): still this
// question's place, unlike a note after the "?". A line break ends a sentence
// too: forms put their helper text on its own line, with no full stop
// ("Visa sponsorship is not available for this role\nDo you have the right
// to work in Germany?" said No in Germany). A "?" in brackets ("Work
// authorization (required?) Are you…") does not end the question.
// `questions` is every asking sentence, notes left out: "Are you based in the
// EU? Do you have the right to work in the EU without sponsorship?" asks both,
// and the second one's "without sponsorship" still counts.
function askParts(f) {
  const tidy = (text) => text.replace(/\s+/g, ' ').trim();
  const sentences = String(f?.label || '').replace(/[*✱]/g, ' ')
    .replace(/\(([^)]*)\)/g, (whole, inner) => (SPONSOR_NOTE_RE.test(inner.toLowerCase()) || EXAMPLE_ASIDE_RE.test(inner) ? ' ' : whole))
    .split(/\s*[\r\n]+\s*/)
    .flatMap((line) => tidy(line).split(SENTENCE_BREAK_RE))
    .map(tidy)
    .filter(Boolean);
  const at = sentences.findIndex((part) => questionMarks(part).length);
  if (at < 0) {
    const ask = sentences.filter((part) => !SPONSOR_NOTE_RE.test(part.toLowerCase())).join(' ');
    return { ask, questions: ask, before: '' };
  }
  const asking = sentences.filter((part) => questionMarks(part).length);
  return {
    ask: sentences[at].slice(0, questionMarks(sentences[at])[0] + 1),
    questions: asking.map((part) => part.slice(0, questionMarks(part).at(-1) + 1)).join(' '),
    before: sentences.slice(0, at).join(' '),
  };
}

// Where "?" closes a question, brackets aside.
function questionMarks(text) {
  const at = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth = Math.max(0, depth - 1);
    else if (text[i] === '?' && depth === 0) at.push(i);
  }
  return at;
}

function askText(f) {
  return askParts(f).ask;
}

// A yes/no question, whatever the widget: Yes|No options, a question that
// opens on "Are you / Do you…", or a statement on a choice widget whose
// options are not scraped yet ("This role requires relocation to Doha").
function isYesNoAsk(f) {
  const opts = (f.options || []).map((o) => String(typeof o === 'string' ? o : o?.text || '').trim())
    .filter((t) => t && !/^(select|choose|--|please|s[ée]lectionn)/i.test(t));
  // A short list that holds a Yes row and a No row is still a yes/no ask,
  // whatever the third row says ("Yes | No | Open to discuss", "Yes | No |
  // I will need sponsorship"): the old blanket rules took those over.
  if (opts.length) {
    if (optionsAreYesNo(opts) || opts.every((t) => /^(yes|no|oui|non|s[ií]|ja|nein|n[aã]o)(?![a-zà-ÿ])/i.test(t))) return true;
    return opts.length <= 6
      && opts.some((t) => /^(yes|oui|s[ií]|ja)(?![a-zà-ÿ])/i.test(t))
      && opts.some((t) => /^(no|non|nein|n[aã]o)(?![a-zà-ÿ])/i.test(t) && !/^non-?binary|^none\b/i.test(t));
  }
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
  // The place the question itself names, not one its note or examples name:
  // "Do you have the right to work in the UK? EU nationals must hold settled
  // status" is a UK question (it got Yes), "(e.g. U.S. citizen)" under "the
  // country where this job is located" is not a US one (it got No in Paris).
  // Then its other questions, its lead-in, then the posting. "…eligible to
  // work in Europe?" asks about the EU; a lead-in that hires "across Europe"
  // says nothing of the role.
  const { ask, questions, before } = askParts(f);
  for (const [text, europe] of [[ask, /\beurope\b/i.test(ask)], [questions, /\beurope\b/i.test(questions)], [before, false]]) {
    const named = placesIn(text);
    if (europe || namesEuropeanUnion(text)) return { eu: true, countries: named.countries, cities: named.cities.map((c) => c.city) };
    if (named.countries.length) return { eu: false, countries: named.countries, cities: named.cities.map((c) => c.city) };
  }
  const offer = offerLocation(spec);
  if (!offer.remote && offer.countries.length) {
    return { eu: false, countries: offer.countries, cities: offer.cities || [], fromOffer: true, deictic: DEICTIC_PLACE_RE.test(s) };
  }
  // "Remote (US) - New York": a remote job tied to a country the candidate
  // may not work in is that country's job, not a work-from-home one. It got
  // Yes to US work authorization.
  // Only when none of its countries is one the candidate may work in: a
  // remote job open in France and the UK is worked from France.
  if (offer.remote && offer.countries.length) {
    const policy = candidatePolicy(spec.identity || {});
    if (offer.countries.every((c) => !policy.authorized.has(c))) {
      return { eu: false, countries: offer.countries, cities: [], fromOffer: true, remoteOffer: true, deictic: DEICTIC_PLACE_RE.test(s) };
    }
  }
  // Neither the question nor the posting names a place: the rest of the label
  // may ("Do you have the right to work in this country? This role is based in
  // London."), its examples aside.
  if (!offer.countries.length) {
    const rest = q.replace(/\(([^)]*)\)/g, (whole, inner) => (EXAMPLE_ASIDE_RE.test(inner) ? ' ' : whole));
    const noted = placesIn(rest);
    if (namesEuropeanUnion(rest)) return { eu: true, countries: noted.countries, cities: noted.cities.map((c) => c.city) };
    if (noted.countries.length) return { eu: false, countries: noted.countries, cities: noted.cities.map((c) => c.city) };
  }
  return { eu: false, countries: [], cities: [], remoteOffer: offer.remote };
}

/**
 * Whether the candidate may work where this field's question points, without
 * sponsorship. null when the profile says nowhere (no base, no authorized_in).
 */
export function workAuthorizedFor(f, spec = {}) {
  const s = fieldSearchText(f);
  return authorizedFor(targetPlaces(f, spec, s), candidatePolicy(spec.identity || {}));
}

function authorizedFor(target, policy) {
  // Unknown is the candidate's answer, never a No.
  if (!policy.authorized.size) return null;
  if (target.eu) return [...expandCountryList(['European Union'])].every((c) => policy.authorized.has(c));
  if (target.countries.length) return target.countries.every((c) => policy.authorized.has(c));
  // Remote job or a country nobody named: the candidate works from home.
  return !policy.home || policy.authorized.has(policy.home);
}

function workAuthPlan(f, spec, s) {
  const identity = spec.identity || {};
  const policy = candidatePolicy(identity);
  // "Do you live in Germany and are you allowed to work in Germany?", "Are you
  // currently living in the Netherlands and in possession of an EU passport?":
  // living there is part of the ask. "…or willing to relocate" is not. No
  // known place: not a No.
  // The question itself, not the note under it ("EU passport holders do not
  // need one" under "Will you require sponsorship?" answered Yes; "…who can
  // work without visa sponsorship" under "Do you require sponsorship?" flipped
  // it). Living there, the passport and "without sponsorship" may sit in any
  // of its questions; the main ask is the first one. A label with no text of
  // its own (name / id only) keeps `s`.
  const own = askParts(f);
  const ask = own.ask.toLowerCase() || s;
  const asked = own.questions.toLowerCase() || s;
  const where = identity.city || identity.country ? identity : policy.bases[0];
  if (/(do you|are you)( currently)? (live|living|located|based|reside|residing) in/.test(asked)
      && !/\bor\b[^.?]{0,30}\b(willing|open|able|ready|happy) to (relocat|move)/.test(asked)
      && where && candidateIsIn(own.questions || questionText(f), where) === false) {
    return isStatementBox(f) ? boxPlan(false) : no();
  }
  const euCitizen = [...policy.authorized].some((c) => isEuCountry(c))
    || /\b(eu|european|french)\b[^.]{0,20}citizen|citoyen/i.test(String(identity.visaStatus || ''));
  // "EU passport OR a valid work permit…": holding the passport is the answer.
  if (/eu passport|european (union )?passport/.test(asked)) {
    if (isStatementBox(f)) return boxPlan(euCitizen);
    return euCitizen ? yes() : null;
  }
  const target = targetPlaces(f, spec, s);
  const ok = authorizedFor(target, policy);
  if (ok == null) return null;
  const visaText = String(identity.visaStatus || '').trim();
  const essay = (f.tag === 'textarea' || f.type === 'textarea') && questionText(f).length > 120;
  const authAskOnly = AUTH_RE.test(ask) && !SPONSOR_RE.test(ask);
  if (SPONSOR_RE.test(s) && !/without[^.?]{0,25}sponsor/.test(asked) && !authAskOnly) {
    if (isStatementBox(f)) return boxPlan(!ok);
    if (!isYesNoAsk(f)) return essay ? null : { value: ok ? (visaText || 'No sponsorship needed') : 'Yes' };
    return ok ? no(visaText || 'No') : yes();
  }
  if (isStatementBox(f)) return boxPlan(ok);
  if (!isYesNoAsk(f)) {
    if (essay || !STATUS_ASK_RE.test(s)) return null;
    // "UK right to work status" for a French citizen is not the profile's
    // "no sponsorship needed" line: the status there is "needs sponsorship".
    if (!ok) return { value: 'Requires visa sponsorship', selectText: 'Requires visa sponsorship', selectPrefer: /sponsor|need (a )?(visa|permit)|require/i };
    return visaText ? { value: visaText } : null;
  }
  return ok ? yes() : no();
}

function relocationOk(target, policy) {
  if (policy.relocationAnywhere) return true;
  if (target.cities.length && target.cities.some((city) => policy.baseCities.has(foldPlace(city)))) return true;
  if (target.countries.length && target.countries.some((c) => policy.baseCountries.has(c) || policy.relocationCountries?.has(c))) return true;
  return false;
}

function onsiteOk(target, policy) {
  if (target.countries.length) {
    if (target.countries.every((c) => policy.onsiteCountries.has(c))) return true;
    return !policy.remoteOnly;
  }
  return !policy.remoteOnly;
}

// availability.current_employment (identity.employmentStatus, lib/apply-spec.mjs):
// only the answers that status settles. Anything else stays with the resolver.
function employmentPlan(f, status, s) {
  if (!status) return null;
  const box = isStatementBox(f);
  if ((f.type === 'checkbox' || f.role === 'checkbox') && !box) return null;
  if (!box && !isYesNoAsk(f)) return null;
  if (CONTACT_EMPLOYER_RE.test(s)) {
    if (status !== 'employed-discreet') return null;
    return box ? boxPlan(false) : no();
  }
  if (EMPLOYED_ASK_RE.test(s)) {
    if (status === 'employed' || status === 'employed-discreet') return box ? boxPlan(true) : yes();
    if (status === 'between-jobs') return box ? boxPlan(false) : no();
  }
  return null;
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

  const employment = employmentPlan(f, identity.employmentStatus, s);
  if (employment) return employment;

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
    `- Work authorization: allowed to work without sponsorship in ${authorizedNames || 'the countries of the bases'}. Anywhere else needs sponsorship: "authorized / right to work there?" is No and "require sponsorship there?" is Yes.`,
    policy.remoteOnly
      ? `- Work mode: ${p.remote || 'full remote'}.${p.onsite ? ` ${p.onsite}.` : ''} On-site or hybrid outside ${[...policy.onsiteCountries].join(', ') || 'the remote setup'}: No.`
      : `- Work mode: ${p.remote || 'not stated: answer from the job and the candidate\'s bases'}.${p.onsite ? ` ${p.onsite}.` : ''}`,
    `- Bases: ${bases || identity.location || 'not stated'}. ${policy.relocationAnywhere ? 'Open to relocation.' : policy.relocationCountries?.size ? `Relocation is Yes only to these bases or ${[...policy.relocationCountries].join(', ')}.` : 'Relocation is Yes only to one of these bases.'}`,
    policy.travelOk ? '- Travel: occasional trips, offsites and team events are fine (Yes). Frequent travel (weekly, monthly, 30 %+): No.' : '- Travel: No.',
    `- This job is located: ${where}.`,
    EMPLOYMENT_LINES[identity.employmentStatus] || '',
  ].filter(Boolean).join('\n');
}

// One line per availability.current_employment status, for the model.
const EMPLOYMENT_LINES = {
  employed: '- Current situation: employed. "Are you currently employed?" is Yes.',
  'employed-discreet': '- Current situation: employed, searching discreetly. "Currently employed?" is Yes; "may we contact your current employer?" is No.',
  freelancing: '- Current situation: freelancing (self-employed), no employer to contact.',
  'between-jobs': '- Current situation: between jobs, available now. "Currently employed?" is No; notice period: none.',
  student: '- Current situation: student or about to graduate.',
};
