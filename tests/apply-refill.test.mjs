import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRunMemory,
  displayValue,
  failedAttempts,
  forgetAnswer,
  knownAnswer,
  knownOptions,
  listShowsAnswer,
  noteFailedAttempt,
  planWant,
  reconCandidates,
  rematchFields,
  rememberAnswer,
  rememberOptions,
  retryTargets,
  stableKey,
  withOrdinals,
} from '../lib/apply-refill.mjs';

const nativeSelect = (value, options, extra = {}) => ({
  i: 3, frameId: 0, tag: 'select', type: 'select-one', label: 'Current location', value, options, ...extra,
});

test('a native select shows its option text, not the stored option value', () => {
  const f = nativeSelect('bkk', [{ value: '', text: 'Select…' }, { value: 'bkk', text: 'Bangkok' }, { value: 'par', text: 'Paris' }]);
  assert.equal(displayValue(f), 'Bangkok');
  assert.equal(displayValue({ ...f, tag: 'input', type: 'text', value: 'bkk' }), 'bkk');
});

test('a list that already shows the planned option is not re-picked', () => {
  const location = nativeSelect('bkk', [{ value: 'bkk', text: 'Bangkok' }, { value: 'par', text: 'Paris' }]);
  assert.equal(listShowsAnswer(location, 'Bangkok'), true);
  assert.equal(listShowsAnswer(location, 'Paris'), false);
  const yesNo = nativeSelect('1', [{ value: '1', text: 'Yes' }, { value: '0', text: 'No' }], { label: 'Do you need sponsorship?' });
  assert.equal(listShowsAnswer(yesNo, planWant({ yesNo: 'yes' })), true);
  assert.equal(listShowsAnswer(yesNo, planWant({ yesNo: 'no' })), false);
});

test('a placeholder is not an answer, and no want accepts any real option', () => {
  const empty = nativeSelect('', [{ value: '', text: 'Select…' }, { value: 'a', text: 'A' }]);
  assert.equal(listShowsAnswer(empty, ''), false);
  const chosen = nativeSelect('a', [{ value: '', text: 'Select…' }, { value: 'a', text: 'A' }]);
  assert.equal(listShowsAnswer(chosen, ''), true);
});

test('a multi list with chips counts every wanted item', () => {
  const multi = { i: 5, frameId: 0, tag: 'input', type: 'text', role: 'combobox', label: 'Languages', value: 'English, French', options: [{ text: 'English' }, { text: 'French' }, { text: 'German' }] };
  assert.equal(listShowsAnswer(multi, ['English', 'French']), true);
  assert.equal(listShowsAnswer(multi, ['English', 'German']), false);
});

test('same-label fields keep distinct keys by rank, across re-collects that move indexes', () => {
  const first = withOrdinals([
    { i: 1, frameId: 0, label: 'Year', value: '' },
    { i: 2, frameId: 0, label: 'Company', value: 'Acme' },
    { i: 3, frameId: 0, label: 'Year', value: '2021' },
  ]);
  assert.notEqual(stableKey(first[0]), stableKey(first[2]));
  // Remount: every index shifts by 10; the empty first "Year" must map to the
  // empty first "Year", not to the filled second one.
  const fresh = [
    { i: 11, frameId: 0, label: 'Year', value: '' },
    { i: 12, frameId: 0, label: 'Company', value: 'Acme' },
    { i: 13, frameId: 0, label: 'Year', value: '2021' },
  ];
  const [year1] = rematchFields([first[0]], fresh);
  assert.equal(year1.i, 11);
  assert.equal(year1.value, '');
});

test('a field with no live match stays as it was', () => {
  const [same] = rematchFields([{ i: 4, frameId: 0, label: 'Gone' }], [{ i: 4, frameId: 0, label: 'Other' }]);
  assert.equal(same.label, 'Gone');
});

