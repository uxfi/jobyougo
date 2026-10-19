// agence-checkout.mjs — online ordering for the agency page (/agence, "v2 studio").
//
// The page's order form (ui/portfolio/agence-checkout.js) sends a package, a track,
// add-ons and a short brief. Two modes, chosen by the environment:
//   - request (default): no payment here. The form drafts an email and the founder
//     replies with the confirmed scope and a payment link. The server routes answer
//     503 so nothing can be charged by accident.
//   - stripe: AGENCE_PAYMENTS=stripe, STRIPE_SECRET_KEY and AGENCE_TERMS_URL are all
//     set. The server prices the order itself from the offers JSON (never from the
//     client), opens a Stripe Checkout Session over the REST API (no SDK) and
//     verifies the webhook signature before trusting a payment.
// Everything here is pure or takes its fetch/env as arguments, so it is testable
// without a Stripe account (tests/agence-checkout.test.mjs).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { matchLangTag } from './agence-i18n.mjs';

export const STRIPE_API = 'https://api.stripe.com/v1';
const MAX_BRIEF = 1000;
const MAX_FIELD = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Payment mode from the environment. Card payments need three things at once:
 * the switch, a secret key and published terms of sale. Anything missing → request.
 */
export function checkoutConfig(env = process.env) {
  const wanted = String(env.AGENCE_PAYMENTS || '').trim().toLowerCase() === 'stripe';
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  const termsUrl = safeHttpUrl(env.AGENCE_TERMS_URL);
  const ready = wanted && /^(sk|rk)_(test|live)_/.test(key) && !!termsUrl;
  return {
    mode: ready ? 'stripe' : 'request',
    currency: 'usd',
    termsUrl: ready ? termsUrl : '',
    livemode: ready && /_live_/.test(key),
    automaticTax: ready && String(env.AGENCE_STRIPE_TAX || '').trim() === '1',
  };
}

/** What the page may know about the mode (no keys, no flags beyond what it shows). */
export function publicCheckoutConfig(config) {
  return { mode: config.mode, currency: config.currency, termsUrl: config.termsUrl || '' };
}

