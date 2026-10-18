// Tests for lib/agence-checkout.mjs: payment mode switch, server-side pricing,
// buyer validation, Stripe session params and webhook signatures. No network:
// Stripe calls take a fetch stub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractOffersJson } from '../lib/agence-site.mjs';
import {
  checkoutConfig,
  createCheckoutSession,
  makeRateLimiter,
  orderRecordFromEvent,
  priceOrder,
  publicCheckoutConfig,
  publicOrigin,
  retrieveCheckoutSession,
  stripeSessionParams,
  validateCustomer,
  verifyStripeSignature,
} from '../lib/agence-checkout.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OFFERS = extractOffersJson(readFileSync(join(ROOT, 'ui', 'portfolio', 'agence-data.js'), 'utf8'));

const buyer = (over = {}) => ({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  kind: 'business',
  company: 'Analytical Ltd',
  country: 'France',
  vat: 'FR 12 345',
  link: 'https://example.com',
  brief: 'Our pricing page loses people before the signup step.',
  consent: { scope: true, terms: true },
  ...over,
});

test('the offers block the page ships is valid and orderable', () => {
  assert.ok(OFFERS && Array.isArray(OFFERS.offers));
  const card = OFFERS.offers.filter((o) => o.checkout === 'card' && o.open !== false).map((o) => o.id);
  assert.deepEqual(card, ['refonte', 'creation']);
  for (const a of OFFERS.addons) assert.ok(Array.isArray(a.for) && a.for.length, `${a.id} says which packages it applies to`);
});

test('payments stay in request mode unless the switch, a key and terms are all set', () => {
  assert.equal(checkoutConfig({}).mode, 'request');
  assert.equal(checkoutConfig({ AGENCE_PAYMENTS: 'stripe', STRIPE_SECRET_KEY: 'sk_test_abc' }).mode, 'request', 'no terms of sale');
  assert.equal(checkoutConfig({ AGENCE_PAYMENTS: 'stripe', AGENCE_TERMS_URL: 'https://x.test/terms' }).mode, 'request', 'no key');
  assert.equal(checkoutConfig({ STRIPE_SECRET_KEY: 'sk_test_abc', AGENCE_TERMS_URL: 'https://x.test/terms' }).mode, 'request', 'switch off');
  assert.equal(checkoutConfig({ AGENCE_PAYMENTS: 'stripe', STRIPE_SECRET_KEY: 'pk_test_abc', AGENCE_TERMS_URL: 'https://x.test/terms' }).mode, 'request', 'a publishable key is not a secret key');
  const on = checkoutConfig({ AGENCE_PAYMENTS: 'Stripe', STRIPE_SECRET_KEY: 'sk_live_abc', AGENCE_TERMS_URL: 'https://x.test/terms', AGENCE_STRIPE_TAX: '1' });
  assert.equal(on.mode, 'stripe');
  assert.equal(on.livemode, true);
  assert.equal(on.automaticTax, true);
  assert.deepEqual(Object.keys(publicCheckoutConfig(on)).sort(), ['currency', 'mode', 'termsUrl'], 'nothing secret reaches the page');
  assert.equal(checkoutConfig({ AGENCE_PAYMENTS: 'stripe', STRIPE_SECRET_KEY: 'sk_test_abc', AGENCE_TERMS_URL: 'javascript:alert(1)' }).mode, 'request');
});

