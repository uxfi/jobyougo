import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Scan log on disk: one file per day (scan-YYYY-MM-DD.log), the last `keepDays`
 * kept, each capped at `maxBytes`; plus a per-company summary
 * (scan-companies.jsonl: found / after filter / junk ignored), trimmed to the
 * last `maxSummaryLines`. Lives under data/ (gitignored).
 */
export function createScanLogger({ dir, keepDays = 7, maxBytes = 5 * 1024 * 1024, maxSummaryLines = 5000, now = () => new Date() } = {}) {
  let ready = false;
  const ensure = () => { if (!ready) { mkdirSync(dir, { recursive: true }); ready = true; } };
  const dayOf = () => now().toISOString().slice(0, 10);
  const pruneOld = () => {
    const keep = new Set();
    for (let i = 0; i < keepDays; i++) keep.add(new Date(now().getTime() - i * 86400000).toISOString().slice(0, 10));
    for (const name of readdirSync(dir)) {
      const m = name.match(/^scan-(\d{4}-\d{2}-\d{2})\.log$/);
      if (m && !keep.has(m[1])) rmSync(join(dir, name), { force: true });
    }
  };
  let lastPrune = '';
  return {
    line(level, text) {
      try {
        ensure();
        const day = dayOf();
        if (day !== lastPrune) { lastPrune = day; pruneOld(); }
        const file = join(dir, `scan-${day}.log`);
        let size = 0;
        try { size = statSync(file).size; } catch { /* new file */ }
        if (size > maxBytes) return false;
        appendFileSync(file, `${now().toISOString()} ${String(level).toUpperCase()} ${String(text).replace(/\s+$/, '')}\n`);
        return true;
      } catch { return false; }
    },
    summary(entry) {
      try {
        ensure();
        const file = join(dir, 'scan-companies.jsonl');
        appendFileSync(file, `${JSON.stringify({ ts: now().toISOString(), ...entry })}\n`);
        const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
        if (lines.length > maxSummaryLines) writeFileSync(file, `${lines.slice(-maxSummaryLines).join('\n')}\n`);
        return true;
      } catch { return false; }
    },
  };
}
