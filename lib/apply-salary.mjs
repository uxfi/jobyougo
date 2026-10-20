// Single numeric salary for application forms.
// Profile strings like "EUR70K-110K salary / EUR600-900/day freelance" must
// never be typed into a number/range input — they collapse to garbage
// ("v76000119000"). Forms get one annual figure from compensation.minimum.

function firstChunk(s) {
  return String(s || '').split('/')[0];
}

function afterSlash(s) {
  const parts = String(s || '').split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : '';
}

function kOrInteger(chunk) {
  const text = String(chunk || '');
  const k = text.match(/(\d+(?:[.,]\d+)?)\s*k\b/i);
  if (k) return Math.round(Number(k[1].replace(',', '.')) * 1000);
  const n = text.match(/(\d{1,3}(?:[.,\s]\d{3}){1,2}|\d{4,7})/);
  if (n) {
    const v = Number(n[1].replace(/[^\d]/g, ''));
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  return null;
}

function dailyInteger(chunk) {
  const text = String(chunk || '');
  const k = text.match(/(\d+(?:[.,]\d+)?)\s*k\b/i);
  if (k) return Math.round(Number(k[1].replace(',', '.')) * 1000);
  const n = text.match(/(\d{2,4})\b/);
  if (n) {
    const v = Number(n[1]);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  return null;
}

export function looksLikeDailyRateField(label = '') {
  return /daily rate|tjm|per day|day rate|taux journal|\/\s*day|\bday\b.*rate|\brate\b.*\bday\b/i.test(String(label || ''));
}

export function looksLikeMonthlySalaryField(label = '') {
  return /monthly|per month|\/\s*month|a month|each month|par mois|mensuel/i.test(String(label || ''));
}

export function currencyFromLabel(label = '') {
  const t = String(label || '');
  if (/\bthb\b|thai baht|\bbaht\b/i.test(t)) return 'THB';
  if (/\busd\b|\bus \$|u\.?s\.? dollars?/i.test(t)) return 'USD';
  if (/\bgbp\b|british pound|\bpounds?\b/i.test(t)) return 'GBP';
  if (/\bsgd\b|singapore dollar/i.test(t)) return 'SGD';
  const code = t.match(/\b(aud|cad|chf|pln|sek|dkk|nok|czk|huf|ron|inr|aed|hkd|jpy|cny|myr|idr|php|vnd|zar|brl|mxn|nzd|ils|try)\b/i);
  if (code) return code[1].toUpperCase();
  if (/\bzł|zloty/i.test(t)) return 'PLN';
  if (/\beur\b|euros?\b|€/.test(t)) return 'EUR';
  // Symbols last: "£" is sterling, a bare "$" is US dollars ("$120-130K").
  if (/£/.test(t)) return 'GBP';
  if (/¥/.test(t)) return 'JPY';
  if (/\$/.test(t)) return 'USD';
  return '';
}

// One salary vocabulary for classifyField and the keep/replace guards. The
// guards' shorter copy missed "Salaire souhaité" / "Gehaltsvorstellung", so a
// CV-parse "4000" in those boxes was kept as an answer.
export const SALARY_LABEL_RE = /salary|compensation|r[ée]mun[ée]ration|expected pay|pay expectation|pretension|pr[ée]tentions? salariales?|pretensi[oó]n salarial|expectativa salarial|retribuci[oó]n|gehaltsvorstellung|\bgehalt\b|salarisindicatie|\bsalaris\b|stipendio|\bsalaire\b|daily rate|tjm|expected (comp|ctc)|ctc\b|pay range|salary range|salary expectations/i;

export function looksLikeSalaryField(label = '') {
  return SALARY_LABEL_RE.test(String(label || ''));
}

export function annualSalaryForForm(compensation = {}) {
  const fromMin = kOrInteger(firstChunk(compensation.minimum));
  if (fromMin) return fromMin;
  return kOrInteger(firstChunk(compensation.target_range));
}

export function dailyRateForForm(compensation = {}) {
  const fromMin = dailyInteger(afterSlash(compensation.minimum));
  if (fromMin) return fromMin;
  return dailyInteger(afterSlash(compensation.target_range));
}

// Rate used when a form asks another currency than the profile's (Hugo
// 2026-10-20: "~1.1"). compensation.fx_rates overrides it ({ EUR_USD: 1.1 }).
export const DEFAULT_FX_RATES = Object.freeze({ EUR_USD: 1.1 });

export function convertCurrency(amount, from, to, fxRates = {}) {
  const n = Number(amount);
  const a = String(from || '').toUpperCase();
  const b = String(to || '').toUpperCase();
  if (!Number.isFinite(n) || !a || !b) return null;
  if (a === b) return n;
  const rates = { ...DEFAULT_FX_RATES, ...(fxRates || {}) };
  const direct = Number(rates[`${a}_${b}`]);
  if (direct > 0) return n * direct;
  const inverse = Number(rates[`${b}_${a}`]);
  if (inverse > 0) return n / inverse;
  return null;
}

// Converted figures are rounded up: to the thousand for a yearly amount, to
// the hundred for a monthly one ("~1.1, arrondi au millier supérieur").
function roundedUp(n, monthly) {
  const step = monthly ? 100 : 1000;
  return Math.ceil(n / step) * step;
}

export function formSalaryValue(compensation = {}, fieldLabel = '') {
  if (looksLikeDailyRateField(fieldLabel)) {
    const n = dailyRateForForm(compensation);
    return n != null ? String(n) : '';
  }
  const wanted = currencyFromLabel(fieldLabel);
  const have = String(compensation.currency || '').toUpperCase();
  const n = annualSalaryForForm(compensation);
  if (n == null) return '';
  const monthly = looksLikeMonthlySalaryField(fieldLabel);
  if (wanted && have && wanted !== have) {
    const converted = convertCurrency(n, have, wanted, compensation.fx_rates);
    if (converted == null) return '';
    return String(roundedUp(monthly ? converted / 12 : converted, monthly));
  }
  if (monthly) return String(Math.round(n / 12));
  return String(n);
}

/**
 * The current pay (compensation.current: { amount, currency, period }) in the
 * form's terms: per month or per year as the label asks (yearly by default),
 * converted when the label names another currency. '' when unknown.
 */
export function currentSalaryForForm(current, fieldLabel = '', fxRates = {}) {
  if (!current || typeof current !== 'object') return '';
  const amount = Number(String(current.amount ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return '';
  const have = String(current.currency || '').toUpperCase();
  const perMonth = /^(month|monthly|mois|mensuel)/i.test(String(current.period || 'year'));
  const monthly = looksLikeMonthlySalaryField(fieldLabel);
  let value = perMonth ? (monthly ? amount : amount * 12) : (monthly ? amount / 12 : amount);
  const wanted = currencyFromLabel(fieldLabel);
  if (wanted && have && wanted !== have) {
    const converted = convertCurrency(value, have, wanted, fxRates);
    if (converted == null) return '';
    return String(roundedUp(converted, monthly));
  }
  return String(Math.round(value));
}

export function numbersInText(s) {
  const out = [];
  const re = /(\d{1,3}(?:[.,\s]\d{3})+|\d{4,7})/g;
  let m;
  while ((m = re.exec(String(s || '')))) {
    const v = Number(m[1].replace(/[^\d]/g, ''));
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

export function salaryNumberMatchScore(want, optionText) {
  const optNums = numbersInText(optionText);
  if (!optNums.length) return 0;
  const wantNums = numbersInText(want);
  const compactWant = String(want || '').replace(/[^\d]/g, '');
  const wantN = /^\d{4,7}$/.test(compactWant) ? Number(compactWant) : null;

  if (wantN && optNums.includes(wantN)) return 85;
  // LLM / profile range ("USD 76,000–119,000") vs the same bucket in the list.
  if (wantNums.length >= 2 && optNums.length >= 2) {
    const wLo = Math.min(wantNums[0], wantNums[1]);
    const wHi = Math.max(wantNums[0], wantNums[1]);
    const oLo = Math.min(optNums[0], optNums[1]);
    const oHi = Math.max(optNums[0], optNums[1]);
    if (wLo === oLo && wHi === oHi) return 90;
  }
  const probe = wantN || (wantNums.length === 1 ? wantNums[0] : null);
  if (probe && optNums.length >= 2) {
    const lo = Math.min(optNums[0], optNums[1]);
    const hi = Math.max(optNums[0], optNums[1]);
    if (probe >= lo && probe <= hi) return 80;
  }
  return 0;
}
