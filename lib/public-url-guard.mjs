/**
 * Egress guard for a link a user typed (an offer URL): it is read by the
 * server, so it must never reach localhost, the LAN or a cloud metadata
 * endpoint (169.254.169.254), directly or through a redirect.
 *
 * - assertPublicHttpUrl: http(s) only, an IP literal or every address the name
 *   resolves to must be public (providers/_ip-guard.mjs says what public is).
 * - fetchPublicUrl: fetch that follows redirects by hand and vets every hop,
 *   inside the provider-fetch context so the patched dns.lookup also checks the
 *   address that is really dialled (a name answering public, then private).
 * - isPublicHttpUrl: the same verdict as a boolean, for the page a browser
 *   landed on after its own redirects.
 *
 * The finder's page reader (createPageFetcher) gets the same protection from
 * providers/_http.mjs; the offer reader in ui/server.mjs used a bare fetch.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import '../providers/_dns-cache.mjs';
import { isBlockedAddress, blockedAddressError, providerFetchContext } from '../providers/_ip-guard.mjs';

// The code blockedAddressError carries: a verdict about one URL, not a network failure.
export const BLOCKED_URL_CODE = 'ECAREEROPS_BLOCKED_ADDRESS';

// Names that only exist inside a network (a single label is one too).
const INTERNAL_NAME_RE = /\.(?:local|localhost|localdomain|internal|lan|home|corp|intranet|test|invalid|arpa)$/i;

export function isBlockedUrlError(err) {
  return err?.code === BLOCKED_URL_CODE;
}

function refusal(message, props = {}) {
  return Object.assign(new Error(message), { code: BLOCKED_URL_CODE, ...props });
}

/**
 * The parsed URL when it is http(s) at a public address; throws otherwise.
 * A refusal carries BLOCKED_URL_CODE; a DNS failure is thrown as it is (the
 * check fails closed, and the reader would have failed on that host too).
 * `lookup` replaces dns.promises.lookup in tests.
 */
export async function assertPublicHttpUrl(input, { lookup = dnsLookup } = {}) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch { throw refusal('Not a valid URL'); }
  if (!/^https?:$/.test(url.protocol)) throw refusal(`Refusing a ${url.protocol} URL`);
  // The URL parser has already turned 2130706433 and 0x7f.1 into 127.0.0.1.
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw blockedAddressError(host, host);
    return url;
  }
  if (!host.includes('.') || INTERNAL_NAME_RE.test(host)) throw refusal(`Refusing ${host}: not a public host name`, { hostname: host });
  const answers = await lookup(host, { all: true });
  const addresses = (Array.isArray(answers) ? answers : [answers]).map(answer => answer?.address ?? answer);
  if (!addresses.length) throw blockedAddressError(host, '');
  // One private answer among public ones is enough to refuse: the connector may pick it.
  const bad = addresses.find(address => isBlockedAddress(address));
  if (bad !== undefined) throw blockedAddressError(host, bad);
  return url;
}

/** assertPublicHttpUrl as a verdict. */
export async function isPublicHttpUrl(input, options) {
  try {
    await assertPublicHttpUrl(input, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * fetch(input, init) with every hop vetted: the first URL and each redirect
 * target must pass assertPublicHttpUrl before anything connects. Returns the
 * final Response, body unread, like fetch (a 404 is a response, not an error).
 */
export async function fetchPublicUrl(input, { fetchImpl = fetch, lookup, maxRedirects = 5, ...init } = {}) {
  let target = String(input || '').trim();
  for (let hop = 0; ; hop += 1) {
    const url = await assertPublicHttpUrl(target, { lookup });
    const response = await providerFetchContext.run({ url: url.href }, () => fetchImpl(url.href, { ...init, redirect: 'manual' }));
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) return response;
    await response.body?.cancel().catch(() => {});
    if (hop >= maxRedirects) throw new Error(`Too many redirects (${maxRedirects}) from ${input}`);
    try { target = new URL(location, url).href; } catch { throw refusal(`Redirect to an invalid URL (${String(location).slice(0, 80)})`); }
  }
}
