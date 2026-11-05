// 2026-11-05: the portal explorer added civil, mechanical and aerospace firms
// (Michels, Goken, Archer…) because "Design Engineer" / "Design Lead" on a
// product design profile also matched "Civil Design Engineer" or "Airframe
// Design Lead". hardwareDesignNegatives now covers physical engineering too,
// without touching web design, product design or product management titles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hardwareDesignNegatives } from '../lib/scan-targeting.mjs';
import { explainTitle } from '../lib/scan-decision.mjs';

const TERMS = ['Product Designer', 'Design Engineer', 'Design Lead', 'Head of Design', 'Web Designer', 'Product Manager', 'UX Designer'];
const filter = (terms) => ({ positive: terms, negative_patterns: hardwareDesignNegatives(terms) });

test('engineering design titles are blocked for a product design profile', () => {
  const tf = filter(TERMS);
  for (const title of [
    'Civil Design Engineer, Geostructural - Mi-Tech Services, Inc.',
    'Design Engineer - Structural - Mi-Tech Services, Inc.',
    'R&D Mechanical Design Engineer',
    'Contract Design Engineer- Automotive Plastics (NX)',
    'Contract Design Engineer I - Automotive Plastics (CATIA)',
    'Design Engineer - Chassis/Structures',
    'Senior Automation and Controls Design Engineer',
    'HVAC Controls Design Engineer',
    'Distribution Design Engineer',
    'Antenna Design Engineer',
    'Board Design Engineer',
    'CAD Drafter – Electrical Harness Design',
    'Airframe Design Lead, Wing',
    'Electrical Engineer, Wiring Design',
    'Senior Lighting Design Engineer - Remote Branch - United Kingdom',
    'Machine Learning Scientist I / II, Protein Design',
  ]) {
    const r = explainTitle(title, tf);
    assert.equal(r.ok, false, `${title} should be blocked`);
    assert.equal(r.via, 'pattern', title);
  }
});

test('web design, product design and product management titles still pass', () => {
  const tf = filter(TERMS);
  for (const title of [
    'Web Designer', 'Senior Web Designer', 'Product Manager', 'Senior Product Manager, AI',
    'Design Engineer', 'Senior Design Engineer', 'Product Design Engineer', 'Member of Technical Staff, Design Engineering',
    'Product Design Lead', 'Head of Design', 'Senior Product Designer', 'Senior UX Designer, Automotive', 'Design Lead',
  ]) {
    assert.equal(explainTitle(title, tf).ok, true, `${title} should pass`);
  }
});

test('a mechanical design profile keeps its own titles', () => {
  const terms = ['Mechanical Design Engineer', 'Design Engineer'];
  const tf = filter(terms);
  assert.equal(explainTitle('Senior Mechanical Design Engineer', tf).ok, true);
  // the other disciplines are still filtered for it
  assert.equal(explainTitle('Civil Design Engineer', tf).ok, false);
});
