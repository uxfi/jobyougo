// One-off sample of the application email chain on a FIXTURE posting (not a real ad).
// Usage: node scripts/sample-application-email.mjs [out.json]
import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';
import { chat, MODELS } from '../lib/openrouter.mjs';
import { compactCv } from '../lib/prompt-budget.mjs';
import { generateApplicationEmail, formatApplicationEmail } from '../lib/application-email.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = process.env.EMAIL_SAMPLE_MODEL || MODELS.CLAUDE_HAIKU;
const JOB = `Product Designer
555GROUP PTE. LTD. (Singapore), remote-friendly.
FIXTURE posting written for testing, not a real advertisement.

About the role
We are building an AI-assisted platform used by operations teams. You will own the design of core workflows, from research to shipped interfaces, working daily with a product manager and engineers.

What you will do
- Run user research and interviews with operations users and turn findings into product decisions.
- Design end-to-end flows for complex, data-heavy screens.
- Maintain and extend our design system.
- Prototype quickly, including with AI tools, and hand off to engineering.

What we are looking for
- 5+ years of product design experience, with SaaS or enterprise products.
- Strong user research and interviewing skills.
- Experience with design systems.
- Comfort working with AI tools and with engineers.
Contract or permanent, remote.`;
const [cv, profileYaml, profileContext, custom] = await Promise.all([
  readFile(join(ROOT, 'cv.md'), 'utf-8'),
  readFile(join(ROOT, 'config/profile.yml'), 'utf-8'),
  readFile(join(ROOT, 'modes/_profile.md'), 'utf-8').catch(() => ''),
  readFile(join(ROOT, 'modes/_custom.md'), 'utf-8').catch(() => ''),
]);
const profileData = yamlLoad(profileYaml) || {};
const draft = await generateApplicationEmail({
  chat, model, cv, compactedCv: compactCv(cv, 12000), profileData, profileContext, custom,
  jobUrl: '', jobText: JOB, language: 'auto', roleHint: 'Product Designer', companyHint: '555GROUP PTE. LTD.',
  log: m => console.error('[log]', m),
});
console.log('MODEL', model);
console.log(JSON.stringify(draft, null, 2));
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(draft, null, 2));
