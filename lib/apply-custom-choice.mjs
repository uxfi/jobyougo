/**
 * Pick-list questions the candidate answered once in profile.yml
 * (screening.custom_answers with `match` + `prefer_options`): "How often do
 * you use AI coding tools?" → the row "Daily". Only a row that one of the
 * candidate's own preferred options names is picked; otherwise null and the
 * question goes on to the resolver / the human.
 */

const canon = (s) => String(s || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9+]+/g, ' ').trim();

const optionText = (o) => String(typeof o === 'string' ? o : o?.text || o?.label || '').trim();

function safeRegex(src) {
  try { return src ? new RegExp(src, 'i') : null; } catch { return null; }
}

/** The custom answer whose `match` reads this question, or null. */
export function customAnswerFor(label, customAnswers = []) {
  const text = String(label || '').replace(/\s+/g, ' ');
  for (const row of customAnswers || []) {
    const re = safeRegex(row?.match);
    if (re && re.test(text)) return row;
  }
  return null;
}

/**
 * options: [{text}|string]. Returns the chosen option text or null.
 * A preferred option matches a row whose text equals it, starts with it,
 * or (for a phrase of 2+ words) contains it.
 */
export function customChoiceFor(label, options, customAnswers = []) {
  const rows = (options || []).map(optionText).filter(Boolean);
  if (rows.length < 2) return null;
  for (const row of customAnswers || []) {
    const re = safeRegex(row?.match);
    if (!re || !re.test(String(label || '').replace(/\s+/g, ' '))) continue;
    for (const want of row.preferOptions || []) {
      const w = canon(want);
      if (!w) continue;
      const hit = rows.find((r) => canon(r) === w)
        || rows.find((r) => canon(r).startsWith(`${w} `) || canon(r).startsWith(w + ','))
        || (w.includes(' ') ? rows.find((r) => canon(r).includes(w)) : null);
      if (hit) return hit;
    }
  }
  return null;
}