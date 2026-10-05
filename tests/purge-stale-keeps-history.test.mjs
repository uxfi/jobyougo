// tests/purge-stale-keeps-history.test.mjs — the startup purge drops stale
// offers the user never acted on, and nothing else. Until 2026-10-02 it also
// deleted Applied rows and their reports after 20 days (OpenSea and EvenUp
// submissions included), and let a manual delete stop blocking its URL.
import { spawnSync } from 'child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, linkRepoPackage, rmSync, ROOT, NODE } from './helpers.mjs';

console.log('\npurge-stale — keeps the application history');

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'co-purge-')));
try {
  for (const file of ['purge-stale.mjs', 'title-keywords.mjs', 'url-key.mjs', 'path-resolver.mjs']) {
    copyFileSync(join(ROOT, file), join(sandbox, file));
  }
  cpSync(join(ROOT, 'lib'), join(sandbox, 'lib'), { recursive: true });
  for (const pkg of ['dotenv', 'js-yaml', '@supabase']) linkRepoPackage(sandbox, pkg);
  mkdirSync(join(sandbox, 'data'));
  mkdirSync(join(sandbox, 'reports'));
  writeFileSync(join(sandbox, 'portals.yml'), 'retention_days: 20\n');

  const today = new Date().toISOString().slice(0, 10);
  const old = '2026-01-05';
  const report = (num, slug) => `[${num}](reports/${String(num).padStart(3, '0')}-${slug}-${old}.md)`;
  writeFileSync(join(sandbox, 'data/applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    `| 1 | ${old} | OpenSea | Staff Product Designer | 4.3/5 | Applied | ✅ | ${report(1, 'opensea')} | |`,
    `| 2 | ${old} | Celonis | Lead AI Consultant | 2.1/5 | Evaluated | ❌ | ${report(2, 'celonis')} | |`,
    `| 3 | ${old} | EvenUp | Director of Product Design | 4.0/5 | Rejected | ✅ | ${report(3, 'evenup')} | |`,
    `| 4 | ${old} | Blip | Senior Product Manager | 2.0/5 | SKIP | ❌ | ${report(4, 'blip')} | |`,
    `| 5 | ${today} | Linear | Product Designer | 4.1/5 | Evaluated | ❌ | | |`,
    '',
  ].join('\n'));
  for (const name of ['001-opensea', '002-celonis', '003-evenup', '004-blip']) {
    writeFileSync(join(sandbox, 'reports', `${name}-${old}.md`), `# ${name}\n`);
  }
  writeFileSync(join(sandbox, 'data/scan-history.tsv'), [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
    `https://jobs.example.com/deleted\t${old}\tmanual-delete\tProduct Designer\tAcme\tdeleted`,
    `https://jobs.example.com/added\t${old}\tscan-ui\tProduct Designer\tAcme\tadded`,
    `https://jobs.example.com/fresh\t${today}\tscan-ui\tProduct Designer\tAcme\tadded`,
    '',
  ].join('\n'));

  const run = spawnSync(NODE, ['purge-stale.mjs', '--days=20'], {
    cwd: sandbox,
    env: { ...process.env, USE_SUPABASE: 'false' },
    encoding: 'utf-8',
    timeout: 60_000,
  });
  if (run.status !== 0) fail(`purge-stale exited ${run.status}: ${(run.stderr || run.stdout).slice(0, 400)}`);

  const apps = readFileSync(join(sandbox, 'data/applications.md'), 'utf-8');
  const has = (company) => apps.includes(`| ${company} |`);
  if (has('OpenSea') && has('EvenUp')) pass('Applied and Rejected rows survive the retention window');
  else fail(`acted-on rows were purged:\n${apps}`);
  if (!has('Celonis') && !has('Blip')) pass('stale Evaluated and SKIP rows are purged');
  else fail(`stale untouched rows were kept:\n${apps}`);
  if (has('Linear')) pass('a fresh Evaluated row is kept');
  else fail('the fresh row was purged');

  const report1 = existsSync(join(sandbox, 'reports', `001-opensea-${old}.md`));
  const report3 = existsSync(join(sandbox, 'reports', `003-evenup-${old}.md`));
  const report2 = existsSync(join(sandbox, 'reports', `002-celonis-${old}.md`));
  if (report1 && report3) pass('reports of kept rows are not deleted by their filename date');
  else fail(`a kept row lost its report (001=${report1}, 003=${report3})`);
  if (!report2) pass('the report of a purged row is deleted');
  else fail('the purged row kept its report');

  const history = readFileSync(join(sandbox, 'data/scan-history.tsv'), 'utf-8');
  if (history.includes('/deleted\t')) pass('an old manual delete keeps blocking its URL');
  else fail('the old "deleted" scan-history row was purged');
  if (!history.includes('/added\t') && history.includes('/fresh\t')) pass('other old scan-history rows still expire');
  else fail(`scan-history retention changed:\n${history}`);

  const deleted = readFileSync(join(sandbox, 'data/deleted-applications.tsv'), 'utf-8');
  if (deleted.includes('Celonis\tLead AI Consultant') && !deleted.includes('OpenSea')) {
    pass('purged rows still block rediscovery; kept rows are not listed as deleted');
  } else fail(`deleted-applications.tsv:\n${deleted}`);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
