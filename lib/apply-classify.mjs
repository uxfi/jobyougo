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
  isComboboxField,
  fieldLooksRequired,
  isApplicationGateConsent,
} from './apply-fill-guards.mjs';
import { formSalaryValue } from './apply-salary.mjs';

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
  if (m(/privacy notice|notice at collection|acknowledge|data (privacy|protection) notice/)) {
    return { value: 'Acknowledge', selectText: 'Acknowledge' };
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
  // hiring-manager, emergency-contact, or other third-party name slots.
  if (m(/full[\s_-]*name|your[\s_-]*name|legal[\s_-]*name|_systemfield_name|what is your name|candidate[\s_-]*name|\bname\b|\bnom\b/)
      && !m(/company|file|user.?name|first|last|family|sur|given|middle|program|domain|brand|user[\s_-]*name|file[\s_-]*name|hiring|manager|recruiter|reference|emergency|contact[\s_-]*name|mother|father|spouse|partner|school|universit|employer/)) {
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
      ? { value: code, selectText: code, selectMatch: code }
      : { skip: 'indicatif téléphonique inconnu' };
  }
  if (m(/phone|t[ée]l[ée]phone|mobile|cell|_systemfield_phone/)) return { value: id.phone, optionalEmpty: !id.phone };
  if (m(/linkedin/)) return { value: id.linkedin };
  if (m(/github/)) return { value: id.github };
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
  if (m(/(additional|autre|second|other)\b/) && m(/portfolio|website|link|lien|\burl\b/)) {
    return id.github ? { value: id.github } : { skip: 'lien supplémentaire (laissé vide)' };
  }
  if (m(/portfolio|website|site (web|internet)|personal site|personal url|\burl\b|web site/)) {
    return { value: id.portfolio, optionalEmpty: !id.portfolio };
  }
  // Word-boundary anchored: a bare /location/ also matches "reLOCATION", so
  // "This role requires relocation to Bangkok — are you open to it?" was being
  // classified as a city field and answered with the candidate's address
  // instead of Yes/No (caught by live tracing: the runner typed "Bangkok,
  // Thailand" into a Yes/No dropdown). Same reasoning for \bcity\b, which
  // otherwise matches "capaCITY".
  if (m(/current location|where (are you|do you) (based|live)|based in|place of residence|lieu de r[ée]sidence|\blocation\b|\baddress\b|\badresse\b/)
      && !m(/relocat|travel|sponsor|visa/)) {
    return { value: id.location, selectText: id.location, selectMatch: id.city || id.location };
  }
  if (m(/\bcity\b|\bville\b/) && !m(/capacity|relocat/)) {
    return { value: id.city || id.location, selectText: id.city, selectMatch: id.city };
  }
  if (m(/country|pays/) && !m(/relocat|travel|work authori|visa|sponsor/)) {
    return { value: id.country, selectText: id.country, selectMatch: id.country };
  }
  if (m(/time[\s_-]*zone|fuseau/)) return { value: id.timezone, selectText: id.timezone, selectMatch: id.timezone };
  if (m(/salary|compensation|r[ée]mun[ée]ration|expected pay|pay expectation|pretension|daily rate|tjm|expected (comp|ctc)|ctc\b|pay range|salary range/)) {
    // Never type the profile prose ("EUR70K-110K …") or a Section F range:
    // numeric inputs concatenate min+max into garbage like "v76000119000".
    const value = formSalaryValue(
      { minimum: id.salaryMinimum, target_range: id.salary },
      f.label,
    );
    return value ? { value } : { skip: 'salaire non numérique dans le profil' };
  }
  if (m(/notice[\s_-]*period|pr[ée]avis/)) {
    return {
      value: id.noticePeriod || '1 week',
      selectText: id.noticePeriod || '1 week',
      selectPrefer: /1\s*(week|semaine)|one\s+week|une\s+semaine|7\s*days?|7\s*jours?/i,
    };
  }
  if (isAvailabilityStartField(f)) return { value: id.startDate, dateISO: id.startDateISO };
  // Years of experience — Product Designer / AI builder profile.
  // Skip Yes/No gates ("Do you have 5+ years…?") so they fall through to the
  // factual-question null below / LLM instead of typing "8" into a radio.
  {
    const yoClean = (f.label || '').replace(/^[\s*••\-–—.)\d:]+/, '').trim();
    const yoYesNo = /^(do|did|does|have|has|are|were|will|would|can|is) (you|your)\b/i.test(yoClean);
    if (!yoYesNo && m(/years? of (experience|exp)|ann[ée]es? d.exp[ée]rience|how many years|total (years|experience)/)) {
      return { value: '8', selectText: '8', selectPrefer: /\b(8|9|10|\d{2})\+?\b|8\s*[-–]\s*10|5\s*\+/ };
    }
  }
  // Bare "source"/"referr" substrings used to false-positive on unrelated
  // fields (any label/name/id containing "resource", "preferred", etc.) —
  // require the fuller phrase instead.
  if (m(/how did you (hear|find)|where did you (hear|find)|referral source|how you (heard|found)|comment avez-vous (entendu|trouv[ée])/)) {
    return { value: id.howDidYouHear, selectText: 'Other', selectPrefer: /other|job board|search|website|linkedin|autre/i };
  }
  if (m(/reference/) && !m(/referr/)) return { value: id.references };

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

  // Free-text questions → Section F answers
  const qa = bestAnswerFor(f.label, spec.answers, usedAnswers);
  if (qa) return { value: polishApplicationAnswer(qa.answer), fromQuestion: qa.question };
  if (m(/cover letter|lettre de motivation|motivation|why (do you want|are you interested|us|join)/) && spec.answers.length) {
    const motiv = spec.answers.slice(0, 2).map(a => a.answer).join('\n\n');
    return { value: polishApplicationAnswer(motiv), fromQuestion: 'cover letter (combinaison des réponses F)' };
  }
  return null; // unknown → left for human
}

