// Countries and cities that application forms ask about, with the spellings
// their options use (French names, ISO codes). Pure data and lookups, shared
// by the screening policy (which country is this question about?) and option
// matching ("Paris, France" must find "Paris, Île-de-France, FRA").

const EU = new Set([
  'Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czechia', 'Denmark', 'Estonia', 'Finland',
  'France', 'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg',
  'Malta', 'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden',
]);
// EEA beyond the EU, plus Switzerland (EU/EFTA free movement: no sponsorship).
const EEA_EXTRA = new Set(['Iceland', 'Liechtenstein', 'Norway', 'Switzerland']);

// [canonical, ISO2, ISO3, other names…]. ISO codes only count as standalone
// upper-case tokens ("FRA", "FR") — in prose "it", "de", "es" are words.
const COUNTRY_ROWS = [
  ['Austria', 'AT', 'AUT', 'autriche', 'österreich', 'osterreich'],
  ['Belgium', 'BE', 'BEL', 'belgique', 'belgië', 'belgie'],
  ['Bulgaria', 'BG', 'BGR', 'bulgarie'],
  ['Croatia', 'HR', 'HRV', 'croatie', 'hrvatska'],
  ['Cyprus', 'CY', 'CYP', 'chypre'],
  ['Czechia', 'CZ', 'CZE', 'czech republic', 'tchéquie', 'republique tcheque', 'česko'],
  ['Denmark', 'DK', 'DNK', 'danemark', 'danmark'],
  ['Estonia', 'EE', 'EST', 'estonie', 'eesti'],
  ['Finland', 'FI', 'FIN', 'finlande', 'suomi'],
  ['France', 'FR', 'FRA', 'french republic', 'république française', 'republique francaise'],
  ['Germany', 'DE', 'DEU', 'allemagne', 'deutschland'],
  ['Greece', 'GR', 'GRC', 'grèce', 'grece', 'hellas'],
  ['Hungary', 'HU', 'HUN', 'hongrie', 'magyarország'],
  ['Ireland', 'IE', 'IRL', 'irlande', 'republic of ireland'],
  ['Italy', 'IT', 'ITA', 'italie', 'italia'],
  ['Latvia', 'LV', 'LVA', 'lettonie', 'latvija'],
  ['Lithuania', 'LT', 'LTU', 'lituanie', 'lietuva'],
  ['Luxembourg', 'LU', 'LUX'],
  ['Malta', 'MT', 'MLT', 'malte'],
  ['Netherlands', 'NL', 'NLD', 'the netherlands', 'pays-bas', 'pays bas', 'holland', 'nederland'],
  ['Poland', 'PL', 'POL', 'pologne', 'polska'],
  ['Portugal', 'PT', 'PRT'],
  ['Romania', 'RO', 'ROU', 'roumanie', 'românia'],
  ['Slovakia', 'SK', 'SVK', 'slovaquie', 'slovensko'],
  ['Slovenia', 'SI', 'SVN', 'slovénie', 'slovenie', 'slovenija'],
  ['Spain', 'ES', 'ESP', 'espagne', 'españa', 'espana'],
  ['Sweden', 'SE', 'SWE', 'suède', 'suede', 'sverige'],
  ['Iceland', 'IS', 'ISL', 'islande'],
  ['Liechtenstein', 'LI', 'LIE'],
  ['Norway', 'NO', 'NOR', 'norvège', 'norvege', 'norge'],
  ['Switzerland', 'CH', 'CHE', 'suisse', 'schweiz', 'svizzera'],
  ['United Kingdom', 'UK', 'GBR', 'great britain', 'britain', 'england', 'scotland', 'wales', 'royaume-uni', 'royaume uni', 'u.k.'],
  ['United States', 'US', 'USA', 'united states of america', 'u.s.', 'u.s.a.', 'états-unis', 'etats-unis'],
  ['Canada', 'CA', 'CAN'],
  ['Mexico', 'MX', 'MEX', 'mexique'],
  ['Brazil', 'BR', 'BRA', 'brésil', 'bresil', 'brasil'],
  ['Argentina', 'AR', 'ARG', 'argentine'],
  ['Colombia', 'CO', 'COL', 'colombie'],
  ['Chile', 'CL', 'CHL', 'chili'],
  ['Australia', 'AU', 'AUS', 'australie'],
  ['New Zealand', 'NZ', 'NZL', 'nouvelle-zélande'],
  ['Thailand', 'TH', 'THA', 'thaïlande', 'thailande'],
  ['Singapore', 'SG', 'SGP', 'singapour'],
  ['Malaysia', 'MY', 'MYS', 'malaisie'],
  ['Indonesia', 'ID', 'IDN', 'indonésie', 'indonesie'],
  ['Philippines', 'PH', 'PHL'],
  ['Vietnam', 'VN', 'VNM', 'viet nam', 'viêt nam'],
  ['Japan', 'JP', 'JPN', 'japon'],
  ['South Korea', 'KR', 'KOR', 'korea', 'corée du sud', 'coree du sud', 'republic of korea'],
  ['China', 'CN', 'CHN', 'chine'],
  ['Hong Kong', 'HK', 'HKG'],
  ['Taiwan', 'TW', 'TWN'],
  ['India', 'IN', 'IND', 'inde'],
  ['United Arab Emirates', 'AE', 'ARE', 'uae', 'emirates', 'émirats arabes unis'],
  ['Saudi Arabia', 'SA', 'SAU', 'arabie saoudite', 'ksa'],
  ['Qatar', 'QA', 'QAT'],
  ['Israel', 'IL', 'ISR', 'israël'],
  ['Turkey', 'TR', 'TUR', 'türkiye', 'turkiye', 'turquie'],
  ['Ukraine', 'UA', 'UKR'],
  ['Serbia', 'RS', 'SRB', 'serbie'],
  ['Georgia', 'GE', 'GEO', 'géorgie'],
  ['Armenia', 'AM', 'ARM', 'arménie'],
  ['Morocco', 'MA', 'MAR', 'maroc'],
  ['Tunisia', 'TN', 'TUN', 'tunisie'],
  ['Egypt', 'EG', 'EGY', 'égypte', 'egypte'],
  ['Nigeria', 'NG', 'NGA'],
  ['Kenya', 'KE', 'KEN'],
  ['South Africa', 'ZA', 'ZAF', 'afrique du sud'],
];