test('run memory keeps options and answers per field, and counts failures', () => {
  const memory = createRunMemory();
  const f = withOrdinals([{ i: 7, frameId: 0, label: 'How did you hear about us?' }])[0];
  assert.equal(knownOptions(memory, f), null);
  rememberOptions(memory, f, [{ text: 'LinkedIn' }, { text: 'Job board' }]);
  rememberAnswer(memory, f, 'LinkedIn');
  // Same question after a remount (new index): same memory entry.
  const again = withOrdinals([{ i: 19, frameId: 0, label: 'How did you hear about us?' }])[0];
  assert.deepEqual(knownOptions(memory, again).map((o) => o.text), ['LinkedIn', 'Job board']);
  assert.equal(knownAnswer(memory, again), 'LinkedIn');
  assert.equal(noteFailedAttempt(memory, f), 1);
  assert.equal(noteFailedAttempt(memory, again), 2);
  assert.equal(failedAttempts(memory, f), 2);
  forgetAnswer(memory, f);
  assert.equal(knownAnswer(memory, f), null);
});

test('Relance auto retries only the failed, still-empty fields', () => {
  const pending = [
    { label: 'How did you hear about us?', reason: 'réponse suggérée — liste non ouverte' },
    { label: 'Criminal record', reason: 'requis — pas de donnée profil' },
  ];
  const live = [
    { i: 1, label: 'First name', value: 'Hugo' },
    { i: 2, label: 'How did you hear about us?', value: '' },
    { i: 3, label: 'Criminal record', value: '' },
  ];
  const targets = retryTargets(pending, live, {
    retryable: (reason) => /liste non ouverte/.test(reason),
    hasValue: (f) => Boolean(f.value),
  });
  assert.deepEqual(targets.map((f) => f.i), [2]);
});

test('recon skips lists, choices, what this pass wrote, and fields outside the scope', () => {
  const fields = [
    { i: 1, label: 'Email', type: 'email', value: 'x@y.z' },
    { i: 2, label: 'Phone', type: 'tel', value: '+33 6' },
    { i: 3, label: 'Country', tag: 'select', value: 'fr', options: [{ value: 'fr', text: 'France' }] },
    { i: 4, label: 'Consent', type: 'checkbox', checked: true },
    { i: 5, label: 'Location', type: 'text', role: 'combobox', value: 'Paris' },
  ];
  const all = reconCandidates(fields);
  assert.deepEqual(all.map((f) => f.i), [1, 2]);
  const written = new Set([stableKey(withOrdinals(fields)[1])]);
  assert.deepEqual(reconCandidates(fields, { written }).map((f) => f.i), [1]);
  const scope = new Set([stableKey(withOrdinals(fields)[1])]);
  assert.deepEqual(reconCandidates(fields, { scope }).map((f) => f.i), [2]);
});

import { listNeedsChange, readBackMatches, readBackTruncated } from '../lib/apply-refill.mjs';
import { mergeFilled, mergePending, fieldCompletionIssue } from '../lib/apply-completion.mjs';
import { isBlockingApplyPending } from '../lib/apply-progression.mjs';
import { languageQuestionPlan, shouldReplaceFilledValue } from '../lib/apply-fill-guards.mjs';

test('an ATS default the plan contradicts is replaced, an agreeing one is kept', () => {
  const sponsorship = nativeSelect('y', [{ value: 'y', text: 'Yes' }, { value: 'n', text: 'No' }], { label: 'Will you require visa sponsorship?' });
  assert.equal(listNeedsChange(sponsorship, 'No', { yesNo: 'no' }), true);
  assert.equal(listNeedsChange(sponsorship, 'Yes', { yesNo: 'yes' }), false);
  // A closed react-select is collected without options: a shown Yes still
  // contradicts a No plan; a non-yes/no plan with no options changes nothing.
  const closed = { i: 9, frameId: 0, tag: 'input', type: 'text', role: 'combobox', label: 'Will you require sponsorship?', value: 'Yes' };
  assert.equal(listNeedsChange(closed, 'No', { yesNo: 'no' }), true);
  assert.equal(listNeedsChange(closed, 'Yes', { yesNo: 'yes' }), false);
  assert.equal(listNeedsChange({ ...closed, value: 'LinkedIn' }, 'Job board', { selectText: 'Job board' }), false);
  // Options the run saw earlier count as known.
  assert.equal(listNeedsChange({ ...closed, value: 'LinkedIn' }, 'Job board', { selectText: 'Job board' }, ['LinkedIn', 'Job board']), true);
});

