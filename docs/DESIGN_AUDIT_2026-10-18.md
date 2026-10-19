# Audit design du dashboard JobYouGo — 2026-10-18

Périmètre : `ui/index.html` (dashboard, Applications, Pipeline, Reports, CVs, Portals, Profile), plus les copies de tokens de `login.html`, `onboarding.html`, `reset-password.html`. Méthode : lecture du code (CSS, markup, rendu JS) avec la grille `audit-ai-design-slop` et la direction `tech-green-dark-mode-modern`. Aucune capture d'écran : les vérifications visuelles restent à faire par toi.

## Verdict

La direction (canvas sombre, émeraude comme seul signal, listes en cartes, labels mono pour les vrais identifiants) tient et n'a pas à changer. Les problèmes sont ailleurs : le dashboard affiche encore des étapes post-candidature que le produit ne suit pas, le flux scan → process → apply n'a pas sa deuxième commande là où l'utilisateur la cherche, et le thème est figé en sombre par 200 couleurs codées en dur. À retirer en premier : les statuts Responded / Interview / Offer / Rejected et la section « Interview » des rapports.

## Constats

| Priorité | Classe | Motif | Preuve (avant modification) | Nuisance | Décision |
|---|---|---|---|---|---|
| P1 | Défaut | Statuts post-candidature hors périmètre | Tokens `--st-responded/interview/offer/rejected` (l.58-61), badges `.badge-responded/interview/offer/rejected` (l.708-711), `STATUS_CLASS` / `STATUS_BADGE_ICONS` / `STATUS_KIND` (l.5832-5873), `UNDELETABLE_STATUSES` (l.5886-5894), `everApplied` énumère 13 statuts (l.6782), section « Interview » dans `RV_SECTIONS` (l.6148) | La liste Applications, son filtre Status et les rapports exposent des étapes que JobYouGo ne pilote pas (règle produit : search + apply) | **Appliqué.** Tout statut post-envoi est normalisé en `Applied` à la lecture ; tokens, badges, icônes retirés ; la section F des rapports n'est plus rendue |
| P1 | Défaut | Un seul thème | `color-scheme: dark` (l.23) ; 136 `rgba(255,255,255,…)`, 23 `rgba(0,0,0,…)`, 42 `rgba(45,212,160,…)` et 19 `rgba(239,107,107,…)` en dur dans le CSS ; trois copies divergentes des tokens (login l.17, onboarding l.18, reset l.15) | Impossible de proposer une version claire ; chaque changement de token doit être reporté à la main | **Appliqué.** Tokens RGB (`--fg-rgb`, `--accent-rgb`, `--danger-rgb`, `--warn-rgb`, `--shadow-k`), surfaces flottantes tokenisées (`--glass`, `--pop`, `--scrim`, `--bulk-bg`), bloc `:root[data-theme="light"]`, bascule Dark / Light dans la sidebar, mémorisée dans `localStorage` et appliquée avant le premier rendu sur les quatre pages |
| P1 | Défaut | L'étape 2 du flux n'a pas de commande sur le dashboard | `#dashboard-command-row` ne contient que « Run scan » (l.4756-4765) alors que le hero annonce « N roles waiting in the queue » ; `forEach(btn => btn.classList.add('is-primary'))` (l.6898) rend tous les boutons primaires | On lit « 12 rôles en attente » et on n'a que « Run scan » sous la main ; « Process offers » n'existe que dans Pipeline | **Appliqué.** « Process N offers » devient le primaire quand la file est pleine, « Run scan » passe en secondaire ; un seul primaire à la fois |
| P1 | Défaut | Sélection des lignes Pipeline inaccessible au clavier | `.pipeline-item` est une `div` cliquable avec `aria-selected` mais sans rôle ni `tabindex` ; la case `.pipeline-select` est un `<span aria-hidden>` (l.9108-9112) | Pas de sélection au clavier ni au lecteur d'écran ; `aria-selected` est invalide sur une `div` | **Appliqué.** Vraie case `<button role="checkbox">`, même modèle que les cartes Applications |
| P2 | Slop | Deux styles de bouton primaire | `.btn-action.is-primary` (pilule, l.538) et `.dashboard-command-row .btn-action.is-primary` (dégradé, icône encadrée, rayon 12 px, 42 px, l.2814-2841) | Le « primaire » change de forme entre Dashboard et Pipeline ; empilement dégradé + inset + glow + beam sur un seul bouton | **Appliqué.** Une définition (la pilule système, 40 px dans le hero) ; le beam reste |
| P2 | Slop | Figure décorative dans le hero | `.dashboard-hero-art` + `hairline-fig terrain` (l.4752-4754), chargée par `landing-figures.js` (76 Ko, l.5790), déjà masquée sous 960 px | Aucune information ; un module entier pour une vignette | **Appliqué.** Figure et script retirés du dashboard (`/agence` charge toujours le sien) |
| P2 | Slop | Le même compteur « ready to apply » à quatre endroits | Tuile KPI (l.6936), puce du panneau Funnel (l.6978), carte « Next best move » (l.6855), panneau « Ready to apply » (l.7073) | Redite ; la puce n'appartient pas à Found → Evaluated → Applied | **Appliqué.** Puce du Funnel retirée ; les trois autres portent une information différente (liste, compteur, prochain geste) |
| P2 | Défaut | Les effets suivent le thème de l'OS, pas celui de la page | `effects.js` lit `[data-theme]` sur un ancêtre, sinon `prefers-color-scheme` ; la page ne posait aucun `data-theme` | Sur une machine réglée en clair, orbes et beams pouvaient se rendre en variante claire sur le dashboard sombre (non vérifié à l'écran) | **Appliqué.** `data-theme` explicite sur `<html>` |
| P2 | Défaut | Lien « Portfolio » du propriétaire dans la barre d'un produit multi-comptes | `.btn-portfolio-switch` (l.4707-4710), sans condition de compte | Chaque utilisateur voit un lien vers le site personnel du propriétaire | **Non modifié.** Pas d'indicateur « owner » côté client ; à conditionner côté serveur si le produit s'ouvre |
| P3 | Défaut | Copie | « Deal-breakers (un par ligne) » dans une UI en anglais (l.5169) ; onboarding « say it in an interview » (l.568) | Langue mélangée ; mot hors périmètre | **Appliqué** |
| P3 | Défaut | Contraste des numéros de ligne | `.rc-num` en `--text-5` (#545c58) à 11 px sur `--surface` ≈ 2,7:1 (l.3967) | Numéro d'offre illisible | **Appliqué.** `--text-4` (≈ 4,7:1) |
| P3 | Défaut | Trois copies des tokens | `login.html`, `onboarding.html`, `reset-password.html` portent chacun leur `:root` (onboarding sans `--accent-glow`) | Dérive à chaque changement | **Partiel.** Thème clair ajouté aux trois ; la fusion en un fichier partagé reste à faire |

## Conservé volontairement

- Labels mono en capitales sur les vrais identifiants, dates et compteurs (sidebar, hero, tuiles) : c'est la signature « instrumentée » du système.
- Le beam sur la commande primaire et les orbes du dock : ils signalent un état (commande en cours), pas une décoration.
- Les listes en cartes (pas de tableau), les filtres en puces, le modal unique : décisions produit du 2026-10-09.
- La page marketing `landing.html` reste sombre : elle n'est pas dans l'app et n'a pas de bascule.

## Inconnues

- Rendu réel des deux thèmes (contrastes calculés depuis les tokens, pas mesurés à l'écran).
- Comportement des effets metal-fx / orbes en clair : à regarder à l'œil, le bundle choisit lui-même sa variante d'après `data-theme`.
- Tracker : les lignes qui portent encore `Interview` ou `Offer` côté fichier restent telles quelles ; seule la lecture UI les affiche en `Applied`. Les scripts CLI hérités de career-ops (`interview-prep/`, `outcome.mjs`, `negotiation-roi.mjs`, `followup-*.mjs`) ne sont pas chargés par l'app et n'ont pas été touchés.

## Skills utilisés

`audit-ai-design-slop` (grille et test de retrait), `tech-green-dark-mode-modern` (direction conservée), `light-mode-paper-technical` (surfaces papier froides plutôt que blanc pur pour la version claire), `dataviz` (rampe ordinale du funnel recalculée pour fond clair).
