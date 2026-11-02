// Three answers really sent on 2026-11-02, with the forms' own wording:
//  - Hilo: "…United Kingdom, Germany, Italy, France, Spain, or Ireland?" got No
//    from a French citizen, because the list was read as all of them;
//  - Hunt St: an invented computer and connection;
//  - Hunt St: consent to contact the current employer got "After 1 week notice".
// Offline: the LLM is simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUnknownFields, unsourcedEquipmentClaim } from '../lib/apply-llm.mjs';
import { policyPlan, workAuthorizedFor } from '../lib/apply-policy.mjs';

const identity = {
  fullName: 'Hugo V',
  city: 'Paris',
  country: 'France',
  nationality: 'French',
  visaStatus: 'No sponsorship needed -- French / EU citizen',
  employmentStatus: 'employed',
  startDate: 'After 1 week notice',
  noticePeriod: '1 week',
  policy: { authorizedIn: ['France', 'European Union', 'European Economic Area', 'Thailand'], remote: 'Full remote required', fullRemoteOnly: true },
};
const spec = { company: 'Example', role: 'Designer', identity };
const yesNo = (label) => ({ label, type: 'radio', options: [{ text: 'Yes' }, { text: 'No' }] });
const CONTACT = 'Do you authorise Hunt St Pty Ltd and the prospective client to contact your current employer or client to verify information relevant to your application, including your employment or engagement status, role, dates, experience and availability?';
const COMPUTER = 'Please indicate your computer specifications and internet speed test results. (Example: Ryzen 5 / 100MBPS)';

function fakeChat(reply) {
  const fn = async () => { fn.calls += 1; return reply; };
  fn.calls = 0;
  return fn;
}

test('a list joined by "or" needs one country the candidate may work in', () => {
  const hilo = yesNo('Are you legally authorized to work in the United Kingdom, Germany, Italy, France, Spain, or Ireland?');
  assert.equal(workAuthorizedFor(hilo, spec), true);
  assert.equal(policyPlan(hilo, spec).yesNo, 'yes');
  assert.equal(policyPlan(yesNo('Are you authorized to work in France or the UK?'), spec).yesNo, 'yes');
  assert.equal(policyPlan(yesNo('Are you authorized to work in the UK or the US?'), spec).yesNo, 'no');
});

test('other work authorization questions keep their answer', () => {
  assert.equal(policyPlan(yesNo('Are you authorized to work in the UK and France?'), spec).yesNo, 'no');
  assert.equal(workAuthorizedFor(yesNo('Are you authorized to work in the UK and Germany, or will you need a visa?'), spec), false);
  assert.equal(policyPlan(yesNo('Are you authorized to work in the United Kingdom?'), spec).yesNo, 'no');
  assert.equal(policyPlan(yesNo('Are you authorized to work in Germany?'), spec).yesNo, 'yes');
});

test('the computer question goes to the human, the model is not asked', async () => {
  const chatFn = fakeChat('{"0":"MacBook Pro M series with 32GB RAM / 300 Mbps symmetrical fiber connection."}');
  const out = await resolveUnknownFields({ fields: [{ i: 0, label: COMPUTER, kind: 'text', required: true }], spec, career: '# CV', chatFn });
  assert.equal(out['0'], undefined);
  assert.deepEqual(out.refused['0'], ['no-source']);
  assert.equal(chatFn.calls, 0);
});

test('the candidate\'s own equipment answer is used as written', async () => {
  const own = { ...spec, identity: { ...identity, screening: { customAnswers: [{ question: 'What are your computer specifications and internet speed?', answer: 'ThinkPad T14, 32GB / 200 Mbps' }] } } };
  const chatFn = fakeChat('{}');
  const out = await resolveUnknownFields({ fields: [{ i: 0, label: COMPUTER, kind: 'text', required: true }], spec: own, career: '# CV', chatFn });
  assert.equal(out['0'], 'ThinkPad T14, 32GB / 200 Mbps');
  assert.equal(chatFn.calls, 0);
});

test('a hardware claim in any other short answer is dropped', async () => {
  const chatFn = fakeChat('{"0":"I work on a MacBook Pro with 32GB RAM."}');
  const out = await resolveUnknownFields({ fields: [{ i: 0, label: 'What is your remote setup?', kind: 'text', required: true }], spec, career: '# CV', chatFn });
  assert.equal(out['0'], undefined);
  assert.deepEqual(out.refused['0'], ['no-source']);
});

test('the claim check lets through what the sources say and ordinary numbers', () => {
  assert.equal(unsourcedEquipmentClaim('I use a MacBook daily', 'Tools: MacBook, Figma'), false);
  assert.equal(unsourcedEquipmentClaim('12 years of product design', ''), false);
  assert.equal(unsourcedEquipmentClaim('On 300 Mbps fiber', ''), true);
});

test('consent to contact the current employer goes to the human', async () => {
  const chatFn = fakeChat('{"answer":"Yes, please do."}');
  const out = await resolveUnknownFields({ fields: [{ i: 0, label: CONTACT, kind: 'long text', required: true }], spec, career: '# CV', chatFn });
  assert.equal(out['0'], undefined, 'not "After 1 week notice", not a model\'s consent');
  assert.deepEqual(out.refused['0'], ['personal']);
  assert.equal(chatFn.calls, 0);
});

test('a discreet search still answers No before the resolver', () => {
  const plan = policyPlan(yesNo(CONTACT), { ...spec, identity: { ...identity, employmentStatus: 'employed-discreet' } });
  assert.equal(plan.yesNo, 'no');
});

test('a yes/no question that only mentions availability or salary skips the profile value', async () => {
  const label = 'Do you agree that we verify your references, role, dates and availability with the people you worked with during the recruitment process, as described in our privacy notice for candidates?';
  const chatFn = fakeChat('{"answer":"Yes"}');
  const out = await resolveUnknownFields({ fields: [{ i: 0, label, kind: 'long text', required: true }], spec, career: '# CV', chatFn });
  assert.notEqual(out['0'], 'After 1 week notice');
  assert.ok(chatFn.calls > 0, 'the writer gets the question');
});

test('real availability and salary boxes still take the profile value', async () => {
  const chatFn = fakeChat('{}');
  const salaried = { ...spec, identity: { ...identity, salaryFormAnnual: '60000', salaryCurrency: 'EUR' } };
  const fields = [
    { i: 0, label: 'What is your availability and notice period?', kind: 'long text', required: true },
    { i: 1, label: 'What are your salary expectations for this role and how do you see them evolving over the first year of the engagement with our team here in Europe?', kind: 'long text', required: true },
  ];
  const out = await resolveUnknownFields({ fields, spec: salaried, career: '# CV', chatFn });
  assert.equal(out['0'], 'After 1 week notice');
  assert.equal(out['1'], '60000');
});
