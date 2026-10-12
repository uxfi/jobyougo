# Contact finder — who to write to for an offer

From the Applications list, the row menu (⋯) has **Find contact & write email**.
It looks for the right address at the employer, says how sure it is of each
one, then drafts the application email for the best one. Nothing is sent: the
draft opens in Gmail or the mail app, or is copied.

## What it looks for, in order

1. **The posting itself**: an address printed in it (`jobs@…`, "send your CV
   to…") and the people it names ("you will report to Marie Dupont, Head of
   Design", "Louis, our Talent Acquisition Manager").
2. **The company site**: found from the job page (JSON-LD `hiringOrganization`
   on Welcome to the Jungle and most ATS pages), from the job URL when the
   posting lives on the employer's own domain, from a link or address inside
   the posting, or as a last resort from a web search for the official site.
   The home page plus up to seven contact / about / team / careers / legal /
   privacy pages are read for printed addresses and named people (French
   "Directeur de la publication", German "Geschäftsführer", "CEO: …").
3. **Web search for people**: three LinkedIn-scoped queries at most, for a
   recruiter, the lead of the team that hires for this role (Head of Design for
   a designer, CTO for an engineer…) and a founder. Results go through the same
   engines as the scan (PinchTab Brave, PinchTab Google, DuckDuckGo, SearchAPI).
   A result is kept only when its title names the company exactly ("Riot", not
   "Riot Games", and never a truncated "Riot …"), and a cheap model pass drops
   namesakes by comparing the result with what the company site says it does.
4. **An address for each person**: an enrichment provider when a key is set,
   otherwise the naming pattern the site itself shows (`marie.dupont@` →
   `first.last`), otherwise a common pattern that is clearly labelled a guess.

## Confidence

| Tag | Meaning |
|---|---|
| **verified** | Printed on the company's own site or in the posting, or confirmed by a provider. |
| **likely** | Built from the pattern the company uses for other people, or a provider said "catch-all / risky". |
| **guess** | A common pattern with nothing confirming it. Check it before sending. |

Only a verified or likely address is picked as **best** and drafted for without
asking. A guess is listed with its alternatives (`marie@`, `mdupont@`) and the
user chooses. Addresses on a domain with no MX record are dropped; `dpo@`,
`press@`, `noreply@` and the like are never proposed; `support@` / `contact@`
are kept as a last resort because a person may forward them.

The finder does **not** probe mail servers (no SMTP `RCPT TO` checks).

## Providers (optional)

| Env | Service | Used for |
|---|---|---|
| `HUNTER_API_KEY` | hunter.io | domain search (pattern + addresses with titles), email finder, verifier |
| `LEMLIST_API_KEY` | lemlist | find / verify email (needs a plan with API access; a 402 is reported and skipped) |

Without a key the finder still works from the site, the posting and web
search; people found by search then get pattern-based addresses.

## Models and cost

- `CONTACT_FINDER_MODEL` (default Qwen 30B): one short call per team/about
  page and per posting to list named people, one call per search round to
  drop namesakes. A few tenths of a cent per offer.
- `APPLICATION_EMAIL_MODEL` (default Qwen 30B): the email itself, including
  the repair pass. A 2026-10-07 bench (7 real postings, 3 blind judges)
  scored Haiku 4.5 at 4.5/5, Sonnet 4.6 at 3.9 and Qwen 30B at 3.3-3.6;
  generation still uses Qwen, the same model as the rest of the app.

## Routes

- `GET /api/contact-finder?num=516` (or `company=…&role=…&jobUrl=…`), server-sent
  events: `status`, `warning`, `contacts` (company, ranked contacts, best,
  notes), `draft` (same payload as the email route) when `draft=1` and a best
  contact exists, then `done` or `error`. Optional `language=fr|en`, `notes=…`.
- `POST /api/application-email` now also accepts `contact: { firstName,
  lastName, title, persona, company }` and `companyText`, and reuses the
  posting text cached by a previous finder run for the same `jobUrl`.

## The email itself

`lib/application-email.mjs` writes to a **persona**: recruiter (fit, then
proof), hiring manager (the team's concrete problem, then the closest thing the
candidate did), founder (two short paragraphs), shared inbox (clear first line,
forward request). The persona comes from the contact's title or the mailbox
(`jobs@` → recruiter, `contact@` → inbox).

The system prompt carries the reader's plan and the voice rules; the user
message carries the facts: CV, house rules, reader, posting, the posting lines
the candidate can answer, the closest CV experiences. After the model:
deterministic layout, rule audit, one repair call, then two grounding guards
that drop a sentence (when its paragraph keeps another) for a figure or
posting term the CV does not contain, or for a tool (Cursor, Claude Code,
GitHub, Figma…) attached to an employer whose CV block never mentions it. An
employer the house rules forbid to name (`modes/_profile.md`, "Do not name …
as proof") that survives the repair is rewritten as "in my current role" /
"at a previous employer"; anything the guards could not settle is shown to the
user as an "À vérifier" warning under the draft.

The prompt wording was settled by measurement, not taste. The 2026-10-07
design panel had three independent agents write a prompt philosophy each
(sample emails + 8 rules; plan-then-write; hook-first minimal), ran them on 7
real postings with Haiku 4.5 and Sonnet 4.6 and blind-judged every draft with
3 models. The persona prompt shipped here scored 4.0-4.5 out of 5 on Haiku
across runs, the best variant 4.2-4.3; a merge of the two with word caps and
grafted rules scored 3.8-3.9 and was dropped. One run of 7 scenarios is noisy
(the same prompt moved by 0.5 between two runs, the same drafts by 0.2 between
judging rounds): what holds is Haiku far above Qwen (3.2-3.5) and at or above
Sonnet. Change the prompt only with the bench (`scratch/email-bench/`), run
each variant several times, and read the bodies, not only the table.

Bench harness: `scratch/email-bench/` (`scenarios.mjs`, `run.mjs`, `judge.mjs`,
`VARIANT_GUIDE.md`) runs any prompt variant over real postings and blind-judges
the drafts with three models.

## Tests

```bash
npm run test:email
```
