/**
 * import-profile-offers.mjs — queue nine LinkedIn leads on Hugo Vermot's pipeline.
 *
 * Job offers that have not been evaluated or applied live in public.pipeline,
 * one row per posting, owned by profiles.id via user_id (see supabase/schema.sql
 * and addManyToPipeline in ui/server.mjs). The applications tracker is a
 * different table: it only accepts a canonical status from templates/states.yml
 * and a score, and these leads have neither.
 *
 * The note is the same "company | title | …" string formatPipelineNote writes
 * when the dashboard adds an offer. Work mode is stored as remote_verdict and
 * repeated in the visible location cell, because the pipeline table has no
 * location or work-mode columns.
 *
 * This does not submit applications and does not touch any other user's rows.
 * A row that is already processed (evaluated, removed from the queue) is left
 * as it is. An unprocessed row for the same URL only gets its note filled in.
 *
 * Usage:
 *   node import-profile-offers.mjs --dry-run
 *   node import-profile-offers.mjs --sql
 *   node import-profile-offers.mjs --self-test
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node import-profile-offers.mjs
 *   node import-profile-offers.mjs --user-id=<profiles.id>
 *
 * Without the service-role key, nothing is written. Paste
 * supabase/imports/20261029_hugo_linkedin_offers.sql into the Supabase SQL
 * editor instead (it is the same statement this script builds).
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isMainModule } from './lib/is-main-module.mjs';
import { extractPipelineNoteParts, formatPipelineNote } from './lib/pipeline-record.mjs';
import { normalizeUrl } from './url-key.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const SQL_PATH = join(ROOT, 'supabase', 'imports', '20261029_hugo_linkedin_offers.sql');

export const FOUND_AT = '2026-10-29T12:00:00.000Z';
export const HUGO_NAME = 'Hugo Vermot';

// Found 29 Oct 2026 on LinkedIn. None applied. The URL is the board posting
// when one was recorded; the LinkedIn view stays in the note and is used only
// to recognise a row already queued under that address.
export const OFFERS = [
  {
    title: 'Senior Product Designer',
    company: 'DuckDuckGo',
    location: 'Romania',
    workMode: 'Remote',
    url: 'https://jobs.ashbyhq.com/duck-duck-go/776bd1c8-81aa-4719-8238-ba357e1f5271',
    linkedin: 'https://www.linkedin.com/jobs/view/4481960699',
    status: 'to apply',
  },
  {
    title: 'Staff Product Designer',
    company: 'Snyk',
    location: 'Lisbon, Portugal',
    workMode: 'Remote',
    url: 'https://jobs.ashbyhq.com/Snyk/18909497-81c2-4a75-9b81-0c98d8cf7226/application',
    linkedin: 'https://www.linkedin.com/jobs/view/4474327088',
    status: 'to apply',
  },
  {
    title: 'Senior Product Designer, BNPL Merchant Experience',
    company: 'Tabby',
    location: 'Lisbon, Portugal',
    workMode: 'Remote',
    url: 'https://tabby.pinpointhq.com/en/postings/71c10dc9-c190-491a-8079-a23c3478e652',
    linkedin: 'https://www.linkedin.com/jobs/view/4483595568',
    status: 'to apply',
  },
  {
    title: 'Senior Product Designer (w/m/d)',
    company: 'HERO Software',
    location: 'Berlin, Germany',
    workMode: 'Hybrid',
    url: 'https://www.linkedin.com/jobs/view/4484023848',
    linkedin: '',
    status: 'Easy Apply, needs German',
  },
  {
    title: 'Senior Product Designer',
    company: 'Aircall',
    location: 'Madrid, Spain',
    workMode: 'Hybrid',
    url: 'https://www.linkedin.com/jobs/view/4444585662',
    linkedin: '',
    status: 'Easy Apply',
    workModeDetail: '3 days office',
  },
  {
    title: 'Senior Product Designer (AIR)',
    company: 'JetBrains',
    location: 'Berlin, Germany',
    workMode: 'Hybrid',
    url: 'https://job-boards.eu.greenhouse.io/jetbrains/jobs/4806218101',
    linkedin: 'https://www.linkedin.com/jobs/view/4389692982',
    status: 'to apply',
  },
  {
    title: 'Senior Product Designer DEX',
    company: 'TeamViewer',
    location: 'Porto, Portugal',
    workMode: 'Hybrid',
    url: 'https://careers.teamviewer.com/jobs/8453344-senior-product-designer-dex',
    linkedin: 'https://www.linkedin.com/jobs/view/4471888294',
    status: 'to apply',
  },
  {
    title: 'Product Designer – UX/UI',
    company: 'Sia',
    location: 'Paris, France',
    workMode: 'On-site',
    url: 'https://www.linkedin.com/jobs/view/4484484132',
    linkedin: '',
    status: 'Easy Apply',
  },
  {
    title: 'Senior Product Designer – Paris',
    company: 'Designshot',
    location: 'Paris, France',
    workMode: 'Hybrid',
    url: 'https://www.linkedin.com/jobs/view/4484490001',
    linkedin: '',
    status: 'Easy Apply',
  },
];

function urlKey(raw = '') {
  return normalizeUrl(raw) || '';
}

function offerKeys(offer) {
  return [offer.url, offer.linkedin].map(urlKey).filter(Boolean);
}

/** Visible tail plus the structured remote_verdict the pipeline note already carries. */
export function pipelineNote(offer) {
  const mode = offer.workModeDetail ? `${offer.workMode} (${offer.workModeDetail})` : offer.workMode;
  const bits = [offer.location, mode, offer.status];
  if (offer.linkedin && offer.linkedin !== offer.url) bits.push(`LinkedIn ${offer.linkedin}`);
  return formatPipelineNote({
    url: offer.url,
    company: offer.company,
    title: offer.title,
    location: bits.join(' · '),
    source: 'LinkedIn',
    remote_verdict: offer.workMode,
    remote_reason: offer.status,
  });
}

