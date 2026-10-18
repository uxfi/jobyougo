import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { applyCvNameOf, pickCoverLetterPath, pickCvPath } from '../lib/apply-spec.mjs';

const APPLY_CV = 'Jane_Doe_CV.pdf';

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'apply-cv-'));
  await mkdir(join(root, 'output'));
  await mkdir(join(root, 'ui'));
  for (const [rel, body] of Object.entries(files)) {
    await writeFile(join(root, rel), body);
  }
  return root;
}

test('the apply CV is the PDF the profile names, whatever the region', async () => {
  const root = await fixture({
    'output/Jane_Doe_CV_Complete_Bangkok.pdf': 'bkk',
    'output/Jane_Doe_CV_Complete_Paris.pdf': 'par',
    [`output/${APPLY_CV}`]: 'ok',
    'output/agoda-tailored.pdf': 'no',
  });
  assert.equal(await pickCvPath(root, 'Agoda', 'asia', APPLY_CV), join(root, 'output', APPLY_CV));
  assert.equal(await pickCvPath(root, 'N26', 'europe', APPLY_CV), join(root, 'output', APPLY_CV));
});

test('no named CV: nothing is guessed, a regional or tailored PDF never stands in', async () => {
  const root = await fixture({
    'output/Jane_Doe_CV_Complete_Bangkok.pdf': 'bkk',
    'output/Hugo_Vermot_CV-PRODUCT-AI-DESIGNER_compressed.pdf': 'someone else',
  });
  assert.equal(await pickCvPath(root, 'Agoda', 'asia'), null);
  assert.equal(await pickCvPath(root, 'N26', 'europe', 'Missing.pdf'), null);
});

test('the profile names the apply CV in candidate.apply_cv or cv.apply_pdf', () => {
  assert.equal(applyCvNameOf({ candidate: { apply_cv: 'A.pdf' }, cv: { apply_pdf: 'B.pdf' } }), 'A.pdf');
  assert.equal(applyCvNameOf({ cv: { apply_pdf: 'B.pdf' } }), 'B.pdf');
  assert.equal(applyCvNameOf({}), '');
});

test('a profile value never reaches a file outside the CV folders', async () => {
  const root = await fixture({ 'output/Jane_Doe_CV.pdf': 'ok', 'cv.md': '# secret' });
  for (const name of ['../cv.md', '../config/profile.yml', 'cv.md', '..\\cv.md', '.hidden.pdf', 'sub/Jane_Doe_CV.pdf']) {
    assert.equal(await pickCvPath(root, 'Acme', 'europe', name), null, name);
  }
});

test('the cover letter is the newest one for this company and role, named as the writer names it', async () => {
  const root = await fixture({
    'output/cover-letter-acme-robotics-product-designer-2026-10-12.pdf': 'other company',
    'output/cover-letter-acme-product-designer-2026-10-01.pdf': 'old',
    'output/cover-letter-acme-product-designer-2026-10-10.pdf': 'new',
    'output/cover-letter-acme-backend-engineer-2026-10-11.pdf': 'other role',
    'output/cover-letter-l-or-al-brand-designer-2026-10-09.pdf': 'accented',
  });
  assert.equal(await pickCoverLetterPath(root, 'Acme', 'Product Designer'), join(root, 'output', 'cover-letter-acme-product-designer-2026-10-10.pdf'));
  assert.equal(await pickCoverLetterPath(root, "L'Oréal", 'Brand Designer'), join(root, 'output', 'cover-letter-l-or-al-brand-designer-2026-10-09.pdf'));
  assert.equal(await pickCoverLetterPath(root, 'Acme', 'Data Scientist'), null);
  assert.equal(await pickCoverLetterPath(root, '', 'Product Designer'), null);
});
