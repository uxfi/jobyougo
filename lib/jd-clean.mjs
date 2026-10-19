// Isolate the posting from a long scraped page (nav, cookie banner, footer,
// "similar jobs"). Only removes text; never rewrites or adds any.
const START_HEADING = /^(?:about (?:the )?(?:role|job|position|opportunity|this role|us)|job (?:description|summary|overview|details)|(?:the )?role|role (?:overview|description)|position (?:summary|overview)|overview|summary|description|responsibilities|what you(?:'|\u2019)ll do|what you will do|your (?:role|mission|impact)|the opportunity|who we are looking for|about the team|[\u00e0a] propos du (?:poste|r[\u00f4o]le)|description du poste|missions?|le poste|votre mission)\s*:?$/i;
const END_HEADING = /^(?:similar (?:jobs|roles|positions)|related (?:jobs|roles|positions)|other (?:open )?(?:jobs|roles|positions)|more jobs|you may also like|share (?:this|the) (?:job|role)|follow us|stay connected|join our talent|subscribe|footer|quick links|about us links|offres similaires|autres offres|partager (?:cette )?offre|suivez-nous)\s*:?$/i;
const BOILERPLATE_LINE = /^(?:skip to (?:main )?content|skip to main navigation|menu|home|careers?|jobs|search|search jobs|log ?in|sign ?in|sign ?up|register|apply(?: now)?|apply for this job|back to (?:all )?jobs|all jobs|view all jobs|share|share this job|copy link|print|english|fran\u00e7ais|deutsch|accept(?: all)?(?: cookies)?|reject(?: all)?|decline|cookie(?:s)? (?:settings|preferences|policy)|manage (?:cookies|preferences)|we use cookies.*|this (?:site|website) uses cookies.*|privacy(?: policy| notice)?|terms(?: of (?:use|service))?|terms & conditions|legal|sitemap|accessibility|contact(?: us)?|follow us|linkedin|twitter|x|facebook|instagram|youtube|tiktok|github|all rights reserved.*|\u00a9.*|copyright.*|powered by .*|cancel|close|refer|refer a friend|create (?:a )?job alert|job alerts?|find jobs?|\d+ (?:jobs|open positions)|open positions|loading\.*|please wait\.*)$/i;

function norm(line) { return line.replace(/\s+/g, ' ').trim(); }

export function cleanJobDescriptionText(text = '', { title = '', minLength = 6000, maxChars = 0 } = {}) {
  const raw = String(text || '');
  if (raw.length < minLength) return raw; // short pages are already the posting
  const lines = raw.split(/\r?\n/).map(norm);

  // 1. drop boilerplate lines and exact repeats of short lines (menus repeated for mobile/desktop).
  const seen = new Set();
  const kept = [];
  for (const line of lines) {
    if (!line) { if (kept.length && kept[kept.length - 1] !== '') kept.push(''); continue; }
    if (BOILERPLATE_LINE.test(line)) continue;
    if (line.length <= 60) {
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(line);
  }

  // 2. cut at the first footer / "similar jobs" heading found after real content.
  let end = kept.length;
  let words = 0;
  for (let i = 0; i < kept.length; i += 1) {
    if (END_HEADING.test(kept[i]) && words > 120) { end = i; break; }
    words += kept[i].split(' ').filter(Boolean).length;
  }
  let body = kept.slice(0, end);

  // 3. start at the first description heading, keeping the title line just above it when there is one.
  const startAt = body.findIndex(l => START_HEADING.test(l));
  if (startAt > 0) {
    const rest = body.slice(startAt).join('\n');
    if (rest.length >= 400) {
      const titleNorm = norm(title).toLowerCase();
      const titleIdx = titleNorm ? body.slice(0, startAt).map(l => l.toLowerCase()).lastIndexOf(titleNorm) : -1;
      const head = titleIdx >= 0 ? [body[titleIdx]] : [];
      body = [...head, ...body.slice(startAt)];
    }
  }

  let out = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (out.length < 300) return raw; // over-aggressive: keep the original
  if (maxChars > 0 && out.length > maxChars) out = out.slice(0, maxChars);
  return out;
}