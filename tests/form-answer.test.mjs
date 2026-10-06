import { pass, fail } from './helpers.mjs';
import { extractAnswerBody, opensWithDenial, writeFormAnswer } from '../lib/form-answer.mjs';

function ok(label, cond) {
  if (cond) pass(label);
  else fail(label);
}

ok('denial opener is detected', opensWithDenial("Je n'ai pas conçu de produit"));
ok('a shipped-work sentence is not a denial', !opensWithDenial('I shipped the locator apps at Edenred.'));
ok('answer body drops the question header', /Edenred/.test(extractAnswerBody('## Acme — Designer\n**Question:** Tell us\n\nI shipped Edenred.')) && !/Question/.test(extractAnswerBody('## Acme — Designer\n**Question:** Tell us\n\nI shipped Edenred.')));

const calls = [];
const written = await writeFormAnswer({
  question: 'Tell us about a product you shipped.',
  company: 'Acme',
  role: 'Designer',
  career: '- Edenred: designed the locator apps',
  voice: '',
  complete: async ({ user }) => {
    calls.push(user);
    if (calls.length === 1) return "Je n'ai pas conçu ça.";
    return 'I shipped the locator apps at Edenred. I owned the driver flows. The work covered finding a station.';
  },
});

ok('a denial in the wrong language is rewritten once', calls.length === 2);
ok('both calls share the career and the english rules', calls.every(user => user.includes('Edenred') && user.includes('English only')));
ok('the kept answer is the rewrite', /Edenred/.test(written.answer) && !/Je n'ai pas/.test(written.answer));