function sqlDollar(value, tag = 'offer') {
  const text = String(value ?? '');
  if (text.includes(`$${tag}$`)) throw new Error(`SQL dollar-quote tag $${tag}$ appears in a value`);
  return `$${tag}$${text}$${tag}$`;
}

/**
 * One statement for the Supabase SQL editor (postgres role, RLS bypassed).
 * Inserts only Hugo's missing rows. An already-processed row keeps its note.
 *
 * @returns {string}
 */
export function renderSql() {
  const values = OFFERS.map((offer) => `    (${sqlDollar(offer.url)}, ${sqlDollar(pipelineNote(offer))})`).join(',\n');
  return `-- Queue the 9 LinkedIn leads found on 2026-10-29 onto Hugo Vermot's pipeline.
--
-- public.pipeline is the per-account inbox (user_id -> profiles.id / auth.users.id).
-- public.applications is the evaluated tracker and is not written here: these
-- leads have no score and no canonical status.
--
-- Safe to re-run. Rows already processed for this user are left untouched.
-- Other accounts are not updated. Requires the unique (url, user_id)
-- constraint from supabase/schema.sql (pipeline_url_user_id_key).
--
-- Run in the Supabase SQL editor. If the name lookup raises, re-run
-- import-profile-offers.mjs --user-id=<profiles.id> with the service role key.

do $import$
declare
  hugo_id uuid;
  match_count integer;
begin
  select count(distinct p.id)
    into match_count
  from public.profiles p
  left join auth.users u on u.id = p.id
  where lower(btrim(coalesce(p.full_name, ''))) = 'hugo vermot'
     or lower(btrim(coalesce(u.raw_user_meta_data->>'full_name', ''))) = 'hugo vermot';

  if match_count <> 1 then
    raise exception 'Expected exactly 1 profile named Hugo Vermot, found %. Pass --user-id to import-profile-offers.mjs.', match_count;
  end if;

  select distinct p.id
    into hugo_id
  from public.profiles p
  left join auth.users u on u.id = p.id
  where lower(btrim(coalesce(p.full_name, ''))) = 'hugo vermot'
     or lower(btrim(coalesce(u.raw_user_meta_data->>'full_name', ''))) = 'hugo vermot';

  insert into public.pipeline (url, note, processed, user_id, created_at)
  select v.url, v.note, false, hugo_id, timestamptz '2026-10-29 12:00:00+00'
  from (values
${values}
  ) as v(url, note)
  on conflict (url, user_id) do update
    set note = excluded.note
    where pipeline.processed is not true
      and pipeline.note is distinct from excluded.note;
end
$import$;
`;
}

/**
 * Decide inserts and note updates for one account's existing pipeline rows.
 * Pure: no I/O. A processed row is never rewritten. A second URL is not
 * inserted when the same offer is already queued under its LinkedIn address.
 *
 * @param {{url: string, note?: string, processed?: boolean}[]} existingRows
 * @param {typeof OFFERS} [offers]
 */
