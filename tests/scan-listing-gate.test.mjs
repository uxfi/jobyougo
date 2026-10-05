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
  ['https://arc.dev/hire-designers/ui-ux-designers', 'The Best Freelance UI/UX Designers for Hire in Sep 2026'],
  ['https://arc.dev/hire-product-managers', 'Hire Top Remote Freelance Product Managers in Oct 2026 - Arc'],
  ['https://arc.dev/remote-jobs/product-ux-design', 'Remote product UI/UX designer Jobs (September 2026) - Arc'],
  ['https://arc.dev/remote-jobs?jobRoles=product_manager', 'Remote Product Manager Jobs'],
  ['https://www.toptal.com/designers/product-design', '11 Best Freelance Product Designers for Hire in October 2026'],
  ['https://www.toptal.com/freelance-jobs/product-managers/agile', 'Remote Freelance Agile Product Manager Jobs [Aug 2026]'],
  ['https://www.yunojuno.com/sub-disciplines/product-manager', 'Top Product Managers for Hire'],
  ['https://use.worksome.com/profile/47679', 'Senior Ux Designer & Product designer - freelancer on Worksome'],
  ['https://www.lehibou.com/freelance/ui-design/62531', 'Découvrez mon profil freelance chez LeHibou - Senior UX/UI Designer'],
  ['https://www.lehibou.com/en/freelance/methodes-et-process/product-manager', 'Mission freelance Product Manager'],
  ['https://www.lehibou.com/recherche?keyword=Product%20Manager', 'Freelance Product Manager - Tous les experts disponibles'],
  ['https://www.kicklox.com/product-owner-freelance/', 'Product Owner freelance : Accédez à + de 80 000 talents sur Kicklox'],
  ['https://plateforme.freelance.com/job/product-designer', 'Need a freelance Product designer? Freelance.com'],
  ['https://plateforme.freelance.com/metier/ux-designer', 'Besoin d’un UX Designer freelance ? Freelance.com'],
  ['https://magazine.workingnotworking.com/magazine/hire-product-designer-portfolios-examples', 'Ready to Hire a Product Designer? Read Our Breakdown of 12 Awesome Product Designer Portfolios'],
  ['https://workingnotworking.com/search/everywhere/members/ui-designer', 'UI Designers – Working Not Working'],
  ['https://cdn1.workingnotworking.com/54631-samantha', 'Product Designer / Samantha Chiu – Working Not Working'],
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
  ['https://arc.dev/remote-jobs/j/redirect/p5ty9auo6u', 'Senior Product Designer'],
  ['https://workingnotworking.com/unjobboard/4687', 'Senior Product Designer'],
  ['https://www.404works.com/fr/project/mission-freelance-product-designer-e-commerce-sr-ux-transverse', 'Mission freelance : Product Designer e-commerce sr - UX transverse'],
  ['https://www.twine.net/projects/b8vbb0-uiux-ui-designer-remote-job', 'UI/UX freelance job'],
  ['https://agentic-engineering-jobs.com/jobs/tiger-tracks-founding-ai-engineer-contract-to-hire-LBGg5p', 'Founding AI Engineer (Contract-to-Hire)'],
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
