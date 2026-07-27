/**
 * migrate-admin.mjs
 *
 * One-time migration:
 * 1. Crée le compte Supabase Auth pour Hugo (admin)
 * 2. Insère le profil depuis config/profile.yml
 * 3. Assigne toutes les lignes existantes (applications, pipeline, reports) à son user_id
 *
 * Usage:
 *   node migrate-admin.mjs [--email=you@example.com] [--password=YourPassword123]
 *   ou définir ADMIN_EMAIL et ADMIN_PASSWORD dans .env
 */

import 'dotenv/config';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const url  = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ── Args ──────────────────────────────────────────────────────────────────────

function getArg(name) {
  const flag = process.argv.find(a => a.startsWith(`--${name}=`));
  if (flag) return flag.split('=').slice(1).join('=');
  return process.env[name.toUpperCase().replace(/-/g, '_')] || '';
}

const adminEmail    = getArg('email')    || process.env.ADMIN_EMAIL;
const adminPassword = getArg('password') || process.env.ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  console.error('\nUsage: node migrate-admin.mjs --email=you@example.com --password=YourPassword123');
  console.error('   or: set ADMIN_EMAIL and ADMIN_PASSWORD in .env\n');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg) { console.log(`  ${msg}`); }
function ok(msg)  { console.log(`  ✓ ${msg}`); }
function err(msg) { console.error(`  ✗ ${msg}`); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  Career-Ops — Migration Admin\n');

  // 1. Lire profile.yml
  const profileYml = await readFile(join(__dirname, 'config/profile.yml'), 'utf-8');
  const profile = yamlLoad(profileYml);
  const candidate = profile?.candidate || {};

  log(`Email : ${adminEmail}`);
  log(`Nom   : ${candidate.full_name || '(not set)'}`);

  // 2. Créer ou récupérer le compte Auth
  let userId;

  // Vérifier si le user existe déjà
  const { data: listData, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) { err(`listUsers: ${listErr.message}`); process.exit(1); }

  const existing = (listData?.users || []).find(u => u.email === adminEmail);

  if (existing) {
    ok(`Compte Auth existant trouvé : ${existing.id}`);
    userId = existing.id;
  } else {
    log('Création du compte Auth...');
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: candidate.full_name || '' },
    });
    if (createErr) { err(`createUser: ${createErr.message}`); process.exit(1); }
    userId = created.user.id;
    ok(`Compte Auth créé : ${userId}`);
  }

  // 3. Upsert le profil dans la table profiles
  log('Lecture cv.md et modes/_profile.md...');
  const cvMarkdown     = await readFile(join(__dirname, 'cv.md'), 'utf-8').catch(() => '');
  const profileContext = await readFile(join(__dirname, 'modes/_profile.md'), 'utf-8').catch(() => '');
  if (cvMarkdown)     ok('cv.md trouvé — sera seedé dans cv_markdown');
  else                log('cv.md absent — cv_markdown sera vide');
  if (profileContext) ok('modes/_profile.md trouvé — sera seedé dans profile_context');

  log('Mise à jour de la table profiles...');
  const profileRow = {
    id:              userId,
    full_name:       candidate.full_name || '',
    email:           adminEmail,
    location:        candidate.location || '',
    linkedin:        candidate.linkedin || '',
    target_roles:    profile?.target_roles || null,
    narrative:       profile?.narrative || null,
    compensation:    profile?.compensation || null,
    search_prefs:    profile?.search || null,
    location_prefs:  profile?.location || null,
    cv_markdown:     cvMarkdown || null,
    profile_context: profileContext || null,
    is_admin:        true,
  };

  const { error: upsertErr } = await supabase.from('profiles').upsert(profileRow);
  if (upsertErr) { err(`upsert profiles: ${upsertErr.message}`); process.exit(1); }
  ok('Profil inséré/mis à jour (is_admin = true)');

  // 4. Assigner user_id sur les tables existantes (lignes sans user_id)
  log('Attribution du user_id sur applications...');
  const { error: appErr } = await supabase
    .from('applications')
    .update({ user_id: userId })
    .is('user_id', null);
  if (appErr) { err(`update applications: ${appErr.message}`); }
  else ok('applications → user_id assigné');

  log('Attribution du user_id sur pipeline...');
  const { error: pipeErr } = await supabase
    .from('pipeline')
    .update({ user_id: userId })
    .is('user_id', null);
  if (pipeErr) { err(`update pipeline: ${pipeErr.message}`); }
  else ok('pipeline → user_id assigné');

  log('Attribution du user_id sur reports...');
  const { error: repErr } = await supabase
    .from('reports')
    .update({ user_id: userId })
    .is('user_id', null);
  if (repErr) { err(`update reports: ${repErr.message}`); }
  else ok('reports → user_id assigné');

  console.log('\n  Migration terminée.\n');
  console.log(`  Connecte-toi sur http://localhost:3210/login`);
  console.log(`  Email    : ${adminEmail}`);
  console.log(`  Password : ${adminPassword}\n`);
}

main().catch(e => { err(e.message); process.exit(1); });