export function planImport(existingRows, offers = OFFERS) {
  const byKey = new Map();
  for (const row of existingRows || []) {
    const key = urlKey(row?.url);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, row);
  }

  const insert = [];
  const update = [];
  const unchanged = [];
  const keptProcessed = [];

  for (const offer of offers) {
    const note = pipelineNote(offer);
    const seen = new Set();
    const matches = [];
    for (const key of offerKeys(offer)) {
      const row = byKey.get(key);
      if (!row || seen.has(row.url)) continue;
      seen.add(row.url);
      matches.push(row);
    }

    if (!matches.length) {
      insert.push({
        url: offer.url,
        note,
        processed: false,
        created_at: FOUND_AT,
        company: offer.company,
        title: offer.title,
      });
      continue;
    }

    for (const row of matches) {
      if (row.processed === true) {
        keptProcessed.push({ url: row.url, company: offer.company, title: offer.title });
        continue;
      }
      if (String(row.note || '') === note) {
        unchanged.push({ url: row.url, company: offer.company, title: offer.title });
        continue;
      }
      update.push({ url: row.url, note, company: offer.company, title: offer.title });
    }
  }

  return { insert, update, unchanged, keptProcessed };
}

function loadDotEnv() {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] != null) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function supabaseEnv() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

function nameIsHugo(value) {
  return String(value || '').trim().toLowerCase() === HUGO_NAME.toLowerCase();
}

