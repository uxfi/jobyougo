# Ordering and payment on /agence (v2 studio)

Status on 2026-10-17: the order flow is live in **email mode**. The card payment code is in place but **switched off**.

## What a visitor sees

Two kinds of button open the order flow (`ui/portfolio/agence-checkout.js`):
- the hero's "Improve my website";
- on the Redesign and Build cards (home pricing section and `/agence/pricing`), "Order a Redesign · $390" or "Order a Build · $590".

Since 2026-10-18 the flow is a near-fullscreen stepper, "Improve my website" (styles in `agence-order.css`). On the left, each step shows a scene with the mascot (`agence-order-art.js`) and the rail of the five steps; steps already done are buttons that go back. On the right are the step's fields and the running total:

1. **Your site**: an optional link, the brief (required, at least 10 characters) and the brief starters.
2. **Package**: Redesign or Build. For Build, the track (landing page or AI prototype). Then the add-ons, each with a quantity stepper capped by `max` in the offers JSON, and the delivery date.
3. **How we build**: the five dated steps from the process section (Day 0 to Day 5, or Day 7 for a Build, from `workingDays`). Day 2 is the key step: the client approves the direction or asks for changes before the build (there is no refund promise; the Day 2 guarantee was dropped on 2026-10-12 and removed from every page on 2026-10-19). This step has no fields.
4. **About you**: name, email, whether the buyer is a business or an individual, the country, and for a business the company and an optional VAT number.
5. **Review and pay**: the priced lines, delivery and revisions, a "What you pay, and when" timeline (different in email mode and in Stripe mode), and the checkboxes.

`scratch/studio-smoke.cjs` (not shipped) runs the real script against a fake DOM and walks the five steps in EN and FR.

Added on 2026-10-18:
- The dialog header shows the founder's photo and a line saying he reads every order.
- Step 1 shows the delivery day if the brief and files arrive today. It is computed in business days (Monday to Friday) from the package's delivery time, by `agenceExtras.etaFor()` in `ui/portfolio/agence-extras.js`. Public holidays are not counted.
- Step 1 also shows the capacity line when `AGENCY_AVAILABILITY` is filled in.
- Step 2 has brief starters, chips that add a sentence to the brief.
- Step 3 shows reassurance lines under the buttons.
- Brief draft:
  - While the visitor types, the brief, link, name, email, company, country and VAT number are kept in `localStorage` (`v2studio-order-draft`) on their own device for 14 days.
  - They are restored the next time the dialog opens.
  - They are deleted once the order is sent or the visitor leaves for Stripe.
