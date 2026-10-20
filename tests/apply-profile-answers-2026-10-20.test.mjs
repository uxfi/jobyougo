import test from 'node:test';
import assert from 'node:assert/strict';
import { convertCurrency, currentSalaryForForm, formSalaryValue } from '../lib/apply-salary.mjs';
import { fileUploadPlan } from '../lib/apply-fill-guards.mjs';
import { classifyField } from '../lib/apply-classify.mjs';

const current = { amount: 4000, currency: 'EUR', period: 'month' };

test('current salary: monthly EUR from the profile, yearly by default, converted and rounded up for USD', () => {
  assert.equal(currentSalaryForForm(current, 'What is your current salary?'), '48000');
  assert.equal(currentSalaryForForm(current, 'Current monthly salary'), '4000');
  assert.equal(currentSalaryForForm(current, 'Current salary (annual USD)'), '53000');
  assert.equal(currentSalaryForForm(current, 'Current salary per month in USD'), '4400');
  assert.equal(currentSalaryForForm(null, 'Current salary'), '');
});

test('expected salary in USD is converted from the EUR profile (~1.1) instead of being skipped', () => {
  const comp = { minimum: 'EUR60K salary / EUR500/day', currency: 'EUR' };
  assert.equal(formSalaryValue(comp, 'What is your expected salary? (annual USD)'), '66000');
  assert.equal(formSalaryValue(comp, 'Expected salary (EUR)'), '60000');
  assert.equal(formSalaryValue(comp, 'Expected salary (JPY)'), '');
  assert.equal(Math.round(convertCurrency(110, 'USD', 'EUR')), 100);
});

test('classify: the current-salary box takes the profile figure, even when the form says "enter 0"', () => {
  const spec = { identity: { currentSalary: current, fxRates: { EUR_USD: 1.1 }, salaryCurrency: 'EUR' }, answers: [] };
  const plan = classifyField({ type: 'text', tag: 'input', label: 'What is your Current salary (enter 0 if not applicable)?', required: true }, spec);
  assert.equal(plan.value, '48000');
  const none = classifyField({ type: 'text', tag: 'input', label: 'What is your current salary?', required: true }, { identity: {}, answers: [] });
  assert.equal(none.leaveBlank, true);
});

test('a portfolio file slot gets the CV only when the profile says so', () => {
  const f = { type: 'file', tag: 'input', label: 'Please upload your portfolio here' };
  assert.deepEqual(fileUploadPlan(f, { cvPath: 'C:/cv.pdf', identity: { portfolioFile: 'cv' } }), { upload: 'C:/cv.pdf', kind: 'portfolio-cv' });
  assert.ok(fileUploadPlan(f, { cvPath: 'C:/cv.pdf', identity: {} }).skip);
  assert.ok(fileUploadPlan({ type: 'file', label: 'Design challenge upload' }, { cvPath: 'C:/cv.pdf', identity: { portfolioFile: 'cv' } }).skip);
});