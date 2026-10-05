import {
  pinchtabSolveSucceeded,
  redactPinchtabOutput,
  resolvePinchtabConfigPath,
  stalePidFileFromOutput,
} from '../lib/pinchtab.mjs';
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

// Sortie reelle de `pinchtab server --background -y` quand server.pid pointe
// vers un PID recycle par Windows (ici M365Copilot) : le demarrage est refuse.
const stalePidFile = 'C:\\Users\\PC\\AppData\\Roaming\\pinchtab\\server.pid';
const staleCases = [
  [
    'pid perime detecte dans la sortie de demarrage',
    'YOLO mode: guards down for this run only (config file unchanged)\n'
      + `background PID file at ${stalePidFile} points to a live process that cannot be verified: read process command for pid 25368: exit status 1`,
    stalePidFile,
  ],
  ['demarrage normal sans pid perime', '{\n  "pid": 31600,\n  "url": "http://127.0.0.1:9867"\n}', ''],
  ['sortie vide', '', ''],
];
for (const [name, output, expected] of staleCases) {
  const actual = stalePidFileFromOutput(output);
  if (actual === expected) {
    pass(name);
  } else {
    fail(`${name}: attendu ${expected}, recu ${actual}`);
  }
}

const secret = 'abcdef0123456789secret';
const redactCases = [
  ['token masque dans le JSON de demarrage', `{\n  "pid": 31600,\n  "token": "${secret}",\n  "url": "http://127.0.0.1:9867"\n}`],
  ['token masque en format cle=valeur', `token=${secret}`],
];
for (const [name, output] of redactCases) {
  const actual = redactPinchtabOutput(output);
  if (!actual.includes(secret) && actual.includes('<redacted>')) {
    pass(name);
  } else {
    fail(`${name}: token visible dans ${actual}`);
  }
}
