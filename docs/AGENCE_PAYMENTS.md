# Ordering and payment on /agence (v2 studio)

Status on 2026-10-17: the order flow is live in **email mode**. The card payment code is in place but **switched off**.

## What a visitor sees

On the Redesign and Build cards (home pricing section and `/agence/pricing`), the button reads "Order a Redesign · $390" or "Order a Build · $590". It opens a three-step dialog (`ui/portfolio/agence-checkout.js`):

1. **Package**: Redesign or Build. For Build, the track (landing page or AI prototype). Then the add-ons, each with a quantity stepper capped by `max` in the offers JSON.
2. **Brief**: an optional link, a short brief, name, email, whether the buyer is a business or an individual, the country, and for a business the company and an optional VAT number.
3. **Review**: the priced lines, delivery and revisions, the next step, and the checkboxes.

Coaching has no order button while it is closed (`"open": false` in the offers JSON), only "Join the waiting list", which opens the contact form. Custom has "Book a scoping call", which goes to Calendly. Deposits for custom projects are handled by hand; see [Not built yet](#not-built-yet).

## The two modes

`GET /api/agence/checkout/config` tells the page which mode is on. `lib/agence-checkout.mjs` → `checkoutConfig()` decides it.

| Mode | When | Last button | What happens |
|---|---|---|---|
| `request` (default) | Any of the three variables below is missing | "Send my order" (and "Copy the order") | An email draft to chilka.v@gmail.com with the whole order. You confirm the scope and send a payment link. Nothing is charged from the page. |
| `stripe` | `AGENCE_PAYMENTS=stripe` **and** a `sk_…`/`rk_…` key in `STRIPE_SECRET_KEY` **and** an http(s) `AGENCE_TERMS_URL` | "Pay $X" | The server prices the order and returns a Stripe Checkout URL. Stripe takes the card, then sends the buyer to `/agence/thanks`. |

The terms URL is required on purpose. The server refuses card payments while no terms of sale are published.

The "How ordering works" steps under the cards follow the same mode (`s_step_req_*` / `s_step_pay_*` in `agence-story.js`).

## Safety built in

- **Prices come from the server.** The browser sends only the package, track, add-on ids and quantities. `priceOrder()` reads the offers block in `ui/portfolio/agence-data.js` (the same block the cards and the chatbot use). Unknown packages, closed offers, add-ons that do not apply to the package, quantities above `max` and duplicates are refused with a stable error code.
- **Buyer checks** (`validateCustomer()`): a name, a valid email, a brief of at least 10 characters, an http(s) link only, the "I read the scope" box, and the terms box. An **individual** must also tick the box asking you to start within the 14-day withdrawal period (EU distance selling).
- **Webhook**: `POST /api/agence/stripe-webhook` checks the `Stripe-Signature` header (HMAC-SHA256 on the raw body, 5-minute tolerance, constant-time compare) before it reads the event.
- **Rate limit**: 12 order attempts per IP every 10 minutes (`AGENCE_ORDER_RATE_LIMIT`).
- **No card data on our side.** Cards are entered on Stripe's page only.
- `/agence/thanks` gets a short summary (paid or not, package, total, email) from `GET /api/agence/checkout/session?id=cs_…`, never the whole Stripe object. The page carries `noindex`.

## Switching card payments on

1. **Publish terms of sale (CGV) and legal notices first.** See the checklist below. Note their URL.
2. **Stripe account**: create it, finish the business verification, and set the payout bank account.
3. **Test mode first.** Put the test values in the environment of the server (Vercel → Project → Settings → Environment Variables, or `.env` locally):
   ```
   AGENCE_PAYMENTS=stripe
   STRIPE_SECRET_KEY=sk_test_…
   AGENCE_TERMS_URL=https://jobyougo.xyz/agence/terms
   AGENCE_PUBLIC_URL=https://jobyougo.xyz
   ```
4. **Webhook**: Stripe Dashboard → Developers → Webhooks → Add endpoint `https://jobyougo.xyz/api/agence/stripe-webhook`, event `checkout.session.completed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
5. **Try a test order** with card `4242 4242 4242 4242`, any future date, any CVC. You should land on `/agence/thanks` with "Paid". Each paid order also writes an `[agence] order paid` line to the server log.
6. **Go live**: replace the key with `sk_live_…` and the webhook secret with the live endpoint's. Turn on Stripe's email receipts and the "successful payment" notification for yourself.

Optional:
- `AGENCE_STRIPE_TAX=1` turns on Stripe Tax (prices are tax-exclusive, as the page says). Register your tax details in Stripe first.
- `AGENCE_ORDERS_FILE=data/agence-orders.jsonl` keeps a local copy of each paid order. It contains buyer names, emails and briefs: keep it out of git (`data/*` already is). On Vercel the disk is read-only, so leave it empty and use the Stripe Dashboard.

Each one-off payment creates a Stripe invoice (`invoice_creation`), so "every payment gets an invoice" holds. For a business buyer, Checkout asks for the tax ID.

## Checklist before taking real money (France / EU)

This is a list of things to check with your accountant or a lawyer, not legal advice.

- **Terms of sale (CGV)** covering: what each package includes, delivery dates and when the clock starts, revision rounds, payment terms, what happens if the brief does not fit the package, ownership of the work, and the withdrawal right for individuals with its exception for work started at their request.
- **Legal notices** (mentions légales): legal name, SIREN/SIRET, address, contact, host.
- **VAT**: whether you charge VAT, and the matching mention on invoices. If you are under the VAT exemption threshold, the invoice wording for it. Whether you turn on Stripe Tax.
- **Refunds**: the site makes no refund promise (see `modes/agence.md`, "DAY 2 AND REFUNDS"). The terms still need to say what happens before Day 1 if you cannot deliver the package as sold.
- **Prices in USD**: confirm that is what you want for French clients, or add EUR later. The page and Stripe use the `currency` field of the offers JSON.
- **Chatbot**: `modes/agence.md` says "send the form… then payment". When card payment is on, update the "How to start" sentence there.

## Not built yet

- **Coaching subscription**: the offer is closed. When it opens, add a Stripe Price with a monthly recurring interval and a `mode=subscription` branch in `stripeSessionParams()`, then set `"open": true`.
- **Custom project deposits**: send them by hand with a Stripe Payment Link or invoice from the Dashboard, using the amounts in the quote.
- **Order storage in Supabase**: the webhook only logs, plus the optional file. If you want orders in the dashboard, add an `agence_orders` table and insert from `recordAgenceOrder()` in `ui/server.mjs`.

## Files

| File | Role |
|---|---|
| `ui/portfolio/agence-data.js` | Offers JSON: prices, tracks, add-ons (`for`, `max`, `open`), payment lines |
| `ui/portfolio/agence-checkout.js` | Order dialog, email draft, Stripe redirect, `/agence/thanks` |
| `ui/portfolio/agence-story.js` | Package cards, Build track switch, "How ordering works" |
| `lib/agence-checkout.mjs` | Mode switch, pricing, validation, Stripe REST calls, webhook signature |
| `lib/agence-site.mjs` | `loadAgencyOffers()`, the `thanks` sub-page (`noindex`) |
| `ui/server.mjs` | `/api/agence/checkout/config`, `/api/agence/checkout`, `/api/agence/checkout/session`, `/api/agence/stripe-webhook` |
| `tests/agence-checkout.test.mjs` | Pricing, consents, session params, signatures, no network |
