import test from 'node:test';
import assert from 'node:assert/strict';
import { inferWorkModeFromText } from '../lib/work-mode.mjs';

test('"remote unmoderated tests" is a research method, not the work mode', () => {
  const jd = 'Senior Product Designer, Singapore. You design research-cheap ways to learn (fake-door tests, concierge MVPs, remote unmoderated tests).';
  assert.equal(inferWorkModeFromText(jd).mode, 'unknown');
  assert.equal(inferWorkModeFromText('Run moderated remote sessions with users. Remote usability testing.').mode, 'unknown');
});

test('a real remote claim still reads as remote next to such a method', () => {
  assert.equal(inferWorkModeFromText('Remote role. You run remote unmoderated tests.').mode, 'remote');
  assert.equal(inferWorkModeFromText('This position is remote within Europe.').mode, 'remote');
  assert.equal(inferWorkModeFromText('Location: Remote, Europe. Remote usability testing.').mode, 'remote');
});
