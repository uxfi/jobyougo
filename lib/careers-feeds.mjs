// Public no-auth careers feeds fetched without a browser. One entry per ATS:
//   match(company) -> truthy when the company's careers_url (or pin) is that ATS
//   fetch(company) -> { source, jobs, partial? }  (throws on a real fetch error)
import { fetchManatalJobs, isManatalUrl } from './manatal-careers.mjs';
import { fetchPersonioJobs, isPersonioUrl } from './personio-careers.mjs';

export const CAREERS_FEEDS = [
  { id: 'manatal', match: c => isManatalUrl(c?.careers_url), fetch: c => fetchManatalJobs(c.careers_url) },
  {
    id: 'personio',
    match: c => isPersonioUrl(c?.careers_url, { slug: typeof c?.personio === 'string' ? c.personio : '' }),
    fetch: c => fetchPersonioJobs(c.careers_url, { slug: typeof c?.personio === 'string' ? c.personio : '', companyName: c.name || '' }),
  },
];

export function careersFeedFor(company = {}) {
  return CAREERS_FEEDS.find(feed => feed.match(company)) || null;
}

export const hasCareersFeed = company => careersFeedFor(company) !== null;