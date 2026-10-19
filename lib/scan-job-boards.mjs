import { fileURLToPath } from 'node:url';
import { loadProviders } from '../providers/_registry.mjs';
import { makeHttpCtx } from '../providers/_http.mjs';
import { cleanFetchUrl } from './fetch-politeness.mjs';

export const jobBoardProviders = await loadProviders(fileURLToPath(new URL('../providers', import.meta.url)));

export function getScanAggregators(config = {}) {
  return [
    ...(config.api_aggregators || []),
    ...(config.job_boards || []).map(entry => ({ ...entry, sourceKind: 'job_board' })),
  ];
}

export async function fetchJobBoard(entry, { providers = jobBoardProviders, ctx = makeHttpCtx() } = {}) {
  const provider = providers.get(entry.provider);
  if (!provider) throw new Error(`Unknown job board provider: ${entry.provider}`);
  const jobs = await provider.fetch(entry, ctx);
  // Boards whose API terms ask for attribution (Remotive, ...) keep the board's own
  // posting URL and name the source on every job.
  const via = provider.attribution?.name || '';
  return jobs.map(job => ({
    ...job,
    url: typeof job.url === 'string' ? cleanFetchUrl(job.url) : job.url,
    publishedAt: job.postedAt ?? job.publishedAt ?? '',
    remoteEvidence: job.remoteEvidence || job.location || '',
    ...(via && !job.via ? { via } : {}),
  }));
}

// Same as fetchJobBoard, honouring a per-source minimum interval (see job-board-throttle.mjs).
// -> { skipped: true, reason } without any request, or { skipped: false, jobs }.
export async function fetchJobBoardPolite(entry, { throttle = null, providers = jobBoardProviders, ctx } = {}) {
  const provider = providers.get(entry.provider);
  const verdict = throttle && provider ? throttle.check(entry, provider) : { skip: false };
  if (verdict.skip) return { skipped: true, reason: verdict.reason, jobs: [] };
  const jobs = await fetchJobBoard(entry, { providers, ...(ctx ? { ctx } : {}) });
  throttle?.record(entry);
  return { skipped: false, jobs };
}