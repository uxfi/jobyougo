# JobYouGo — préparation à l'accueil de nouveaux utilisateurs

Audit du 2026-09-30 sur le code de `JobYouGo/` (fork uxfi/jobyougo) et sur le site live
https://jobyougo.xyz (Vercel). Périmètre : création de compte, import CV + génération de profil
par IA, onboarding, isolation des données entre utilisateurs, exécution hébergée.

## Verdict

| Parcours | État | Note |
|---|---|---|
| Création de compte (email + mot de passe) | Fonctionne | Pas de reset de mot de passe, pas d'OAuth, pas de CGU, SMTP Supabase à vérifier |
| Import CV → profil par IA | Fonctionne de bout en bout | Le profil sauvegardé n'alimente que partiellement les évaluations (bug de forme) |
| Onboarding 8 étapes + redirection | Fonctionne | Ancien branding "JobYouGo" violet, aucune suite guidée après |
| Isolation multi-utilisateur | **Non prêt** | Fuites publiques, collisions de numéros, données du propriétaire codées en dur |
| Exécution hébergée (scan, éval, CV PDF, apply) | **Non prêt** | Sur Vercel : navigateur absent, disque éphémère, pas de `maxDuration`, apply refusé |

Conclusion : un inconnu peut aujourd'hui créer un compte et remplir son profil, mais il ne peut
rien faire d'utile ensuite sur le site hébergé, et sa présence exposerait ses données et
celles du propriétaire. Il faut fermer les fuites (phase 0) avant toute invitation, puis
isoler les données (phase 1) avant une alpha fermée.

## Ce qui existe et fonctionne

- **Landing** `ui/landing.html` : "Get started" et "Analyze your first job" mènent à `/login`.
- **Login / signup** `ui/login.html` : `supabase.auth.signInWithPassword` et `signUp` avec
  `full_name` en metadata ; message "Check your email to confirm". Mode "View only" invité.
- **Schéma** `supabase/schema.sql` : table `profiles` (1 ligne par `auth.users`, créée par le
  trigger `handle_new_user`), colonnes `user_id` sur `applications`, `pipeline`, `reports`,
  RLS "own or admin". Le serveur utilise la clé service role, donc la RLS ne protège rien côté
  serveur : l'isolation repose uniquement sur les `eq('user_id', …)` du code.
- **Onboarding** `ui/onboarding.html` : étape 0 import (PDF lu côté client par pdf.js, .txt/.md,
  ou collage, 5 Mo max) → `POST /api/profile/cv-parse` → Qwen via OpenRouter
  (`parseCvForProfile`, `ui/server.mjs:5190`) renvoie un JSON strict (règle "never invent") qui
  pré-remplit identité, rôles, narrative, compensation, localisation, critères. Étapes 1-7 avec
  validation (nom, email, localisation, rôles cibles, pays, CV markdown), brouillon en
  localStorage par utilisateur, puis `PUT /api/profile` + `PUT /api/profile/cv`.
- **Gate** : `/login` et `/dashboard` appellent `GET /api/profile/status`
  (`getProfileStatus`, `ui/server.mjs:5112`) ; incomplet → `/onboarding`.
- **Page profil** du dashboard (`ui/index.html`, `renderProfile`) : lit la ligne plate Supabase
  via `normalizeProfileData`, bannière "onboarding" avec les manques.

## Blocages, par gravité

### A. Fuites de données (confirmées sur le site live)

1. **Lecture anonyme des évaluations de tout le monde.** `VIEW_ONLY_PATHS`
   (`ui/server.mjs:6577`) laisse passer sans jeton `GET /api/reports`, `/api/applications`,
   `/api/pipeline` et `/api/reports/<fichier>`. Sans `userId`, `getReports` / `getApplications`
   / `getPipeline` n'ajoutent aucun filtre, et la clé service role contourne la RLS.
   Vérifié le 2026-09-30 : `https://jobyougo.xyz/api/reports` répond 200 (277 rapports),
   `/api/applications` 200, `/api/pipeline` 200 avec les `user_id` en clair, et le contenu d'un
   rapport se lit sans jeton. Aujourd'hui ce sont les données du propriétaire ; dès le
   deuxième inscrit, ce seront aussi les siennes.
