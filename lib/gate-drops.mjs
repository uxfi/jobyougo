// Pipeline offers dropped before Qwen: the profile gate (rules) or the Jev
// gate (full JD). Without this log they left the queue with no visible trace,
// while a Qwen reject gets a SKIP tracker row with its reason (n8n, 2026-10-16).
// One JSON line per drop in the account's scan folder (lib/scan-memory.mjs).

import { appendFile, readFile } from 'fs/promises';
import { ensureScanMemoryDir } from './scan-memory.mjs';

export const GATE_DROP_GATES = Object.freeze(['profile', 'jev']);
export const GATE_DROPS_DAYS = 30;
const LIMIT = 200;

function text(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function gateDropRecord({ url, title, company, gate, reasons = [], at } = {}) {
  const cleanUrl = text(url, 2000);
  if (!/^https?:\/\//i.test(cleanUrl)) return null;
  return {
    url: cleanUrl,
    title: text(title, 200),
    company: text(company, 120),
    gate: GATE_DROP_GATES.includes(gate) ? gate : 'profile',
    reasons: (Array.isArray(reasons) ? reasons : [reasons]).map(reason => text(reason)).filter(Boolean).slice(0, 5),
    at: at || new Date().toISOString(),
  };
}

export async function appendGateDrop(memory, drop) {
  const record = gateDropRecord(drop);
  if (!record || !memory?.gateDrops) return null;
  await ensureScanMemoryDir(memory);
  await appendFile(memory.gateDrops, `${JSON.stringify(record)}\n`, 'utf-8');
  return record;
}

/** Newest first, one row per URL (its latest drop), within `days`. */
export function parseGateDrops(raw = '', { days = GATE_DROPS_DAYS, now = Date.now(), limit = LIMIT } = {}) {
  const cutoff = now - days * 864e5;
  const byUrl = new Map();
  for (const line of String(raw || '').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const record = gateDropRecord(row);
    const time = Date.parse(record?.at || '');
    if (!record || !Number.isFinite(time) || time < cutoff) continue;
    const previous = byUrl.get(record.url);
    if (!previous || Date.parse(previous.at) <= time) byUrl.set(record.url, record);
  }
  return [...byUrl.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

export async function readGateDrops(memory, options) {
  if (!memory?.gateDrops) return [];
  const raw = await readFile(memory.gateDrops, 'utf-8').catch(() => '');
  return parseGateDrops(raw, options);
}
