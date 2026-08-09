#!/usr/bin/env node
/**
 * purge-stale.mjs — Delete offers / applications / related artifacts older than N days.
 *
 * A job posting older than the retention window is treated as dead:
 *   - applications.md rows (and Supabase applications)
 *   - linked report files (and Supabase reports)
 *   - scan-history.tsv rows
 *   - pending pipeline.md lines whose URL appears in purged history
 *   - published-dates-cache.json entries
 *   - company+role appended to deleted-applications.tsv (blocks rediscovery)
 *
 * Usage:
 *   node purge-stale.mjs              # default 20 days
 *   node purge-stale.mjs --days=20
 *   node purge-stale.mjs --dry-run
 */

import 'dotenv/config';
import { readFile, writeFile, unlink, readdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { supabase, isEnabled as useSupabase } from './lib/supabase.mjs';
import { tsvSafe, loadPortals } from './lib/scan-filters.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry-run');
const daysArg = process.argv.find(a => a.startsWith('--days='));
let RETENTION_DAYS = 20;
try {
  const portals = loadPortals(join(ROOT, 'portals.yml'));
  if (Number.isFinite(portals.retention_days) && portals.retention_days > 0) {
    RETENTION_DAYS = portals.retention_days;
  }
} catch { /* keep default */ }
if (daysArg) RETENTION_DAYS = Math.max(1, parseInt(daysArg.split('=')[1], 10) || RETENTION_DAYS);

const today = new Date();
const cutoff = new Date(today.getTime() - RETENTION_DAYS * 864e5);
const cutoffIso = cutoff.toISOString().slice(0, 10);

const P = {
  apps: join(ROOT, 'data/applications.md'),
  pipeline: join(ROOT, 'data/pipeline.md'),
  history: join(ROOT, 'data/scan-history.tsv'),
  deleted: join(ROOT, 'data/deleted-applications.tsv'),
  dateCache: join(ROOT, 'data/published-dates-cache.json'),
  reports: join(ROOT, 'reports'),
};

const stats = {
  apps: 0,
  reports: 0,
  history: 0,
  pipeline: 0,
  cache: 0,
  deletedExclusions: 0,
};

function parseAppDate(value = '') {
  const m = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function extractReportFilename(reportCell = '') {
  const m = String(reportCell).match(/reports\/([^)\s]+\.md)/i);
  return m ? m[1] : '';
}

async function getAdminUserId() {
  if (!useSupabase || !supabase) return null;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const { data } = await supabase.auth.admin.listUsers().catch(() => ({ data: null }));
    const found = (data?.users || []).find(u => u.email === adminEmail);
    if (found) return found.id;
  }
  const { data } = await supabase
    .from('applications')
    .select('user_id')
    .not('user_id', 'is', null)
    .limit(1)
    .maybeSingle()
    .catch(() => ({ data: null }));
  return data?.user_id || null;
}

async function appendDeletedExclusions(entries) {
  if (!entries.length) return;
  let existing = '';
  if (existsSync(P.deleted)) {
    existing = await readFile(P.deleted, 'utf-8');
  } else {
    existing = 'company\trole\tdate_deleted\treason\n';
  }
  if (!existing.startsWith('company\t')) {
    existing = `company\trole\tdate_deleted\treason\n${existing}`;
  }
  const known = new Set(
    existing.split('\n').slice(1)
      .map(l => l.split('\t').slice(0, 2).join('\t').toLowerCase())
      .filter(Boolean)
  );
  const rows = [];
  for (const e of entries) {
    const company = tsvSafe(e.company);
    const role = tsvSafe(e.role);
    if (!company || !role) continue;
    const key = `${company}\t${role}`.toLowerCase();
    if (known.has(key)) continue;
    known.add(key);
    rows.push(`${company}\t${role}\t${cutoffIso}\tstale_purge_${RETENTION_DAYS}d`);
  }
  if (!rows.length) return;
  stats.deletedExclusions += rows.length;
  if (DRY) return;
  await writeFile(P.deleted, `${existing.replace(/\n+$/, '')}\n${rows.join('\n')}\n`, 'utf-8');
}