async function loadPipeline(supabase, userId) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('pipeline')
      .select('url, note, processed')
      .eq('user_id', userId)
      .range(from, from + 999);
    if (error) throw new Error(`pipeline read failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function resolveHugo(supabase, explicitId) {
  if (explicitId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(explicitId)) {
      throw new Error('--user-id must be a profile uuid');
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('id', explicitId)
      .maybeSingle();
    if (error) throw new Error(`profiles lookup failed: ${error.message}`);
    if (!data) throw new Error(`No profiles row for ${explicitId}`);
    return data;
  }

  const { data: profiles, error } = await supabase.from('profiles').select('id, full_name, email');
  if (error) throw new Error(`profiles lookup failed: ${error.message}`);
  const named = (profiles || []).filter((row) => nameIsHugo(row.full_name));

  const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw new Error(`auth.admin.listUsers failed: ${listErr.message}`);
  const authNamed = (listed?.users || []).filter((user) => nameIsHugo(user.user_metadata?.full_name));

  const ids = new Set([...named.map((row) => row.id), ...authNamed.map((user) => user.id)]);
  if (ids.size === 0) {
    throw new Error('No profile named "Hugo Vermot". Re-run with --user-id=<profiles.id>.');
  }
  if (ids.size > 1) {
    throw new Error(`Several profiles match Hugo Vermot. Re-run with --user-id=. Matches: ${[...ids].join(', ')}`);
  }
  const id = [...ids][0];
  return named.find((row) => row.id === id)
    || { id, full_name: HUGO_NAME, email: authNamed.find((user) => user.id === id)?.email || '' };
}

async function applyImport(supabase, userId) {
  const existing = await loadPipeline(supabase, userId);
  const plan = planImport(existing);

  for (const row of plan.insert) {
    const { error } = await supabase.from('pipeline').insert({
      url: row.url,
      note: row.note,
      processed: false,
      user_id: userId,
      created_at: row.created_at,
    });
    if (error) throw new Error(`insert ${row.company} failed: ${error.message}`);
  }

  for (const row of plan.update) {
    const { error } = await supabase
      .from('pipeline')
      .update({ note: row.note })
      .eq('user_id', userId)
      .eq('url', row.url)
      .eq('processed', false);
    if (error) throw new Error(`note update ${row.company} failed: ${error.message}`);
  }

  return plan;
}

function selfTest() {
  const failures = [];
  const fail = (message) => failures.push(message);

  if (OFFERS.length !== 9) fail(`expected 9 offers, got ${OFFERS.length}`);
  const urls = new Set(OFFERS.map((offer) => offer.url));
  if (urls.size !== OFFERS.length) fail('primary URLs are not unique');

  for (const offer of OFFERS) {
    const parsed = extractPipelineNoteParts(pipelineNote(offer));
    if (parsed.company !== offer.company) fail(`${offer.company}: company parsed as ${parsed.company || '(empty)'}`);
    if (parsed.title !== offer.title) fail(`${offer.company}: title parsed as ${parsed.title || '(empty)'}`);
    if (parsed.source !== 'LinkedIn') fail(`${offer.company}: source parsed as ${parsed.source || '(empty)'}`);
    if (parsed.remote_verdict !== offer.workMode) fail(`${offer.company}: work mode parsed as ${parsed.remote_verdict || '(empty)'}`);
    if (parsed.remote_reason !== offer.status) fail(`${offer.company}: status parsed as ${parsed.remote_reason || '(empty)'}`);
    if (!parsed.note.includes(offer.location)) fail(`${offer.company}: visible note is missing the location`);
    if (!parsed.note.includes(offer.workMode)) fail(`${offer.company}: visible note is missing the work mode`);
    if (!parsed.note.includes(offer.status)) fail(`${offer.company}: visible note is missing the status`);
  }

  const fresh = planImport([]);
  if (fresh.insert.length !== 9 || fresh.update.length || fresh.keptProcessed.length) {
    fail(`empty inbox should insert 9 rows, got ${JSON.stringify({ insert: fresh.insert.length, update: fresh.update.length, kept: fresh.keptProcessed.length })}`);
  }

  const duck = OFFERS[0];
  const processed = planImport([{ url: duck.url, note: 'old', processed: true }]);
  if (processed.insert.some((row) => row.company === 'DuckDuckGo') || !processed.keptProcessed.some((row) => row.company === 'DuckDuckGo')) {
    fail('a processed DuckDuckGo row must be left in place');
  }

  const linkedinOnly = planImport([{ url: duck.linkedin, note: '', processed: false }]);
  if (linkedinOnly.insert.length !== 8) fail(`LinkedIn duplicate should suppress one insert, got ${linkedinOnly.insert.length}`);
  if (!linkedinOnly.update.some((row) => row.url === duck.linkedin)) fail('the existing LinkedIn row should receive the note');

  const same = planImport([{ url: duck.url, note: pipelineNote(duck), processed: false }]);
  if (!same.unchanged.some((row) => row.company === 'DuckDuckGo') || same.update.some((row) => row.company === 'DuckDuckGo')) {
    fail('an identical unprocessed note must not be rewritten');
  }

  let sql = '';
  try {
    sql = renderSql();
  } catch (err) {
    fail(`renderSql threw: ${err.message}`);
  }
  for (const offer of OFFERS) {
    if (!sql.includes(offer.url)) fail(`SQL is missing ${offer.url}`);
  }
  if (!sql.includes('on conflict (url, user_id)')) fail('SQL is missing the pipeline conflict target');
  if (!sql.includes('pipeline.processed is not true')) fail('SQL would overwrite a processed row');
  if (/insert\s+into\s+(public\.)?applications/i.test(sql)) fail('SQL must not write the applications tracker');
  if (!sql.includes("timestamptz '2026-10-29 12:00:00+00'")) fail('SQL is missing the found-on timestamp');

  let committed = '';
  try {
    committed = readFileSync(SQL_PATH, 'utf-8');
  } catch (err) {
    fail(`SQL file missing (${SQL_PATH}): ${err.message}`);
  }
  if (committed && committed !== sql) fail('supabase/imports/20261029_hugo_linkedin_offers.sql drifted from renderSql()');

  return failures;
}

function argValue(args, name) {
  const flag = args.find((arg) => arg.startsWith(`--${name}=`));
  return flag ? flag.slice(name.length + 3) : '';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node import-profile-offers.mjs [--dry-run] [--sql] [--user-id=<uuid>] [--self-test]');
    return;
  }
  if (args.includes('--self-test')) {
    const failures = selfTest();
    if (failures.length) {
      console.error(failures.join('\n'));
      process.exit(1);
    }
    console.log('import-profile-offers self-test passed');
    return;
  }
  if (args.includes('--sql')) {
    process.stdout.write(renderSql());
    return;
  }

  const dryRun = args.includes('--dry-run');
  loadDotEnv();
  const env = supabaseEnv();
  if (!env.url || !env.key) {
    const plan = planImport([]);
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. No rows were written.');
    console.error('Paste supabase/imports/20261029_hugo_linkedin_offers.sql into the Supabase SQL editor,');
    console.error('or re-run with those two variables set (service role, not the anon key).');
    console.log(JSON.stringify({ wrote: false, wouldInsert: plan.insert.length, companies: plan.insert.map((row) => row.company) }, null, 2));
    process.exit(2);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(env.url, env.key, { auth: { autoRefreshToken: false, persistSession: false } });
  const profile = await resolveHugo(supabase, argValue(args, 'user-id'));
  const existing = await loadPipeline(supabase, profile.id);
  const plan = planImport(existing);
  const report = {
    wrote: !dryRun,
    userId: profile.id,
    fullName: profile.full_name || '',
    insert: plan.insert.map((row) => ({ company: row.company, title: row.title, url: row.url })),
    update: plan.update.map((row) => ({ company: row.company, title: row.title, url: row.url })),
    unchanged: plan.unchanged.map((row) => ({ company: row.company, url: row.url })),
    keptProcessed: plan.keptProcessed.map((row) => ({ company: row.company, url: row.url })),
  };

  if (!dryRun) await applyImport(supabase, profile.id);
  console.log(JSON.stringify(report, null, 2));
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
