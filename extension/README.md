# JobYouGo Apply Bridge

Ouvre / navigue / remplit une candidature **dans votre Chrome déjà ouvert**
(pas de fenêtre Playwright séparée quand le plugin est connecté).

## Parité avec `apply-runner`

Même moteur de décision côté serveur :

- `lib/apply-classify.mjs` — `classifyField` (identité, visa, salaire, Section F…)
- `lib/apply-llm.mjs` — `resolveUnknownFields` pour les champs requis non classifiés
- `lib/apply-select.mjs` — options select / radio / decline
- Upload CV via `chrome.debugger` → `DOM.setFileInputFiles` (bannière « debugging » temporaire)
- Multi-étapes Next / Continue + retry auto + `selectPrefer` live
- Frappe humaine (textarea / longs textes), vérif email/tel, scrape options avant LLM
- Combobox CDP (clics trusted) — au-delà du runner Playwright
- Submit si `autoSubmit` (dashboard) ou action UI « Envoyer » (re-check avant clic)

## Installation

1. `chrome://extensions` → Mode développeur → Charger non empaquetée → ce dossier
2. Recharger l’extension après chaque changement (`manifest` **0.0.24**)
3. Lancer le dashboard (`npm run dev`) — le pont WS est sur `ws://127.0.0.1:3210/apply-bridge`
4. Le pont standalone `node extension/dev-bridge.mjs` (port 8934) n’est plus contacté par l’extension

## Permissions

`tabs`, `scripting`, `windows`, `alarms`, **`debugger`** (upload CV uniquement).