- In email mode, the last step posts the order to `POST /api/agence/order` (see [Email mode, complete](#email-mode-complete)): the dialog then shows "Order received. Reference V2-…" with the next steps and a Calendly button. When the mail provider is off or the request fails, it falls back to the "ready in your email app" view (a `mailto:` draft).
- `/agence/thanks` shows a signed note from the founder. When the payment is confirmed, paint dabs burst over the card. They are skipped under reduced motion.
- Every pricing card (home and `/agence/pricing`) also shows the delivery day.

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

## Email mode, complete

Since 2026-10-19 an order in email mode reaches the server. `lib/agence-mail.mjs` sends the emails through Resend over plain HTTP (no SDK); nothing is sent while the variables below are missing, and the page falls back to the visitor's own email app.

| Variable | Role |
|---|---|
| `AGENCE_MAIL_API_KEY` (or `RESEND_API_KEY`) | The provider's key. Without it: mail off, 503 `mail_off`. |
| `AGENCE_MAIL_FROM` | The sender, on a domain verified at the provider, e.g. `v2 studio <orders@jobyougo.xyz>`. A gmail.com address cannot be used as sender through a third party. |
| `AGENCE_MAIL_TO` | Where orders go. Default: chilka.v@gmail.com. |
| `AGENCE_CALENDLY` | The kickoff-call link in the confirmation. Default: the usual Calendly link. |
| `AGENCE_ORDERS_FILE` | Optional local JSONL record (one line per order, with the buyer's name and email). Not on Vercel. |

What happens on `POST /api/agence/order`:
1. Rate limit (same as the card route), a honeypot field (`website` must be empty) and a minimum fill time of 4 seconds.
2. The order is priced from the offers JSON (`priceOrder`) and the buyer validated (`validateCustomer`, stage `request`: name, email, brief, link, the scope box; no terms box, since the terms come with the invoice).
3. A reference `V2-YYMMDD-XXXX` is drawn.
4. Two emails go out: the whole order to `AGENCE_MAIL_TO` with Reply-To set to the buyer, and a confirmation to the buyer in English or French (other languages get English). If the founder's email fails the order is refused (502) and the page falls back to the email app; if only the confirmation fails the order still stands and the log says so.
5. One log line `[agence] order received: V2-… ` (plus the JSONL line when `AGENCE_ORDERS_FILE` is set).

What the founder does by hand, until a payment method is plugged in:
1. Read the order email and reply to it (the reply goes to the buyer) quoting the reference: the confirmed scope, the price, the delivery date.
2. Send the invoice and a payment link (a Stripe Payment Link or an invoice from the Dashboard, for the amount excluding taxes shown in the email).
3. Once paid, set Day 1 and book the kickoff call if the buyer has not.

To set it up: create the Resend account, verify the sending domain (SPF and DKIM records at the DNS host), put the three variables in Vercel, and send one test order from the page.

## Switching card payments on

1. **Publish terms of sale (CGV) and legal notices first.** Drafts are at `/agence/terms` and `/agence/legal`; see [Terms of sale and legal notices](#terms-of-sale-and-legal-notices) for what is left to do. Once they are final, the terms URL is `https://jobyougo.xyz/agence/terms`.
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

## Terms of sale and legal notices

Drafted on 2026-10-18, in English and French, as `/agence` sub-pages:

| Page | Fragment | What it covers |
|---|---|---|
| `/agence/terms` | `ui/agence/terms.html` | Terms of sale (CGV): the seller, packages and prices, ordering, payment, delivery dates, how the work runs, revisions, what happens before Day 1 if the brief does not fit, refunds, the withdrawal right for individuals with the model form, delays, what the client provides, ownership, confidentiality, liability, applicable law |
| `/agence/legal` | `ui/agence/legal.html` | Legal notices (mentions légales): publisher, host, intellectual property, personal data, browser storage |

How they work:
- Both languages are in each fragment. `ui/portfolio/agence-legal.css` shows the one that matches `<html lang>`, so the language switch needs no script. `ui/portfolio/agence-legal.js` only sets the tab title and description.
- Prices, delivery times, revisions and add-ons are copied from `AGENCY_OFFERS`. `tests/agence-site.test.mjs` fails when they drift, so change both together.
- The personal data section describes what the pages send today: the email draft, Stripe, the assistant through OpenRouter, Calendly, and the browser storage keys. All fonts are self-hosted in `ui/portfolio/fonts/`, and three.js for the home page 3D scene in `ui/portfolio/vendor/three-0.160.0/`, so the pages load nothing from Google Fonts or jsDelivr; a test fails if a CDN link comes back. Update the section when any of this changes.

They are **drafts, not ready to use**:
- Every detail the code could not give is a highlighted placeholder in brackets (`class="legal-ph"`): legal name, legal form, share capital, SIREN/SIRET, registration, address, phone, VAT status and number, publication director, host, consumer mediator, the city for business disputes, and how long emails about projects that did not go ahead are kept.
- Both pages carry `noindex`, and no nav or footer links to them. A test in `tests/agence-site.test.mjs` keeps it that way while a placeholder is left.
- Some clauses do not come from the code. They are usual terms, written for your accountant or lawyer to confirm or change:
  - the full refund within 14 days when an order is cancelled before Day 1;
  - late payment interest and the €40 indemnity, for business clients;
  - a new date, then a refund of the work not delivered, when we are late;
  - the 10-business-day limit when Hugo cannot work;
  - the liability cap for business clients;
  - the scope of the transfer of rights, and the note on AI-generated material;
  - an individual can ask for Day 1 to be set after the 14-day withdrawal period;
  - the French version prevails over the English one.

To finish them:
1. Fill in every placeholder, in both languages, on both pages.
2. Have both pages reviewed by your accountant or lawyer.
3. Remove the draft notes (`legal-draft`), and change the "Draft of" lines to the date the terms take effect.
4. In `lib/agence-site.mjs`, drop `NOINDEX` from the `terms` and `legal` entries. Keep `LEGAL_ASSETS`.
5. Link both pages from the footer of `ui/agence/page.html` and `ui/agence.html`.
6. Set `AGENCE_TERMS_URL=https://jobyougo.xyz/agence/terms` on Vercel ([Switching card payments on](#switching-card-payments-on), step 3).

## Checklist before taking real money (France / EU)

This is a list of things to check with your accountant or a lawyer, not legal advice.

- **Terms of sale (CGV)**: drafted at `/agence/terms` ([above](#terms-of-sale-and-legal-notices)). They cover: what each package includes, delivery dates and when the clock starts, revision rounds, payment terms, what happens if the brief does not fit the package, ownership of the work, and the withdrawal right for individuals with its exception for work started at their request.
- **Legal notices** (mentions légales): drafted at `/agence/legal`. Still to fill in: legal name, SIREN/SIRET, address, phone, publication director, host.
- **Consumer mediator**: a business that sells to individuals in France has to name a consumer mediator. The terms have a placeholder for it.
- **Prices shown to individuals**: French price rules generally expect consumer prices with taxes included, and in euros. The page shows US dollars excluding taxes. Check it together with the USD point below.
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
| `lib/agence-site.mjs` | `loadAgencyOffers()`, the `thanks`, `terms` and `legal` sub-pages (`noindex`) |
| `ui/agence/terms.html`, `ui/agence/legal.html` | Terms of sale and legal notices, EN and FR (drafts) |
| `ui/portfolio/agence-legal.css`, `ui/portfolio/agence-legal.js` | Layout, language switch and tab title of the two legal pages |
| `ui/portfolio/vendor/three-0.160.0/` | three.js r160 from the npm package (MIT, `LICENSE`), only the files the home page 3D island imports through the importmap in `ui/agence.html` |
| `tests/agence-site.test.mjs` | Sub-pages; the legal pages follow the offers JSON and stay `noindex` while drafted |
| `ui/server.mjs` | `/api/agence/checkout/config`, `/api/agence/checkout`, `/api/agence/checkout/session`, `/api/agence/stripe-webhook` |
| `tests/agence-checkout.test.mjs` | Pricing, consents, session params, signatures, no network |