test('a timed-out fill counts only when the page shows what was sent', () => {
  const box = { i: 1, frameId: 0, type: 'text', label: 'Salary', value: '45000' };
  assert.equal(readBackMatches(box, { value: '45000' }), true);
  assert.equal(readBackMatches({ ...box, value: '30000' }, { value: '45000' }), false);
  const list = nativeSelect('', [{ value: '', text: 'Select…' }, { value: 'a', text: 'LinkedIn' }], { label: 'How did you hear about us?' });
  assert.equal(readBackMatches(list, { selectText: 'LinkedIn' }), false);
  assert.equal(readBackMatches({ ...list, value: 'a' }, { selectText: 'LinkedIn' }), true);
  const phone = { i: 2, frameId: 0, type: 'tel', label: 'Phone', value: '+33 6 12 34 56 78' };
  assert.equal(readBackMatches(phone, { value: '+33612345678' }), true);
});

test('a timed-out read-back showing only the start of an answer is cut, and blocks the send', () => {
  const want = 'Kraken’s focus on building open financial infrastructure is why I applied.';
  const box = { i: 3, frameId: 0, tag: 'textarea', type: 'textarea', label: 'Why are you interested in working at Kraken?', value: 'Kraken’s focus on bui' };
  assert.equal(readBackTruncated(box, { value: want }), true);
  assert.equal(readBackMatches(box, { value: want }), false);
  // A number early in the answer is no proof either.
  assert.equal(readBackMatches({ ...box, value: 'I have 8 ye' }, { value: 'I have 8 years of product design experience.' }), false);
  // The whole answer, or as much as the box's maxlength takes, landed.
  assert.equal(readBackMatches({ ...box, value: want }, { value: want }), true);
  assert.equal(readBackMatches({ ...box, maxLength: 21 }, { value: want }), true);
  assert.equal(readBackTruncated({ ...box, maxLength: 21 }, { value: want }), false);
  assert.equal(isBlockingApplyPending('valeur tronquée'), true);
  // A year early in a cut sentence matches the year sent: still cut.
  assert.equal(readBackMatches({ ...box, value: 'Since 2019, I hav' }, { value: 'Since 2019, I have led design for payments teams.' }), false);
});

test('a read-back the site only tidied is no cut: a dropped trailing "/", a bare amount', () => {
  const url = { i: 4, frameId: 0, type: 'url', tag: 'input', label: 'LinkedIn', value: 'https://www.linkedin.com/in/jane-doe' };
  assert.equal(readBackTruncated(url, { value: 'https://www.linkedin.com/in/jane-doe/' }), false);
  assert.equal(readBackMatches(url, { value: 'https://www.linkedin.com/in/jane-doe/' }), true);
  const salary = { i: 5, frameId: 0, type: 'text', tag: 'input', label: 'Expected salary', value: '45000' };
  assert.equal(readBackMatches(salary, { value: '45000 EUR' }), true);
  assert.equal(readBackMatches({ ...salary, value: '45,000' }, { value: '45000 EUR' }), true);
});

test('two fields with one label stay two rows; a filled one does not hide the other', () => {
  const filled = mergeFilled([], [{ label: 'Year', key: '0:year#1', value: '2021' }]);
  const pending = mergePending([], [{ label: 'Year', key: '0:year#0', reason: 'requis — non rempli après 2 essais' }], filled);
  assert.equal(pending.length, 1);
  assert.equal(mergeFilled(filled, [{ label: 'Year', key: '0:year#0', value: '2020' }]).length, 2);
  // A label-only row from the live-DOM check does not duplicate a keyed one.
  assert.equal(mergePending(pending, [{ label: 'Year', reason: 'requis et vide' }], filled).length, 1);
});

test('a required field the bridge could not fill blocks Next and auto-submit', () => {
  assert.equal(isBlockingApplyPending('requis — réponse suggérée — liste non ouverte'), true);
  assert.equal(isBlockingApplyPending('requis — non rempli après 2 essais'), true);
  assert.equal(isBlockingApplyPending('requis — pas de donnée profil'), false);
  assert.equal(isBlockingApplyPending('réponse suggérée — liste non ouverte'), false);
});

