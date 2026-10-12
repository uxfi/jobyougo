import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRegion, regionFromOfferLocation } from '../lib/apply-spec.mjs';

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
