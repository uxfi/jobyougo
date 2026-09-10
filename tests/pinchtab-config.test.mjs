import { pinchtabSolveSucceeded, resolvePinchtabConfigPath } from '../lib/pinchtab.mjs';
import { pass, fail } from './helpers.mjs';

const cases = [
  [
    'PINCHTAB_CONFIG prioritaire',
    { PINCHTAB_CONFIG: 'D:\\custom\\pinchtab.json', HOME: 'C:\\home', USERPROFILE: 'C:\\user' },
    'D:\\custom\\pinchtab.json',
  ],
  [
    'HOME utilise quand present',
    { HOME: 'C:\\home', USERPROFILE: 'C:\\user' },
    'C:\\home\\.pinchtab\\config.json',
  ],
  [
    'USERPROFILE utilise sous Windows sans HOME',
    { USERPROFILE: 'C:\\Users\\PC' },
    'C:\\Users\\PC\\.pinchtab\\config.json',
  ],
  [
    'homedir en dernier recours',
    {},
    'C:\\fallback\\.pinchtab\\config.json',
  ],
];

for (const [name, env, expected] of cases) {
  const actual = resolvePinchtabConfigPath(env, 'C:\\fallback');
  if (actual === expected) {
    pass(name);
  } else {
    fail(`${name}: attendu ${expected}, recu ${actual}`);
  }
}

const solveCases = [
  ['challenge resolu', { solved: true, attempts: 2 }, true],
  ['aucun challenge detecte', { solved: true, attempts: 0 }, true],
  ['echec solveur', { solved: false, attempts: 6 }, false],
  ['reponse absente', null, false],
];
for (const [name, result, expected] of solveCases) {
  const actual = pinchtabSolveSucceeded(result);
  if (actual === expected) {
    pass(name);
  } else {
    fail(`${name}: attendu ${expected}, recu ${actual}`);
  }
}
