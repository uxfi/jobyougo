// tests/scan-listing-gate.test.mjs — web-search listing/profile pages never reach Jev.
// Cases are real results of the 2026-10-02 scan, where such pages took 48 of
// the 120 Jev slots.
import { listingPageReason, evaluateCandidate } from '../lib/scan-decision.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nScanner — listing pages are not postings');

const listings = [
  ['https://wellfound.com/role/r/product-designer', 'Remote Product Designer Jobs in 2027 | Wellfound'],
  ['https://wellfound.com/role/l/ux-designer/europe', 'UX Designer (User Experience) Jobs in Europe - 2027 | Wellfound'],
  ['https://wellfound.com/job-collections/15-trending-startups-hiring-remote-ux-designers', '20 Top Startups Hiring Remote UX/UI Designers | Wellfound'],
  ['https://remotive.com/remote-jobs/o-ux-designer', 'ux designer Remote Jobs (597 openings) | Remotive.com'],
  ['https://the-dots.com/users/andrea-flamini-193546', 'Andrea Flamini Director, Product Design | The Dots'],
  ['https://skima.ai/resources/job-descriptions/product-lead-job-description', 'Product Lead Job Description Template: Duties, Skills & More'],
  ['https://techjobsforgood.com/job-title/senior-product-designer/', 'Senior Product Designer Jobs | Tech Jobs for Good'],
  ['https://sg.indeed.com/q-ai-product-manager-l-remote-jobs.html', '13 Ai Product Manager Jobs, Employment in Remote May 12, 2026 | Indeed'],
  ['https://www.linkedin.com/jobs/ai-product-manager-jobs-worldwide', 'Ai Product Manager Jobs in Worldwide (33000+ Open Roles)'],
  ['https://www.linkedin.com/jobs/product-manager-jobs-european-union', '42,000+ Product Manager jobs in European Union'],
  ['https://builtin.com/jobs/remote/san-diego/product', 'Best Remote Product Manager Jobs in San Diego, CA 2026 | Built In'],
  // URL alone would pass: the search-result title gives it away.
  ['https://www.coroflot.com/design-jobs/UXUI-Designer', 'UX/UI Designer Jobs, Employment Opportunities | Coroflot.com'],
  ['https://uiuxjobsboard.com/', 'UI/UX Designer Jobs'],
  ['https://www.workingnomads.com/remote-ux-designer-jobs-europe', 'Remote UX Designer Jobs in Europe | Working Nomads'],
  ['https://www.naukri.com/ui-ux-designer-jobs-in-remote-india-36', 'Page 36 - Ui Ux Designer Jobs In Remote-india'],
  ['https://authenticjobs.com/14-ui-ux-design-resume-tips-hiring-managers-jobs/', '14 UI/UX Design Resume Tips to Impress Hiring Managers - Authentic Jobs'],
];
for (const [url, title] of listings) {
  const reason = listingPageReason({ url, title });
  if (reason) pass(`listing rejected: ${title}`);
  else fail(`expected a listing page: ${url} | ${title}`);
}

const postings = [
  ['https://wellfound.com/jobs/3124346-ux-ui-designer-remote-europe', 'UX/UI Designer - Remote Europe at Reedsy • Spain • France • United Kingdom • Remote (Work from Home) | Wellfound'],
  ['https://remotive.com/remote-jobs/software-development/senior-independent-ai-engineer-architect-1919266', 'Senior Independent AI Engineer / Architect'],
  ['https://the-dots.com/jobs/design-lead-freelance-240107', 'Design Lead - Freelance Job at AKQA | The Dots'],
  ['https://www.behance.net/joblist/329375/UIUX-Designer', 'UI/UX Designer at smarter.codes :: Behance'],
  ['https://www.linkedin.com/jobs/view/4012345678', 'Senior Product Designer'],
  ['https://www.welcometothejungle.com/en/companies/dropbox/jobs/staff-product-designer', 'Staff Product Designer – Dropbox – Permanent contract – Fully-remote'],
  ['https://jobs.ashbyhq.com/acme/1234', 'Senior Product Designer, Jobs Marketplace'],
  // Board names in the title of a real posting (found replaying scan history).
  ['https://authenticjobs.com/job/3645/postlight-lead-product-designer/', 'Lead Product Designer - Authentic Jobs'],
  ['https://techjobsforgood.com/jobs/34195/', 'Senior Product Manager at NYC Office of Technology and Innovation | Tech Jobs for Good'],
  ['https://remotive.com/remote/jobs/design/ux-designer-3789495', '[Hiring] UX Designer @NearSource - Remote jobs'],
  ['https://remotive.com/remote-jobs/design/ui-ux-designer-2046873', '[Hiring] UI/UX Designer @Jobs for Humanity'],
];
for (const [url, title] of postings) {
  const reason = listingPageReason({ url, title });
  if (!reason) pass(`posting kept: ${title}`);
  else fail(`posting wrongly taken for a listing (${reason}): ${url} | ${title}`);
}

const decision = evaluateCandidate(
  { url: 'https://wellfound.com/role/r/product-designer', title: 'Remote Product Designer Jobs in 2027 | Wellfound', location: 'Remote - Europe' },
  { title_filter: { positive: ['Product Designer'] }, remote_filter: {} },
);
if (decision.disposition === 'reject' && decision.reasonCode === 'listing') pass('evaluateCandidate rejects a listing with reasonCode "listing"');
else fail(`expected reject/listing, got ${decision.disposition}/${decision.reasonCode}`);
