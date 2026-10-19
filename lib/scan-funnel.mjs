// Per-stage candidate funnel for a scan: found -> decision (title/level/location/age)
// -> title-collapse -> dedup -> dated -> link-alive -> Jev. Shows where offers are lost.
export function createFunnel() {
  const stages = [];
  return {
    stage(name, count, detail = {}) {
      stages.push({ name, count: Number(count) || 0, ...(Object.keys(detail).length ? { detail } : {}) });
    },
    stages: () => stages.map(s => ({ ...s })),
    format() {
      return stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].count : null;
        const lost = prev != null && prev > s.count ? ` (-${prev - s.count})` : '';
        const detail = s.detail ? ` [${Object.entries(s.detail).map(([k, v]) => `${k}=${v}`).join(' ')}]` : '';
        return `${s.name}=${s.count}${lost}${detail}`;
      }).join(' -> ');
    },
  };
}

export function countBy(items = [], key = x => x) {
  const out = {};
  for (const item of items) { const k = key(item) || 'other'; out[k] = (out[k] || 0) + 1; }
  return out;
}
