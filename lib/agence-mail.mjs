// agence-mail.mjs — the emails of the agency page's order flow (/agence, "v2 studio"). 2026-10-19.
//
// In email mode an order reaches the server (POST /api/agence/order in ui/server.mjs), gets a reference,
// and goes out as two emails: the whole order to the founder, a confirmation to the buyer in their language.
// A payment method is plugged in later; until then the founder replies with the scope, the invoice and a
// payment link by hand (docs/AGENCE_PAYMENTS.md).
//
// Provider-agnostic: one HTTP adapter (Resend, plain fetch, no SDK) and a "mail off" state when nothing is
// configured, in which the page falls back to the visitor's own email app. Everything takes its env and
// fetch as arguments, so it is testable without an account.

import { randomBytes } from 'node:crypto';

export const RESEND_API = 'https://api.resend.com/emails';
export const DEFAULT_ORDER_TO = 'chilka.v@gmail.com';
export const DEFAULT_CALENDLY = 'https://calendly.com/chilka-v/30min';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Mail settings from the environment:
 *   AGENCE_MAIL_API_KEY (or RESEND_API_KEY)  the provider's key; nothing is sent without it
 *   AGENCE_MAIL_FROM                          the sender, on a domain verified at the provider ("v2 studio <orders@…>")
 *   AGENCE_MAIL_TO                            where orders go (default: the founder's address)
 *   AGENCE_MAIL_PROVIDER                      resend (default when a key is set)
 *   AGENCE_CALENDLY                           the kickoff-call link in the confirmation
 */
export function mailConfig(env = process.env) {
  const key = String(env.AGENCE_MAIL_API_KEY || env.RESEND_API_KEY || '').trim();
  const from = String(env.AGENCE_MAIL_FROM || '').trim();
  const to = String(env.AGENCE_MAIL_TO || '').trim() || DEFAULT_ORDER_TO;
  const provider = String(env.AGENCE_MAIL_PROVIDER || (key ? 'resend' : '')).trim().toLowerCase();
  const fromAddress = from.replace(/^.*<\s*/, '').replace(/\s*>.*$/, '');
  const on = provider === 'resend' && !!key && EMAIL_RE.test(fromAddress) && EMAIL_RE.test(to);
  return { provider: on ? provider : '', key, from, to, on, calendly: String(env.AGENCE_CALENDLY || '').trim() || DEFAULT_CALENDLY };
}

function mailError(code, statusCode, detail) {
  const err = new Error(detail ? `${code}: ${detail}` : code);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

/** Send one email through the configured provider. → { id }. Throws mail_off / mail_failed. */
export async function sendMail(config, msg, { fetchImpl = fetch } = {}) {
  if (!config || !config.on) throw mailError('mail_off', 503);
  const body = { from: config.from, to: [].concat(msg.to), subject: msg.subject, text: msg.text };
  if (msg.html) body.html = msg.html;
  if (msg.replyTo) body.reply_to = msg.replyTo;
  if (Array.isArray(msg.tags) && msg.tags.length) body.tags = msg.tags;
  const res = await fetchImpl(RESEND_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw mailError('mail_failed', res.status, data && (data.message || data.name));
  return { id: data && data.id ? String(data.id) : '' };
}

/** A short, readable order reference: V2-YYMMDD-XXXX (no 0/O or 1/I). */
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REF_RE = /^V2-\d{6}-[A-HJ-NP-Z2-9]{4}$/;
export function orderReference(now = new Date(), rand = randomBytes) {
  const day = now.toISOString().slice(2, 10).replace(/-/g, '');
  const bytes = rand(4);
  let tail = '';
  for (let i = 0; i < 4; i++) tail += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return `V2-${day}-${tail}`;
}

/* ── Copy, hand-written in English and French. Other languages get English (the brief is in the buyer's words). ── */
const COPY = {
  en: {
    subject: 'Your order {ref} · v2 studio',
    hello: 'Hello {name},',
    received: 'We have your order {ref}. Nothing is charged for now.',
    order: 'Your order',
    total: 'Total: {total}, excluding applicable taxes',
    delivery: 'Delivery: {delivery} after Day 1',
    next: 'What happens next',
    steps: [
      'Within one business day, Hugo replies with the scope in writing, the invoice and a secure payment link.',
      'Day 1 is the business day after your payment, your brief and your files.',
      'The kickoff call, 30 minutes, free: book it when it suits you: {calendly}',
    ],
    change: 'To change anything, reply to this email.',
    sign: 'Hugo Vermot\nv2 studio',
    ex: 'excl. taxes',
  },
  fr: {
    subject: 'Votre commande {ref} · v2 studio',
    hello: 'Bonjour {name},',
    received: 'Nous avons bien reçu votre commande {ref}. Rien n’est débité pour le moment.',
    order: 'Votre commande',
    total: 'Total : {total}, hors taxes applicables',
    delivery: 'Livraison : {delivery} après le jour 1',
    next: 'La suite',
    steps: [
      'Sous un jour ouvré, Hugo vous répond avec le périmètre par écrit, la facture et un lien de paiement sécurisé.',
      'Le jour 1 est le jour ouvré qui suit votre paiement, votre brief et vos fichiers.',
      'L’appel de lancement, 30 minutes, gratuit : réservez-le quand cela vous arrange : {calendly}',
    ],
    change: 'Pour modifier quoi que ce soit, répondez à cet e-mail.',
    sign: 'Hugo Vermot\nv2 studio',
    ex: 'HT',
  },
};

const fill = (s, map) => String(s).replace(/\{(\w+)\}/g, (m, k) => (map[k] == null ? m : String(map[k])));
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function money(amount, currency = 'usd', lang = 'en') {
  const n = Number(amount) || 0;
  if (currency === 'usd') return lang === 'fr' ? `${n} $` : `$${n}`;
  if (currency === 'eur') return lang === 'fr' ? `${n} €` : `€${n}`;
  return `${n} ${currency.toUpperCase()}`;
}

/** Plain text → a small HTML email: blank lines split paragraphs, "1. " lines make a list, URLs become links. */
export function textToHtml(text) {
  const link = (s) => escHtml(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#6a4fb5">${u}</a>`);
  const blocks = String(text).split(/\n{2,}/);
  const html = blocks.map((b) => {
    const lines = b.split('\n');
    const isNum = (l) => /^\d+\. /.test(l);
    const ol = (ls) => `<ol style="margin:0 0 16px;padding-left:22px">${ls.map((l) => `<li style="margin:0 0 8px">${link(l.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`;
    if (lines.every(isNum)) return ol(lines);
    // a heading line followed by numbered lines: "What happens next" + the steps
    if (lines.length > 1 && !isNum(lines[0]) && lines.slice(1).every(isNum)) return `<p style="margin:0 0 8px"><b>${link(lines[0])}</b></p>${ol(lines.slice(1))}`;
    return `<p style="margin:0 0 16px">${lines.map(link).join('<br>')}</p>`;
  }).join('');
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f3f7;color:#16151d;font:16px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:28px 28px 24px;background:#fbfafd;border-radius:14px">${html}</div></body></html>`;
}

/**
 * The two emails of an order. order = priceOrder().order, customer = validateCustomer().customer.
 * → { buyer: { to, subject, text, html }, founder: { to, subject, text, html } }
 */
export function orderEmails({ order, customer, ref, lang = 'en', locale = '', origin = '', to = DEFAULT_ORDER_TO, calendly = DEFAULT_CALENDLY, now = new Date() }) {
  const L = COPY[lang === 'fr' ? 'fr' : 'en'];
  const bl = lang === 'fr' ? 'fr' : 'en';
  const cur = order.currency || 'usd';
  const lineText = (l, lg = bl) => (l.qty > 1 ? `${l.name} × ${l.qty} (${money(l.amount, cur, lg)})` : `${l.name} (${money(l.amount, cur, lg)})`);
  const buyerLines = order.lines.map((l) => `· ${lineText(l)}`).join('\n');
  const buyerText = [
    fill(L.hello, { name: customer.name }),
    '',
    fill(L.received, { ref }),
    '',
    `${L.order}\n${buyerLines}\n${fill(L.total, { total: money(order.total, cur, bl) })}${order.delivery ? '\n' + fill(L.delivery, { delivery: order.delivery }) : ''}`,
    '',
    `${L.next}\n${L.steps.map((s, i) => `${i + 1}. ${fill(s, { calendly })}`).join('\n')}`,
    '',
    L.change,
    '',
    L.sign,
  ].join('\n');

  const who = [customer.kind === 'individual' ? 'individual' : 'business', customer.company, customer.country, customer.vat ? `VAT ${customer.vat}` : ''].filter(Boolean).join(' · ');
  const first = order.lines[0] || { name: '', amount: 0 };
  const addons = order.lines.slice(1);
  const founderText = [
    `New order ${ref} (email mode: nothing paid yet)`,
    '',
    `Package: ${first.name} (${money(first.amount, cur)})`,
    `Add-ons: ${addons.length ? addons.map((l) => lineText(l, 'en')).join('; ') : 'none'}`,
    `Total: ${money(order.total, cur)}, excluding applicable taxes`,
    order.delivery ? `Delivery: ${order.delivery} after Day 1` : '',
    '',
    `Name: ${customer.name}`,
    `Email: ${customer.email}`,
    `Ordering as: ${who}`,
    `Link: ${customer.link || 'none'}`,
    '',
    'Brief:',
    customer.brief,
    '',
    `Consents: scope confirmed${customer.kind === 'individual' ? `; start within the 14 days: ${customer.startNow ? 'yes' : 'no'}` : ''}`,
    `Page language: ${lang}${locale && locale !== lang ? ` · visitor language: ${locale}` : ''}`,
    `Sent from the order form${origin ? ` on ${origin}` : ''}, ${now.toISOString().replace('T', ' ').slice(0, 16)} UTC`,
    'Reply to this email to answer the client: the reply goes to them.',
  ].filter((x, i, arr) => !(x === '' && arr[i - 1] === '')).join('\n');

  return {
    buyer: { to: customer.email, subject: fill(L.subject, { ref }), text: buyerText, html: textToHtml(buyerText) },
    founder: { to, subject: `Order ${ref} · ${first.name} · ${customer.name}`, text: founderText, html: textToHtml(founderText) },
  };
}