2. **PDF sans authentification.** `/api/cvs/*` est explicitement exclu du garde
   (`ui/server.mjs:6583`) et `/output/*.pdf` (`ui/server.mjs:8607`) sert tout le dossier
   `output/`. Vide sur Vercel, mais sur le serveur local ce sont les CV et lettres du
   propriétaire. `/Hugo_Vermot_CV_Paris.pdf` est aussi une route publique (`8582`).
3. **Profil du propriétaire en clair (serveur local).** `GET /api/profile` en view-only appelle
   `getProfile(undefined)` qui lit `config/profile.yml` (téléphone, email, salaire). Sur Vercel
   la route renvoie 500 uniquement parce que le fichier n'est pas déployé.
4. **Lecture croisée entre comptes.** `getReport` (`ui/server.mjs:1016`) retombe sur une requête
   sans filtre utilisateur : tout compte authentifié lit le rapport d'un autre par son nom de
   fichier, et les noms sont séquentiels (`277-…`).
5. **Actions serveur ouvertes à tout compte.** `POST /api/run/{merge,normalize,dedup,
   purge-stale,sync-apps}` (`ALLOWED_SCRIPTS`, `5630`) et les PATCH de `/api/portals` et
   `/api/queries` modifient les fichiers locaux partagés (`portals.yml`, `data/*`).

### B. Modèle de données pas multi-tenant

6. **Collision des numéros de rapport.** `applications` est upserté sur `onConflict: 'num'`
   (`5706`, `8444`) et `reports` sur `filename` (`8377`, `8940`). Le numéro vient d'une séquence
   globale sur disque (`reserve-report-num.mjs`). L'évaluation n°123 de l'utilisateur B écrase
   la ligne n°123 de A.