async function purgeApplications() {
  if (!existsSync(P.apps)) return { purgedUrls: [], reportFiles: [] };
  const raw = await readFile(P.apps, 'utf-8');
  const lines = raw.split('\n');
  const kept = [];
  const purged = [];
  const reportFiles = [];
  const exclusions = [];

  for (const line of lines) {
    if (!line.trim().startsWith('|') || line.includes('---') || /\|\s*#\s*\|/.test(line)) {
      kept.push(line);
      continue;
    }
    const cells = line.split('|').map(c => c.trim());
    // | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
    const date = parseAppDate(cells[2]);
    const company = cells[3] || '';
    const role = cells[4] || '';
    const reportCell = cells[8] || '';
    if (date && date < cutoffIso) {
      stats.apps += 1;
      purged.push({ company, role, report: reportCell, line });
      const reportFile = extractReportFilename(reportCell);
      if (reportFile) reportFiles.push(reportFile);
      if (company && role) exclusions.push({ company, role });
      continue;
    }
    kept.push(line);
  }

  if (stats.apps && !DRY) {
    await writeFile(P.apps, kept.join('\n'), 'utf-8');
  }

  await appendDeletedExclusions(exclusions);
  return { purged, reportFiles };
}

async function purgeReportFiles(extraFiles = []) {
  const toDelete = new Set(extraFiles.filter(Boolean));
  if (!existsSync(P.reports)) return toDelete;

  const files = await readdir(P.reports);
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const dateMatch = f.match(/(\d{4}-\d{2}-\d{2})\.md$/);
    if (dateMatch && dateMatch[1] < cutoffIso) toDelete.add(f);
  }

  for (const f of toDelete) {
    const path = join(P.reports, f);
    if (!existsSync(path)) continue;
    stats.reports += 1;
    if (!DRY) {
      try { await unlink(path); } catch { /* ignore */ }
    }
  }
  return toDelete;
}

async function purgeScanHistory() {
  if (!existsSync(P.history)) return new Set();
  const raw = await readFile(P.history, 'utf-8');
  const lines = raw.split('\n');
  const header = lines[0]?.startsWith('url\t') ? lines[0] : 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus';
  const kept = [header];
  const purgedUrls = new Set();

  for (const line of lines.slice(lines[0]?.startsWith('url\t') ? 1 : 0)) {
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const url = cells[0]?.trim();
    const firstSeen = parseAppDate(cells[1] || '');
    if (url && firstSeen && firstSeen < cutoffIso) {
      stats.history += 1;
      purgedUrls.add(url);
      continue;
    }
    if (url === 'url') continue;
    kept.push(line);
  }

  if (stats.history && !DRY) {
    await writeFile(P.history, `${kept.join('\n')}\n`, 'utf-8');
  }
  return purgedUrls;
}

async function purgePipeline(purgedUrls) {
  if (!existsSync(P.pipeline) || !purgedUrls.size) return;
  const raw = await readFile(P.pipeline, 'utf-8');
  const lines = raw.split('\n');
  const kept = [];
  for (const line of lines) {
    const urlMatch = line.match(/https?:\/\/[^\s|]+/);
    if (urlMatch && purgedUrls.has(urlMatch[0])) {
      stats.pipeline += 1;
      continue;
    }
    kept.push(line);
  }
  if (stats.pipeline && !DRY) {
    await writeFile(P.pipeline, kept.join('\n'), 'utf-8');
  }
}

async function purgePublishedDatesCache() {
  if (!existsSync(P.dateCache)) return;
  let cache;
  try {
    cache = JSON.parse(await readFile(P.dateCache, 'utf-8'));
  } catch {
    return;
  }
  if (!cache || typeof cache !== 'object') return;

  let removed = 0;
  for (const [url, entry] of Object.entries(cache)) {
    const fetchedAt = parseAppDate(entry?.fetchedAt || entry?.publishedAt || '');
    const publishedAt = parseAppDate(entry?.publishedAt || '');
    const staleFetch = fetchedAt && fetchedAt < cutoffIso;
    const stalePub = publishedAt && publishedAt < cutoffIso;
    if (staleFetch || stalePub) {
      delete cache[url];
      removed += 1;
    }
  }
  stats.cache = removed;
  if (removed && !DRY) {
    await writeFile(P.dateCache, JSON.stringify(cache, null, 2), 'utf-8');
  }
}

