import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import {
  assembleUiPrompt,
  clipJd,
  clipReportForWriting,
  candidateFacts,
  compactCv,
  compactPipeline,
  compactProfile,
  compactTracker,
} from '../lib/prompt-budget.mjs';

function ok(label, cond) {
  if (cond) pass(label);
  else fail(label);
}

const cv = readFileSync(join(ROOT, 'cv.md'), 'utf8');
const profile = readFileSync(join(ROOT, 'modes/_profile.md'), 'utf8');
const shared = readFileSync(join(ROOT, 'modes/_shared.md'), 'utf8');
const oferta = readFileSync(join(ROOT, 'modes/oferta.md'), 'utf8');

const leanCv = compactCv(cv);
ok('compact CV is shorter than the source', leanCv.length < cv.length * 0.6);
ok('compact CV keeps OneAsset and LVMH', /OneAsset/.test(leanCv) && /LVMH/.test(leanCv));
ok('compact CV keeps the skills block', /Prompt engineering/.test(leanCv));

const leanProfile = compactProfile(profile);
ok('profile extract keeps the location policy', /Location Policy/i.test(leanProfile));
ok('profile extract drops the writing-style section', !/^## Writing Style/m.test(leanProfile));

const longJd = `${'Requirements\n'.repeat(400)}hybrid 3 days/week in London office. Salary 80k.`;
const clipped = clipJd(longJd, 2500);
ok('long JD keeps a tail that carries attendance language', /hybrid 3 days/.test(clipped));
ok('long JD head is capped', clipped.length < longJd.length);

const report = `# Evaluation\n\n## A) Résumé du rôle\nRemote product design.\n\n## Job Description (archived verbatim)\n${'lorem '.repeat(800)}\n\n## B) Match CV\nFigma.\n`;
const leanReport = clipReportForWriting(report, 2000);
ok('writing context drops the archived JD', !/lorem/.test(leanReport));
ok('writing context keeps the match section', /Match CV/.test(leanReport));

const assembled = assembleUiPrompt({
  mode: 'pipeline',
  shared,
  modeFile: oferta,
  cv,
  profile,
  profileConfig: 'spend_tier: standard\n',
  criteria: '### Hard Matching Rules\n- Full remote only: yes',
  articleDigest: 'digest should stay out of eval',
  prefetch: '## Job Description\nSenior Product Designer, fully remote.',
});
ok('eval system is the short contract, not oferta.md', assembled.systemPrompt.includes('## B) Match CV') && !assembled.systemPrompt.includes('Block E'));
ok('eval user prompt does not include the digest', !assembled.parts.join('\n').includes('digest should stay out'));
ok('eval prompt is under half the raw context', assembled.afterChars < assembled.beforeChars / 2);
const evalText = assembled.parts.join('\n');
ok('eval ends with confirmed CV facts', /Faits confirmés du CV/.test(evalText) && /Figma \(10\/10\)/.test(evalText) && /12/.test(candidateFacts(cv)));
ok('eval profile omits form-answer rules', !/Form answers/.test(evalText) && !/Evidence order/.test(evalText));

const question = assembleUiPrompt({
  mode: 'question',
  shared,
  modeFile: 'question mode playbook '.repeat(200),
  cv,
  profile,
  criteria: 'remote',
  prefetch: report,
});
ok('question system is not _shared.md', question.systemPrompt.length < 500);
ok('question prefetch drops the archived JD', !question.parts.join('\n').includes('lorem'));
ok('question profile still carries form-answer rules', /Form answers|Evidence order/i.test(question.parts.join('\n')));

const tracker = [
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-09-01 | Acme | Designer | 4.2/5 | Applied | ❌ | [1](reports/1.md) | long note |',
  '| 2 | 2026-09-02 | Other | PM | 3.1/5 | Evaluated | ❌ | [2](reports/2.md) | |',
].join('\n');
const leanTracker = compactTracker(tracker);
ok('tracker keeps the live application and drops the report link', /Acme/.test(leanTracker) && !/reports\/1/.test(leanTracker));
ok('tracker counts the evaluated row without listing it', /Evaluated 1/.test(leanTracker) && !/Other/.test(leanTracker));

const inbox = `- [ ] https://jobs.example/1 | Sierra | Engineer | Singapore · London · Berlin · Paris | posted: 2026-01-01 | location: unclear — no signal\n`.repeat(30);
const leanInbox = compactPipeline(inbox, 5);
ok('pipeline inbox keeps a short extract and a remainder count', /URL en attente/.test(leanInbox) && /25 autres/.test(leanInbox) && !/Singapore · London/.test(leanInbox));

const pdf = assembleUiPrompt({
  mode: 'pdf',
  shared,
  modeFile: oferta,
  cv,
  profile,
  criteria: 'remote',
});
ok('pdf system is the marker contract', pdf.systemPrompt.includes('### SUMMARY_TEXT') && !pdf.systemPrompt.includes('Block E'));
ok('pdf uses the compact CV', pdf.parts.join('\n').includes('Prompt engineering') && pdf.afterChars < cv.length + 8000);
