/**
 * Shared field classification for apply-runner (Playwright window) and
 * apply-bridge (Chrome extension tab). Same rules, same plans — keep them
 * aligned: any change here affects both browser paths.
 */
import { polishApplicationAnswer } from './application-writing.mjs';
import {
  trivialFieldPlan,
  fileUploadPlan,
  isSecretCredentialField,
  travelOrRelocatePlan,
  employmentHistoryPlan,
  screeningChoicePlan,
  unknownThirdPartyPlan,
  isAvailabilityStartField,
  looksLikeDialCodeField,
  formDialCode,
  nationalPhoneNumber,
  isComboboxField,
  isListField,
  fieldLooksRequired,
  isApplicationGateConsent,
  isCandidateFullNameField,
} from './apply-fill-guards.mjs';
import { formSalaryValue } from './apply-salary.mjs';
import { optionsAreYesNo } from './apply-option-match.mjs';

// First matching pattern wins, not the first row in the DOM.
const HEAR_ABOUT_RANK = [
  /\blinkedin\b/i,
  /\b(indeed|glassdoor|welcome to the jungle|wttj|monster|stepstone)\b/i,
  /job board|job site|career site|company website|\bwebsite\b/i,
  /\b(google|web search|search engine)\b/i,
  /employee referral|\breferral\b|\breferred\b/i,
  /\b(other|autre)\b/i,
];

const STOPWORDS = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'for', 'and', 'or', 'you', 'your', 'is', 'are', 'do', 'does', 'this', 'that', 'with', 'us', 'we', 'at', 'on', 'what', 'why', 'how', 'about', 'tell', 'please', 'would', 'be', 'it', 'le', 'la', 'les', 'de', 'des', 'un', 'une', 'vous', 'pour', 'et']);

// Job-domain nouns that appear in nearly EVERY question on an application form
// and therefore carry no power to tell two questions apart. Without this, a
// single shared "role" was enough to score 0.5 and clear the 0.4 threshold:
// "What is your current role?" {current, role} matched "How did you hear about
// this role?" {did, hear, role} and the form was submitted with the
// how-did-you-hear answer in the current-role box. Dropping these leaves only
// the words that actually discriminate ("interested", "hear", "experience").
const GENERIC_TERMS = new Set(['role', 'roles', 'position', 'positions', 'job', 'jobs', 'company', 'companies', 'work', 'working', 'poste', 'entreprise', 'travail']);

export function tokens(s) {
  return new Set(String(s).toLowerCase().replace(/[^a-z0-9àâéèêëîïôùûüç\s]/gi, ' ').split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w) && !GENERIC_TERMS.has(w)));
}

