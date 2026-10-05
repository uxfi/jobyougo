# JobYouGo

**Apply better to fewer jobs.**

JobYouGo keeps an eye on the career pages you care about, tells you which offers really match
your CV, and gets a tailored application ready for the good ones. You take a look, then hit Submit.

Live: [jobyougo.xyz](https://jobyougo.xyz) · Author: [Hugo Vermot](https://jobyougo.xyz/portfolio)

## How it works

1. **Scan** — never miss a new offer. 100+ companies ready to scan from day one (ATS APIs such as
   Greenhouse, Ashby and Lever, job boards, RSS feeds, aggregators).
2. **See what's worth your time** — every offer gets a fit score out of 5, with the reasons.
   Under 4.0/5, we suggest you pass.
3. **Tailor** — a CV and a cover letter that fit the offer, as PDFs.
4. **Apply** — pre-filled applications you send yourself, in a few minutes.

## Our promises

- You always hit Submit.
- Straight talk on weak fits.
- Your story, never made up.
- Your data stays with you.

## Pricing

$0 to use. Bring your own AI key (Gemini, OpenRouter, any OpenAI-compatible endpoint, or Ollama
locally): you only pay your AI provider, if you use one.

## Run it locally

Requirements: Node.js 18+ and git. Optional: a Supabase project (hosted accounts), PinchTab
(browser automation for SPA career pages and the apply runner), Go 1.21+ (terminal dashboard).

```bash
npm install
cp .env.example .env      # add your AI key; Supabase keys are optional
npm run dev               # web app on http://localhost:3210
```

Entry points: `ui/server.mjs` (the web app, also what Vercel runs), `node scan.mjs`
(deterministic scan), `node openrouter-runner.mjs` (headless pipeline), `npm run doctor`
(environment check). The pipeline and its modes are documented in `AGENTS.md`; setup details in
`docs/SETUP.md`; the JobYouGo product layer (web UI, portfolio, Supabase, apply runner) in
`docs/JOBYOUGO_FORK.md`.

**Codex users**: see `CODEX.md`. Interactive: run `codex` in the repo root and ask for a mode in plain language — slash commands are not guaranteed in Codex ("Run the JobYouGo scan mode"). Headless: `codex exec "Run the JobYouGo pipeline mode"`.

## Repository layout

- `ui/` — web app (landing, dashboard, portfolio, login) and its server
- `providers/` — job-board and ATS connectors
- `modes/` — the AI pipeline prompts (evaluate, tailor, cover letter, apply…)
- `lib/` and the root `*.mjs` scripts — pipeline logic
- `supabase/` — schema for hosted accounts
- `dashboard/` — optional Go terminal dashboard
- `tests/` and `test-all.mjs` — test suite (`node test-all.mjs --quick`)

## License

MIT — Copyright (c) 2026 Hugo Vermot. Portions of the pipeline engine derive from
[career-ops](https://github.com/career-ops-hq/career-ops) (MIT, Copyright (c) 2026 Santiago
Fernández de Valderrama); that notice is kept in `LICENSE` as the license requires. JobYouGo is
developed independently in this repository and does not track career-ops releases.
