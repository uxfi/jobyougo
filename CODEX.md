@AGENTS.md
<!-- Codex config — imports AGENTS.md -->

# jobyougo — Codex quick notes

## Local web UI

When the user asks to "lance serveur", "launch server", or start the local UI,
use the fork web server directly:

```bash
cd C:\Users\PC\Desktop\jobyougo-main\career-ops
npm run dev
```

The server is `ui/server.mjs` and listens on `http://localhost:3210` by default
(`PORT` can override it). After launch, verify with:

```bash
Invoke-WebRequest -UseBasicParsing http://localhost:3210 -TimeoutSec 10
```

Expected startup output includes:

```text
Career Ops UI  ->  http://localhost:3210
```

It may also print Supabase sync warnings for missing old report files. Those do
not prevent the UI from serving if the HTTP check returns `200`.
