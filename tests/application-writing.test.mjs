import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { polishApplicationAnswer, loadApplicationVoice } from '../lib/application-writing.mjs';

test('editing preserves qualifications, technical terms and proper names', () => {
  for (const text of [
    'I believe the change helped, but we did not measure its effect.',
    'I worked on Leverage, an internal tool, from 2020–2024.',
    'Je contribuai au prototype ; une collègue pilotait le projet.',
    'https://example.com/Showcase?team=AI&version=1.2',
    'EUR 70–110K',
    'I showcased the prototype, not the production release.',
  ]) assert.equal(polishApplicationAnswer(text), text);
});

test('plain text cleanup preserves paragraphs and meaningful lists', () => {
  assert.equal(polishApplicationAnswer('Réponse : **Bonjour**\r\n\r\nUn exemple.\r\n\r\nMerci.'), 'Bonjour\n\nUn exemple.\n\nMerci.');
  assert.equal(polishApplicationAnswer('1. Design\n2. Implementation'), '1. Design\n2. Implementation');
});

test('user voice loads without pulling unrelated custom workflow instructions', () => {
  const root = mkdtempSync(join(tmpdir(), 'application-writing-'));
  try {
    mkdirSync(join(root, 'modes'));
    writeFileSync(join(root, 'modes/_custom.md'), 'Unrelated workflow\n<!-- application-writing:start -->\nÉcrire sobrement.\n<!-- application-writing:end -->');
    assert.equal(loadApplicationVoice(root), 'Écrire sobrement.');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