function safeHttpUrl(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

function clean(value, max = MAX_FIELD) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

function pickLang(obj, lang) {
  if (!obj || typeof obj !== 'object') return String(obj == null ? '' : obj);
  return obj[lang] != null ? String(obj[lang]) : String(obj.en == null ? '' : obj.en);
}

/**
 * Price an order from the offers JSON (the same block the page and the chatbot read).
 * The client only says WHAT it wants; amounts always come from here.
 * → { ok: true, order } or { ok: false, error } with a stable error code.
 */
export function priceOrder(offersJson, input, lang = 'en') {
  const offers = offersJson && Array.isArray(offersJson.offers) ? offersJson.offers : [];
  const addons = offersJson && Array.isArray(offersJson.addons) ? offersJson.addons : [];
  const req = input && typeof input === 'object' ? input : {};
  const offer = offers.find((o) => o && o.id === req.offer);
  if (!offer) return { ok: false, error: 'unknown_offer' };
  if (offer.open === false) return { ok: false, error: 'offer_not_open' };
  if (offer.checkout !== 'card') return { ok: false, error: 'offer_not_orderable' };
  const unit = Number(offer.price);
  if (!Number.isInteger(unit) || unit <= 0) return { ok: false, error: 'bad_price' };

  let track = null;
  if (Array.isArray(offer.tracks) && offer.tracks.length) {
    track = offer.tracks.find((t) => t && t.id === req.track) || null;
    if (!track) return { ok: false, error: 'unknown_track' };
  }

  const lines = [{ kind: 'offer', id: offer.id, name: pickLang(offer.name, lang) + (track ? ' · ' + pickLang(track.name, lang) : ''), qty: 1, unit, amount: unit }];
  const wanted = Array.isArray(req.addons) ? req.addons : [];
  const seen = new Set();
  for (const item of wanted) {
    const id = item && typeof item.id === 'string' ? item.id : '';
    const qty = Number(item && item.qty);
    if (!id || !Number.isInteger(qty) || qty < 0) return { ok: false, error: 'bad_addon' };
    if (qty === 0) continue;
    if (seen.has(id)) return { ok: false, error: 'duplicate_addon' };
    seen.add(id);
    const addon = addons.find((a) => a && a.id === id);
    if (!addon) return { ok: false, error: 'unknown_addon' };
    if (addon.open === false) return { ok: false, error: 'addon_not_open' };
    if (!Array.isArray(addon.for) || !addon.for.includes(offer.id)) return { ok: false, error: 'addon_not_for_offer' };
    const max = Number.isInteger(addon.max) && addon.max > 0 ? addon.max : 1;
    if (qty > max) return { ok: false, error: 'addon_qty' };
    const price = Number(addon.price);
    if (!Number.isInteger(price) || price <= 0) return { ok: false, error: 'bad_price' };
    lines.push({ kind: 'addon', id, name: pickLang(addon.name, lang), qty, unit: price, amount: price * qty });
  }
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return {
    ok: true,
    order: {
      offer: offer.id,
      track: track ? track.id : '',
      lines,
      total,
      currency: String(offersJson.currency || 'USD').toLowerCase(),
      delivery: pickLang(offer.delivery, lang),
    },
  };
}

/** The buyer and the brief. → { ok, customer } or { ok: false, error }.
 * stage 'payment' (default) needs the terms box and, for an individual, the start consent; stage 'request'
 * (an order sent by email, nothing paid) needs neither: the terms come with the invoice. */
export function validateCustomer(input, { stage = 'payment' } = {}) {
  const paying = stage !== 'request';
  const c = input && typeof input === 'object' ? input : {};
  const name = clean(c.name, 120);
  const email = clean(c.email, 200).toLowerCase();
  if (!name) return { ok: false, error: 'name_required' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'email_invalid' };
  const kind = c.kind === 'individual' ? 'individual' : 'business';
  const brief = clean(c.brief, MAX_BRIEF);
  if (brief.length < 10) return { ok: false, error: 'brief_required' };
  const link = clean(c.link, 300);
  if (link && !safeHttpUrl(link)) return { ok: false, error: 'link_invalid' };
  const consent = c.consent && typeof c.consent === 'object' ? c.consent : {};
  if (consent.scope !== true) return { ok: false, error: 'scope_not_confirmed' };
  if (paying && consent.terms !== true) return { ok: false, error: 'terms_not_accepted' };
  // An individual buying a service online may withdraw for 14 days in the EU, unless they ask
  // for the work to start before that and accept that the right ends once it is fully delivered.
  if (paying && kind === 'individual' && consent.startNow !== true) return { ok: false, error: 'start_consent_required' };
  return {
    ok: true,
    customer: {
      name,
      email,
      kind,
      company: kind === 'business' ? clean(c.company, 160) : '',
      country: clean(c.country, 80),
      vat: kind === 'business' ? clean(c.vat, 40).replace(/\s+/g, '') : '',
      link,
      brief,
      startNow: consent.startNow === true,
    },
  };
}

/** Stripe metadata values are capped at 500 characters: split the brief across keys. */
function splitForMetadata(text, size = 490, parts = 3) {
  const out = [];
  for (let i = 0; i < parts && i * size < text.length; i++) out.push(text.slice(i * size, (i + 1) * size));
  return out;
}

/**
 * Form body for POST /v1/checkout/sessions. One line item per order line (price_data, so
 * no Stripe product setup is needed), an invoice for one-off payments, the order in metadata.
 */
/** Stripe Checkout's page language for a visitor language (lib/agence-i18n.mjs codes); 'auto' when Stripe has none. */
const STRIPE_LOCALES = new Set(['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'vi', 'zh', 'zh-TW']);
export function stripeLocale(code) {
  const c = matchLangTag(code) || 'en';
  if (c === 'pt-PT') return 'pt';
  if (c === 'zh-Hans') return 'zh';
  if (c === 'zh-Hant') return 'zh-TW';
  return STRIPE_LOCALES.has(c) ? c : 'auto';
}

export function stripeSessionParams(order, customer, { origin, lang = 'en', locale = '', automaticTax = false } = {}) {
  const base = String(origin || '').replace(/\/+$/, '');
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('success_url', `${base}/agence/thanks?session_id={CHECKOUT_SESSION_ID}`);
  p.set('cancel_url', `${base}/agence/pricing?order=cancelled`);
  p.set('customer_email', customer.email);
  p.set('locale', stripeLocale(locale || lang));
  p.set('billing_address_collection', 'required');
  p.set('invoice_creation[enabled]', 'true');
  p.set('invoice_creation[invoice_data][description]', `v2 studio · ${order.lines[0].name}`);
  if (customer.kind === 'business') p.set('tax_id_collection[enabled]', 'true');
  if (automaticTax) p.set('automatic_tax[enabled]', 'true');
  order.lines.forEach((line, i) => {
    p.set(`line_items[${i}][quantity]`, String(line.qty));
    p.set(`line_items[${i}][price_data][currency]`, order.currency);
    p.set(`line_items[${i}][price_data][unit_amount]`, String(line.unit * 100));
    p.set(`line_items[${i}][price_data][product_data][name]`, line.name);
    if (automaticTax) p.set(`line_items[${i}][price_data][tax_behavior]`, 'exclusive');
  });
  const meta = {
    offer: order.offer,
    track: order.track,
    addons: order.lines.filter((l) => l.kind === 'addon').map((l) => `${l.id}x${l.qty}`).join(','),
    total: String(order.total),
    name: customer.name,
    kind: customer.kind,
    company: customer.company,
    country: customer.country,
    vat: customer.vat,
    link: customer.link,
    start_now: customer.startNow ? 'yes' : 'no',
    lang: lang === 'fr' ? 'fr' : 'en',
  };
  splitForMetadata(customer.brief).forEach((part, i) => { meta[`brief_${i + 1}`] = part; });
  for (const [k, v] of Object.entries(meta)) {
    if (v) {
      p.set(`metadata[${k}]`, String(v).slice(0, 500));
      p.set(`payment_intent_data[metadata][${k}]`, String(v).slice(0, 500));
    }
  }
  return p;
}

async function stripeCall(path, { method = 'GET', body, key, fetchImpl = fetch, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${key}` };
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetchImpl(`${STRIPE_API}${path}`, { method, headers, body: body ? body.toString() : undefined, signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || `Stripe answered ${res.status}`);
    err.statusCode = 502;
    err.stripeStatus = res.status;
    throw err;
  }
  return data;
}

/** → { id, url } of a new Checkout Session. */
export async function createCheckoutSession(params, key, { fetchImpl, idempotencyKey } = {}) {
  const s = await stripeCall('/checkout/sessions', { method: 'POST', body: params, key, fetchImpl, idempotencyKey });
  if (!s || typeof s.url !== 'string' || !/^https:\/\/checkout\.stripe\.com\//.test(s.url)) {
    const err = new Error('Stripe returned no checkout URL');
    err.statusCode = 502;
    throw err;
  }
  return { id: s.id, url: s.url };
}

/** What the thanks page shows about a session: never the whole Stripe object. */
export function sessionSummary(s) {
  const m = (s && s.metadata) || {};
  return {
    paid: s && s.payment_status === 'paid',
    status: String((s && s.status) || ''),
    offer: String(m.offer || ''),
    track: String(m.track || ''),
    addons: String(m.addons || ''),
    total: Number.isFinite(s && s.amount_total) ? s.amount_total / 100 : null,
    currency: String((s && s.currency) || 'usd'),
    email: String((s && s.customer_details && s.customer_details.email) || (s && s.customer_email) || ''),
  };
}

export async function retrieveCheckoutSession(id, key, { fetchImpl } = {}) {
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(String(id || ''))) {
    const err = new Error('Unknown session');
    err.statusCode = 404;
    throw err;
  }
  return sessionSummary(await stripeCall(`/checkout/sessions/${encodeURIComponent(id)}`, { key, fetchImpl }));
}

/**
 * Stripe-Signature check (t=…,v1=…): HMAC-SHA256 of `${t}.${rawBody}` with the endpoint
 * secret, constant-time compare, and a timestamp tolerance against replays.
 */
export function verifyStripeSignature(rawBody, header, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!secret || typeof header !== 'string' || !header) return false;
  const parts = header.split(',').map((x) => x.trim().split('='));
  const t = Number((parts.find(([k]) => k === 't') || [])[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v).filter(Boolean);
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(now / 1000 - t) > toleranceSec) return false;
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest();
  return sigs.some((hex) => {
    if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
    const got = Buffer.from(hex, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** One line per paid order, for the founder's records (no card data ever reaches us). */
export function orderRecordFromEvent(event) {
  const s = event && event.data && event.data.object;
  if (!event || event.type !== 'checkout.session.completed' || !s) return null;
  const m = s.metadata || {};
  const brief = ['brief_1', 'brief_2', 'brief_3'].map((k) => m[k] || '').join('');
  return {
    at: new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    session: s.id,
    paid: s.payment_status === 'paid',
    total: Number.isFinite(s.amount_total) ? s.amount_total / 100 : null,
    currency: s.currency || 'usd',
    email: (s.customer_details && s.customer_details.email) || s.customer_email || '',
    name: m.name || '',
    offer: m.offer || '',
    track: m.track || '',
    addons: m.addons || '',
    kind: m.kind || '',
    company: m.company || '',
    country: m.country || '',
    vat: m.vat || '',
    link: m.link || '',
    startNow: m.start_now === 'yes',
    brief,
  };
}

/** Raw request body (the webhook needs the exact bytes Stripe signed). */
export function readRawBody(req, { limit = 512 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('Request body too large');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Small per-key sliding window (order attempts per IP). */
export function makeRateLimiter({ windowMs = 10 * 60 * 1000, max = 12 } = {}) {
  const hits = new Map();
  return function limited(key, now = Date.now()) {
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) { hits.set(key, list); return true; }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return false;
  };
}

/** The site origin for Stripe's return URLs: AGENCE_PUBLIC_URL, else the request's own host. */
export function publicOrigin(req, env = process.env) {
  const fixed = safeHttpUrl(env.AGENCE_PUBLIC_URL);
  if (fixed) return new URL(fixed).origin;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host && /^[a-z0-9.:-]+$/i.test(host) ? `${proto === 'https' ? 'https' : 'http'}://${host}` : '';
}
