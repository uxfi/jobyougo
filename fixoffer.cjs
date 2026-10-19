const fs=require('fs');
let f='lib/apply-policy.mjs';let t=fs.readFileSync(f,'utf8');
const a="// Location lines of the report (\"- **Localisation** : Hybrid · Berlin\") and of\n";
if(!t.includes(a))throw new Error('policy anchor');
const helper=`/**
 * The part of an evaluation report that describes the OFFER: the header and the
 * "A) Role summary" section. B) Match CV, C) Level, D) Comp and G) Legitimacy
 * discuss the candidate ("résident en Thaïlande", "aucune contrainte hors
 * Bangkok", "Localisation : Phuket (résident digital nomad)") and made European
 * jobs (Preply, Secfi, Factorial) read as Asian ones, so the form got Bangkok /
 * Thailand. A report without that structure is used whole, as before.
 */
export function offerPartOfReport(reportText = '') {
  const text = String(reportText || '');
  const sections = text.split(/^(?=## )/m);
  if (sections.length < 2 || !sections.some((part) => /^##\s+A\)/i.test(part))) return text;
  return sections.filter((part, i) => i === 0 || /^##\s+A\)/i.test(part)).join('');
}

`;
t=t.replace(a,helper+a);
const b="  return String(reportText || '')\n    .split('\n')\n    .filter((line) => /^\s*[-*]?\s*\**\s*(localisation|location|lieu|ville|pays|country|city|based in|work location|office)\b/i.test(line))";
if(!t.includes(b))throw new Error('locationLines body');
t=t.replace(b,"  return offerPartOfReport(reportText)\n    .split('\n')\n    .filter((line) => /^\s*[-*]?\s*\**\s*(localisation|location|lieu|ville|pays|country|city|based in|work location|office)\b/i.test(line))");
fs.writeFileSync(f,t);
f='lib/apply-spec.mjs';t=fs.readFileSync(f,'utf8');
const c="  return String(reportText || '')\n    .split('\n')\n    .filter(l => !/candidat|declared|profile\.yml|localisation actuelle|current location/i.test(l)";
if(!t.includes(c))throw new Error('offerLinesOf body');
t=t.replace(c,"  return offerPartOfReport(reportText)\n    .split('\n')\n    .filter(l => !/candidat|declared|profile\.yml|localisation actuelle|current location/i.test(l)");
fs.writeFileSync(f,t);