test('a required list still showing its prompt is empty', () => {
  const de = { i: 1, frameId: 0, tag: 'select', type: 'select-one', label: 'Land', required: true, value: 'Bitte wählen' };
  assert.equal(fieldCompletionIssue(de), 'requis et vide');
  const text = { i: 2, frameId: 0, tag: 'textarea', type: 'textarea', label: 'Comments', required: true, value: 'Please see my CV' };
  assert.equal(fieldCompletionIssue(text), null);
});

test('C1 English is not a native English speaker', () => {
  const langs = [{ name: 'French', level: 'Native' }, { name: 'English', level: 'C1' }];
  const q = (label) => ({ i: 1, frameId: 0, tag: 'select', type: 'select-one', label, options: [{ value: 'y', text: 'Yes' }, { value: 'n', text: 'No' }] });
  assert.equal(languageQuestionPlan(q('Are you a native English speaker?'), langs)?.yesNo, 'no');
  assert.equal(languageQuestionPlan(q('Is English your mother tongue?'), langs)?.yesNo, 'no');
  assert.equal(languageQuestionPlan(q('Are you a native French speaker?'), langs)?.yesNo, 'yes');
  assert.equal(languageQuestionPlan(q('Are you fluent in English?'), langs)?.yesNo, 'yes');
});

test('a salary the ATS reformats is the same amount; a French salary box replaces CV-parse junk', () => {
  const en = { i: 1, frameId: 0, type: 'text', label: 'Expected salary' };
  assert.equal(shouldReplaceFilledValue(en, '45,000.00', '45000'), false);
  const fr = { i: 2, frameId: 0, type: 'text', label: 'Salaire souhaité' };
  assert.equal(shouldReplaceFilledValue(fr, '4000', '45000'), true);
});

import { ensureOrdinals, hasShownValue } from '../lib/apply-refill.mjs';

test('review fixes: native-or-fluent questions still accept a fluent level', () => {
  const langs = [{ name: 'English', level: 'C1' }];
  const q = (label) => ({ i: 1, frameId: 0, tag: 'select', type: 'select-one', label, options: [{ value: 'y', text: 'Yes' }, { value: 'n', text: 'No' }] });
  assert.equal(languageQuestionPlan(q('Do you speak English at a native or fluent level?'), langs)?.yesNo, 'yes');
  assert.equal(languageQuestionPlan(q('Do you have native or bilingual proficiency in English?'), langs)?.yesNo, 'yes');
  assert.equal(languageQuestionPlan(q('Are you a native English speaker?'), langs)?.yesNo, 'no');
});

test('review fixes: a native select prompt stored as value "0" is empty everywhere', () => {
  const f = { i: 1, frameId: 0, tag: 'select', type: 'select-one', label: 'Land', required: true, value: '0', options: [{ value: '0', text: 'Please select' }, { value: 'fr', text: 'France' }] };
  assert.equal(hasShownValue(f), false);
  assert.equal(fieldCompletionIssue(f), 'requis et vide');
  assert.equal(hasShownValue({ ...f, value: 'fr' }), true);
});

test('review fixes: timed-out read-back accepts reformatted amounts and longer option labels', () => {
  assert.equal(readBackMatches({ i: 1, frameId: 0, type: 'text', label: 'Salary', value: '45,000' }, { value: '45000' }), true);
  const list = { i: 2, frameId: 0, tag: 'input', type: 'text', role: 'combobox', label: 'Authorized to work?', value: 'Yes, I am authorized' };
  assert.equal(readBackMatches(list, { selectText: 'Yes' }), true);
  assert.equal(readBackMatches(list, { selectText: 'No' }), false);
});

test('review fixes: a same-label field appearing above starts fresh memory', () => {
  const before = withOrdinals([{ i: 1, frameId: 0, label: 'If yes, please specify' }]);
  const after = withOrdinals([{ i: 1, frameId: 0, label: 'If yes, please specify' }, { i: 2, frameId: 0, label: 'If yes, please specify' }]);
  const memory = createRunMemory();
  noteFailedAttempt(memory, before[0]);
  noteFailedAttempt(memory, before[0]);
  assert.equal(failedAttempts(memory, after[0]), 0);
  assert.equal(failedAttempts(memory, after[1]), 0);
});