async function purgeSupabase(reportFiles, userId) {
  if (!useSupabase || !supabase) return;

  // Applications older than cutoff
  let appsQ = supabase.from('applications').select('num, date, company, role, report');
  if (userId) appsQ = appsQ.eq('user_id', userId);
  const { data: apps, error: appsErr } = await appsQ;
  if (appsErr) {
    console.warn(`⚠️  Supabase applications select failed: ${appsErr.message}`);
  } else {
    const staleNums = (apps || [])
      .filter(a => parseAppDate(a.date) && parseAppDate(a.date) < cutoffIso)
      .map(a => a.num);
    if (staleNums.length) {
      if (!DRY) {
        let delQ = supabase.from('applications').delete().in('num', staleNums);
        if (userId) delQ = delQ.eq('user_id', userId);
        const { error } = await delQ;
        if (error) console.warn(`⚠️  Supabase applications delete failed: ${error.message}`);
        else console.log(`☁️  Supabase applications deleted: ${staleNums.length}`);
      } else {
        console.log(`☁️  [dry-run] would delete ${staleNums.length} Supabase application(s)`);
      }
    }
  }

  // Reports by filename list + date in filename
  const filenames = [...reportFiles];
  if (filenames.length) {
    if (!DRY) {
      let delR = supabase.from('reports').delete().in('filename', filenames);
      if (userId) delR = delR.eq('user_id', userId);
      const { error } = await delR;
      if (error) console.warn(`⚠️  Supabase reports delete failed: ${error.message}`);
      else console.log(`☁️  Supabase reports deleted: ${filenames.length}`);
    }
  }

  // Also delete reports with date column older than cutoff
  try {
    let repQ = supabase.from('reports').select('filename, date');
    if (userId) repQ = repQ.eq('user_id', userId);
    const { data: reps, error: repErr } = await repQ;
    if (repErr) {
      console.warn(`⚠️  Supabase reports select failed: ${repErr.message}`);
    } else {
      const staleReps = (reps || [])
        .filter(r => parseAppDate(r.date) && parseAppDate(r.date) < cutoffIso)
        .map(r => r.filename)
        .filter(Boolean);
      if (staleReps.length && !DRY) {
        let delR = supabase.from('reports').delete().in('filename', staleReps);
        if (userId) delR = delR.eq('user_id', userId);
        await delR;
        console.log(`☁️  Supabase stale-date reports deleted: ${staleReps.length}`);
      } else if (staleReps.length) {
        console.log(`☁️  [dry-run] would delete ${staleReps.length} stale Supabase report(s)`);
      }
    }
  } catch (err) {
    console.warn(`⚠️  Supabase reports purge failed: ${err.message}`);
  }
}

async function syncApplicationsAfterPurge() {
  if (DRY || !useSupabase) return;
  const { execSync } = await import('child_process');
  try {
    execSync(`node "${join(ROOT, 'sync-supabase.mjs')}" applications`, {
      stdio: 'inherit',
      cwd: ROOT,
    });
  } catch (err) {
    console.warn(`⚠️  applications sync after purge failed: ${err.message}`);
  }
}

console.log(`Purge stale — retention ${RETENTION_DAYS}d (cutoff ${cutoffIso})${DRY ? ' [DRY-RUN]' : ''}`);
console.log('━'.repeat(60));

const userId = await getAdminUserId();
const { reportFiles } = await purgeApplications();
const deletedReports = await purgeReportFiles(reportFiles);
const purgedUrls = await purgeScanHistory();
await purgePipeline(purgedUrls);
await purgePublishedDatesCache();
await purgeSupabase(deletedReports, userId);
await syncApplicationsAfterPurge();

console.log('\n📊 Summary:');
console.log(`   applications removed : ${stats.apps}`);
console.log(`   reports deleted      : ${stats.reports}`);
console.log(`   scan-history rows    : ${stats.history}`);
console.log(`   pipeline lines       : ${stats.pipeline}`);
console.log(`   date-cache entries   : ${stats.cache}`);
console.log(`   deleted exclusions   : ${stats.deletedExclusions}`);
if (DRY) console.log('(dry-run — no changes written)');
