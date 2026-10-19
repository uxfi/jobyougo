// Per-source minimum interval between fetches of a job board feed, persisted
// across scans (e.g. Remotive asks for max ~4 API calls a day). A throttled
// source is reported as "skipped" (empty, not failed) in the scan funnel.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function sourceThrottleKey(entry = {}) {
  return [entry.provider || '', entry.category || '', entry.api || entry.careers_url || '', entry.name || ''].join('|');
}

export function minIntervalMinutes(entry = {}, provider = null) {
  const own = Number(entry.min_interval_minutes);
  if (Number.isFinite(own) && own >= 0) return own;
  const def = Number(provider?.minIntervalMinutes);
  return Number.isFinite(def) && def > 0 ? def : 0;
}

export function createSourceThrottle({ statePath = '', now = () => Date.now() } = {}) {
  let state = null;
  const load = () => {
    if (state) return state;
    try { state = statePath ? JSON.parse(readFileSync(statePath, 'utf8')) : {}; } catch { state = {}; }
    if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
    return state;
  };
  const save = () => {
    if (!statePath) return;
    try { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(state, null, 2)); } catch { /* best effort */ }
  };
  return {
    // -> { skip: false } or { skip: true, reason, nextAt }
    check(entry, provider) {
      const minutes = minIntervalMinutes(entry, provider);
      if (!minutes) return { skip: false };
      const last = Number(load()[sourceThrottleKey(entry)]) || 0;
      const nextAt = last + minutes * 60_000;
      if (last && now() < nextAt) {
        const waitMin = Math.ceil((nextAt - now()) / 60_000);
        return { skip: true, nextAt, reason: `fetched less than ${minutes} min ago (source rate limit), next in ~${waitMin} min` };
      }
      return { skip: false };
    },
    record(entry) {
      load()[sourceThrottleKey(entry)] = now();
      save();
    },
  };
}