test('review fixes: a stray unranked entry never re-ranks a ranked subset', () => {
  const ranked = withOrdinals([{ i: 1, frameId: 0, label: 'Year' }, { i: 2, frameId: 0, label: 'Year' }]);
  const mixed = ensureOrdinals([ranked[1], { i: 9, frameId: 0, label: 'Year' }]);
  assert.equal(stableKey(mixed[0]), stableKey(ranked[1]));
  assert.notEqual(stableKey(mixed[1]), stableKey(ranked[0]));
});

test('review fixes: keyed pending rows retry exactly their field', () => {
  const live = withOrdinals([{ i: 1, frameId: 0, label: 'Year', value: '' }, { i: 2, frameId: 0, label: 'Year', value: '' }]);
  const targets = retryTargets([{ label: 'Year', key: stableKey(live[1]), reason: 'liste non ouverte' }], live, {
    retryable: () => true,
    hasValue: (f) => Boolean(f.value),
  });
  assert.deepEqual(targets.map((f) => f.i), [2]);
});

test('second review: a number on the page never confirms a name or URL that was sent', () => {
  assert.equal(readBackMatches({ i: 1, frameId: 0, type: 'text', label: 'First name', value: '0612345678' }, { value: 'Hugo' }), false);
  assert.equal(readBackMatches({ i: 2, frameId: 0, type: 'text', label: 'LinkedIn', value: 'linkedin.com/in/old-123456' }, { value: 'linkedin.com/in/hugovermot' }), false);
  assert.equal(readBackMatches({ i: 3, frameId: 0, type: 'tel', label: 'Phone', value: '+33 6 12 34 56 78' }, { value: '06 12 34 56 78' }), true);
});

test('second review: native-level questions need a native level, explicit alternatives accept fluent', () => {
  const langs = [{ name: 'English', level: 'C1' }];
  const q = (label) => ({ i: 1, frameId: 0, tag: 'select', type: 'select-one', label, options: [{ value: 'y', text: 'Yes' }, { value: 'n', text: 'No' }] });
  assert.equal(languageQuestionPlan(q('Do you have native-level proficiency in English?'), langs)?.yesNo, 'no');
  assert.equal(languageQuestionPlan(q('Are you a native English speaker (C2)?'), langs)?.yesNo, 'no');
  assert.equal(languageQuestionPlan(q('Are you fluent in English (native or near-native)?'), langs)?.yesNo, 'yes');
});

test('second review: a keyed row whose ranks moved retries its field by label', () => {
  const live = withOrdinals([{ i: 1, frameId: 0, label: 'Please specify', value: '' }, { i: 2, frameId: 0, label: 'Please specify', value: 'x' }]);
  const targets = retryTargets([{ label: 'Please specify', key: '0:please specify#0/1', reason: 'échec fill' }], live, {
    retryable: () => true,
    hasValue: (f) => Boolean(f.value),
  });
  assert.deepEqual(targets.map((f) => f.i), [1]);
});

test('second review: run memory keeps contradicted lists across passes', () => {
  const memory = createRunMemory();
  assert.ok(memory.contradicted instanceof Map);
});

import { stillContradicted } from '../lib/apply-refill.mjs';

test('final check: a replacement that landed late is not flagged as contradicted', () => {
  const memory = createRunMemory();
  const f = withOrdinals([{ i: 1, frameId: 0, tag: 'input', type: 'text', role: 'combobox', label: 'Need sponsorship?', value: 'Yes' }])[0];
  memory.contradicted.set(stableKey(f), 'Yes');
  assert.equal(stillContradicted(memory, f), true);
  assert.equal(stillContradicted(memory, { ...f, value: 'No' }), false);
});

test('final check: "native/fluent" accepts a fluent level', () => {
  const q = { i: 1, frameId: 0, tag: 'select', type: 'select-one', label: 'Are you native/fluent in English?', options: [{ value: 'y', text: 'Yes' }, { value: 'n', text: 'No' }] };
  assert.equal(languageQuestionPlan(q, [{ name: 'English', level: 'C1' }])?.yesNo, 'yes');
});
