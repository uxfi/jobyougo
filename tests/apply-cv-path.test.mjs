import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { APPLY_CV_FILENAME, pickCvPath } from '../lib/apply-spec.mjs';

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'apply-cv-'));
  await mkdir(join(root, 'output'));
  await mkdir(join(root, 'ui'));
  for (const [rel, body] of Object.entries(files)) {
    await writeFile(join(root, rel), body);
  }
  return root;
}

test('apply CV is the product-AI designer file for Asia and Europe', async () => {
  const root = await fixture({
    'output/Hugo_Vermot_CV_Complete_Bangkok.pdf': 'bkk',
    'output/Hugo_Vermot_CV_Complete_Paris.pdf': 'par',
    [`output/${APPLY_CV_FILENAME}`]: 'ok',
    'output/agoda-tailored.pdf': 'no',
  });
  const asia = await pickCvPath(root, 'Agoda', 'asia');
  const europe = await pickCvPath(root, 'N26', 'europe');
  assert.equal(asia, join(root, 'output', APPLY_CV_FILENAME));
  assert.equal(europe, join(root, 'output', APPLY_CV_FILENAME));
});

test('does not fall back to a regional Complete_* CV', async () => {
  const root = await fixture({
    'output/Hugo_Vermot_CV_Complete_Bangkok.pdf': 'bkk',
    'output/Hugo_Vermot_CV_Complete_Paris.pdf': 'par',
  });
  assert.equal(await pickCvPath(root, 'Agoda', 'asia'), null);
  assert.equal(await pickCvPath(root, 'N26', 'europe'), null);
});