test('the server prices the order from the offers JSON, never from the client', () => {
  const r = priceOrder(OFFERS, { offer: 'creation', track: 'ai', addons: [{ id: 'extra-page', qty: 2 }, { id: 'copy', qty: 0 }], total: 1, price: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.order.total, 590 + 2 * 190);
  assert.equal(r.order.track, 'ai');
  assert.deepEqual(r.order.lines.map((l) => [l.kind, l.qty, l.amount]), [['offer', 1, 590], ['addon', 2, 380]]);
  assert.equal(r.order.currency, 'usd');
  assert.match(r.order.lines[0].name, /Build · AI prototype/);
  assert.match(priceOrder(OFFERS, { offer: 'creation', track: 'landing' }, 'fr').order.lines[0].name, /Création · Landing page/);
  assert.equal(priceOrder(OFFERS, { offer: 'refonte' }).order.total, 390);
});

test('orders the page cannot sell are refused with a stable code', () => {
  const code = (input) => priceOrder(OFFERS, input).error;
  assert.equal(code({ offer: 'nope' }), 'unknown_offer');
  assert.equal(code({ offer: 'accompagnement' }), 'offer_not_open');
  assert.equal(code({ offer: 'custom' }), 'offer_not_orderable');
  assert.equal(code({ offer: 'creation' }), 'unknown_track');
  assert.equal(code({ offer: 'creation', track: 'native-app' }), 'unknown_track');
  assert.equal(code({ offer: 'refonte', addons: [{ id: 'session', qty: 1 }] }), 'addon_not_open');
  assert.equal(code({ offer: 'refonte', addons: [{ id: 'ghost', qty: 1 }] }), 'unknown_addon');
  assert.equal(code({ offer: 'refonte', addons: [{ id: 'extra-page', qty: 99 }] }), 'addon_qty');
  assert.equal(code({ offer: 'refonte', addons: [{ id: 'extra-page', qty: -1 }] }), 'bad_addon');
  assert.equal(code({ offer: 'refonte', addons: [{ id: 'extra-page', qty: 1.5 }] }), 'bad_addon');
  assert.equal(code({ offer: 'refonte', addons: [{ id: 'extra-page', qty: 1 }, { id: 'extra-page', qty: 1 }] }), 'duplicate_addon');
  const notFor = { ...OFFERS, addons: OFFERS.addons.map((a) => (a.id === 'copy' ? { ...a, for: ['creation'] } : a)) };
  assert.equal(priceOrder(notFor, { offer: 'refonte', addons: [{ id: 'copy', qty: 1 }] }).error, 'addon_not_for_offer');
});

test('the buyer needs a name, an email, a brief and the consents', () => {
  const ok = validateCustomer(buyer());
  assert.equal(ok.ok, true);
  assert.equal(ok.customer.vat, 'FR12345');
  assert.equal(validateCustomer(buyer({ name: ' ' })).error, 'name_required');
  assert.equal(validateCustomer(buyer({ email: 'ada@' })).error, 'email_invalid');
  assert.equal(validateCustomer(buyer({ brief: 'short' })).error, 'brief_required');
  assert.equal(validateCustomer(buyer({ link: 'javascript:alert(1)' })).error, 'link_invalid');
  assert.equal(validateCustomer(buyer({ consent: { terms: true } })).error, 'scope_not_confirmed');
  assert.equal(validateCustomer(buyer({ consent: { scope: true } })).error, 'terms_not_accepted');
  // An individual must ask for the work to start inside the withdrawal period.
  assert.equal(validateCustomer(buyer({ kind: 'individual' })).error, 'start_consent_required');
  const person = validateCustomer(buyer({ kind: 'individual', consent: { scope: true, terms: true, startNow: true } }));
  assert.equal(person.ok, true);
  assert.equal(person.customer.company, '', 'no company for an individual');
  assert.equal(validateCustomer(buyer({ brief: 'x'.repeat(5000) })).customer.brief.length, 1000);
});

test('the Stripe session carries the priced lines, the return URLs and the order', () => {
  const order = priceOrder(OFFERS, { offer: 'refonte', addons: [{ id: 'revision', qty: 1 }] }).order;
  const customer = validateCustomer(buyer({ brief: 'b'.repeat(900) })).customer;
  const p = stripeSessionParams(order, customer, { origin: 'https://jobyougo.xyz/', lang: 'fr', automaticTax: true });
  assert.equal(p.get('mode'), 'payment');
  assert.equal(p.get('success_url'), 'https://jobyougo.xyz/agence/thanks?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(p.get('cancel_url'), 'https://jobyougo.xyz/agence/pricing?order=cancelled');
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '39000');
  assert.equal(p.get('line_items[1][price_data][unit_amount]'), '9000');
  assert.equal(p.get('line_items[1][quantity]'), '1');
  assert.equal(p.get('line_items[0][price_data][currency]'), 'usd');
  assert.equal(p.get('line_items[0][price_data][tax_behavior]'), 'exclusive');
  assert.equal(p.get('automatic_tax[enabled]'), 'true');
  assert.equal(p.get('invoice_creation[enabled]'), 'true');
  assert.equal(p.get('tax_id_collection[enabled]'), 'true');
  assert.equal(p.get('locale'), 'fr');
  assert.equal(p.get('metadata[offer]'), 'refonte');
  assert.equal(p.get('metadata[addons]'), 'revisionx1');
  assert.equal(p.get('metadata[total]'), '480');
  assert.equal(p.get('metadata[brief_1]').length + p.get('metadata[brief_2]').length, 900);
  for (const [k, v] of p) if (k.startsWith('metadata[')) assert.ok(v.length <= 500, `${k} fits Stripe's 500-character limit`);
  const noTax = stripeSessionParams(order, customer, { origin: 'https://jobyougo.xyz' });
  assert.equal(noTax.get('automatic_tax[enabled]'), null);
});

test('createCheckoutSession posts to Stripe and only trusts a Stripe checkout URL', async () => {
  let call = null;
  const fetchImpl = async (url, init) => { call = { url, init }; return new Response(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' }), { status: 200 }); };
  const s = await createCheckoutSession(new URLSearchParams({ mode: 'payment' }), 'sk_test_abc', { fetchImpl });
  assert.equal(s.url, 'https://checkout.stripe.com/c/pay/cs_test_123');
  assert.equal(call.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer sk_test_abc');
  assert.equal(call.init.body, 'mode=payment');
  const evil = async () => new Response(JSON.stringify({ id: 'x', url: 'https://evil.example/pay' }), { status: 200 });
  await assert.rejects(createCheckoutSession(new URLSearchParams(), 'sk_test_abc', { fetchImpl: evil }), /no checkout URL/);
  const refused = async () => new Response(JSON.stringify({ error: { message: 'Invalid API Key provided' } }), { status: 401 });
  await assert.rejects(createCheckoutSession(new URLSearchParams(), 'sk_test_bad', { fetchImpl: refused }), (err) => err.statusCode === 502 && /Invalid API Key/.test(err.message));
});

test('the thanks page only gets a short summary of a real session id', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    id: 'cs_test_abcdefghij', payment_status: 'paid', status: 'complete', amount_total: 78000, currency: 'usd',
    customer_details: { email: 'ada@example.com', address: { line1: 'secret' } }, metadata: { offer: 'creation', track: 'landing', addons: 'extra-pagex1', name: 'Ada' },
  }), { status: 200 });
  const s = await retrieveCheckoutSession('cs_test_abcdefghij', 'sk_test_abc', { fetchImpl });
  assert.deepEqual(s, { paid: true, status: 'complete', offer: 'creation', track: 'landing', addons: 'extra-pagex1', total: 780, currency: 'usd', email: 'ada@example.com' });
  await assert.rejects(retrieveCheckoutSession('../../v1/charges', 'sk_test_abc', { fetchImpl }), (err) => err.statusCode === 404);
});

