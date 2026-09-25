// Order a scan roster before the Jev cap.
// Title match, explicit remote, allowed geography and a known date rank first.
// One source may fill at most half the cap until every other source is exhausted.

export function rosterSignals(candidate = {}, assessment = {}) {
  const reason = String(assessment.reason || '');
  let rank = 0;
  if (String(candidate.title || '').trim()) rank += 1;
  if (reason.includes('matched required remote term')) rank += 4;
  if (reason.includes('allowed geo')) rank += 2;
  const published = Date.parse(candidate.publishedAt || '');
  const freshness = Number.isFinite(published) ? published : 0;
  if (freshness) rank += 1;
  return { rank, freshness };
}

function sourceKey(candidate = {}) {
  return String(candidate.source || candidate.engine || 'unknown');
}

export function prioritizeScanRoster(candidates = [], { limit = 120, scoreOf } = {}) {
  const cap = Math.max(1, Number(limit) || 120);
  const half = Math.max(1, Math.floor(cap / 2));
  const score = typeof scoreOf === 'function'
    ? scoreOf
    : (candidate) => rosterSignals(candidate, {});
  const ranked = candidates.map((candidate, index) => ({
    candidate,
    index,
    score: score(candidate) || { rank: 0, freshness: 0 },
  }));
  ranked.sort((a, b) => {
    const rankDelta = (b.score.rank || 0) - (a.score.rank || 0);
    if (rankDelta) return rankDelta;
    const freshDelta = (b.score.freshness || 0) - (a.score.freshness || 0);
    if (freshDelta) return freshDelta;
    return a.index - b.index;
  });

  const counts = new Map();
  const picked = [];
  const deferred = [];
  for (const item of ranked) {
    const key = sourceKey(item.candidate);
    const used = counts.get(key) || 0;
    if (used >= half) {
      deferred.push(item);
      continue;
    }
    counts.set(key, used + 1);
    picked.push(item.candidate);
    if (picked.length >= cap) return picked;
  }
  for (const item of deferred) {
    picked.push(item.candidate);
    if (picked.length >= cap) break;
  }
  return picked;
}
