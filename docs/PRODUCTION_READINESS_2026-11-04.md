# JobYouGo — mise en production pour de vrais utilisateurs

Audit du 2026-11-04 sur le code (branche `feat/agence-bestiary-3d`, propre) et sur le site live
https://jobyougo.xyz (requêtes GET anonymes uniquement). Suite de `NEW_USER_READINESS.md`.

## Verdict

Un inconnu peut créer un compte, importer son CV et finir l'onboarding. Mais aujourd'hui :

1. **Le site live expose les données du propriétaire à n'importe qui**, sans compte.
2. **Le plugin, qui fait la valeur du produit, ne fonctionne qu'en local** : il est câblé sur
   `ws://127.0.0.1:3210`, et Vercel ne peut pas tenir sa connexion WebSocket.
3. Scan navigateur, PDF et apply sont coupés sur Vercel. Un utilisateur en ligne ne peut donc
   faire qu'évaluer des offres.

Ordre conseillé : fermer les fuites (1 jour), héberger un vrai serveur Node, brancher le plugin
dessus et le publier sur le Chrome Web Store, puis légal, quotas et mise en avant du plugin.

## 1. Fuites sur le site live — à fermer avant toute invitation

Vérifié aujourd'hui sans jeton :

| Route | Résultat |
|---|---|
| `GET /api/applications` | 200, 579 lignes avec `user_id` en clair |
| `GET /api/reports`, `/api/reports/<fichier>` | 200, tous les rapports (n° 1280 le 2026-11-02) |
| `GET /api/pipeline` | 200 |
| `GET /api/cvs` | 200, liste des 4 PDF `Hugo_Vermot_CV*.pdf` |
| `GET /api/cvs/Hugo_Vermot_CV.pdf` | **200, le PDF du CV (téléphone, email)** |
| `GET /Hugo_Vermot_CV_Paris.pdf` | 200 |
| `GET /api/portals` | 200, 300 Ko de config |

Cause : `VIEW_ONLY_PATHS` (`ui/server.mjs:9345`) laisse passer ces GET sans jeton, et
`viewOnlyScope` (`ui/server.mjs:574`) rend `undefined` (aucun filtre) pour un appel anonyme ;
`/api/cvs/*` est exclu du garde. La clé service role contourne la RLS.

À faire :
- [ ] Anonyme : soit 401, soit un jeu de démo statique (jamais les lignes réelles). Le mode
      « View only » du login doit pointer sur ce jeu de démo.
- [ ] `/api/cvs/*`, `/output/*`, `/Hugo_Vermot_CV_*.pdf` : admin uniquement. Garder un seul
      lien public volontaire pour le portfolio si besoin.
- [ ] Retirer `user_id` des réponses JSON.
- [ ] `POST/PATCH/PUT/DELETE /api/portals` et `POST/PATCH /api/queries`
      (`ui/server.mjs:9778`, `9816`) : aucun contrôle admin, tout compte connecté modifie le
      `portals.yml` partagé. Ajouter `isAdminUser` comme sur `/api/run/*`.
- [ ] Données de test en prod : 2 lignes `Acme` / `Beta` (fixtures du 2026-10-17) dans la table
      `applications` live, à supprimer.

**Fait le 2026-11-04 (code, pas encore déployé)** : sans jeton, `/api/applications`,
`/api/pipeline`, `/api/reports`, `/api/cvs` répondent `[]` et leurs sous-routes (un rapport,
un PDF, `pipeline/dropped`, `monetization/affiliates`) répondent 401 ; le dashboard du
propriétaire ouvre ses PDF avec `?_token=`. `user_id` retiré des réponses applications et
pipeline. Écritures `/api/portals*` et `/api/queries*` réservées à l'admin. `extension/**`
ajouté aux `includeFiles`. Lignes Acme / Beta supprimées de Supabase. Gardé volontairement :
`/Hugo_Vermot_CV_Complete_Paris.pdf`, lien « Download CV » du portfolio. Le mode « View only »
montre maintenant un dashboard vide : un jeu de démo reste à faire.

