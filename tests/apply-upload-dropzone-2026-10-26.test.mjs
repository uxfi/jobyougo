import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const background = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

test('a drop zone that builds its file input on click is clicked under chooser interception', () => {
  const chooser = background.slice(background.indexOf('async function trySetFileViaChooser'), background.indexOf('async function trySetFileInputInSession'));
  assert.match(chooser, /spl-dropzone, oc-dropzone/);
  assert.match(chooser, /data-co-chooser/);
  assert.match(chooser, /Page\.setInterceptFileChooserDialog/);
});

test('the DataTransfer fallback does not let an empty frame hide the real error', () => {
  assert.match(background, /errs\.find\(\(message\) => message !== 'no file input'\)/);
});
