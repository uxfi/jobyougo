import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listingPageReason } from '../lib/scan-decision.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('WeLoveProduct category pages are rejected before evaluation', () => {
  assert.match(listingPageReason({
    url: 'https://weloveproduct.co/product-designer-jobs-remote-europe',
    title: 'Remote Product Designer Jobs Europe 2026 - 20 Open Product Design Roles',
  }), /not a job posting/);
});

test('the evaluation instructions do not infer remote compatibility from a city or silence', () => {
  const mode = readFileSync(join(ROOT, 'modes/oferta.md'), 'utf8');
  assert.match(mode, /A job being "based in Paris" does not by itself mean it is remote/);
  assert.match(mode, /Never infer remote eligibility from silence/);
});