7. **Rapport attribué à l'admin sur Vercel.** `ui/server.mjs:8374-8377` écrit `user_id =
   adminId` au lieu de `req.userId` : le nouvel utilisateur ne voit pas son rapport dans sa
   liste (filtrée par `user_id`).
8. **Le tracker local du propriétaire fuit vers les autres comptes.** Hors Vercel,
   `getApplications` ré-injecte les lignes de `data/applications.md` absentes de Supabase dans
   la liste de n'importe quel utilisateur (`886-896`), et `syncLocalApplicationsToSupabase
   (req.userId)` (`5690`) pousse tout le tracker local sous l'id de l'utilisateur courant.
9. **Le profil Supabase n'alimente pas les évaluations.** `buildProfileCriteriaBlock` reçoit la
   ligne plate (`location` = chaîne, `location_prefs`, `search_prefs`) mais
   `inferProfileMatchingRules` (`5241`) lit `profileData.location.*`, `.search.*`,
   `.candidate.*`. Pour tout compte Supabase, localisation, télétravail, sponsorship, critères
   must/nice/deal-breakers sont silencieusement vides dans le prompt d'évaluation. Seuls
   `target_roles`, `narrative`, `compensation` passent.
10. **Faits du propriétaire codés en dur.** Prompt d'évaluation : "outside Thailand"
    (`5379-5383`). Réponses de secours pour l'apply : lit `ROOT/cv.md` et "Paris / Bangkok"
    (`7028-7033`). `/api/cv-pdf` nomme `cv-hugo-vermot-*.pdf` et rend `data/cv-profiles.yml`
    (portrait, stats, expériences du propriétaire) : le "CV sur mesure" d'un nouvel
    utilisateur serait celui d'Hugo. `lib/apply-spec.mjs` cherche `Hugo_Vermot_CV_*.pdf` et
    l'identité de `config/profile.yml`. `renderBaseCV(profileKey, userId)` existe mais n'est
    appelé nulle part.
11. **Config de scan partagée.** `portals.yml` (100+ entreprises, requêtes) est un fichier unique :
    un utilisateur qui coche ou décoche une source change le scan de tous. Sur Vercel le
    fichier n'est même pas déployé (`/api/portals` → 500 ENOENT).

### C. Exécution hébergée (Vercel)

12. `WRITE_ROOT = /tmp` : `data/*`, `reports/`, `scan-history.tsv` (dédup) disparaissent à
    chaque cold start. Aucun `maxDuration` dans `vercel.json` ni dans le serveur : les SSE
    `/api/claude/scan|pipeline` de plusieurs minutes seront coupés par le timeout Vercel.
13. Navigateur local désactivé (`fetchPlaywrightSectionsLocal`, `launchLocalBrowserContext`),
    donc une partie des sources de scan renvoie une erreur ; `pdf-gen` lance Playwright ;
    `/api/apply/start` renvoie 400 "requires a local server". L'extension Chrome est un
    "dev POC" chargé en non empaqueté, câblée sur `ws://127.0.0.1:3210`.
14. Le dashboard n'a aucun drapeau "hébergé" : les boutons Scan, Auto-apply, PDF s'affichent et
    échouent.

### D. Compte, légal, coûts

15. Pas de "mot de passe oublié" (`resetPasswordForEmail`), pas de lien magique / OAuth, pas de
    changement d'email, pas de suppression de compte ni d'export (RGPD : un CV est une donnée
    personnelle), pas de CGU ni de politique de confidentialité sur la landing.
16. Emails Supabase : le SMTP par défaut est limité à quelques envois par heure et l'expéditeur
    est `noreply@mail.app.supabase.io`. Confirmation d'email, URL de redirection et SMTP
    personnalisé (une clé `ELASTICMAIL_API_KEY` existe dans `.env`, inutilisée) sont à vérifier
    dans le dashboard Supabase.
17. `cv-parse` et tous les modes `/api/claude/*` consomment la clé OpenRouter du propriétaire
    sans quota par utilisateur (seul `/api/hrhv` a une limite par IP). La landing promet "bring
    your own AI key" mais aucun champ n'existe. Coûts unitaires faibles (≈ $0.0007 par éval,
    ≈ $0.005 par scan) mais inscription libre = abus possible.
18. Aucune vue admin (la colonne `is_admin` n'est utilisée nulle part côté client).

### E. Finitions onboarding

19. `login.html` et `onboarding.html` gardent le thème violet "JobYouGo", le logo "C" et le
    titre "JobYouGo — Sign in".
20. PDF scanné (image) → texte vide sans message explicite ; pas de gabarit de CV markdown si
    l'utilisateur saute l'import ; LinkedIn réclamé par la bannière du dashboard mais absent de
    l'étape Identité ; la soumission envoie `context_markdown: ''` et efface le contexte
    avancé si l'onboarding est rejoué ; anglais uniquement.
21. Après l'onboarding, le dashboard est vide : pas de "lance ton premier scan / évalue une URL",
    pas de sélection de sources par défaut, pas d'états vides.
22. Aucun test sur le garde d'auth, `profile/status`, `cv-parse`, l'isolation. 44 fichiers
    modifiés non committés au moment de l'audit.

## Plan

### Phase 0 — fermer les fuites du site live (1 jour, avant toute invitation)

- [ ] En mode Supabase, exiger un jeton sur `/api/reports`, `/api/reports/*`,
      `/api/applications`, `/api/pipeline` (ou servir un jeu de démo statique en view-only).
- [ ] Supprimer le repli sans filtre de `getReport` ; réserver le repli disque à l'admin.
- [ ] Mettre `/api/cvs/*`, `/output/*.pdf` et `/Hugo_Vermot_CV_*.pdf` derrière l'auth du
      propriétaire (ou les retirer du serveur public).
- [ ] Ajouter `requireAdmin(req)` (lecture de `profiles.is_admin`) sur `/api/run/*`, les PATCH
      `/api/portals`, `/api/queries`, `/api/scan-selection`, `bulk-discard-stale`.
- [ ] Ne plus renvoyer `user_id` dans les réponses JSON.

### Phase 1 — isolation réelle par utilisateur (≈ 1 semaine)

- [ ] `normalizeProfileRow()` côté serveur dans `getProfile` pour rendre la forme imbriquée
      (`candidate`, `location`, `search`) à l'évaluation, aux lettres et à l'apply.
- [ ] Retirer Thailand/Bangkok/Paris des prompts ; dériver du profil. `generateFallbackAnswers`
      → `getCvMarkdown(req.userId)`.
- [ ] Schéma : `applications unique (num, user_id)`, `reports unique (filename, user_id)` et
      numérotation par utilisateur (ou clé UUID + `display_num`). Corriger l'upsert Vercel des
      rapports pour utiliser `req.userId`.
- [ ] Réserver à l'admin la fusion du tracker local (`getApplications` lignes "missing",
      `syncLocalApplicationsToSupabase`).
- [ ] Sources de scan par utilisateur : table `user_portals` (ou colonne JSON) initialisée depuis
      `portals.yml` ; `scan_history(user_id, url, …)` en base plutôt qu'un TSV.
- [ ] CV PDF par utilisateur : construire les données de gabarit depuis `cv_markdown` + profil
      (reprendre `renderBaseCV`), nommage `cv-<slug-utilisateur>-…`, stockage Supabase Storage
      `cvs/<user_id>/` au lieu de `output/`.
- [ ] Tests : matrice anonyme / utilisateur / admin × routes, `profile/status`, robustesse JSON
      de `cv-parse`, isolation à deux comptes sur un projet Supabase de test.

### Phase 2 — un runtime hébergé qui exécute vraiment (1 à 2 semaines)

- [ ] Choisir le modèle : (a) service Node long-running (VPS, Fly, Railway) avec file de jobs
      pour scan / éval / PDF, Vercel gardant landing + auth ; ou (b) produit "local-first"
      (installeur + extension, le site ne fait que landing + compte). Recommandation : (a) pour
      scan/éval/PDF, apply reste local via l'extension.
- [ ] `GET /api/capabilities` → le dashboard masque Auto-apply / PDF / sources navigateur quand
      le runtime ne les supporte pas, avec un texte explicatif.
- [ ] Quotas par utilisateur (table `usage_counters` : cv-parse, évals, scans par jour) + limite
      par IP sur `cv-parse` ; champ optionnel "clé OpenRouter personnelle" chiffré pour tenir
      la promesse de la landing.
- [ ] Si Vercel est conservé pour l'API : `maxDuration` et découpage des SSE longs.

### Phase 3 — compte et onboarding (≈ 1 semaine)

- [ ] Mot de passe oublié (`resetPasswordForEmail` + page `/reset`), vérification de la
      confirmation d'email, URLs de redirection Supabase, SMTP personnalisé (Elastic Email).
- [ ] Rebrand `login.html` / `onboarding.html` sur le système JobYouGo (`:root` de
      `index.html`, logo "J", titres).
- [ ] Pages Confidentialité + CGU ; suppression de compte (`auth.admin.deleteUser`, cascade) ;
      export JSON (profil + rapports).
- [ ] Premier lancement guidé : carte "Évalue une offre / lance un scan", sources par défaut,
      états vides.
- [ ] Onboarding : message clair pour PDF scanné, LinkedIn à l'étape Identité, ne pas écraser
      `profile_context`, gabarit CV markdown si import sauté, FR/EN optionnel.
- [ ] Committer le travail en cours et tester l'inscription complète avec un compte de test
      (à faire par le propriétaire : la création de compte n'est pas automatisable ici).

## À vérifier dans le dashboard Supabase (non visible depuis le code)

- Auth → "Confirm email" activé ou non ; "Site URL" et "Redirect URLs" pointant sur
  `https://jobyougo.xyz` ; SMTP personnalisé ; limites de débit des emails.
- Contraintes uniques réelles des tables `applications` et `reports` (créées hors
  `schema.sql`).
