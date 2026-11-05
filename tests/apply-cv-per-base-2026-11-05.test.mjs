// 2026-11-05: one apply CV per base. The owner applies with a Bangkok CV to
// APAC offers and a Europe CV everywhere else; the base picked for the offer
// (lib/candidate-location.mjs selectBase) now picks the PDF as well as the
// city, zone and phone. candidate.apply_cv stays the fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApplySpec, preferLocalApplyCv } from '../lib/apply-spec.mjs';

const PDF = Buffer.from('%PDF-1.4\n%test\n');

const PROFILE = {
  candidate: { full_name: 'Jane Doe', email: 'jane@example.com', apply_cv: 'CV_Europe.pdf' },
  location: {
    bases: [
      { city: 'Paris', country: 'France', timezone: 'Europe/Paris', default: true, status: 'citizen', apply_cv: 'CV_Europe.pdf' },
      { city: 'Bangkok', country: 'Thailand', timezone: 'Asia/Bangkok', regions: ['APAC'], status: 'authorized', apply_cv: 'CV_Bangkok.pdf' },
    ],
  },
};

async function rootWith(files) {
  const root = await mkdtemp(join(tmpdir(), 'apply-cv-base-'));
  await mkdir(join(root, 'output'));
  for (const f of files) await writeFile(join(root, 'output', f), PDF);
  return root;
}

const report = (location) => `# Acme — Product Designer\n\n**URL:** https://jobs.example.com/acme/1\n\n**Location:** ${location}\n`;

async function specFor(root, location, profile = PROFILE) {
  return buildApplySpec({
    root, reportFilename: 'r.md', company: 'Acme', role: 'Product Designer',
    reportText: report(location), profile, cvMarkdown: '',
  });
}

test('an APAC offer attaches the Bangkok CV, a European one the Europe CV', async () => {
  const root = await rootWith(['CV_Europe.pdf', 'CV_Bangkok.pdf']);
  const asia = await specFor(root, 'Bangkok, Thailand (hybrid)');
  assert.equal(asia.cvPath, join(root, 'output', 'CV_Bangkok.pdf'));
  assert.equal(asia.region, 'asia');
  const sg = await specFor(root, 'Singapore');
  assert.equal(sg.cvPath, join(root, 'output', 'CV_Bangkok.pdf'));
  const eu = await specFor(root, 'Berlin, Germany');
  assert.equal(eu.cvPath, join(root, 'output', 'CV_Europe.pdf'));
  assert.equal(eu.region, 'europe');
  // No place named: the default base, so the Europe CV.
  const global = await specFor(root, 'Remote');
  assert.equal(global.cvPath, join(root, 'output', 'CV_Europe.pdf'));
});

test('a base whose PDF is missing falls back to candidate.apply_cv', async () => {
  const root = await rootWith(['CV_Europe.pdf']);
  const asia = await specFor(root, 'Bangkok, Thailand');
  assert.equal(asia.cvPath, join(root, 'output', 'CV_Europe.pdf'));
});

test('bases without apply_cv keep the single apply_cv for every offer', async () => {
  const root = await rootWith(['One.pdf']);
  const profile = {
    candidate: { full_name: 'Jane Doe', apply_cv: 'One.pdf' },
    location: { bases: PROFILE.location.bases.map(({ apply_cv, ...b }) => b) },
  };
  assert.equal((await specFor(root, 'Bangkok, Thailand', profile)).cvPath, join(root, 'output', 'One.pdf'));
  assert.equal((await specFor(root, 'Paris, France', profile)).cvPath, join(root, 'output', 'One.pdf'));
});

test('a missing base PDF and fallback name both files in the error', async () => {
  const root = await rootWith([]);
  await assert.rejects(specFor(root, 'Bangkok, Thailand'), /CV_Bangkok\.pdf \/ CV_Europe\.pdf/);
});

test('the owner: profile.yml base CVs win over stored bases matched by city', () => {
  const stored = {
    candidate: { apply_cv: 'Old.pdf' },
    location: { bases: [{ city: 'Paris', country: 'France', default: true }, { city: 'bangkok', country: 'Thailand', apply_cv: 'Stale.pdf' }, { city: 'Lisbon', country: 'Portugal', apply_cv: 'Lisbon.pdf' }] },
  };
  const merged = preferLocalApplyCv(stored, PROFILE);
  assert.equal(merged.candidate.apply_cv, 'CV_Europe.pdf');
  assert.deepEqual(merged.location.bases.map((b) => b.apply_cv), ['CV_Europe.pdf', 'CV_Bangkok.pdf', 'Lisbon.pdf']);
  // Nothing local to bring: the stored profile is returned as is.
  assert.equal(preferLocalApplyCv(stored, {}), stored);
});
