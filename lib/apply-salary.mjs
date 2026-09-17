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

export function looksLikeSalaryField(label = '') {
  return /salary|compensation|r[ée]mun[ée]ration|expected pay|pay expectation|pretension|daily rate|tjm|expected (comp|ctc)|ctc\b|pay range|salary range/i.test(String(label || ''));
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

export function formSalaryValue(compensation = {}, fieldLabel = '') {
  if (looksLikeDailyRateField(fieldLabel)) {
    const n = dailyRateForForm(compensation);
    return n != null ? String(n) : '';
  }
  const n = annualSalaryForForm(compensation);
  return n != null ? String(n) : '';
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
