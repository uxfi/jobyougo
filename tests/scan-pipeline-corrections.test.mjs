import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainTitle, assessRemote } from '../lib/scan-decision.mjs';
import { geoRejectCanWiden } from '../lib/remote-geo-widen.mjs';
import {
  parsePipeline,
  extractPipelineNoteParts,
  formatPipelineMarkdown,
  pipelineRecordFromEntry,
} from '../lib/pipeline-record.mjs';

const titleFilter = {
  positive: ['AI', 'Product Manager'],
  negative: ['ai trainer', 'annotation specialist', 'sales rep', 'operations coordinator', 'annotator'],
  positive_patterns: [
    String.raw`\b(ai|artificial intelligence|genai|generative ai|llm|agentic|agent\s+builder|automation)\b`,
    String.raw`\b(product\s+(manager|designer|lead|director|owner|strategist|growth|engineer)|head\s+of\s+product|vp\s+product)\b`,
    String.raw`\b(chef de produit|responsable produit|directeur(?:rice)? de produit)\b`,
  ],
  negative_patterns: [
    String.raw`\b(engineering|sales|account|customer|community|office|people|finance|legal|recruit|talent|marketing|operations|support|success)\s+manager\b`,
    String.raw`\b(program|project|delivery|partner|channel|vendor|incident|release|site reliability)\s+manager\b`,
  ],
};

test('AI program manager stays, delivery manager and low-relevance AI titles do not', () => {
  assert.equal(explainTitle('AI Program Manager', titleFilter).ok, true);
  assert.equal(explainTitle('Technical Program Manager - AI', titleFilter).ok, true);
  assert.equal(explainTitle('Agent Builder - Product', titleFilter).ok, true);
  assert.equal(explainTitle('Product Manager - AI Agents', titleFilter).ok, true);
  assert.equal(explainTitle('Chef de produit IA', titleFilter).ok, true);
  assert.equal(explainTitle('Program Manager', titleFilter).ok, false);
  assert.equal(explainTitle('AI Delivery Manager', titleFilter).ok, false);
  assert.equal(explainTitle('AI Trainer', titleFilter).ok, false);
  assert.equal(explainTitle('AI Annotation Specialist', titleFilter).ok, false);
  assert.equal(explainTitle('AI Sales Rep', titleFilter).ok, false);
  assert.equal(explainTitle('AI Operations Coordinator', titleFilter).ok, false);
  assert.equal(explainTitle('AI Marketing Manager', titleFilter).ok, false);
});

test('empty JD does not reopen a rejected ATS location', () => {
  assert.deepEqual(geoRejectCanWiden(''), { widen: false, phrase: '' });
  assert.deepEqual(geoRejectCanWiden('   '), { widen: false, phrase: '' });
  const closed = assessRemote(
    { title: 'Engineer', location: 'Remote - US', description: '' },
    { mode: 'strict_full_remote_only', required_any: ['remote'], ambiguous_policy: 'keep' },
  );
  assert.equal(closed.disposition, 'reject');
});

test('an explicit inclusive phrase can reopen a rejected ATS location', () => {
  const opened = assessRemote(
    { title: 'Engineer', location: 'Remote - US', description: 'Open to candidates in the US or Europe.' },
    { mode: 'strict_full_remote_only', required_any: ['remote'], ambiguous_policy: 'keep' },
    ['us or europe'],
  );
  assert.equal(opened.disposition, 'keep');
  assert.match(opened.reason, /us or europe/i);
});

test('pipeline markdown is generated from the record and keeps the remote reason intact', () => {
  const record = pipelineRecordFromEntry({
    url: 'https://jobs.example.com/1',
    company: 'Acme | Labs',
    title: 'AI PM',
    location: 'Remote - EMEA',
    publishedAt: '2026-08-25',
    source: 'Ashby',
    engine: 'api',
    jevKeep: 0.72,
    jevFit: 1.4,
    jevOutcome: 'validated',
    remoteVerdict: 'compatible',
    remoteReason: 'opened by JD phrase "us or europe"',
    remoteConfidence: 0.8,
  }, '2026-09-24T03:00:00.000Z');
  const line = formatPipelineMarkdown(record);
  assert.equal(line.includes('Acme / Labs'), true);
  assert.equal(line.startsWith('- [ ] https://jobs.example.com/1 |'), true);
  assert.match(line, /posted: 2026-08-25/);
  assert.match(line, /source: Ashby/);
  assert.match(line, /jev: 0\.72 kept/);
  assert.match(line, /remote_verdict: compatible — opened by JD phrase/);

  const parsed = parsePipeline(line);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].url, 'https://jobs.example.com/1');
  const parts = extractPipelineNoteParts(parsed[0].note);
  assert.equal(parts.company, 'Acme / Labs');
  assert.equal(parts.title, 'AI PM');
  assert.equal(parts.publishedAt, '2026-08-25');
  assert.match(parts.note, /remote_verdict: compatible — opened by JD phrase/);
  assert.equal(record.remote_confidence, 0.8);
  assert.equal(record.scanned_at, '2026-09-24T03:00:00.000Z');
});