## 2. Plugin : ce qui manque pour qu'il marche en ligne

État : `extension/manifest.json` 0.0.51, chargé « non empaqueté ».

- `BRIDGE_URL = 'ws://127.0.0.1:3210/apply-bridge'` (`extension/background.js:35`),
  `DASHBOARD_URL` en dur dans `popup.js:1` et `background.js:517`.
- `content_scripts.matches` ne couvre que `127.0.0.1:3210` / `localhost:3210` : sur
  jobyougo.xyz, le dashboard ne voit jamais le plugin et l'appairage par compte
  (`/api/apply/bridge-pair`) ne peut pas avoir lieu.
- Sur Vercel, `bridge-pair`, `apply/start` et les routes plugin renvoient 400 « needs the local
  server » ; `bridge-status` force `connected: false`.
- **Le bouton Download du dashboard est cassé en prod** : `GET /api/apply/extension.zip` →
  500 `ENOENT /var/task/extension/README.md` (le dossier `extension/` n'est pas dans
  `vercel.json` `includeFiles`).
- Installation actuelle : dézipper + mode développeur + « Charger non empaqueté ». Chrome
  affiche un avertissement, et un utilisateur lambda abandonne à cette étape.

À faire :
- [ ] **Héberger le serveur Node en continu** (Fly.io, Railway, Render ou un VPS). Le
      `Dockerfile` existe déjà. `ui/server.mjs` est un serveur `http` avec WebSocket attaché :
      il tourne tel quel, sans les limites Vercel (pas de WebSocket, `/tmp` effacé, durée
      max, 250 Mo). Vercel peut garder la landing et l'agence, ou tout passer sur le même
      hôte.
- [ ] Plugin : URL du serveur configurable (`wss://jobyougo.xyz/apply-bridge` en prod,
      localhost en dev, choix stocké dans `chrome.storage`), `content_scripts.matches` +
      `https://jobyougo.xyz/*`, liens popup vers le site live.
