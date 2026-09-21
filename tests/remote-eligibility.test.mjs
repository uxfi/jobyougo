// tests/remote-eligibility.test.mjs — the zero-token location/remote annotator (#1145).
//
// Same two properties as rank-pipeline.test.mjs, because this script shares its
// contract on purpose:
//
//   1. It annotates, never drops. Every write path appends to a row and leaves
//      the rest of the line byte-identical; no code path removes or reorders a
//      row, and a row already tagged is left alone (idempotent re-runs).
//   2. The classification is a three-way call — compatible / incompatible /
//      unclear — never collapsed to two. A posting with no remote signal at
//      all is `unclear`, not silently accepted or silently dropped: scanners
//      routinely capture only an office/hub city even for genuinely remote
//      roles (see AGENTS.md's own truncated-read warning), so treating an
//      absent signal as proof of anything would be the exact false-confidence
//      failure this file exists to catch.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nremote-eligibility — annotate-never-drop, three-way location classification');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'remote-eligibility.mjs')).href);
  const {
    parsePendingEntries,
    formatLocationSegment,
    appendLocationAnnotation,
    applyAnnotations,
  } = mod;
  const { classifyLocation, buildCompatibleAliases } = await import(
    pathToFileURL(join(ROOT, 'remote-eligibility-core.mjs')).href
  );

  const check = (label, cond) => (cond ? pass(label) : fail(label));

  // ── row parsing ──
  const fixture = [
    '## Pending',
    '- [ ] https://x.test/1 | Acme | Backend Engineer | Anywhere',
    '- [ ] https://x.test/2 | Beta | Android Engineer | Remote - US | posted: 2026-06-18',
    '- [x] https://x.test/3 | Gamma | Done Role | Remote',
    '- [ ] https://x.test/4 | Delta | Already Tagged | Remote | location: compatible — prior run',
    '- [ ] https://x.test/5 | Epsilon | No Location Role',
  ].join('\n');
  const pending = parsePendingEntries(fixture);
  check('skips [x]-checked rows', !pending.some((e) => e.url.endsWith('/3')));
  check('skips rows already carrying a location tag', !pending.some((e) => e.url.endsWith('/4')));
  check('finds the three untagged candidates', pending.length === 3);
  check('parses the location cell (4th column)', pending[0].location === 'Anywhere');
  check('a missing location cell parses as empty string, not undefined', pending[2].location === '');

  // ── segment formatting / sanitation ──
  check(
    'formats a compatible segment with its reason',
    formatLocationSegment('compatible', 'x').startsWith('location: compatible — x'),
  );
  check('a blank reason still yields a bare status segment', formatLocationSegment('unclear', '') === 'location: unclear');
  check('an unrecognized status yields no segment at all', formatLocationSegment('bogus', 'x') === '');
  check(
    'a pipe inside the reason cannot open a new column',
    !formatLocationSegment('incompatible', 'US only | remote').slice('location: incompatible — '.length).includes('|'),
  );
  check(
    'a newline inside the reason cannot forge a new row',
    !formatLocationSegment('unclear', 'x\n- [ ] https://evil.test | Evil | Role').includes('\n'),
  );
  check(
    'a very long reason is truncated rather than left to bloat the row',
    formatLocationSegment('compatible', 'z'.repeat(400)).length < 140 + 30,
  );

  // ── annotate-never-drop ──
  const line = pending[0].raw;
  const once = appendLocationAnnotation(line, 'compatible', 'worldwide remote');
  check('annotation appends after the original row', once.endsWith('| location: compatible — worldwide remote'));
  check('annotation preserves the original line byte-for-byte', once.startsWith(line));
  check('re-annotating an already-tagged row is a no-op', appendLocationAnnotation(once, 'incompatible', 'x') === once);

  // pipeline.md does not enforce line uniqueness: two byte-identical pending
  // rows are two entries classified separately. Keying by row text alone would
  // give both the same segment and drop one classification on the floor.
  const dupText = [
    '## Pending',
    '- [ ] https://x.test/9 | Acme | Backend Engineer | Remote',
    '- [ ] https://x.test/9 | Acme | Backend Engineer | Remote',
  ].join('\n');
  const dupRaw = '- [ ] https://x.test/9 | Acme | Backend Engineer | Remote';
  const dupOut = applyAnnotations(dupText, [
    { raw: dupRaw, segment: 'location: compatible — a' },
    { raw: dupRaw, segment: 'location: unclear — b' },
  ]);
  check('both duplicate rows get annotated', dupOut.written === 2);
  check(
    'each duplicate keeps its own classification, in file order',
    dupOut.text.includes('— a') && dupOut.text.includes('— b'),
  );
  check(
    'a row already carrying a location tag is skipped by applyAnnotations',
    applyAnnotations(`${dupRaw} | location: compatible — old`, [
      { raw: dupRaw, segment: 'location: incompatible — new' },
    ]).written === 0,
  );
  check(
    'a stale target (row no longer present) is a no-op, not a corruption',
    applyAnnotations('- [ ] https://other.test | X | Y | Remote', [
      { raw: dupRaw, segment: 'location: unclear — x' },
    ]).written === 0,
  );

  // ── buildCompatibleAliases ──
  const aliases = buildCompatibleAliases(['France', 'European Union', 'European Economic Area', 'Thailand']);
  check('an authorized country is in the compatible set', aliases.words.has('france'));
  check('an authorized broad bloc is in the compatible set', aliases.words.has('thailand'));
  check('EU/EEA authorization expands to the EMEA alias', aliases.words.has('emea'));
  check('EU/EEA authorization expands to every member state, not just the authorized one', aliases.words.has('germany'));
  check('EU/EEA authorization expands to UK for remote-eligibility purposes', aliases.words.has('united kingdom'));
  const noEuAliases = buildCompatibleAliases(['United States']);
  check('a non-EU/EEA authorization does NOT get the EMEA alias', !noEuAliases.words.has('emea'));
  check(
    'a Thailand-only authorization does NOT broaden to all of Asia/APAC',
    !buildCompatibleAliases(['Thailand']).words.has('asia'),
  );

  // ── classifyLocation: the exact postings this tool exists to get right ──
  const profile = { location: { authorized_in: ['France', 'European Union', 'European Economic Area', 'Thailand'] } };
  const status = (loc) => classifyLocation(loc, profile).status;

  check('"Anywhere" is compatible', status('Anywhere') === 'compatible');
  check('"Anywhere in the World" is compatible', status('Anywhere in the World') === 'compatible');
  check(
    'unspecified "Remote" defaults compatible (profile.yml\'s own timezone_context rule)',
    status('Remote') === 'compatible',
  );
  check('a named EU country + Remote is compatible', status('Berlin, Germany, Remote') === 'compatible');
  check('"Remote - EMEA" is compatible', status('Remote - EMEA') === 'compatible');
  check('a named authorized country + Remote is compatible', status('Paris, France, Remote') === 'compatible');
  check(
    'a multi-region posting is compatible via its one EU/EMEA option',
    status('UNITED STATES - Remote, EMEA - Remote, CANADA - Remote, LATAM - Remote') === 'compatible',
  );
  check('"Remote US or Remote EU" is compatible (the EU option)', status('Remote US or Remote EU') === 'compatible');

  check('"Remote - India" is incompatible (not in authorized_in)', status('Remote - India') === 'incompatible');
  check('an explicit US-hours requirement is incompatible', status('US-based, US Pacific hours') === 'incompatible');
  check('"Remote (LATAM)" is incompatible', status('Remote (LATAM)') === 'incompatible');
  check('a "(New York only)" qualifier is incompatible', status('Remote (New York only)') === 'incompatible');
  check(
    'a "(France only)" qualifier is compatible for a France-authorized candidate',
    status('Remote (France only)') === 'compatible',
  );
  check('hybrid with no remote option is incompatible', status('Berlin, Germany (Hybrid)') === 'incompatible');
  check('explicit on-site with no remote option is incompatible', status('On-site, London') === 'incompatible');

  check('a bare city with no remote/on-site signal is unclear, never a silent reject', status('Bangalore, India') === 'unclear');
  check('an empty location string is unclear', status('') === 'unclear');
  check('a whitespace-only location string is unclear', status('   ') === 'unclear');

  // Regression fixture: the exact set audited by hand against today's real
  // data/pipeline.md scan (2026-09-18) — pins the classifier to that finding
  // so a future change cannot silently regress back to the "0 matches" bug
  // this file exists to prevent.
  check('Circle "Anywhere" (confirmed pick)', status('Anywhere') === 'compatible');
  check('n8n\'s EU-country list (confirmed pick)', status('Germany · Bosnia · Norway · Estonia · Slovenia · Italy · Netherlands · Hungary · Portugal · France') === 'compatible');
  check('Consensys\' 4-region list (confirmed pick)', status('UNITED STATES - Remote, EMEA - Remote, CANADA - Remote, LATAM - Remote') === 'compatible');
  check('Coinbase "Remote - India" (confirmed reject)', status('Remote - India') === 'incompatible');
  check('DomainTools US-hours requirement (confirmed reject)', status('US-based, with a willingness to accommodate core hours that overlap at least 9am-3pm US Pacific time') === 'incompatible');
  check('podimo hybrid across 3 cities (confirmed reject)', status('Amsterdam, Berlin, Copenhagen (Hybrid)') === 'incompatible');
  check('a Singapore-only on-site posting (confirmed unclear/skip)', status('Singapore') === 'unclear');
} catch (err) {
  fail(`remote-eligibility test suite threw: ${err?.message ?? err}`);
}