const CITY_ROWS = {
  France: ['paris', 'lyon', 'marseille', 'toulouse', 'bordeaux', 'nantes', 'lille', 'montpellier', 'strasbourg', 'rennes', 'grenoble', 'sophia antipolis'],
  Thailand: ['bangkok', 'phuket', 'chiang mai', 'pattaya'],
  'United Kingdom': ['london', 'manchester', 'edinburgh', 'bristol', 'cambridge', 'oxford', 'birmingham', 'glasgow', 'leeds'],
  Germany: ['berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'cologne', 'köln', 'stuttgart', 'düsseldorf', 'dusseldorf', 'leipzig', 'nuremberg', 'nürnberg'],
  Netherlands: ['amsterdam', 'rotterdam', 'utrecht', 'eindhoven', 'the hague'],
  Belgium: ['brussels', 'bruxelles', 'antwerp', 'ghent'],
  Spain: ['madrid', 'barcelona', 'valencia', 'seville', 'malaga', 'málaga'],
  Portugal: ['lisbon', 'lisboa', 'porto'],
  Italy: ['milan', 'milano', 'rome', 'roma', 'turin', 'torino', 'bologna'],
  Austria: ['vienna', 'wien', 'graz'],
  Switzerland: ['zurich', 'zürich', 'geneva', 'genève', 'geneve', 'lausanne', 'basel', 'bern'],
  Ireland: ['dublin'],
  Sweden: ['stockholm', 'gothenburg', 'malmö', 'malmo'],
  Denmark: ['copenhagen'],
  Norway: ['oslo'],
  Finland: ['helsinki'],
  Poland: ['warsaw', 'warszawa', 'krakow', 'kraków', 'wroclaw', 'wrocław', 'gdansk', 'gdańsk', 'poznan', 'poznań'],
  Czechia: ['prague', 'praha', 'brno'],
  Hungary: ['budapest'],
  Romania: ['bucharest', 'bucurești', 'cluj'],
  Bulgaria: ['sofia'],
  Greece: ['athens'],
  Croatia: ['zagreb'],
  Slovenia: ['ljubljana'],
  Slovakia: ['bratislava'],
  Estonia: ['tallinn'],
  Latvia: ['riga'],
  Lithuania: ['vilnius'],
  Luxembourg: ['luxembourg city'],
  Cyprus: ['nicosia', 'limassol'],
  Serbia: ['belgrade'],
  Turkey: ['istanbul', 'ankara'],
  Ukraine: ['kyiv', 'kiev'],
  Georgia: ['tbilisi'],
  Armenia: ['yerevan'],
  Israel: ['tel aviv'],
  'United Arab Emirates': ['dubai', 'abu dhabi'],
  Qatar: ['doha'],
  'Saudi Arabia': ['riyadh', 'jeddah'],
  Egypt: ['cairo'],
  Morocco: ['casablanca', 'rabat'],
  Tunisia: ['tunis'],
  Nigeria: ['lagos', 'abuja'],
  Kenya: ['nairobi'],
  'South Africa': ['cape town', 'johannesburg'],
  'United States': ['new york', 'san francisco', 'los angeles', 'seattle', 'boston', 'austin', 'chicago', 'miami', 'denver', 'washington dc', 'nyc'],
  Canada: ['toronto', 'vancouver', 'montreal', 'montréal'],
  Australia: ['sydney', 'melbourne'],
  Singapore: [],
  Japan: ['tokyo', 'osaka'],
  'South Korea': ['seoul'],
  'Hong Kong': [],
  Taiwan: ['taipei'],
  China: ['shanghai', 'beijing', 'shenzhen'],
  India: ['bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'pune'],
  Malaysia: ['kuala lumpur'],
  Indonesia: ['jakarta'],
  Philippines: ['manila'],
  Vietnam: ['ho chi minh', 'hanoi'],
  Brazil: ['são paulo', 'sao paulo'],
  Mexico: ['mexico city'],
};

export function foldPlace(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NAME_TO_COUNTRY = new Map();
const CODE_TO_COUNTRY = new Map();
const CITY_TO_COUNTRY = new Map();
for (const [name, iso2, iso3, ...others] of COUNTRY_ROWS) {
  NAME_TO_COUNTRY.set(foldPlace(name), name);
  for (const alias of others) NAME_TO_COUNTRY.set(foldPlace(alias), name);
  CODE_TO_COUNTRY.set(iso2, name);
  CODE_TO_COUNTRY.set(iso3, name);
}
for (const [country, cities] of Object.entries(CITY_ROWS)) {
  for (const city of cities) CITY_TO_COUNTRY.set(foldPlace(city), country);
}
// City-states and same-name places: the name is the country.
CITY_TO_COUNTRY.set('singapore', 'Singapore');
CITY_TO_COUNTRY.set('hong kong', 'Hong Kong');
CITY_TO_COUNTRY.set('luxembourg', 'Luxembourg');

// Longest names first, so "south africa" wins over "africa"-like fragments.
const NAME_PATTERNS = [...NAME_TO_COUNTRY.entries()]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([alias, country]) => ({ re: new RegExp(`(^|[^a-z])${escapeRe(alias)}([^a-z]|$)`), country }));
const CITY_PATTERNS = [...CITY_TO_COUNTRY.entries()]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([city, country]) => ({ re: new RegExp(`(^|[^a-z])${escapeRe(city)}([^a-z]|$)`), city, country }));

/** Canonical country for a country name, ISO code or known city ('' when unknown). */
export function countryOf(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  // An upper-case code on its own ("FRA", "TH") is a country; "it" is a word.
  if (/^[A-Z]{2,3}$/.test(text) && CODE_TO_COUNTRY.has(text)) return CODE_TO_COUNTRY.get(text);
  const folded = foldPlace(text);
  return NAME_TO_COUNTRY.get(folded) || CITY_TO_COUNTRY.get(folded) || '';
}

/**
 * Countries and cities named in a text. `codes: true` also reads standalone
 * upper-case ISO codes ("Paris, Île-de-France, FRA") — only for short option
 * texts, never for questions ("IT", "US" and "DE" are too ambiguous there…
 * except US/UK, which questions do use as country names).
 */
export function placesIn(text, { codes = false } = {}) {
  const raw = String(text || '');
  const folded = foldPlace(raw);
  const countries = [];
  const cities = [];
  // Countries the text names itself, before cities add theirs: "Paris, TX,
  // USA" names the United States, not France.
  const explicit = [];
  const addCountry = (c) => {
    if (!c) return;
    if (!countries.includes(c)) countries.push(c);
    if (!explicit.includes(c)) explicit.push(c);
  };
  let rest = folded;
  for (const { re, city, country } of CITY_PATTERNS) {
    if (!re.test(rest)) continue;
    cities.push({ city, country });
    rest = rest.replace(re, '$1 $2');
  }
  for (const { re, country } of NAME_PATTERNS) {
    if (re.test(rest)) addCountry(country);
  }
  // US / UK are written as upper-case codes in questions ("work in the US?").
  for (const m of raw.matchAll(/(^|[^A-Za-z.])(U\.?S\.?A?|U\.?K\.?)(?=[^A-Za-z]|$)/g)) {
    addCountry(/^U\.?K/.test(m[2]) ? 'United Kingdom' : 'United States');
  }
  if (codes) {
    for (const m of raw.matchAll(/(^|[^A-Za-z])([A-Z]{2,3})(?=[^A-Za-z]|$)/g)) addCountry(CODE_TO_COUNTRY.get(m[2]));
  }
  for (const { country } of cities) if (!countries.includes(country)) countries.push(country);
  return { countries, cities, explicit };
}

export function isEuCountry(country) {
  return EU.has(countryOf(country) || country);
}

/** EU, EEA, or Switzerland: an EU citizen works there without sponsorship. */
export function isEuFreeMovementCountry(country) {
  const c = countryOf(country) || country;
  return EU.has(c) || EEA_EXTRA.has(c);
}

/** Expand a profile "authorized in" list ("France", "European Union", "EEA"…) to countries. */
export function expandCountryList(list = []) {
  const out = new Set();
  for (const raw of list || []) {
    const s = foldPlace(raw);
    if (!s) continue;
    if (/\b(european union|\beu\b|union europeenne)\b/.test(s)) {
      for (const c of EU) out.add(c);
      continue;
    }
    if (/\b(european economic area|\beea\b|espace economique europeen|efta)\b/.test(s)) {
      for (const c of EU) out.add(c);
      for (const c of EEA_EXTRA) out.add(c);
      continue;
    }
    const c = countryOf(raw);
    if (c) out.add(c);
  }
  return out;
}

const EUROPE_EXTRA = ['United Kingdom', 'Serbia', 'Ukraine', 'Turkey'];
const MIDDLE_EAST_AFRICA = ['United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Israel', 'Egypt', 'Morocco', 'Tunisia', 'Nigeria', 'Kenya', 'South Africa'];
const APAC = ['Thailand', 'Singapore', 'Malaysia', 'Indonesia', 'Philippines', 'Vietnam', 'Japan', 'South Korea', 'China', 'Hong Kong', 'Taiwan', 'India', 'Australia', 'New Zealand'];
const AMERICAS = ['United States', 'Canada', 'Mexico', 'Brazil', 'Argentina', 'Colombia', 'Chile'];

/** Countries of the regions a text names ("EMEA", "Europe", "APAC"…); empty when none. */
// Only a region used as a place counts ("based in the EU", "within EMEA"):
// "an EU passport" or "EU citizen" says nothing about where someone lives.
export function regionCountriesIn(text) {
  const t = foldPlace(text)
    .replace(/\b(eu|european( union)?)\s+(passport|citizen\w*|national\w*|work permit|visa|law|regulation|data)\b/g, ' ');
  const out = new Set();
  const add = (list) => { for (const c of list) out.add(c); };
  const at = (names) => new RegExp(`\\b(in|within|across|from|throughout|inside|around|of)\\s+(the\\s+|a\\s+|an\\s+)?(${names})\\b`).test(t);
  if (at('eu|eea|european union|european economic area')) add(EU);
  if (at('europe|european')) { add(EU); add(EEA_EXTRA); add(EUROPE_EXTRA); }
  if (at('emea')) { add(EU); add(EEA_EXTRA); add(EUROPE_EXTRA); add(MIDDLE_EAST_AFRICA); }
  if (at('apac|asia|asia[- ]pacific|south[- ]?east asia')) add(APAC);
  if (at('north america|the americas|americas|latam|latin america')) add(AMERICAS);
  return out;
}

/**
 * Is the candidate in the place a question names ("Are you based in the San
 * Francisco Bay Area?", "…in EMEA?")? true / false, or null when the text
 * names no place at all.
 */
export function candidateIsIn(text, { city = '', country = '' } = {}) {
  const found = placesIn(text);
  const regions = regionCountriesIn(text);
  if (!found.cities.length && !found.explicit.length && !regions.size) return null;
  const home = countryOf(country) || String(country || '');
  const homeCity = foldPlace(city);
  if (homeCity && found.cities.some((c) => c.city === homeCity)) return true;
  if (home && (found.explicit.includes(home) || regions.has(home))) return true;
  return false;
}

/** Text names the EU / EEA / Europe as a whole ("legal right to work in the EU"). */
export function namesEuropeanUnion(text) {
  return /\b(EU|EEA|E\.U\.)\b|\beuropean (union|economic area)\b|\bunion europ[ée]enne\b/i.test(String(text || ''));
}
