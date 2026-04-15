import 'dotenv/config';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { supabase, isEnabled } from './lib/supabase.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

if (!isEnabled) {
  console.error('❌  USE_SUPABASE=true requis dans .env');
  process.exit(1);
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseApplications(content) {
  const lines = content.split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 3) return [];
  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean);
  return lines.slice(2)
    .map(row => {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
      return obj;
    })
    .filter(row => Object.values(row).some(v => v))
    .map(row => ({
      num:    parseInt(row['#'] || row['num'], 10),
      date:   row['Date'] || row['date'],
      company: row['Company'] || row['company'],
      role:   row['Role'] || row['role'],
      score:  row['Score'] || row['score'],
      status: row['Status'] || row['status'],
      pdf:    row['PDF'] || row['pdf'],
      report: row['Report'] || row['report'],
      notes:  row['Notes'] || row['notes'],
    }))
    .filter(r => !isNaN(r.num));
}

function parsePipeline(content) {
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- [ ]'))   // only pending, skip processed
    .map(l => {
      // format: "- [ ] https://... | Company | Role"  or  "- [ ] https://... — note"
      const body = l.replace(/^- \[ \]\s*/, '');
      const urlMatch = body.match(/https?:\/\/[^\s|]+/);
      if (!urlMatch) return null;
      const url = urlMatch[0].trim();
      const rest = body.replace(url, '').replace(/^\s*\|\s*/, '').trim();
      return { url, note: rest || null, processed: false };
    })
    .filter(Boolean);
}

// ─── Migration ────────────────────────────────────────────────────────────────

async function migrateApplications() {
  console.log('\n📋  Applications...');
  const raw = await readFile(join(ROOT, 'data/applications.md'), 'utf-8');
  const rows = parseApplications(raw);
  if (!rows.length) { console.log('   aucune ligne trouvée'); return; }

  const { error } = await supabase
    .from('applications')
    .upsert(rows, { onConflict: 'num' });
  if (error) throw error;
  console.log(`   ✅  ${rows.length} application(s) insérée(s)`);
}

async function migratePipeline() {
  console.log('\n🔗  Pipeline (pending uniquement)...');
  const raw = await readFile(join(ROOT, 'data/pipeline.md'), 'utf-8');
  const rows = parsePipeline(raw);
  if (!rows.length) { console.log('   aucune URL pending'); return; }

  const { error } = await supabase
    .from('pipeline')
    .upsert(rows, { onConflict: 'url' });
  if (error) throw error;
  console.log(`   ✅  ${rows.length} URL(s) insérée(s)`);
}

async function migrateReports() {
  console.log('\n📄  Reports...');
  const files = (await readdir(join(ROOT, 'reports'))).filter(f => f.endsWith('.md'));
  if (!files.length) { console.log('   aucun report'); return; }

  const rows = await Promise.all(files.map(async filename => {
    const content = await readFile(join(ROOT, 'reports', filename), 'utf-8');
    const parts = filename.replace('.md', '').split('-');
    const num = parseInt(parts[0], 10);
    const date = parts.slice(-3).join('-');
    const company = parts.slice(1, -3).join('-');
    return { filename, content, num, company, date };
  }));

  const { error } = await supabase
    .from('reports')
    .upsert(rows, { onConflict: 'filename' });
  if (error) throw error;
  console.log(`   ✅  ${rows.length} report(s) inséré(s)`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

console.log('🚀  Migration → Supabase');

try {
  await migrateApplications();
  await migratePipeline();
  await migrateReports();
  console.log('\n✅  Migration terminée.\n');
} catch (err) {
  console.error('\n❌  Erreur :', err.message);
  process.exit(1);
}
