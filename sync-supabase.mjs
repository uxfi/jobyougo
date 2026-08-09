/**
 * sync-supabase.mjs — Incremental Supabase sync (called by agent modes)
 *
 * Usage:
 *   node sync-supabase.mjs pipeline              → sync pending pipeline entries
 *   node sync-supabase.mjs report <filepath>     → sync a single report file
 *   node sync-supabase.mjs applications          → sync all rows from applications.md
 *
 * Silently exits if USE_SUPABASE != true — safe to call unconditionally.
 */

import 'dotenv/config';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { supabase, isEnabled } from './lib/supabase.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const [, , mode, arg] = process.argv;

if (!isEnabled) {
  // Silent no-op — Supabase not configured
  process.exit(0);
}

// ─── Resolve admin user_id (cached) ──────────────────────────────────────────

let _adminUserId = null;
async function getAdminUserId() {
  if (_adminUserId) return _adminUserId;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const { data } = await supabase.auth.admin.listUsers();
    const found = (data?.users || []).find(u => u.email === adminEmail);
    if (found) { _adminUserId = found.id; return _adminUserId; }
  }
  // Fallback: pick the first user that has rows in applications
  const { data } = await supabase.from('applications').select('user_id').not('user_id', 'is', null).limit(1).single();
  if (data?.user_id) { _adminUserId = data.user_id; return _adminUserId; }
  return null;
}

// ─── Pipeline sync ────────────────────────────────────────────────────────────

async function syncPipeline() {
  const filepath = join(ROOT, 'data/pipeline.md');
  if (!existsSync(filepath)) {
    console.log('⚠️  data/pipeline.md not found — skipping pipeline sync.');
    return;
  }

  const raw = await readFile(filepath, 'utf-8');
  const rows = raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- [ ]'))  // pending only
    .map(l => {
      const body = l.replace(/^- \[ \]\s*/, '');
      const urlMatch = body.match(/https?:\/\/[^\s|]+|local:[^\s|]+/);
      if (!urlMatch) return null;
      const url = urlMatch[0].trim();
      const rest = body.replace(urlMatch[0], '').replace(/^\s*\|\s*/, '').trim();
      return { url, note: rest || null, processed: false };
    })
    .filter(Boolean);

  if (!rows.length) {
    console.log('Pipeline: no pending entries to sync.');
    return;
  }

  const userId = await getAdminUserId();
  if (userId) rows.forEach(r => { r.user_id = userId; });

  const { error } = await supabase
    .from('pipeline')
    .upsert(rows, { onConflict: 'url,user_id' });

  if (error) throw error;
  console.log(`✅  Pipeline: ${rows.length} entry(ies) synced to Supabase.`);
}

// ─── Single report sync ───────────────────────────────────────────────────────

async function syncReport(filepath) {
  if (!filepath) {
    console.error('❌  Usage: node sync-supabase.mjs report <filepath>');
    process.exit(1);
  }

  const fullpath = filepath.startsWith('/') ? filepath : join(ROOT, filepath);
  if (!existsSync(fullpath)) {
    console.error(`❌  Report not found: ${fullpath}`);
    process.exit(1);
  }

  const content = await readFile(fullpath, 'utf-8');
  const filename = basename(fullpath);

  // Parse from filename: {num}-{company-slug}-{YYYY-MM-DD}.md
  const parts = filename.replace('.md', '').split('-');
  const num = parseInt(parts[0], 10);
  const date = parts.slice(-3).join('-');
  const company = parts.slice(1, -3).join('-');

  if (isNaN(num)) {
    console.error(`❌  Cannot parse report number from filename: ${filename}`);
    process.exit(1);
  }

  const userId = await getAdminUserId();
  const row = { filename, content, num, company, date };
  if (userId) row.user_id = userId;

  const { error } = await supabase
    .from('reports')
    .upsert(row, { onConflict: 'filename' });

  if (error) throw error;
  console.log(`✅  Report synced to Supabase: ${filename}`);
}

// ─── Applications sync ────────────────────────────────────────────────────────

function parseApplications(content) {
  const lines = content.split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 3) return [];
  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean);
  return lines.slice(2)
    .map(row => {
      const cells = row.split('|').map(c => c.trim());
      // Keep empty cells (Notes) — filter(Boolean) would shift columns.
      const values = cells.slice(1, -1);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
      return obj;
    })
    .filter(row => Object.values(row).some(v => v))
    .map(row => ({
      num:     parseInt(row['#'] || row['num'], 10),
      date:    row['Date']    || row['date'],
      company: row['Company'] || row['company'],
      role:    row['Role']    || row['role'],
      score:   row['Score']   || row['score'],
      status:  row['Status']  || row['status'],
      pdf:     row['PDF']     || row['pdf'],
      report:  row['Report']  || row['report'],
      notes:   row['Notes']   || row['notes'],
    }))
    .filter(r => !isNaN(r.num));
}

async function syncApplications() {
  const filepath = join(ROOT, 'data/applications.md');
  if (!existsSync(filepath)) {
    console.log('⚠️  data/applications.md not found — skipping applications sync.');
    return;
  }

  const raw = await readFile(filepath, 'utf-8');
  const rows = parseApplications(raw);

  if (!rows.length) {
    console.log('Applications: no rows to sync.');
    return;
  }

  const userId = await getAdminUserId();
  if (userId) rows.forEach(r => { r.user_id = userId; });

  const { error } = await supabase
    .from('applications')
    .upsert(rows, { onConflict: 'num' });

  if (error) throw error;
  console.log(`✅  Applications: ${rows.length} row(s) synced to Supabase.`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

try {
  if (mode === 'pipeline') {
    await syncPipeline();
  } else if (mode === 'report') {
    await syncReport(arg);
  } else if (mode === 'applications') {
    await syncApplications();
  } else {
    console.error('❌  Unknown mode. Use: pipeline | report <filepath> | applications');
    process.exit(1);
  }
} catch (err) {
  console.error('❌  Supabase sync error:', err.message);
  process.exit(1);
}