- [ ] **Publier sur le Chrome Web Store** (compte développeur 5 $ une fois, à créer par toi).
      Points de revue à préparer :
      - `debugger` + `<all_urls>` sont les deux permissions qui déclenchent une revue
        manuelle longue. Justifier chacune (upload du CV dans les formulaires, remplissage de
        n'importe quel ATS) ; envisager `optional_host_permissions` demandées au premier
        apply.
      - Politique de confidentialité publique obligatoire (voir § 4), déclaration des données
        collectées (profil, CV, contenu des formulaires).
      - Captures, icône 128, description, vidéo courte.
- [ ] En attendant la publication : réparer le zip (ajouter `extension/**` aux
      `includeFiles`) pour que le lien manuel marche.
- [ ] Données de compte sur disque : le CV d'un compte (`readAccountCv(WRITE_ROOT, …)`) et
      les jetons d'appairage (`data/apply-files/bridge-pairs.json`) vivent sur le disque.
      Sur l'hôte : volume persistant, ou Supabase Storage / une table.

## 3. Mettre le plugin en avant

Aujourd'hui le plugin n'apparaît que dans une petite puce de la barre du haut
(`#plugin-chip`, `ui/index.html:4591`). Rien sur la landing, rien dans l'onboarding.

- [ ] **Landing** (`ui/landing.html`, zéro mention aujourd'hui) : une section dédiée « Postule
      depuis ton propre Chrome » avec une capture du panneau sur une vraie offre, ce que ça
      change (formulaires remplis, CV joint, tu gardes la main sur Envoyer), et un bouton
      « Ajouter à Chrome » vers la fiche Web Store. Mention dans le hero en lien secondaire.
- [ ] **Onboarding** : étape finale « Installe le plugin » avec bouton Web Store, détection en
      direct (la puce passe au vert) et lien « plus tard ».
- [ ] **Dashboard** : bannière d'accueil tant que le plugin n'est pas connecté, et sur chaque
      bouton Apply un état clair « Nécessite le plugin » au lieu d'un échec.
- [ ] Une fois publié, remplacer les 4 étapes « mode développeur » du panneau par le bouton
      Web Store.
- [ ] Mesurer : clic « Ajouter à Chrome » et première connexion du plugin (Vercel Analytics
      events), pour savoir où les gens décrochent.

## 4. Légal et compte (obligatoire en UE, et pour le Web Store)

- [ ] Pages Confidentialité + CGU pour le produit (404 aujourd'hui sur `/privacy`, `/terms`,
      `/legal`) ; lien sur la landing, le login et l'onboarding ; case d'acceptation à
      l'inscription.
- [ ] Suppression de compte (`auth.admin.deleteUser` + cascade + fichiers sur disque) et export
      JSON du profil, des rapports et des candidatures : un CV est une donnée personnelle.
- [ ] Bannière cookies si des traceurs non essentiels sont ajoutés (Vercel Analytics sans
      cookie n'en demande pas ; les canaux pub de `config/monetization.yml` si).
- [ ] Mention claire que l'utilisateur relit et clique Envoyer lui-même (règle du produit).

## 5. Données multi-utilisateurs encore partagées

- [ ] **Numéros de rapport** : `applications` upserté sur `onConflict: 'num'`
      (`ui/server.mjs:7995`, `12170`) et `reports` sur `filename` (`12087`, `12769`), séquence
      globale. Le rapport n° N d'un compte écrase la ligne n° N d'un autre. Passer à
      `unique (num, user_id)` / `unique (filename, user_id)` et une numérotation par compte.
- [ ] `getAdminUserId` retombe encore sur le `user_id` de la première ligne si `ADMIN_EMAIL`
      manque : vérifier que `ADMIN_EMAIL` est bien défini sur l'hôte de prod.
- [ ] Mémoire de scan, sources et dédup par compte : à revérifier sur l'hôte choisi
      (`data/accounts/<id>/` doit être sur un volume persistant).

## 6. Coûts et abus

- [ ] Quotas par compte sur les évaluations et scans (`/api/claude/*`). Seuls `cv-parse`
      (12/h) et `/api/hrhv` ont une limite. Les modèles gratuits passent d'abord
      (`lib/free-llm.mjs`), mais la clé OpenRouter payante reste le dernier recours.
- [ ] Limite par IP sur signup / login, et captcha Supabase (hCaptcha / Turnstile) activé.
- [ ] Alerte de dépense OpenRouter, Gemini et Supabase.

## 7. Exploitation

- [ ] Supabase : SMTP personnalisé (le SMTP par défaut est limité à quelques mails par heure),
      Site URL + Redirect URLs sur le domaine final, « Confirm email » activé.
- [ ] Sauvegardes Supabase (plan payant ou export planifié).
- [ ] Logs et erreurs : Sentry ou équivalent sur le serveur et le plugin.
- [ ] Un vrai parcours de bout en bout par toi avec un compte de test : inscription, onboarding,
      installation du plugin depuis le site, scan, évaluation, apply jusqu'avant Envoyer.
- [ ] Déploiement : aujourd'hui manuel depuis le dossier local (fichiers non committés inclus).
      Sur le nouvel hôte, déployer depuis `main` uniquement.

## Ordre proposé

| Étape | Contenu | Taille |
|---|---|---|
| 0 | § 1 : fuites live, admin sur portals/queries, fixtures, zip du plugin | 1 jour |
| 1 | Hôte Node continu + plugin configurable sur `wss://jobyougo.xyz` | 2-4 jours |
| 2 | Légal (confidentialité, CGU, suppression, export) | 1-2 jours |
| 3 | Publication Chrome Web Store (revue : 1 à 3 semaines avec `debugger`) | à lancer tôt |
| 4 | Mise en avant du plugin : landing, onboarding, dashboard | 1-2 jours |
| 5 | Numérotation par compte, quotas, SMTP, monitoring | 2-3 jours |

À faire par toi (pas automatisable ici) : choisir l'hôte et créer le compte, compte
développeur Chrome Web Store, réglages Supabase (SMTP, captcha, redirect URLs), validation des
textes légaux.