export function similarity(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

export function bestAnswerFor(label, answers, usedAnswers = new Set()) {
  // Prefer an unused answer when scores are close, so two similar questions
  // ("why us?" / "why this role?") don't get the exact same text.
  const scored = answers
    .map(qa => ({ qa, s: similarity(label, qa.question) }))
    .filter(x => x.s >= 0.4)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  const fresh = scored.find(x => !usedAnswers.has(x.qa.question) && x.s >= scored[0].s - 0.2);
  if (fresh) return fresh.qa;
  // The best match was already consumed by an earlier (similar) question. Don't
  // reuse it verbatim — return null so this field goes to the LLM resolver,
  // which writes a distinct answer for its specific angle.
  if (usedAnswers.has(scored[0].qa.question)) return null;
  return scored[0].qa;
}

// "Website" / "Portfolio" / "URL" — not an essay that happens to contain
// "websites", and not a Yes/No about production code.
function isProfileUrlSlot(f) {
  if (!f) return false;
  if (f.type === 'radio' || f.type === 'checkbox' || f.type === 'file') return false;
  const label = String(f.label || '');
  if ((f.tag === 'textarea' || f.type === 'textarea') && label.length > 40) return false;
  if (/tell us|describe|share (two|2 or 3|two or three)|for each|what you designed|what code|few sentences|what would you change|hands-on|designed and (built|written)|behaved in the browser/i.test(label)) {
    return false;
  }
  return true;
}

function checkboxChoiceLabel(f) {
  const raw = String(f.label || '');
  const parts = raw.split(/\s+[—–]\s+|\s+-\s+/);
  return (parts.length > 1 ? parts[parts.length - 1] : raw)
    .replace(/[*✱]/g, ' ')
    .replace(/\brequired\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function questionStem(f) {
  const raw = String(f.label || '').split(/\s+[—–]\s+|\s+-\s+/)[0];
  return raw.replace(/[*✱]/g, ' ').replace(/\brequired\b/gi, '').replace(/\s+/g, ' ').trim();
}

// "Which of these have you worked in hands-on? — React"
// CV: Next.js / JavaScript written by him (Creads, Flemme, UXfi). Not HubSpot,
// WordPress, Webflow, or Framer.
function handsOnCheckboxPlan(f) {
  if (f.type !== 'checkbox') return null;
  if (!/hands-on/i.test(questionStem(f))) return null;
  const opt = checkboxChoiceLabel(f);
  if (/^react$/i.test(opt) || /next\.?js|astro|code-based framework/i.test(opt)) return { check: true };
  if (/hubspot|wordpress|webflow|framer|^other$/i.test(opt)) {
    return { skip: 'outil non utilisé', answeredBlank: true };
  }
  return null;
}

// SaaS / enterprise / MarTech / AI are in the CV. Consumer, cyber, and
// industrial are not a claimed industry.
function industryCheckboxPlan(f) {
  if (f.type !== 'checkbox') return null;
  if (!/^what industries\b/i.test(questionStem(f)) && !/\bindustries\b/i.test(questionStem(f))) return null;
  const opt = checkboxChoiceLabel(f);
  if (/b2b saas|enterprise saas|martech|\bai\b|genai/i.test(opt)) return { check: true };
  if (/consumer|cyber|industrial|manufactur|^other$/i.test(opt)) {
    return { skip: 'industrie hors profil', answeredBlank: true };
  }
  return null;
}

// Teamtailor "Locations" is the posting's hiring regions, not the city field.
// Candidate is in France (CET) and authorized in the EU. UK is not.
function hiringLocationCheckboxPlan(f, id) {
  if (f.type !== 'checkbox') return null;
  if (!/^locations?$/i.test(questionStem(f))) return null;
  const opt = checkboxChoiceLabel(f);
  const country = String(id.country || '').trim();
  if (country && new RegExp(`\\b${country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(opt)) {
    return { check: true };
  }
  if (/\b(netherlands|sweden|germany|belgium|france|spain|ireland|denmark|finland|austria|portugal|italy|luxembourg)\b/i.test(opt)) {
    return { check: true };
  }
  return { skip: 'localisation hors zone de travail', answeredBlank: true };
}

// Essays about sites he built must reach the model. A Section F paragraph
// about motivation is the wrong text, and the portfolio URL is not an answer.
function isOpenBuildQuestion(f) {
  const label = String(f.label || '');
  return /live websites you designed|websites you designed and built|design decision you changed|how it actually behaved|where does ai help/i.test(label);
}

export function classifyField(f, spec, usedAnswers = new Set()) {
  const s = `${f.label || ''} ${f.name || ''} ${f.idAttr || ''} ${f.autocomplete || ''}`.toLowerCase();
  const id = spec.identity || {};

  if (f.type === 'file') return fileUploadPlan(f, spec);
  // "Resume/CV" textarea (alternative to the file upload) → paste the CV text.
  if (f.tag === 'textarea' && /resume|curriculum|\bcv\b/.test(s) && !/cover|lettre|why|describe|experience/.test(s)) {
    return { resume: true };
  }
  // Sensitive EEO questions stay blank (usually optional / "prefer not to say").
  // Pronouns are handled separately: many ATS make them required. \bage\b is
  // word-boundary anchored so it doesn't false-positive on "message",
  // "manage", "package", "language" (seen in the wild: Ashby's optional
  // "Diversity Survey" section asks "What is your current age?").
  // A gender declared in profile.yml is an answer the candidate chose to give,
  // so use it instead of declining. Scoped to the gender question itself: the
  // LGBTQIA+ question also contains "transgender", and race/veteran/disability
  // stay blank regardless.
  const asksGender = /\bgender\b|\bsexe\b|\bgenre\b/.test(s)
    && !/lgbt|transgender community|identify as part of|race|ethnic/.test(s);
  if (asksGender && id.gender) return { value: id.gender, selectText: id.gender };
  if (/gender|race|ethnic|veteran|disab|diversity|origine|sexe|\bage\b|date of birth|birth\s*date/.test(s) && !/pronoun/.test(s)) {
    // declinePreferred: if this turns out to be required, prefer the
    // dropdown's own decline/non-disclosure option over skipping outright —
    // see fillDeclineDropdown / DECLINE_RE.
    return { skip: 'question démographique (laissée vide)', declinePreferred: true };
  }

  const travel = travelOrRelocatePlan(f);
  if (travel) return travel;

  const trivial = trivialFieldPlan(f, id);
  if (trivial) return trivial;

  const employment = employmentHistoryPlan(f, id.employment || {});
  if (employment) return employment;

  const screening = screeningChoicePlan(f, { company: spec.company, identity: id });
  if (screening) return screening;

  const thirdParty = unknownThirdPartyPlan(f);
  if (thirdParty) return thirdParty;

  if (f.type === 'checkbox') {
    // Application-gate consents ("By submitting… I agree… Privacy Policy")
    // are always required by the ATS even when HTML `required` is missing —
    // AssessFirst Live rejected submit with exactly that unchecked box.
    if (isApplicationGateConsent(f)) return { check: true };
    // Optional marketing consents are only ticked when the user opted in for
    // this run (spec.consentOptIn) — agreeing to data retention or future
    // contact on someone's behalf is never a silent default.
    const isConsent = /privacy|consent|gdpr|rgpd|terms|conditions|politique de confidentialité|j'accepte|i (agree|consent|acknowledge)/.test(s);
    if (isConsent && (f.required || fieldLooksRequired(f) || spec.consentOptIn)) return { check: true };
    const hands = handsOnCheckboxPlan(f);
    if (hands) return hands;
    const industry = industryCheckboxPlan(f);
    if (industry) return industry;
    const hiring = hiringLocationCheckboxPlan(f, id);
    if (hiring) return hiring;
    // A REQUIRED checkbox that isn't a consent is a factual claim to confirm
    // ("Have you ever designed a product that leverages AI?"). Skipping it left
    // a mandatory field blank on n8n's form; hand it to the resolver, which
    // reads the CV and answers yes/no.
    if (f.required || fieldLooksRequired(f)) return null;
    return { skip: 'checkbox non requise' };
  }

  const m = (re) => re.test(s);
  // visa/sponsorship BEFORE country/location: these questions usually contain
  // the word "country" ("…require sponsorship to work in the country…").
  // "authorized/eligible to work WITHOUT sponsorship?" is an eligibility yes →
  // must be caught before the generic sponsorship rule flips it to No.
  if (m(/without[^.?]{0,25}sponsor/)) {
    return { yesNo: id.needsSponsorship ? 'no' : 'yes', selectText: id.needsSponsorship ? 'No' : 'Yes', value: id.visaStatus };
  }
  // "require sponsorship / a visa transfer / a work permit / visa support" → No (he never does)
  if (m(/sponsor|visa support|visa transfer|transfer.*visa|need[^.?]{0,20}\bvisa\b|requir[a-z]*[^.?]*\b(visa|work permit|work authori[sz])/)) {
    return { yesNo: id.needsSponsorship ? 'yes' : 'no', selectText: id.needsSponsorship ? 'Yes' : 'No', value: id.visaStatus };
  }
  // Bitpanda-style: "possess an EU passport or a valid work permit …"
  if (m(/eu passport|european (union )?passport|passport or .{0,60}work permit|possess .{0,40}(eu )?passport|valid work permit that authori/)) {
    return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
  }
  // "are you legally eligible / authorized / have the right to work" → Yes
  if (m(/visa|work authori[sz]|right to work|legally (entitled|authori[sz]ed)|eligible to work|permis de travail|authori[sz]ed to work/)) {
    return { yesNo: id.needsSponsorship ? 'no' : 'yes', selectText: id.needsSponsorship ? 'No' : 'Yes', value: id.visaStatus };
  }
  if (m(/relatives?|family member/)) return { yesNo: 'no', value: 'No' };
  if (m(/pronoun/)) {
    const p = (id.pronouns || '').toLowerCase();
    return p ? { value: id.pronouns, selectText: p.split('/')[0] || id.pronouns } : { skip: 'pronoms (laissés vides)' };
  }
  if (m(/non-?compete|non-?competition|non-concurrence/)) return { yesNo: 'no', selectText: 'No' };
  // "select the status that allows you to work and live in that country" — work
  // eligibility status (distinct from the plain yes/no eligibility question).
  if (m(/status that allows you to (work|live)|allows you to (work|live) and (work|live)|immigration status|residency status/)) {
    const asia = spec.region === 'asia';
    return { value: asia ? 'Work VISA' : 'Citizen', selectText: asia ? 'Work VISA' : 'Citizen' };
  }
  // consent to interview recording / transcription (Brighthire etc.) → yes
  if (m(/consent.*(record|using this tool|transcri)|brighthire|record.*(interview|transcri)/)) {
    return { yesNo: 'yes', selectText: 'Yes' };
  }
  // Same opt-in as the checkbox rule above, for ATS that render their consents
  // as a yes/no group instead of a tickbox.
  if (spec.consentOptIn && m(/consent|do you agree|j'accepte|autoris|storing your|store your (information|data)|contact you about/)) {
    return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
  }
  // Demographic self-ID consent: we leave the EEO fields blank, so decline the
  // consent to process self-identification data (coherent + privacy-preserving).
  if (m(/self-?identification data|consent.*self-?identif/)) {
    return { value: "I don't wish to answer", selectText: "don't wish" };
  }
  // California "Notice at Collection" — Hugo is not a California resident.
  if (m(/california/)) return { value: 'I am not a California resident', selectText: 'not a California resident' };
  // single-option acknowledgement selects (privacy notice, data-protection notice)
  // Bitpanda (and similar) ask a Yes/No over a long "protect your data" blurb.
  if (m(/privacy notice|notice at collection|acknowledge|data (privacy|protection) notice|protect your (personal )?data|control over your personal data|job applicant privacy/)) {
    return {
      yesNo: 'yes',
      selectText: 'Yes',
      selectPrefer: /yes|i agree|i consent|accept|acknowledge/i,
      value: 'Yes',
    };
  }
  if (m(/preferred\s*name|nickname|display[\s_-]*name|nom pr[ée]f[ée]r|nom d.affichage/)) return { value: id.firstName };
  // Combined single-input name field ("First and last name"): must be caught
  // before the first/last rules below, which both match it — the last-name rule
  // won on n8n's form and the application went out signed "Vermot".
  if (m(/first[\s_-]*(name)?[\s_-]*(and|&|\/|\+|et)[\s_-]*last[\s_-]*name|last[\s_-]*(name)?[\s_-]*(and|&|\/|\+|et)[\s_-]*first[\s_-]*name|pr[ée]nom et nom|nom et pr[ée]nom|first[\s_-]*name[\s_-]*last[\s_-]*name|name[\s_-]*\(first[\s_-]*(and|&)[\s_-]*last\)/)) {
    return { value: id.fullName || `${id.firstName || ''} ${id.lastName || ''}`.trim() };
  }
  if (m(/middle[\s_-]*name|second[\s_-]*name|nom du milieu/)) {
    return { skip: 'middle name (laissé vide)', leaveBlank: true };
  }
  if (m(/first[\s_-]*name|pr[ée]nom|given[\s_-]*name/)) return { value: id.firstName };
  if (m(/last[\s_-]*name|family[\s_-]*name|surname|nom de famille/)) return { value: id.lastName };
  // Full / legal / bare "Name" / Ashby _systemfield_name — not company, file,
  // hiring-manager, emergency-contact, or open questions that only mention
  // "your name" ("attached to your name"). Shared with isCoreApplicationIdentity.
  if (isCandidateFullNameField(f)) {
    return { value: id.fullName || `${id.firstName || ''} ${id.lastName || ''}`.trim() };
  }
  // Marketing / newsletter emails are never the application identity email.
  if (m(/newsletter|marketing|opt.?in|may we email|email you about|email updates|keep me (posted|updated)|subscribe/)) {
    return { skip: 'email marketing (laissé vide)', leaveBlank: true };
  }
  if (m(/e-?mail|courriel|_systemfield_email/)) return { value: id.email };
  if (looksLikeDialCodeField(f)) {
    const code = id.dialCode || formDialCode(id.phone, id.country);
    return code
      ? {
          value: code,
          selectText: code,
          selectMatch: code,
          // Greenhouse options read "France +33" — code alone still scores via
          // optionMatchScore; country name is a second needle for typeahead.
          selectPrefer: id.country
            ? new RegExp(`${String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|\\b${String(id.country).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
            : null,
        }
      : { skip: 'indicatif téléphonique inconnu' };
  }
  if (m(/phone|t[ée]l[ée]phone|mobile|cell|_systemfield_phone/)) {
    const national = nationalPhoneNumber(id.phone, id.dialCode || formDialCode(id.phone, id.country));
    return { value: national || id.phone, optionalEmpty: !id.phone };
  }
  if (m(/linkedin/)) return { value: id.linkedin };
  if (m(/github/)) return { value: id.github };
  if (m(/link to (the |some )?code (you|i) wrote|code you wrote|share a link to code/)) {
    const gh = String(id.github || '').trim();
    if (!gh) return { skip: 'pas de lien de code dans le profil', leaveBlank: true };
    return { value: /^https?:\/\//i.test(gh) ? gh : `https://${gh.replace(/^\/+/, '')}` };
  }
  // Must come BEFORE the generic portfolio/website/URL catch-all below: its
  // bare \burl\b match would otherwise swallow "Twitter URL" too and hand it
  // the portfolio link instead (a real bug found in live testing).
  if (m(/twitter|\bx\.com\b/)) return { value: id.twitter, optionalEmpty: !id.twitter };
  // Credentials are never ours to type. Ashby's "Password to portfolio link (if
  // applicable)" sits right next to the portfolio field and matched the URL rule
  // below, so the live run pasted the portfolio URL into it as a password.
  if (isSecretCredentialField(f)) {
    return { skip: 'champ mot de passe (jamais rempli automatiquement)' };
  }
  // "Additional portfolio link (if applicable)" is a SECOND slot, not a repeat
  // of the first — filling both with the same URL is visible sloppiness. Offer
  // the other public profile if there is one, else leave it blank.
  if (isProfileUrlSlot(f) && m(/(additional|autre|second|other)\b/) && m(/portfolio|website|link|lien|\burl\b/)) {
    return id.github ? { value: id.github } : { skip: 'lien supplémentaire (laissé vide)' };
  }
  if (isProfileUrlSlot(f) && m(/portfolio|website|site (web|internet)|personal site|personal url|\burl\b|web site/)) {
    return { value: id.portfolio, optionalEmpty: !id.portfolio };
  }
  // Word-boundary anchored: a bare /location/ also matches "reLOCATION", so
  // "This role requires relocation to Bangkok — are you open to it?" was being
  // classified as a city field and answered with the candidate's address
  // instead of Yes/No (caught by live tracing: the runner typed "Bangkok,
  // Thailand" into a Yes/No dropdown). Same reasoning for \bcity\b, which
  // otherwise matches "capaCITY".
  if (m(/current location|where (are you|do you) (based|live)|based in|place of residence|lieu de r[ée]sidence|\blocation\b|\baddress\b|\badresse\b/)
      && !m(/relocat|travel|sponsor|visa|time[\s_-]*zone|fuseau/)) {
    // "Location" whose only choices are Yes | No is an eligibility question.
    // Sending "Paris, France" opens the list, matches nothing, and stays pending.
    if (optionsAreYesNo(f.options)) return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
    return { value: id.location, selectText: id.location, selectMatch: id.city || id.location };
  }
  if (m(/\bcity\b|\bville\b/) && !m(/capacity|relocat/)) {
    if (optionsAreYesNo(f.options)) return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
    return { value: id.city || id.location, selectText: id.city, selectMatch: id.city };
  }
  if (m(/country|pays/) && !m(/relocat|travel|work authori|visa|sponsor/)) {
    return { value: id.country, selectText: id.country, selectMatch: id.country };
  }
  if (m(/time[\s_-]*zone|fuseau/)) {
    // "Are you based in a European time zone, within two hours of CET?" is
    // Yes/No. Paris is CET. A timezone picker still gets the profile string.
    const yesNoTz = optionsAreYesNo(f.options)
      || /are you based|within two hours|within .{0,30}central european/.test(s);
    if (yesNoTz) {
      const cet = /cet|cest|paris|france/i.test(`${id.timezone || ''} ${id.city || ''} ${id.country || ''}`);
      return cet
        ? { yesNo: 'yes', selectText: 'Yes', value: 'Yes' }
        : { yesNo: 'no', selectText: 'No', value: 'No' };
    }
    return { value: id.timezone, selectText: id.timezone, selectMatch: id.timezone };
  }
  if (m(/salary|compensation|r[ée]mun[ée]ration|expected pay|pay expectation|pretension|daily rate|tjm|expected (comp|ctc)|ctc\b|pay range|salary range|salary expectations/)) {
    // Never type the profile prose ("EUR70K-110K …") or a Section F range:
    // numeric inputs concatenate min+max into garbage like "v76000119000".
    const value = formSalaryValue(
      { minimum: id.salaryMinimum, target_range: id.salary },
      f.label,
    );
    // Greenhouse band lists (€50,000 - €60,000): numeric value + optionMatchScore.
    return value
      ? { value, selectText: value, selectMatch: value }
      : { skip: 'salaire non numérique dans le profil' };
  }
  if (m(/notice[\s_-]*period|pr[ée]avis|how long is your notice/)) {
    const notice = String(id.noticePeriod || '1 week');
    // Revolut buckets: Immediate / 1 month / 2 months / 3 months+. A 1-week
    // profile has no exact bucket — Immediate availability is the closest.
    const short = /immediate|asap|disponib|none|no notice|^0\b|1\s*(week|semaine)|one\s+week|une\s+semaine|7\s*days?|7\s*jours?/i.test(notice);
    if (short) {
      return {
        value: notice,
        selectText: 'Immediate availability',
        selectPrefer: /immediate|asap|disponib|none|no notice|^0\b|less than\s*1\s*month|moins d.?un mois/i,
      };
    }
    // Prefer exact selectText match over a broad selectPrefer — a loose
    // /1|2|3 months/ prefer would always pick the first bucket.
    return { value: notice, selectText: notice };
  }
  if (isAvailabilityStartField(f)) {
    const choice = f.type === 'radio' || f.tag === 'select' || isComboboxField(f);
    const notice = String(id.noticePeriod || '');
    const short = /immediate|asap|none|no notice|^0\b|1\s*(week|semaine)|one\s+week|une\s+semaine|7\s*days?/i.test(notice);
    if (choice && short) {
      return {
        value: 'Within 2 weeks',
        selectText: 'Within 2 weeks',
        selectPrefer: /within\s*2\s*weeks|\b2\s*weeks\b|immediate/i,
      };
    }
    return { value: id.startDate, dateISO: id.startDateISO };
  }
  // Full-time engagement. Profile target is a full-time role.
  if (m(/how many days a week|days a week can you|days per week/)) {
    return {
      value: '5 days (full time)',
      selectText: '5 days (full time)',
      selectPrefer: /5\s*days/i,
    };
  }
  // Creads.io is a Next.js product he designed and shipped himself.
  if (m(/how much react|react have you shipped/)) {
    return {
      value: 'A production site or app I built mostly myself',
      selectText: 'A production site or app I built mostly myself',
      selectPrefer: /production site or app i built mostly myself/i,
    };
  }
  // Years of experience — Product Designer / AI builder profile.
  // Skip Yes/No gates ("Do you have 5+ years…?") so they fall through to the
  // factual-question null below / LLM instead of typing "8" into a radio.
  {
    const yoClean = (f.label || '').replace(/^[\s*••\-–—.)\d:]+/, '').trim();
    const yoYesNo = /^(do|did|does|have|has|are|were|will|would|can|is) (you|your)\b/i.test(yoClean);
    // "Both designed and built" is not the 12-year design career. The
    // design-and-code products start in 2022 (cv.md) → the 2-to-4 bracket.
    if (!yoYesNo && m(/both designed and built|designed and built websites/)) {
      return {
        value: '2 to 4 years',
        selectText: '2 to 4 years',
        selectPrefer: /2\s*to\s*4/i,
      };
    }
    if (!yoYesNo && m(/years? of (experience|exp)|ann[ée]es? d.exp[ée]rience|how many years|total (years|experience)/)) {
      return { value: '8', selectText: '8', years: 8, selectPrefer: /\b(8|9|10|\d{2})\+?\b|8\s*[-–]\s*10|5\s*\+/ };
    }
  }
  // Bare "source"/"referr" substrings used to false-positive on unrelated
  // fields (any label/name/id containing "resource", "preferred", etc.) —
  // require the fuller phrase instead.
  if (m(/how did you (hear|find)|where did you (hear|find)|referral source|how you (heard|found)|comment avez-vous (entendu|trouv[ée])/)) {
    return {
      value: id.howDidYouHear,
      selectText: 'LinkedIn',
      selectRank: HEAR_ABOUT_RANK,
      selectPrefer: /linkedin|indeed|glassdoor|welcome to the jungle|job board|job site|career site|company website|\bwebsite\b|\bgoogle\b|employee referral|\breferral\b|\breferred\b|\bother\b|\bautre\b/i,
    };
  }
  // "Available upon request" is a text answer. On a list ("Are you able to
  // provide professional references…?" Yes/No on N26) it matched no option and
  // was typed into the dropdown; the resolver picks from the real options.
  if (m(/reference/) && !m(/referr/) && !isListField(f)) return { value: id.references };

  // Factual yes/no questions ("Do you…", "Have you…") must never receive a
  // Section F motivation answer, even when token overlap is high (company
  // name + "work" match "why do you want to work at …"). Strip any leading
  // numbering / asterisk / bullet so "* Do you…" or "1. Have you…" still match.
  const cleanLabel = (f.label || '').replace(/^[\s*••\-–—.)\d:]+/, '').trim();
  if (/^(do|did|does|have|has|are|were|will|would|can|is) (you|your)\b/i.test(cleanLabel)) return null;

  // A Section F answer is a paragraph of prose, so it can never be a valid
  // value for a closed-option widget — a <select>, radio group, or react-select
  // combobox only accepts one of its OWN options. Live tracing caught a
  // three-sentence motivation answer being typed into a Yes/No dropdown
  // ("This role requires relocation to Bangkok…"), which matched nothing.
  // Send these to the LLM resolver instead: it gets the real scraped option
  // list and picks a genuine option.
  if (f.tag === 'select' || f.type === 'radio' || isComboboxField(f)) return null;

  if (isOpenBuildQuestion(f)) return null;

  // Free-text questions → Section F answers
  const qa = bestAnswerFor(f.label, spec.answers, usedAnswers);
  if (qa) return { value: polishApplicationAnswer(qa.answer), fromQuestion: qa.question };
  if (m(/cover letter|lettre de motivation|motivation|why (do you want|are you interested|us|join)/) && spec.answers.length) {
    const motiv = spec.answers.slice(0, 2).map(a => a.answer).join('\n\n');
    return { value: polishApplicationAnswer(motiv), fromQuestion: 'cover letter (combinaison des réponses F)' };
  }
  return null; // unknown → left for human
}

