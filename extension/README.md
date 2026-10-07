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
- Listes : seule une option réelle est cliquée. Du texte n’est tapé dans la
  recherche d’une liste que pour ville / pays / école / employeur / indicatif
  (`typeQuery` envoyé par le serveur), jamais la réponse elle-même, et il est
  effacé si aucune option n’est retenue
- Submit si `autoSubmit` (dashboard) ou action UI « Envoyer » (re-check avant clic)

## Installation

1. `chrome://extensions` → Mode développeur → Charger non empaquetée → ce dossier
2. Recharger l’extension après chaque changement (`manifest` **0.0.33**)
3. Lancer le dashboard (`npm run dev`) — le pont WS est sur `ws://127.0.0.1:3210/apply-bridge`
4. Cliquer l’icône JobYouGo dans la barre Chrome, puis **Connect**. Le dashboard peut aussi lancer cette connexion une fois la page rechargée.
5. Le pont standalone `node extension/dev-bridge.mjs` (port 8934) n’est plus contacté par l’extension

## Interface

`popup.html` est l’écran de l’icône : état du pont, bouton Connect / Reconnect, ouverture du dashboard. Un `!` sur l’icône veut dire que le socket n’est pas ouvert. `dashboard-bridge.js` tourne sur `http://127.0.0.1:3210` et `http://localhost:3210` pour que la barre du dashboard puisse demander la même connexion.

`apply-helper-overlay.js` est le helper quick-fill (valeurs du profil, réponses du rapport, CV régional) : le bouton « Apply » du dashboard ouvre l’offre via le plugin, puis le message `show-helper` le dessine en panneau flottant par-dessus l’offre (shadow root fermé, invisible pour la collecte des champs). Il est réinjecté après chaque navigation de l’onglet et suit un onglet ouvert depuis celui-ci ; « Fill with the plugin » ramène le dashboard sur la modale auto-apply de cet onglet.

## Fonctions exécutées dans la page

Le monde isolé de l’extension interdit `eval` / `new Function` (CSP MV3) :
le serveur n’envoie jamais de code, il demande un helper **par nom**
(message `page-helper`, liste blanche dans `page-helper-registry.mjs`).

- `page-helpers.mjs` et `collect-fields.js` sont **générés** depuis `lib/`
  (source de vérité testée) : modifier la fonction dans `lib/`, puis
  `npm run sync:extension`. `tests/extension-page-helpers.test.mjs` échoue
  si une copie est périmée.
- Le service worker ne peut importer que des fichiers de ce dossier
  (un import `../lib/…` l’empêche de démarrer) — le même test le vérifie.

## Permissions

`tabs`, `scripting`, `windows`, `alarms`, **`debugger`** (upload CV uniquement), `storage` (helper quick-fill par onglet, session uniquement).
