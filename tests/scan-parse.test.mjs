import { pass, fail } from './helpers.mjs';
import {
  extractScanEntriesFromResponse,
  isScanSelectionComplete,
  scanResponseDeclaresNone,
  buildScanLlmPrefetch,
} from '../lib/scan-parse.mjs';

console.log('\nlib/scan-parse.mjs — scan LLM output parsing and compact prefetch');

{
  const text = [
    '120 exclus (remote US-only, hors critères).',
    '',
    '## URLs_À_AJOUTER',
    'AUCUNE',
  ].join('\n');
  if (isScanSelectionComplete(text) && scanResponseDeclaresNone(text) && extractScanEntriesFromResponse(text).length === 0) {
    pass('AUCUNE under URLs_À_AJOUTER is complete, declares none, extracts 0 URL');
  } else {
    fail('AUCUNE under URLs_À_AJOUTER should be a complete empty selection');
  }
}

{
  const text = 'J’ai regardé le roster. Rien ne passe.';
  if (!isScanSelectionComplete(text) && !scanResponseDeclaresNone(text) && extractScanEntriesFromResponse(text).length === 0) {
    pass('short prose without URLs_À_AJOUTER is incomplete (the 174-char failure mode)');
  } else {
    fail('short prose without the required section must be incomplete, not a silent 0-URL selection');
  }
}

{
  const text = [
    '2 retenues.',
    '',
    '## URLs_À_AJOUTER',
    'https://jobs.example.com/a | Acme | Staff Product Designer',
    'https://jobs.example.com/b | Beta | AI Product Manager',
  ].join('\n');
  const parsed = extractScanEntriesFromResponse(text);
  if (
    isScanSelectionComplete(text)
    && !scanResponseDeclaresNone(text)
    && parsed.length === 2
    && parsed[0].url === 'https://jobs.example.com/a'
    && parsed[1].note.includes('Beta')
  ) {
    pass('URL | Company | Role lines are extracted from URLs_À_AJOUTER');
  } else {
    fail(`expected 2 parsed URLs, got ${JSON.stringify(parsed)}`);
  }
}

{
  const text = 'Keep this one: https://jobs.example.com/c | Gamma | Design Lead';
  const parsed = extractScanEntriesFromResponse(text);
  if (isScanSelectionComplete(text) && parsed.length === 1 && parsed[0].url === 'https://jobs.example.com/c') {
    pass('bare URL lines still extract when the header is missing');
  } else {
    fail(`fallback URL extraction failed: ${JSON.stringify(parsed)}`);
  }
}

{
  const dates = new Map([['https://jobs.example.com/d', '2026-09-17']]);
  const text = [
    '## URLs_À_AJOUTER',
    'https://jobs.example.com/d | Delta | Product Designer',
  ].join('\n');
  const parsed = extractScanEntriesFromResponse(text, dates);
  if (parsed[0]?.note.endsWith('2026-09-17')) {
    pass('published_at is appended when the model omitted the date');
  } else {
    fail(`published_at not appended: ${JSON.stringify(parsed)}`);
  }
}

{
  const prefetch = buildScanLlmPrefetch({
    recapLines: ['WebSearch: 8/104 OK, 96 failed', 'Pre-dedup: 8 already-known URL(s) removed'],
    rosterText: '## Candidate Roster\nTotal prefetched candidates after title + remote filter: 1\n- https://jobs.example.com/e | Staff Designer',
  });
  if (
    prefetch.includes('## Fetch recap')
    && prefetch.includes('## Candidate Roster')
    && prefetch.includes('https://jobs.example.com/e')
    && !prefetch.includes('### Greenhouse')
  ) {
    pass('LLM prefetch is roster + recap, not raw source dumps');
  } else {
    fail('compact prefetch did not keep roster/recap without raw dumps');
  }
}

{
  const empty = buildScanLlmPrefetch({ recapLines: [], rosterText: '' });
  if (empty.includes('Total prefetched candidates after title + remote filter: 0')) {
    pass('empty roster still emits an explicit zero Candidate Roster');
  } else {
    fail(`empty prefetch missing zero roster: ${empty}`);
  }
}
