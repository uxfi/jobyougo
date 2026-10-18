import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRegion, offerLinesOf, regionFromOfferLocation } from '../lib/apply-spec.mjs';
import { offerLocationFromText } from '../lib/apply-policy.mjs';

test('the job country decides Paris vs Bangkok', () => {
  assert.equal(regionFromOfferLocation({ countries: ['Germany'] }), 'europe');
  assert.equal(regionFromOfferLocation({ countries: ['Thailand'] }), 'asia');
  assert.equal(regionFromOfferLocation({ countries: ['Singapore', 'Hong Kong'] }), 'asia');
  assert.equal(regionFromOfferLocation({ countries: ['Thailand', 'Germany'] }), '');
  assert.equal(regionFromOfferLocation({ countries: [] }), '');
});

test('a French report on a German job is not read as Asia (Terra Quantum)', () => {
  const report = [
    '- **Expérience en contexte technique distribué** : ✅ Expérience en remote (Phuket, ICT), avec overlap EU.',
    '- **Justification** : Candidat français, citoyen UE. Localisation actuelle : Thaïlande, mais poste en Allemagne.',
  ].join('\n');
  assert.equal(detectRegion(report), 'europe');
});

// A first name is a word in offer lines ("max 2 office days"): only the full
// name, as written, marks a line about the candidate.
test('the candidate-name filter matches the full name, case-sensitive', () => {
  const report = 'Location: Singapore (Hybrid, max 2 office days)\nMax Mustermann est basé à Berlin.';
  assert.equal(offerLinesOf(report, 'Max Mustermann'), 'Location: Singapore (Hybrid, max 2 office days)');
  assert.equal(offerLinesOf('Will travel monthly to the Paris office', 'Will Smith'), 'Will travel monthly to the Paris office');
  assert.deepEqual(offerLocationFromText({ reportText: '- **Location**: Singapore (Hybrid, max 2 office days)', candidateName: 'Max Mustermann' }).countries, ['Singapore']);
});

// Preply, Secfi and Factorial (2026-10-12/16): the evaluation's B/D/G sections talk
// about the candidate ("résident en Thaïlande", "aucune contrainte hors Bangkok"),
// and the form was filled with Bangkok / Thailand for European jobs.
test('only the header and the role summary locate the offer, not the candidate analysis', async () => {
  const { offerPartOfReport } = await import('../lib/apply-policy.mjs');
  const report = [
    '# Evaluation — Senior Product Designer',
    '**URL:** https://jobs.ashbyhq.com/acme/1',
    '**Score:** 1.0/5 (hard fail: hybrid/on-site exigé hors de Bangkok)',
    '## A) Résumé du rôle',
    'Poste basé à Barcelone, hybride.',
    '## B) Match CV',
    '- Il est citoyen UE, et résident en Thaïlande — Aucune contrainte hors Bangkok.',
    '## D) Comp et demande',
    '**Localisation** : Phuket, Thaïlande (résident digital nomad)',
  ].join('\n');
  const offer = offerPartOfReport(report);
  assert.match(offer, /Barcelone/);
  assert.doesNotMatch(offer, /Thaïlande|Bangkok|Phuket/);
  assert.deepEqual(offerLocationFromText({ role: 'Senior Product Designer', reportText: report, candidateName: 'Hugo Vermot' }).countries, []);
  // A report without sections is read whole, as before.
  assert.equal(offerPartOfReport('Location: Berlin'), 'Location: Berlin');
});
