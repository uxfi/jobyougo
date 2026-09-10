// Re-read browser validity after filling: successful typing is not proof the
// ATS accepted an email, URL, pattern, date or required attachment.
export function fieldCompletionIssue(f) {
  // Explicit ATS rejection wins even when a radio/checkbox is selected.
  if (f.ariaInvalid) return f.validationMessage || 'valeur invalide — vérifier le champ';
  if (f.type === 'radio' || f.type === 'checkbox') {
    if (f.required && !f.groupChecked) return 'choix requis non renseigné';
    return f.invalid && !f.groupChecked ? (f.validationMessage || 'choix invalide') : null;
  }
  if (f.type === 'file' && f.required && !f.fileCount) return 'fichier requis manquant';
  if (f.invalid) return f.validationMessage || 'valeur invalide — vérifier le champ';
  if (f.required && f.type !== 'file' && !String(f.value || '').trim()) return 'requis et vide';
  return null;
}

export async function fieldMatchesAnswer(locator, expected) {
  try {
    let actual = await locator.inputValue({ timeout: 600 }).catch(() => null);
    if (actual === null) actual = await locator.evaluate(el => el.innerText ?? el.textContent ?? '');
    const normalize = value => String(value).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
    return normalize(actual) === normalize(expected);
  } catch { return false; }
}