test('webhook signatures are checked against the exact body, the secret and the clock', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ type: 'checkout.session.completed' });
  const t = 1_800_000_000;
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const now = t * 1000;
  assert.equal(verifyStripeSignature(Buffer.from(body), `t=${t},v1=${sig}`, secret, { now }), true);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=deadbeef,v1=${sig}`, secret, { now }), true, 'any v1 may match (secret rotation)');
  assert.equal(verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, secret, { now }), false, 'tampered body');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_other', { now }), false, 'wrong secret');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, { now: now + 10 * 60 * 1000 }), false, 'replayed too late');
  assert.equal(verifyStripeSignature(body, `v1=${sig}`, secret, { now }), false, 'no timestamp');
  assert.equal(verifyStripeSignature(body, '', secret, { now }), false);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, '', { now }), false, 'no secret configured');
});

test('a completed session becomes one order record; other events are ignored', () => {
  const rec = orderRecordFromEvent({
    type: 'checkout.session.completed', created: 1_800_000_000,
    data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 48000, currency: 'usd', customer_details: { email: 'ada@example.com' },
      metadata: { offer: 'refonte', addons: 'revisionx1', name: 'Ada', kind: 'business', brief_1: 'Half one, ', brief_2: 'half two.', start_now: 'no' } } },
  });
  assert.equal(rec.total, 480);
  assert.equal(rec.brief, 'Half one, half two.');
  assert.equal(rec.paid, true);
  assert.equal(rec.startNow, false);
  assert.equal(orderRecordFromEvent({ type: 'payment_intent.created', data: { object: {} } }), null);
});

test('the rate limiter and the public origin', () => {
  const limited = makeRateLimiter({ windowMs: 1000, max: 2 });
  assert.equal(limited('ip', 0), false);
  assert.equal(limited('ip', 1), false);
  assert.equal(limited('ip', 2), true);
  assert.equal(limited('ip', 1500), false, 'the window slides');
  assert.equal(publicOrigin({ headers: { host: 'localhost:3210' }, socket: {} }, {}), 'http://localhost:3210');
  assert.equal(publicOrigin({ headers: { host: 'a', 'x-forwarded-host': 'jobyougo.xyz', 'x-forwarded-proto': 'https' }, socket: {} }, {}), 'https://jobyougo.xyz');
  assert.equal(publicOrigin({ headers: { host: 'evil.test' }, socket: {} }, { AGENCE_PUBLIC_URL: 'https://jobyougo.xyz/agence' }), 'https://jobyougo.xyz', 'a fixed public URL wins');
  assert.equal(publicOrigin({ headers: { host: 'bad host/<x>' }, socket: {} }, {}), '');
});
