import { fileURLToPath } from 'node:url';
import { loadProviders } from '../providers/_registry.mjs';
import { makeHttpCtx } from '../providers/_http.mjs';

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
  return jobs.map(job => ({
    ...job,
    publishedAt: job.postedAt ?? job.publishedAt ?? '',
    remoteEvidence: job.remoteEvidence || job.location || '',
  }));
}
