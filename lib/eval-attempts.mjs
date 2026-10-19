// Evaluations the report validation rejected, per URL. A rejected report keeps
// its URL in the pipeline for one more try; the Eyzee posting came back on every
// run, evaluated as the candidate's own employer each time (reports 957 and 963,
// 2026-10-19). After MAX_VALIDATION_RETRIES retries the URL is parked for review
// (scan-history `needs_review` + a 'review' gate drop the UI lists with Re-add).
// One JSON line per failure in the account's scan folder (lib/scan-memory.mjs).

import { appendFile, readFile } from 'fs/promises';
import { ensureScanMemoryDir } from './scan-memory.mjs';

export const MAX_VALIDATION_RETRIES = 1;
export const EVAL_FAILURE_DAYS = 30;

function urlKey(url) {
  return String(url || '').trim().replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
}

export function evalFailureRecord({ url, code = '', reason = '', at } = {}) {
  const cleanUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(cleanUrl)) return null;
  return {
    url: cleanUrl,
    code: String(code || 'invalid').slice(0, 60),
    reason: String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    at: at || new Date().toISOString(),
  };
}

/** Failures for this URL within `days`, oldest first. */
export function failuresFor(raw = '', url = '', { days = EVAL_FAILURE_DAYS, now = Date.now() } = {}) {
  const key = urlKey(url);
  const cutoff = now - days * 864e5;
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const time = Date.parse(row?.at || '');
    if (!row?.url || urlKey(row.url) !== key || !Number.isFinite(time) || time < cutoff) continue;
    out.push(row);
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * 'retry' keeps the URL queued, 'park' takes it out for review.
 * @param {number} failures failures for this URL, the current one included
 */
export function validationFailureAction(failures, maxRetries = MAX_VALIDATION_RETRIES) {
  return failures > maxRetries ? 'park' : 'retry';
}

/** Append this failure and return every failure for the URL (this one included). */
export async function recordEvalFailure(memory, failure) {
  const record = evalFailureRecord(failure);
  if (!record || !memory?.evalFailures) return [];
  await ensureScanMemoryDir(memory);
  const raw = await readFile(memory.evalFailures, 'utf-8').catch(() => '');
  await appendFile(memory.evalFailures, `${JSON.stringify(record)}\n`, 'utf-8');
  return [...failuresFor(raw, record.url), record];
}
