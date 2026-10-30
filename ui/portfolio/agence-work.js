/* v2 studio, work and business pages (/agence/showcase, /agence/services).
   Seven projects told in the studio's voice, rewritten from the portfolio data (ui/portfolio/data.js) without new
   claims, EN + FR. Renders into whatever host the page has:
     #work-grid (+ #work-filters)  the filterable project list
     #work-detail                  one project, opened by the hash #work/<id> (same idea as the portfolio's #project/<id>)
     #biz                          services by type of business, with the related projects
   Language follows <html lang> (agence-story.js sets it), re-rendered when it changes. */
(function () {
  'use strict';
  const d = document;
  const root = d.documentElement;
  const lang = () => (root.lang === 'fr' ? 'fr' : 'en');
  // Visitors in other languages read the English copy through the machine translation (agTrDeep, agence shells).
  const tx = (v) => (typeof agTrDeep === 'function' ? agTrDeep(v) : v);
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ── Types of business ── */
  const BIZ = [
    { id: 'saas', en: 'SaaS & B2B', fr: 'SaaS & B2B', c: 'color-mix(in srgb, var(--p-blue) 42%, var(--ink))', c2: 'var(--p-blue)' },
    { id: 'ai', en: 'AI products', fr: 'Produits IA', c: 'color-mix(in srgb, var(--p-purple) 42%, var(--ink))', c2: 'var(--p-purple)' },
    { id: 'fintech', en: 'Fintech & banking', fr: 'Fintech & banque', c: 'color-mix(in srgb, var(--p-moss) 42%, var(--ink))', c2: 'var(--p-moss)' },
    { id: 'proptech', en: 'Real estate', fr: 'Immobilier', c: 'color-mix(in srgb, var(--p-sienna) 42%, var(--ink))', c2: 'var(--p-sienna)' },
    { id: 'ecommerce', en: 'E-commerce & retail', fr: 'E-commerce & retail', c: 'color-mix(in srgb, var(--p-orange) 42%, var(--ink))', c2: 'var(--p-orange)' },
    { id: 'marketplace', en: 'Marketplaces', fr: 'Marketplaces', c: 'color-mix(in srgb, var(--p-yellow) 42%, var(--ink))', c2: 'var(--p-yellow)' },
    { id: 'luxury', en: 'Luxury & beauty', fr: 'Luxe & beauté', c: 'color-mix(in srgb, var(--p-pink) 42%, var(--ink))', c2: 'var(--p-pink)' },
    { id: 'mobility', en: 'Mobility & travel', fr: 'Mobilité & voyage', c: 'color-mix(in srgb, var(--p-cyan) 42%, var(--ink))', c2: 'var(--p-cyan)' },
    { id: 'enterprise', en: 'Large groups', fr: 'Grands groupes', c: 'color-mix(in srgb, var(--p-lime) 42%, var(--ink))', c2: 'var(--p-lime)' },
  ];

  /* ── UI strings ── */
  const L = {
    en: {
      work_title: 'Selected work,<br><em>from brief to launch.</em>',
      work_lede: 'Seven products we designed, from a luxury group’s data platform to our own AI SaaS. Pick a project to see the brief, what we did and what changed.',
      all: 'All',
      view: 'View the project',
      back: 'All projects',
      brief: 'The brief',
      did: 'What we did',
      how: 'How we worked',
      result: 'The result',
      sector: 'Sector',
      year: 'Year',
      platforms: 'Platforms',
      scope: 'Scope',
      team: 'With',
      visit: 'Visit the site',
      next: 'Next project',
      prev: 'Previous',
      cta: 'Want this level of finish on your product?',
      cta_btn: 'Start a project',
      biz_title: 'Built around<br><em>your kind of business.</em>',
      biz_lede: 'The packages stay the same. What we look at first depends on what you sell and who has to trust it.',
      biz_sr_problem: 'The problem:',
      biz_sr_fix: 'What we do:',
      proj_1: '1 project', proj_n: '{n} projects',
      biz_see: 'What we do for it',
      doc_title: '{name}, a v2 studio project',
    },
    fr: {
      work_title: 'Projets choisis,<br><em>du brief au lancement.</em>',
      work_lede: 'Sept produits que nous avons conçus, de la plateforme data d’un groupe de luxe à notre propre SaaS IA. Choisissez un projet pour voir le brief, ce que nous avons fait et ce qui a changé.',
      all: 'Tous',
      view: 'Voir le projet',
      back: 'Tous les projets',
      brief: 'Le brief',
      did: 'Ce que nous avons fait',
      how: 'Comment nous avons travaillé',
      result: 'Le résultat',
      sector: 'Secteur',
      year: 'Année',
      platforms: 'Plateformes',
      scope: 'Périmètre',
      team: 'Avec',
      visit: 'Voir le site',
      next: 'Projet suivant',
      prev: 'Précédent',
      cta: 'Vous voulez ce niveau de finition sur votre produit ?',
      cta_btn: 'Lancer un projet',
      biz_title: 'Pensé pour<br><em>votre type d’activité.</em>',
      biz_lede: 'Les formules restent les mêmes. Ce que nous regardons en premier dépend de ce que vous vendez et de qui doit vous faire confiance.',
      biz_sr_problem: 'Le problème :',
      biz_sr_fix: 'Ce que nous faisons :',
      proj_1: '1 projet', proj_n: '{n} projets',
      biz_see: 'Ce que nous faisons',
      doc_title: '{name}, un projet v2 studio',
    },
  };
  const s = (k) => tx((L[lang()] && L[lang()][k]) || L.en[k] || '');

  /* ── The projects ── */
  const WORK = [
    {
      id: 'lvmh', company: 'LVMH Group', logo: '/images/lvmh.png', hero: '/images/lvmh-cover.webp', card: '/covers/lvmh.webp',
      biz: ['luxury', 'enterprise'], year: '2022 – 2023', url: 'https://www.lvmh.com', platforms: { en: 'Desktop', fr: 'Desktop' },
      en: {
        sector: 'Luxury · Group data platform',
        tagline: 'One data marketing platform for 15+ maisons',
        summary: 'A shared platform where CRM signals from the LVMH maisons land in one hub, and teams filter and export macro customer profiles.',
        challenge: 'Each maison already ran its own CRM. LVMH needed one platform that brings those streams into a single store and lets teams build macro profiles, without erasing what makes Dior, Louis Vuitton or Kenzo different.',
        approach: 'We interviewed CRM teams across the maisons to find where their needs meet and where they clash, mapped the customer journey to ground the data model, then designed the path from maison sources to a central tool to exportable profiles.',
        steps: [
          ['Interviews across maisons', 'Sessions with one to three CRM people from three or more maisons, mixed sectors and seniority, all answering the same question: what does this maison need from a shared platform?'],
          ['A customer journey map', 'From social discovery to in-store trial, purchase and post-purchase sharing: touchpoints, data collected and pain points at each stage.'],
          ['Ingest, map, clean', 'Maisons push CRM and campaign events into a shared backbone: define a data kind, map fields, import through CSV, SQL or API, then clean.'],
          ['Macro profiles', 'Operators build, filter and export full customer profiles across brands, while each maison keeps its own field meanings where it needs them.'],
        ],
        outcome: 'The shared data marketing platform runs across 15+ maisons, including Dior, Louis Vuitton, Fendi and Kenzo. Maison streams land in one tool; teams filter and export macro customer profiles.',
        stat: ['15+', 'maisons on one platform'],
        scope: ['User research', 'Journey mapping', 'Data flows', 'Platform UI'],
        team: 'Product Owner, CRM teams across the maisons, development teams',
      },
      fr: {
        sector: 'Luxe · Plateforme data groupe',
        tagline: 'Une plateforme data marketing pour plus de 15 maisons',
        summary: 'Une plateforme commune où les signaux CRM des maisons LVMH arrivent dans un même hub, et où les équipes filtrent et exportent des profils clients consolidés.',
        challenge: 'Chaque maison avait déjà son propre CRM. LVMH voulait une plateforme qui réunisse ces flux dans une base unique et permette de construire des profils consolidés, sans effacer ce qui distingue Dior, Louis Vuitton ou Kenzo.',
        approach: 'Nous avons interrogé les équipes CRM de plusieurs maisons pour voir où leurs besoins se rejoignent et où ils divergent, cartographié le parcours client pour ancrer le modèle de données, puis conçu le chemin des sources de chaque maison vers un outil central et des profils exportables.',
        steps: [
          ['Des entretiens entre maisons', 'Des sessions avec une à trois personnes CRM venues d’au moins trois maisons, secteurs et niveaux mélangés, autour d’une même question : de quoi cette maison a-t-elle besoin dans une plateforme commune ?'],
          ['Une carte du parcours client', 'De la découverte sur les réseaux à l’essai en boutique, l’achat et le partage après achat : points de contact, données collectées et irritants à chaque étape.'],
          ['Importer, mapper, nettoyer', 'Les maisons envoient leurs événements CRM et de campagne dans un socle commun : définir un type de données, mapper les champs, importer en CSV, SQL ou API, puis nettoyer.'],
          ['Des profils consolidés', 'Les opérateurs construisent, filtrent et exportent des profils clients complets entre marques, et chaque maison garde ses propres définitions de champs quand elle en a besoin.'],
        ],
        outcome: 'La plateforme data marketing commune tourne dans plus de 15 maisons, dont Dior, Louis Vuitton, Fendi et Kenzo. Les flux des maisons arrivent dans un seul outil ; les équipes filtrent et exportent des profils clients consolidés.',
        stat: ['15+', 'maisons sur une même plateforme'],
        scope: ['Recherche utilisateur', 'Parcours client', 'Flux de données', 'Interface plateforme'],
        team: 'Product Owner, équipes CRM des maisons, équipes de développement',
      },
      gallery: [
        { kind: 'pair', items: [
          { src: '/images/lvmh-exp-map.png', en: 'Customer journey map: seven stages from social discovery to post-purchase sharing', fr: 'Carte du parcours client : sept étapes, de la découverte sur les réseaux au partage après achat' },
          { src: '/images/LVMH-persona.png', en: 'The persona that grounds the journey in a real buying pattern', fr: 'Le persona qui ancre le parcours dans un vrai comportement d’achat' },
        ] },
        { kind: 'full', src: '/images/lvmh-userflow.png', en: 'Platform flow: onboarding, data kinds, fields, import and cleaning, up to exported profiles', fr: 'Parcours de la plateforme : onboarding, types de données, champs, import et nettoyage, jusqu’aux profils exportés' },
        { kind: 'full', src: '/images/lvmh-screenshot.webp', en: 'The shared workspace where CRM teams run a common model day to day', fr: 'L’espace commun où les équipes CRM font vivre un modèle partagé au quotidien' },
      ],
    },
    {
      id: 'renault', company: 'Renault Group', logo: '/images/renault.png', hero: '/images/renault-cover.webp', card: '/covers/renault.webp',
      biz: ['marketplace', 'mobility', 'ecommerce', 'enterprise'], year: '2020 – 2021', url: 'https://fr.renew.auto/', platforms: { en: 'Mobile, desktop', fr: 'Mobile, desktop' },
      en: {
        sector: 'Automotive · Marketplace',
        tagline: 'Renew, a used-car marketplace across European markets',
        summary: 'A full redesign of Renault’s Renew marketplace for used cars: 23,900+ vehicles, several brands and European markets, on mobile and desktop, with back offices for dealerships and brand managers.',
        challenge: 'Design one marketplace for several brands and countries, with requirements coming from local teams and dealerships, for buyers who need specs, financing and a nearby dealer before they decide.',
        approach: 'We ran cross-functional workshops with international teams and dealerships, mapped the whole information architecture before drawing screens, kept everyone aligned through iterative wireframes, then designed automotive-specific patterns and two back-office tools.',
        steps: [
          ['Information architecture', 'Every page, content type and feature mapped for 23,900+ listings across brands and markets: the base for every design decision.'],
          ['Front office', 'Search, advanced filters, vehicle pages with lease and credit calculators, and a dealer locator, built around what buyers check before a purchase.'],
          ['Mobile', 'The filter panel and the lease calculator reworked so the controls stay readable on a small screen.'],
          ['Two back offices', 'One tool for dealerships to manage stock, listings and their online store; one for national brand managers to follow sales, KPIs and activity reports.'],
        ],
        outcome: 'A fully redesigned international marketplace on mobile and desktop: 23,900+ vehicles, several European markets, and back-office tools for dealerships and brand managers.',
        stat: ['23,900+', 'vehicles listed'],
        scope: ['Workshops', 'Information architecture', 'Marketplace UX', 'Back offices'],
        team: 'PO, PM, international markets, dealership leads, development teams',
      },
      fr: {
        sector: 'Automobile · Marketplace',
        tagline: 'Renew, une marketplace de véhicules d’occasion dans plusieurs pays d’Europe',
        summary: 'Une refonte complète de Renew, la marketplace de véhicules d’occasion de Renault : plus de 23 900 véhicules, plusieurs marques et marchés européens, sur mobile et desktop, avec des back-offices pour les concessions et les responsables de marque.',
        challenge: 'Concevoir une seule marketplace pour plusieurs marques et pays, avec des exigences venues des équipes locales et des concessions, pour des acheteurs qui veulent la fiche technique, le financement et une concession proche avant de se décider.',
        approach: 'Nous avons animé des ateliers avec les équipes internationales et les concessions, cartographié toute l’architecture de l’information avant de dessiner, aligné tout le monde par itérations de wireframes, puis conçu des patterns propres à l’automobile et deux outils de back-office.',
        steps: [
          ['Architecture de l’information', 'Chaque page, type de contenu et fonctionnalité cartographiés pour plus de 23 900 annonces, toutes marques et tous marchés : la base de chaque décision de design.'],
          ['Front-office', 'Recherche, filtres avancés, fiches véhicule avec calculateurs LOA et crédit, et carte des concessions, pensés autour de ce que l’acheteur vérifie avant d’acheter.'],
          ['Mobile', 'Le panneau de filtres et le calculateur LOA retravaillés pour rester lisibles sur petit écran.'],
          ['Deux back-offices', 'Un outil pour que les concessions gèrent stock, annonces et boutique en ligne ; un autre pour que les responsables de marque nationaux suivent ventes, KPI et rapports d’activité.'],
        ],
        outcome: 'Une marketplace internationale entièrement repensée, sur mobile et desktop : plus de 23 900 véhicules, plusieurs marchés européens, et des back-offices pour les concessions et les responsables de marque.',
        stat: ['23 900+', 'véhicules en ligne'],
        scope: ['Ateliers', 'Architecture de l’information', 'UX marketplace', 'Back-offices'],
        team: 'PO, PM, marchés internationaux, responsables de concessions, équipes de développement',
      },
      gallery: [
        { kind: 'full', src: '/images/renault-userflow.png', en: 'The information architecture, mapped from scratch across brands and countries', fr: 'L’architecture de l’information, cartographiée de zéro pour toutes les marques et tous les pays' },
        { kind: 'full', src: '/images/renault-screen.webp', en: 'Homepage, with the vehicle search as the entry point', fr: 'Page d’accueil, avec la recherche de véhicule en point d’entrée' },
        { kind: 'full', src: '/images/renault-mobile.webp', en: 'Mobile: homepage, search results, vehicle detail and the filter panel', fr: 'Mobile : accueil, résultats de recherche, fiche véhicule et panneau de filtres' },
        { kind: 'pair', items: [
          { src: '/images/renault-example.png', en: 'Dealership back office: vehicle editor and stock listing', fr: 'Back-office concession : éditeur de véhicule et liste du stock' },
          { src: '/images/renault-dashboard.png', en: 'Brand manager analytics: sales, market share, commissions, year-on-year KPIs', fr: 'Pilotage des responsables de marque : ventes, part de marché, commissions, KPI d’une année sur l’autre' },
        ] },
      ],
    },
    {
      id: 'oneasset', company: 'OneAsset', logo: '/images/oneasset-logo.png', hero: '/images/oneasset-dubai-skyline.jpg', card: '/images/oneasset-v2-inv-deal-full.webp?v=full', cardPos: '50% 0%',
      biz: ['fintech', 'proptech'], year: '2026', url: 'https://oneasset.io', platforms: { en: 'Desktop', fr: 'Desktop' },
      en: {
        sector: 'Fintech · Tokenized real estate',
        tagline: 'Tokenized commercial real estate, from the investor app to the back office',
        summary: 'Seven portals and a marketing site for a regulated product that sells shares of income-producing buildings in Dubai and pays the rent in USDC, built as one working prototype on a single design system.',
        challenge: 'Make a regulated, on-chain real estate product readable: what an investor owns, how rent becomes USDC, and what each operator must check before money moves, without ever implying a guaranteed return.',
        approach: 'We designed every persona’s journey inside one shared shell and built the whole product as an interactive React prototype on fixture data, with the design system as its single source of truth, reviewed screen by screen before handoff.',
        steps: [
          ['Seven portals, one shell', 'Investor, property manager, portfolio manager, listing, compliance, distribution and partner portals, each with its own navigation, onboarding (KYC, KYB) and account states.'],
          ['The money model on screen', 'The property money cycle and its five-state lifecycle turned into interface rules: yield labels that follow the lifecycle, a visible rent-to-USDC waterfall, reserves shown as governed infrastructure.'],
          ['A working prototype', 'An interactive React app with light and dark themes, built through AI agents and pull requests on GitHub, and reviewed in Figmol, an internal review board we built, before handoff.'],
        ],
        outcome: 'A working prototype of seven portals and the marketing site on one liquid-glass design system, reviewed screen by screen before handoff to engineering.',
        stat: ['7', 'portals in one prototype'],
        scope: ['Product strategy', 'Compliance journeys', 'Design system', 'React prototype'],
        team: 'The OneAsset product and engineering team',
      },
      fr: {
        sector: 'Fintech · Immobilier tokenisé',
        tagline: 'De l’immobilier commercial tokenisé, de l’app investisseur au back-office',
        summary: 'Sept portails et un site marketing pour un produit régulé qui vend des parts d’immeubles de rapport à Dubaï et verse les loyers en USDC, construits comme un seul prototype fonctionnel sur un même design system.',
        challenge: 'Rendre lisible un produit immobilier régulé et on-chain : ce que possède un investisseur, comment le loyer devient de l’USDC, et ce que chaque opérateur doit vérifier avant que l’argent circule, sans jamais laisser croire à un rendement garanti.',
        approach: 'Nous avons conçu le parcours de chaque persona dans une coque commune et construit tout le produit comme un prototype React interactif sur données fictives, avec le design system comme seule source de vérité, revu écran par écran avant la passation.',
        steps: [
          ['Sept portails, une coque', 'Portails investisseur, gestionnaire d’immeuble, gestionnaire de portefeuille, mise en vente, conformité, distribution et partenaires, chacun avec sa navigation, son onboarding (KYC, KYB) et ses états de compte.'],
          ['Le modèle financier à l’écran', 'Le cycle de l’argent et les cinq états de vie d’un actif traduits en règles d’interface : des libellés de rendement qui suivent le cycle, une cascade loyer → USDC visible, des réserves présentées comme une infrastructure encadrée.'],
          ['Un prototype qui fonctionne', 'Une app React interactive en thème clair et sombre, construite avec des agents IA et des pull requests sur GitHub, et revue dans Figmol, un outil de revue interne que nous avons créé, avant la passation.'],
        ],
        outcome: 'Un prototype fonctionnel de sept portails et du site marketing sur un même design system « liquid glass », revu écran par écran avant la passation aux développeurs.',
        stat: ['7', 'portails dans un seul prototype'],
        scope: ['Stratégie produit', 'Parcours de conformité', 'Design system', 'Prototype React'],
        team: 'L’équipe produit et technique de OneAsset',
      },
      gallery: [
        { kind: 'tall', src: '/images/oneasset-v2-inv-deal-full.webp?v=full', url: 'app.oneasset.io/deal', en: 'The deal page, scroll inside the window: raise progress, buy panel, return simulator, ownership chain and FAQ. The target yield is always labelled as a target.', fr: 'La page d’une opération, à faire défiler dans la fenêtre : levée en cours, panneau d’achat, simulateur de rendement, chaîne de propriété et FAQ. Le rendement cible est toujours présenté comme une cible.' },
        { kind: 'full', src: '/images/oneasset-v2-design-system.webp', en: 'The in-app design system catalogue: tokens, surfaces and components, kept in sync with the code', fr: 'Le catalogue du design system dans l’app : tokens, surfaces et composants, synchronisés avec le code' },
        { kind: 'tall', src: '/images/oneasset-v2-mkt-prelicence-full.webp', url: 'oneasset.io', en: 'The pre-licence marketing site, with the licence application status stated in the banner and the footer', fr: 'Le site marketing avant licence, avec l’état de la demande de licence affiché dans le bandeau et le pied de page' },
        { kind: 'full', src: '/images/oneasset-figmol.webp', en: 'Figmol: every persona board mirrors the live app, with review status and comment pins', fr: 'Figmol : chaque tableau de persona reflète l’app réelle, avec statut de revue et commentaires' },
      ],
    },
    {
      id: 'creads', company: 'Creads.io', logo: '/images/creads-logo.webp?v=20261030', hero: '/images/creads-live-hero.webp?v=20261030', card: '/covers/creads.webp?v=20261030',
      biz: ['saas', 'ai'], year: '2024 – 2026', url: 'https://www.creads.io/', platforms: { en: 'Web app', fr: 'App web' },
      en: {
        sector: 'AI SaaS · Our own product',
        tagline: 'AI advertising, from brand context to creative output',
        summary: 'Creads.io is the studio’s own AI advertising SaaS: it reads a brand, writes the brief and generates ads, then checks each output against the brief. Launched, with 1,200 registered users and 20 paying clients.',
        challenge: 'Carry a brand’s identity, audience and positioning through the brief and into the generated creative, and keep the whole workflow manageable for a small team.',
        approach: 'We structured the brand context as JSON kept in persistent memory, built the brief around explicit creative criteria, and added a second pass that checks every output against the brief before it is accepted.',
        steps: [
          ['Keep the brand context', 'A brand agent reads the website and structures identity, tone, audience and positioning; memory keeps that context from one session to the next.'],
          ['Make creative choices explicit', 'The brief records hook, emotion, composition, format, awareness stage, goal, wording rules, platform and audience, matched against 500+ taxonomy elements and 4,000+ templates.'],
          ['Check before accepting', 'One prompt generates, a second checks coherence and brief compliance. Workers run on Cloud Run, with Supabase, Vercel and Cloudflare behind the app.'],
        ],
        outcome: 'Designed, built and launched in-house, with no paid acquisition: 1,200 registered users and 20 paying clients.',
        stat: ['1,200', 'registered users'],
        scope: ['Product design', 'AI workflow', 'Brand system', 'Infrastructure'],
        team: 'In-house',
      },
      fr: {
        sector: 'SaaS IA · Notre propre produit',
        tagline: 'La publicité par l’IA, du contexte de marque à la création',
        summary: 'Creads.io est le SaaS publicitaire IA du studio : il lit une marque, rédige le brief et génère les publicités, puis vérifie chaque résultat face au brief. Lancé, avec 1 200 utilisateurs inscrits et 20 clients payants.',
        challenge: 'Faire passer l’identité, l’audience et le positionnement d’une marque à travers le brief jusqu’aux créations générées, et garder tout le parcours gérable pour une petite équipe.',
        approach: 'Nous avons structuré le contexte de marque en JSON conservé en mémoire persistante, bâti le brief autour de critères créatifs explicites, et ajouté une seconde passe qui vérifie chaque résultat face au brief avant de l’accepter.',
        steps: [
          ['Garder le contexte de marque', 'Un agent lit le site de la marque et structure identité, ton, audience et positionnement ; la mémoire garde ce contexte d’une session à l’autre.'],
          ['Rendre les choix créatifs explicites', 'Le brief consigne accroche, émotion, composition, format, niveau de conscience, objectif, règles de rédaction, plateforme et audience, croisés avec plus de 500 éléments de taxonomie et 4 000 modèles.'],
          ['Vérifier avant d’accepter', 'Un prompt génère, un second vérifie la cohérence et le respect du brief. Les workers tournent sur Cloud Run, avec Supabase, Vercel et Cloudflare derrière l’app.'],
        ],
        outcome: 'Conçu, développé et lancé en interne, sans acquisition payante : 1 200 utilisateurs inscrits et 20 clients payants.',
        stat: ['1 200', 'utilisateurs inscrits'],
        scope: ['Design produit', 'Parcours IA', 'Identité de marque', 'Infrastructure'],
        team: 'En interne',
      },
      gallery: [
        { kind: 'full', src: '/images/creads-v2-dashboard.webp?v=20261030b', en: 'Dashboard: a product URL is the entry point to a set of ads', fr: 'Tableau de bord : une URL produit sert d’entrée vers une série de publicités' },
        { kind: 'pair', items: [
          { src: '/images/creads-v2-studio.webp?v=20261030b', en: 'Studio: creative production, behind a brand setup gate', fr: 'Studio : la production créative, après la configuration de la marque' },
          { src: '/images/creads-v2-brand.webp?v=20261030b', en: 'Brand: identity set up before analysis and creative', fr: 'Marque : l’identité posée avant l’analyse et la création' },
        ] },
        { kind: 'pair', items: [
          { src: '/images/creads-bot.png', en: 'Chat: the agent that writes the brief and runs the generation', fr: 'Chat : l’agent qui rédige le brief et lance la génération' },
          { src: '/images/creads-admin.png', en: 'Products: the catalogue linked to generation', fr: 'Produits : le catalogue relié à la génération' },
        ] },
      ],
    },
    {
      id: 'jarvos', company: 'Jarvos Agent', logo: '/images/jarvos-logo.svg', hero: '/images/jarvos-cover.jpg', card: '/images/jarvos-cover.jpg',
      biz: ['ai'], year: '2025 – 2026', url: '', platforms: { en: 'Web, Telegram, desktop', fr: 'Web, Telegram, desktop' },
      en: {
        sector: 'AI agents · Studio R&D',
        tagline: 'An agent workspace where the backend, not the model, has the final say',
        summary: 'Jarvos is our in-house AI agent OS: the model proposes a plan, the backend checks tools, permissions and execution state, and high-risk actions wait for an approval.',
        challenge: 'Let the model propose plans without trusting the tools it invents, route requests by meaning rather than keywords, and keep approvals invisible in chat but absolute in the backend.',
        approach: 'We built a monorepo with a Next.js cockpit, a TypeScript orchestrator and Supabase as the source of truth. Every request goes through goal inference, capability retrieval, tool resolution, planning, execution and verification.',
        steps: [
          ['Semantic dispatch', '“Post this on X”, “publish as a tweet” and “share on my profile” resolve to the same capability, never through string matching.'],
          ['Tool resolution', 'Proposed tools are classified as resolved, hallucinated, unavailable or suggested; an invented tool stops before anything runs.'],
          ['Plan, execute, verify', 'Tasks, steps, attempts and approvals persist in Supabase; a verifier scores confidence before the answer goes out.'],
          ['Approvals and health', 'Local PC actions, outbound mail and destructive file actions pause for an approval; the cockpit shows lifecycle, routing decisions and runtime health.'],
        ],
        outcome: 'A working R&D platform: semantic routing, persistent task state, tool resolution, approval gates, voice and local control on one orchestrator. It is where we test the agent patterns we later bring to client products.',
        stat: ['5', 'checks between a request and a result'],
        scope: ['Agent architecture', 'Cockpit UI', 'Approval UX', 'Observability'],
        team: 'In-house',
      },
      fr: {
        sector: 'Agents IA · R&D du studio',
        tagline: 'Un espace d’agents où le backend, pas le modèle, a le dernier mot',
        summary: 'Jarvos est notre système d’agents IA interne : le modèle propose un plan, le backend vérifie outils, permissions et état d’exécution, et les actions à risque attendent une validation.',
        challenge: 'Laisser le modèle proposer des plans sans faire confiance aux outils qu’il invente, router les demandes par le sens plutôt que par mots-clés, et rendre les validations invisibles dans le chat mais absolues dans le backend.',
        approach: 'Nous avons construit un monorepo avec un cockpit Next.js, un orchestrateur TypeScript et Supabase comme source de vérité. Chaque demande passe par l’inférence de l’objectif, la recherche des capacités, la résolution des outils, la planification, l’exécution et la vérification.',
        steps: [
          ['Un routage par le sens', '« Poste ça sur X », « publie en tweet » et « partage sur mon profil » mènent à la même capacité, jamais par comparaison de texte.'],
          ['La résolution des outils', 'Les outils proposés sont classés résolus, inventés, indisponibles ou suggérés ; un outil inventé s’arrête avant toute exécution.'],
          ['Planifier, exécuter, vérifier', 'Tâches, étapes, tentatives et validations sont conservées dans Supabase ; un vérificateur note la confiance avant la réponse.'],
          ['Validations et santé', 'Les actions sur le PC, les e-mails sortants et les suppressions de fichiers attendent une validation ; le cockpit montre le cycle de vie, les décisions de routage et la santé du système.'],
        ],
        outcome: 'Une plateforme de R&D qui fonctionne : routage par le sens, état des tâches persistant, résolution des outils, validations, voix et contrôle local sur un même orchestrateur. C’est là que nous testons les patterns d’agents que nous apportons ensuite aux produits clients.',
        stat: ['5', 'contrôles entre une demande et un résultat'],
        scope: ['Architecture d’agents', 'Interface cockpit', 'UX de validation', 'Observabilité'],
        team: 'En interne',
      },
      gallery: [
        { kind: 'pair', items: [
          { src: '/images/jarvos-chat.webp', en: 'Cockpit chat: conversations, sub-agents and model routing, streamed from the orchestrator', fr: 'Chat du cockpit : conversations, sous-agents et routage des modèles, diffusés par l’orchestrateur' },
          { src: '/images/jarvos-system-health.webp', en: 'System health: task lifecycle, approvals, routing decisions and runtime probes', fr: 'Santé du système : cycle des tâches, validations, décisions de routage et sondes d’exécution' },
        ] },
        { kind: 'full', src: '/images/jarvos-schema.webp', en: 'The system: inputs, orchestration, agent lanes, then data and storage', fr: 'Le système : entrées, orchestration, couloirs d’agents, puis données et stockage' },
      ],
    },
    {
      id: 'skiset', company: 'Skiset', logo: '/images/skiset-logo.png', hero: '/images/skiset-cover.webp', card: '/covers/skiset.webp',
      biz: ['ecommerce', 'mobility'], year: '2020', url: 'https://skiset.com', platforms: { en: 'Mobile, desktop', fr: 'Mobile, desktop' },
      en: {
        sector: 'E-commerce · Sport rental',
        tagline: 'A ski equipment booking flow, redesigned and tested',
        summary: 'Equipment selection and checkout redesigned on mobile and desktop for Europe’s leading ski rental platform, tested with real users before development.',
        challenge: 'Help customers configure equipment for a whole group and complete a booking, and give the client evidence for bold design decisions.',
        approach: 'We tested the existing flow with users, restructured the purchase journey, then delivered interactive prototypes that we tested again before presenting the final interface.',
        steps: [
          ['Test the existing flow', 'Real-condition tests on the old booking flow to find the drop-off points and the friction.'],
          ['Restructure the journey', 'New wireframes and flows: resort search, pack comparison by level, sizing, dates, group details and payment.'],
          ['Prototype, then test again', 'High-fidelity interactive prototypes tested with users; labelling and hierarchy issues fixed screen by screen before handoff.'],
        ],
        outcome: 'User tests validated the major design decisions, with 15/20 satisfaction on mobile and 16/20 on desktop, and the booking flow was redesigned without hurting conversion.',
        stat: ['16/20', 'desktop satisfaction in tests'],
        scope: ['User testing', 'UX architecture', 'UI design', 'Prototyping'],
        team: 'PO, brand marketing, CEO, lead developer',
      },
      fr: {
        sector: 'E-commerce · Location de sport',
        tagline: 'Un parcours de réservation de matériel de ski, repensé et testé',
        summary: 'Le choix du matériel et le paiement repensés sur mobile et desktop pour le leader européen de la location de ski, testés avec de vrais utilisateurs avant le développement.',
        challenge: 'Aider les clients à configurer le matériel de tout un groupe et à finir leur réservation, et donner au client des preuves pour des choix de design audacieux.',
        approach: 'Nous avons testé le parcours existant avec des utilisateurs, restructuré le tunnel d’achat, puis livré des prototypes interactifs testés à nouveau avant de présenter l’interface finale.',
        steps: [
          ['Tester le parcours existant', 'Des tests en conditions réelles sur l’ancien parcours de réservation pour trouver les points d’abandon et les frictions.'],
          ['Restructurer le parcours', 'De nouveaux wireframes et parcours : recherche de station, comparaison des packs par niveau, tailles, dates, détails du groupe et paiement.'],
          ['Prototyper, puis retester', 'Des prototypes interactifs haute fidélité testés avec des utilisateurs ; les problèmes de libellés et de hiérarchie corrigés écran par écran avant la passation.'],
        ],
        outcome: 'Les tests utilisateurs ont validé les grands choix de design, avec 15/20 de satisfaction sur mobile et 16/20 sur desktop, et le parcours de réservation a été repensé sans nuire à la conversion.',
        stat: ['16/20', 'de satisfaction sur desktop en test'],
        scope: ['Tests utilisateurs', 'Architecture UX', 'Design d’interface', 'Prototypage'],
        team: 'PO, marketing de marque, CEO, lead développeur',
      },
      gallery: [
        { kind: 'full', src: '/images/skiset-userflow.png', en: 'The booking flow: resort and dates, equipment, sizing and payment', fr: 'Le parcours de réservation : station et dates, matériel, tailles et paiement' },
        { kind: 'full', src: '/images/skiset-screen.webp', en: 'Homepage, with the resort search as the entry point', fr: 'Page d’accueil, avec la recherche de station en point d’entrée' },
        { kind: 'full', src: '/images/skiset-example.webp', en: 'Equipment selection: pack comparison with level picker, included gear and price breakdown', fr: 'Choix du matériel : comparaison des packs avec choix du niveau, matériel inclus et détail du prix' },
        { kind: 'pair', items: [
          { src: '/images/skiset-mobile.webp', en: 'Mobile: resort search and the booking summary with its date picker', fr: 'Mobile : recherche de station et récapitulatif de réservation avec son sélecteur de dates' },
          { src: '/images/skiset-usertest.png', en: 'User test analysis: observations, findings and recommendations', fr: 'Analyse des tests utilisateurs : observations, constats et recommandations' },
        ] },
      ],
    },
    {
      id: 'sg', company: 'Société Générale', logo: '/images/societegenerale.png', hero: '/images/sg-building.webp', card: '/images/sg-building.webp',
      heroCredit: 'Photo: Arthur Weidmann · CC BY-SA 4.0', heroCreditUrl: 'https://commons.wikimedia.org/wiki/File:Si%C3%A8ge_central_de_la_Soci%C3%A9t%C3%A9_G%C3%A9n%C3%A9rale_ext%C3%A9rieur.jpg',
      biz: ['fintech', 'enterprise'], year: '2023 – 2024', url: 'https://particuliers.sg.fr/', platforms: { en: 'Mobile, desktop', fr: 'Mobile, desktop' },
      en: {
        sector: 'Banking · Investment',
        tagline: 'Savings and investment flows under MiFID II',
        summary: 'Savings, allocation and investment journeys on desktop and mobile for Société Générale, designed within MiFID II requirements, with a documented +12% in investment activity.',
        challenge: 'Make the investment journey clear while meeting MiFID II requirements and validating each investor’s profile, for a bank with millions of customers.',
        approach: 'We designed the flows and the developer handoff specifications, argued for the better user experience over technical shortcuts with business and development teams, and contributed components to the bank’s design system.',
        steps: [
          ['Investor profile', 'The MiFID II questionnaire: financial situation, sustainable investment preferences, financial knowledge and experience.'],
          ['Savings and allocation', 'A savings dashboard with product breakdown and portfolio donut, and asset management flows with delegation and advisory services.'],
          ['Handoff and design system', 'High-fidelity Figma screens, detailed handoff guidelines, and components contributed to the bank’s global design system.'],
        ],
        outcome: '+12% investment activity after the work on savings, allocation and investment flows.',
        stat: ['+12%', 'investment activity'],
        scope: ['Regulated flows', 'Product design', 'Design system', 'Developer handoff'],
        team: 'PO, PM, regulatory team, development teams',
      },
      fr: {
        sector: 'Banque · Investissement',
        tagline: 'Des parcours d’épargne et d’investissement dans le cadre de MIF2',
        summary: 'Des parcours d’épargne, d’allocation et d’investissement sur desktop et mobile pour Société Générale, conçus dans le cadre de MIF2, avec une hausse documentée de 12 % de l’activité d’investissement.',
        challenge: 'Rendre le parcours d’investissement clair tout en respectant MIF2 et en validant le profil de chaque investisseur, pour une banque qui compte des millions de clients.',
        approach: 'Nous avons conçu les parcours et les spécifications de passation aux développeurs, défendu la meilleure expérience face aux raccourcis techniques auprès des équipes métier et techniques, et contribué des composants au design system de la banque.',
        steps: [
          ['Profil investisseur', 'Le questionnaire MIF2 : situation patrimoniale, sensibilité à l’investissement durable, connaissances et expérience financières.'],
          ['Épargne et allocation', 'Un tableau de bord d’épargne avec répartition par produit et graphique du portefeuille, et des parcours de gestion d’actifs avec délégation et conseil.'],
          ['Passation et design system', 'Des écrans Figma haute fidélité, des consignes de passation détaillées, et des composants ajoutés au design system global de la banque.'],
        ],
        outcome: '+12 % d’activité d’investissement après le travail sur les parcours d’épargne, d’allocation et d’investissement.',
        stat: ['+12 %', 'd’activité d’investissement'],
        scope: ['Parcours régulés', 'Design produit', 'Design system', 'Passation aux développeurs'],
        team: 'PO, PM, équipe réglementaire, équipes de développement',
      },
      gallery: [
        { kind: 'full', src: '/images/societe-generale-desktop.png', en: 'Allocation dashboard: portfolio donut, savings by product and asset management overview', fr: 'Tableau d’allocation : graphique du portefeuille, épargne par produit et vue de la gestion d’actifs' },
        { kind: 'pair', items: [
          { src: '/images/societe-generale-mobile.png', en: 'Mobile: savings overview, allocation and quick actions', fr: 'Mobile : vue de l’épargne, allocation et actions rapides' },
          { src: '/images/societe-general-screenshot.webp', en: 'The live platform: investment flows across the bank’s digital products', fr: 'La plateforme en ligne : les parcours d’investissement dans les produits numériques de la banque' },
        ] },
      ],
    },
  ];
  const byId = (id) => WORK.find((p) => p.id === id);
  const copy = (p) => tx(p[lang()] || p.en);

  /* ── The bestiary: one spirit animal per type of business, painted in one house style
     (translucent brushstrokes, pastel iridescence, light from the top left, paper background).
     Images in /images/bestiary/<id>.webp (1600 px) and <id>-m.webp (900 px). ── */
  const ART_V = '?v=1';
  const ANIMAL = {
    saas: { en: ['The bee', 'A hive is a system that runs every day.'], fr: ['L’abeille', 'Une ruche, c’est un système qui tourne tous les jours.'] },
    ai: { en: ['The owl', 'It sees clearly where others see nothing.'], fr: ['La chouette', 'Elle voit clair là où les autres ne voient rien.'] },
    fintech: { en: ['The koi', 'In the East, a sign of prosperity that keeps flowing.'], fr: ['La carpe koï', 'En Asie, le signe d’une prospérité qui circule.'] },
    proptech: { en: ['The tortoise', 'It carries its home, and it is built to last.'], fr: ['La tortue', 'Elle porte sa maison, et elle est faite pour durer.'] },
    ecommerce: { en: ['The hummingbird', 'Quick and precise, from one flower to the next.'], fr: ['Le colibri', 'Rapide et précis, d’une fleur à l’autre.'] },
    marketplace: { en: ['The octopus', 'Arms reaching every side of the market.'], fr: ['La pieuvre', 'Des bras qui touchent chaque côté du marché.'] },
    luxury: { en: ['The swan', 'Grace that has to look effortless.'], fr: ['Le cygne', 'Une grâce qui doit paraître naturelle.'] },
    mobility: { en: ['The horse', 'Speed you can steer.'], fr: ['Le cheval', 'De la vitesse, mais qu’on dirige.'] },
    enterprise: { en: ['The elephant', 'A whole herd that moves together, and remembers.'], fr: ['L’éléphant', 'Tout un troupeau qui avance ensemble, et qui se souvient.'] },
  };
  const artSet = (id) => `/images/bestiary/${id}-m.webp${ART_V} 900w, /images/bestiary/${id}.webp${ART_V} 1600w`;
  const ART_SIZES = '(max-width: 900px) 100vw, 82vw';
  const warmed = new Set();
  function warmArt(id) {
    if (!id || warmed.has(id) || !ANIMAL[id]) return;
    warmed.add(id);
    const im = new Image();
    im.sizes = ART_SIZES;
    im.srcset = artSet(id);
  }
  /* Cross-fade the hero art to the selected animal. The newest choice wins if several are loading. */
  function showArt(id) {
    const host = d.getElementById('biz-art');
    if (!host || !ANIMAL[id] || host.dataset.cur === id) return;
    host.dataset.cur = id;
    const img = d.createElement('img');
    img.className = 'biz-art-img';
    img.alt = '';
    img.decoding = 'async';
    img.width = 1600; img.height = 900;
    img.sizes = ART_SIZES;
    img.srcset = artSet(id);
    img.src = `/images/bestiary/${id}.webp${ART_V}`;
    host.appendChild(img);
    const reveal = () => {
      if (host.dataset.cur !== id) { img.remove(); return; }
      requestAnimationFrame(() => {
        host.querySelectorAll('.biz-art-img.is-on').forEach((old) => {
          if (old === img) return;
          old.classList.remove('is-on');
          old.classList.add('is-off');
          setTimeout(() => old.remove(), 1100);
        });
        img.classList.add('is-on');
      });
    };
    if (img.complete && img.naturalWidth) reveal();
    else { img.addEventListener('load', reveal, { once: true }); img.addEventListener('error', reveal, { once: true }); }
  }

  /* ── Services by type of business ── */
  /* Each type: a title, one line, and three pairs [what breaks, what we do about it]. */
  const BIZ_COPY = {
    saas: {
      en: { title: 'SaaS & B2B tools', intro: 'Trials that stall, onboarding that explains too much, dashboards that grew one feature at a time.',
        pairs: [
          ['Sign-up to first value takes too long', 'An onboarding built around the first result, not a tour of the features'],
          ['Plans and pricing read like a spreadsheet', 'A pricing page that says which plan, for whom, at what price'],
          ['Dashboards that grew one feature at a time', 'Dashboards and settings redrawn as one system'],
        ] },
      fr: { title: 'SaaS & outils B2B', intro: 'Des essais qui stagnent, un onboarding qui explique trop, des tableaux de bord qui ont grandi une fonction à la fois.',
        pairs: [
          ['Trop de temps entre l’inscription et la première valeur', 'Un onboarding construit autour du premier résultat, pas d’une visite des fonctions'],
          ['Des formules qui se lisent comme un tableur', 'Une page de prix qui dit quelle formule, pour qui, à quel prix'],
          ['Des tableaux de bord qui ont grandi une fonction à la fois', 'Des tableaux de bord et des réglages redessinés comme un seul système'],
        ] },
    },
    ai: {
      en: { title: 'AI products', intro: 'Features that shine in a demo and confuse on day two.',
        pairs: [
          ['A blank prompt as the only way in', 'Structured inputs that guide the request'],
          ['Output nobody can check', 'Every result checked against the brief, then open to review and edits'],
          ['Long waits with no state', 'Visible steps, approvals for risky actions, a log of what happened'],
        ] },
      fr: { title: 'Produits IA', intro: 'Des fonctions qui brillent en démo et déroutent dès le deuxième jour.',
        pairs: [
          ['Un champ de prompt vide comme seule porte d’entrée', 'Des entrées structurées qui guident la demande'],
          ['Des résultats que personne ne peut vérifier', 'Chaque résultat vérifié face au brief, puis ouvert à la relecture et à la correction'],
          ['De longues attentes sans aucun état', 'Des étapes visibles, des validations pour les actions à risque, un journal de ce qui s’est passé'],
        ] },
    },
    fintech: {
      en: { title: 'Fintech & banking', intro: 'Regulated flows that still have to feel simple, and numbers that have to be read right.',
        pairs: [
          ['KYC and compliance steps that lose people', 'KYC, KYB and investor-profile journeys that explain why each step is there'],
          ['Fees, yields and risks that are hard to read', 'Money flows shown step by step, with targets labelled as targets'],
          ['Back offices nobody designed', 'Operator back offices on the same design system as the customer app'],
        ] },
      fr: { title: 'Fintech & banque', intro: 'Des parcours régulés qui doivent quand même paraître simples, et des chiffres qu’il faut lire correctement.',
        pairs: [
          ['Des étapes KYC et de conformité où l’on perd des gens', 'Des parcours KYC, KYB et profil investisseur qui expliquent à quoi sert chaque étape'],
          ['Des frais, rendements et risques difficiles à lire', 'Des flux d’argent montrés étape par étape, les objectifs présentés comme des objectifs'],
          ['Des back-offices que personne n’a conçus', 'Des back-offices opérateurs sur le même design system que l’app client'],
        ] },
    },
    proptech: {
      en: { title: 'Real estate & proptech', intro: 'Big tickets, long cycles, and buyers or investors who need to understand what they own.',
        pairs: [
          ['Listings that show photos but hide the numbers', 'Asset pages that lead with the figures buyers and investors check'],
          ['Ownership, fees and rent explained in legal PDFs', 'Ownership and the rent cycle drawn on screen, deduction by deduction'],
          ['Managers living in spreadsheets', 'Back offices for property, portfolio and compliance teams'],
        ] },
      fr: { title: 'Immobilier & proptech', intro: 'Des montants élevés, des cycles longs, et des acheteurs ou investisseurs qui doivent comprendre ce qu’ils possèdent.',
        pairs: [
          ['Des annonces qui montrent les photos mais cachent les chiffres', 'Des fiches d’actif qui commencent par les chiffres que vérifient acheteurs et investisseurs'],
          ['La propriété, les frais et les loyers expliqués dans des PDF juridiques', 'La propriété et le cycle des loyers dessinés à l’écran, déduction par déduction'],
          ['Des gestionnaires qui vivent dans des tableurs', 'Des back-offices pour la gestion d’immeubles, de portefeuilles et la conformité'],
        ] },
    },
    ecommerce: {
      en: { title: 'E-commerce & retail', intro: 'Buyers who cannot find, compare or finish, mostly on a phone.',
        pairs: [
          ['Product pages that hide what buyers check first', 'Product pages ordered by the questions buyers ask before paying'],
          ['Checkout friction on mobile', 'Booking and checkout redesigned for the phone, then tested with real users'],
          ['Options and bundles that are hard to configure', 'Configurators that show what is included and the price at every step'],
        ] },
      fr: { title: 'E-commerce & retail', intro: 'Des acheteurs qui ne trouvent pas, ne comparent pas ou ne finissent pas, surtout sur téléphone.',
        pairs: [
          ['Des fiches produit qui cachent ce que l’acheteur regarde en premier', 'Des fiches produit ordonnées selon les questions posées avant de payer'],
          ['Des frictions au paiement sur mobile', 'Réservation et paiement repensés pour le téléphone, puis testés avec de vrais utilisateurs'],
          ['Des options et des packs difficiles à configurer', 'Des configurateurs qui montrent ce qui est inclus et le prix à chaque étape'],
        ] },
    },
    marketplace: {
      en: { title: 'Marketplaces', intro: 'Two sides to convince: buyers who compare, sellers who list.',
        pairs: [
          ['Search that returns too much, or nothing', 'Search and filters built around how buyers actually compare'],
          ['Listings that change from one seller to the next', 'Listing templates that keep every seller at the same standard'],
          ['Seller tools left behind the storefront', 'Seller and dealer back offices with their own reporting'],
        ] },
      fr: { title: 'Marketplaces', intro: 'Deux côtés à convaincre : les acheteurs qui comparent, les vendeurs qui publient.',
        pairs: [
          ['Une recherche qui renvoie trop, ou rien', 'Une recherche et des filtres construits sur la façon dont les acheteurs comparent'],
          ['Des annonces qui changent d’un vendeur à l’autre', 'Des modèles d’annonce qui tiennent chaque vendeur au même niveau'],
          ['Des outils vendeurs laissés derrière la vitrine', 'Des back-offices vendeurs et concessions, avec leurs propres rapports'],
        ] },
    },
    luxury: {
      en: { title: 'Luxury & beauty', intro: 'A brand that has to look exact everywhere, and customer data spread across houses.',
        pairs: [
          ['A brand that feels generic once it is online', 'Interfaces held to the brand’s standard, detail by detail'],
          ['Each house’s customer data in its own tool', 'One shared CRM platform that keeps each house’s specifics'],
          ['Loyalty and the account space treated last', 'Loyalty, onboarding and the customer account designed as part of the brand'],
        ] },
      fr: { title: 'Luxe & beauté', intro: 'Une marque qui doit être exacte partout, et des données clients réparties entre les maisons.',
        pairs: [
          ['Une marque qui paraît générique une fois en ligne', 'Des interfaces tenues au niveau de la marque, détail par détail'],
          ['Les données clients de chaque maison dans son propre outil', 'Une plateforme CRM commune qui garde les spécificités de chaque maison'],
          ['La fidélité et l’espace client traités en dernier', 'Fidélité, onboarding et espace client pensés comme une partie de la marque'],
        ] },
    },
    mobility: {
      en: { title: 'Mobility & travel', intro: 'Bookings made on a phone, often in a hurry, with dates, places and people to get right.',
        pairs: [
          ['Date and place pickers that fight the user', 'Search by place and date that works with one thumb'],
          ['Group or vehicle options that lose people halfway', 'Configuring a group, a trip or a vehicle, one decision at a time'],
          ['Financing and price details found too late', 'Prices, financing and calculators shown where the decision is made'],
        ] },
      fr: { title: 'Mobilité & voyage', intro: 'Des réservations faites sur téléphone, souvent dans l’urgence, avec des dates, des lieux et des personnes à ne pas rater.',
        pairs: [
          ['Des sélecteurs de dates et de lieux qui résistent', 'Une recherche par lieu et par date qui se fait d’un pouce'],
          ['Des options de groupe ou de véhicule où l’on décroche', 'La configuration d’un groupe, d’un voyage ou d’un véhicule, une décision à la fois'],
          ['Le financement et le prix découverts trop tard', 'Prix, financement et calculateurs affichés là où la décision se prend'],
        ] },
    },
    enterprise: {
      en: { title: 'Large groups', intro: 'Several teams, several brands, one product, and decisions that slow down while everyone aligns.',
        pairs: [
          ['Each entity with its own habits, data and tools', 'Shared platforms that keep each brand’s specifics'],
          ['Requirements spread across countries and teams', 'Interviews and workshops that turn them into one plan'],
          ['Mockups developers cannot ship as drawn', 'Handoff specs and components added to your design system'],
        ] },
      fr: { title: 'Grands groupes', intro: 'Plusieurs équipes, plusieurs marques, un seul produit, et des décisions qui ralentissent le temps que tout le monde s’aligne.',
        pairs: [
          ['Chaque entité avec ses habitudes, ses données et ses outils', 'Des plateformes communes qui gardent les spécificités de chaque marque'],
          ['Des exigences dispersées entre pays et équipes', 'Des entretiens et des ateliers qui les ramènent à un seul plan'],
          ['Des maquettes que les développeurs ne peuvent pas livrer telles quelles', 'Des spécifications de passation et des composants ajoutés à votre design system'],
        ] },
    },
  };

  /* ── Renderers ── */
  const bizName = (id) => { const b = BIZ.find((x) => x.id === id); return b ? tx(b[lang()] || b.en) : id; };
  const projectHref = (id) => (SITE_PAGE() === 'showcase' ? '#work/' + id : '/agence/showcase#work/' + id);
  function SITE_PAGE() { return (window.SITE && window.SITE.page) || ''; }

  function applyStrings() {
    d.querySelectorAll('[data-wt]').forEach((el) => { const v = s(el.dataset.wt); if (v) el.textContent = v; });
    d.querySelectorAll('[data-wh]').forEach((el) => { const v = s(el.dataset.wh); if (v) el.innerHTML = v; });
  }

  let filter = 'all';
  function renderFilters() {
    const host = d.getElementById('work-filters');
    if (!host) return;
    const count = (id) => (id === 'all' ? WORK.length : WORK.filter((p) => p.biz.includes(id)).length);
    host.innerHTML = [{ id: 'all' }].concat(BIZ).map((b) => {
      const label = b.id === 'all' ? s('all') : bizName(b.id);
      return `<button type="button" class="wf" data-filter="${b.id}" aria-pressed="${filter === b.id}">${esc(label)}<span>${count(b.id)}</span></button>`;
    }).join('');
  }
  function card(p, i) {
    const c = copy(p);
    return `<a class="wcard" href="${projectHref(p.id)}" data-biz="${p.biz.join(' ')}" style="--i:${i}">
      <span class="wcard-shot"><img src="${esc(p.card)}" alt="" loading="lazy" decoding="async" style="object-position:${esc(p.cardPos || '50% 40%')}">
        ${c.stat ? `<span class="wcard-stat"><b>${esc(c.stat[0])}</b>${esc(c.stat[1])}</span>` : ''}</span>
      <span class="wcard-body">
        <span class="wcard-meta">${esc(c.sector)}<i aria-hidden="true"></i>${esc(p.year)}</span>
        <span class="wcard-name">${esc(p.company)}</span>
        <span class="wcard-line">${esc(c.tagline)}</span>
        <span class="wcard-go">${esc(s('view'))}<span aria-hidden="true">→</span></span>
      </span>
    </a>`;
  }
  function renderGrid() {
    const host = d.getElementById('work-grid');
    if (!host) return;
    const list = filter === 'all' ? WORK : WORK.filter((p) => p.biz.includes(filter));
    host.innerHTML = list.map(card).join('');
    host.dataset.count = String(list.length);
  }

  function figure(g, alt) {
    const cap = tx(g[lang()] || g.en || '');
    if (g.kind === 'tall') {
      return `<figure class="wd-fig wd-fig--tall"><div class="wd-browser"><div class="wd-chrome"><i></i><i></i><i></i><span>${esc(g.url || '')}</span></div>
        <div class="wd-scroll" tabindex="0" aria-label="${esc(cap)}"><img src="${esc(g.src)}" alt="${esc(alt)}" loading="lazy" decoding="async"></div></div>
        <figcaption>${esc(cap)}</figcaption></figure>`;
    }
    return `<figure class="wd-fig"><img src="${esc(g.src)}" alt="${esc(alt)}" loading="lazy" decoding="async"><figcaption>${esc(cap)}</figcaption></figure>`;
  }
  function renderDetail(p) {
    const host = d.getElementById('work-detail');
    if (!host) return;
    const c = copy(p);
    const i = WORK.indexOf(p);
    const next = WORK[(i + 1) % WORK.length];
    const prev = WORK[(i - 1 + WORK.length) % WORK.length];
    const nc = copy(next);
    const gallery = (p.gallery || []).map((g) => {
      if (g.kind === 'pair') return `<div class="wd-pair">${g.items.map((it) => figure(it, p.company)).join('')}</div>`;
      return figure(g, p.company);
    }).join('');
    host.innerHTML = `
      <header class="wd-hero" style="--bg:url('${esc(p.hero)}')">
        <div class="wd-hero-bg" aria-hidden="true"></div>
        <div class="wrap wd-hero-in">
          <a class="wd-back" href="#work"><span aria-hidden="true">←</span>${esc(s('back'))}</a>
          <p class="wd-kicker">${esc(c.sector)}</p>
          <h1 class="display wd-title" id="wd-title" tabindex="-1">${esc(p.company)}<br><em>${esc(c.tagline)}</em></h1>
          <dl class="wd-meta">
            <div><dt>${esc(s('year'))}</dt><dd>${esc(p.year)}</dd></div>
            <div><dt>${esc(s('platforms'))}</dt><dd>${esc(tx(p.platforms[lang()] || p.platforms.en))}</dd></div>
            <div><dt>${esc(s('team'))}</dt><dd>${esc(c.team)}</dd></div>
            ${p.url ? `<div><dt>Web</dt><dd><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(s('visit'))} <span aria-hidden="true">↗</span></a></dd></div>` : ''}
          </dl>
        </div>
        ${p.heroCredit ? `<a class="wd-credit" href="${esc(p.heroCreditUrl || '#')}" target="_blank" rel="noopener noreferrer">${esc(p.heroCredit)}</a>` : ''}
      </header>
      <section class="wd-intro">
        <div class="wrap wd-intro-in">
          ${c.stat ? `<p class="wd-stat"><b>${esc(c.stat[0])}</b><span>${esc(c.stat[1])}</span></p>` : ''}
          <div>
            <p class="wd-summary">${esc(c.summary)}</p>
            <ul class="wd-scope" aria-label="${esc(s('scope'))}">${c.scope.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          </div>
        </div>
      </section>
      <section class="wd-brief">
        <div class="wrap wd-brief-in">
          <div><h2 class="wd-h"><span class="dab" aria-hidden="true"></span>${esc(s('brief'))}</h2><p>${esc(c.challenge)}</p></div>
          <div><h2 class="wd-h"><span class="dab" aria-hidden="true"></span>${esc(s('did'))}</h2><p>${esc(c.approach)}</p></div>
        </div>
      </section>
      <section class="wd-steps">
        <div class="wrap">
          <h2 class="display wd-steps-title">${esc(s('how'))}</h2>
          <ol>${c.steps.map((st, k) => `<li><span class="wd-n">${String(k + 1).padStart(2, '0')}</span><div><h3>${esc(st[0])}</h3><p>${esc(st[1])}</p></div></li>`).join('')}</ol>
        </div>
      </section>
      <section class="wd-gallery"><div class="wrap">${gallery}</div></section>
      <section class="wd-result">
        <div class="wrap wd-result-in">
          <p class="wd-kicker">${esc(s('result'))}</p>
          <p class="wd-outcome">${esc(c.outcome)}</p>
          <div class="wd-result-cta">
            <p>${esc(s('cta'))}</p>
            <button type="button" class="btn btn-primary" data-offer="">${esc(s('cta_btn'))}</button>
          </div>
        </div>
      </section>
      <nav class="wd-next" aria-label="${esc(s('next'))}">
        <div class="wrap wd-next-in">
          <a class="wd-prev" href="#work/${esc(prev.id)}"><span aria-hidden="true">←</span>${esc(s('prev'))} · ${esc(prev.company)}</a>
          <a class="wd-next-card" href="#work/${esc(next.id)}">
            <span class="wd-next-shot"><img src="${esc(next.card)}" alt="" loading="lazy" decoding="async" style="object-position:${esc(next.cardPos || '50% 40%')}"></span>
            <span class="wd-next-txt"><small>${esc(s('next'))}</small><b>${esc(next.company)}</b><span>${esc(nc.tagline)}</span></span>
            <span class="wd-next-go" aria-hidden="true">→</span>
          </a>
        </div>
      </nav>`;
  }

  let bizTab = 'saas';
  const projCount = (n) => (n === 1 ? s('proj_1') : s('proj_n').replace('{n}', n));
  function renderBiz() {
    const host = d.getElementById('biz');
    if (!host) return;
    const b = BIZ.find((x) => x.id === bizTab);
    const pos = BIZ.indexOf(b);
    const bc = tx(BIZ_COPY[bizTab][lang()] || BIZ_COPY[bizTab].en);
    const work = WORK.filter((p) => p.biz.includes(bizTab));

    const index = d.getElementById('biz-index');
    if (index) {
      index.setAttribute('role', 'tablist');
      index.setAttribute('aria-orientation', 'vertical');
      index.setAttribute('aria-label', s('biz_title').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      index.innerHTML = BIZ.map((x, i) => {
        const n = WORK.filter((p) => p.biz.includes(x.id)).length;
        const on = bizTab === x.id;
        return `<button type="button" role="tab" class="biz-item" id="biz-tab-${x.id}" aria-controls="biz-panel" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-biz="${x.id}" style="--bc:${x.c};--bc2:${x.c2}">
          <span class="biz-num">${String(i + 1).padStart(2, '0')}</span><span class="biz-name">${esc(tx(x[lang()] || x.en))}</span><span class="biz-n">${esc(projCount(n))}</span><i aria-hidden="true">→</i></button>`;
      }).join('');
    }

    const cap = d.getElementById('biz-caption');
    const an = ANIMAL[bizTab] && tx(ANIMAL[bizTab][lang()] || ANIMAL[bizTab].en);
    if (cap && an) {
      cap.style.setProperty('--bc', b.c);
      cap.style.setProperty('--bc2', b.c2);
      cap.innerHTML = `<span class="biz-cap-n">${String(pos + 1).padStart(2, '0')} / ${String(BIZ.length).padStart(2, '0')} · ${esc(tx(b[lang()] || b.en))}</span>
        <b>${esc(an[0])}</b><span class="biz-cap-line">${esc(an[1])}</span>
        <a class="biz-cap-go" href="#biz-panel">${esc(s('biz_see'))}<span aria-hidden="true">↓</span></a>`;
      cap.classList.remove('is-in'); void cap.offsetWidth; cap.classList.add('is-in');
    }
    showArt(bizTab);

    const single = work.length === 1;
    host.innerHTML = `<div class="biz-panel" id="biz-panel" role="tabpanel" aria-labelledby="biz-tab-${bizTab}" style="--bc:${b.c};--bc2:${b.c2}">
      <div class="biz-lead"><h3>${esc(bc.title)}</h3><p>${esc(bc.intro)}</p></div>
      <ol class="biz-fixes">${bc.pairs.map((pr) => `<li><s><span class="sr-only">${esc(s('biz_sr_problem'))} </span>${esc(pr[0])}</s><p><i aria-hidden="true">→</i><span><span class="sr-only">${esc(s('biz_sr_fix'))} </span>${esc(pr[1])}</span></p></li>`).join('')}</ol>
      <div class="biz-proj" style="--n:${work.length}">${work.map((p) => { const c2 = copy(p); return `<a class="biz-pcard${single ? ' is-single' : ''}" href="${projectHref(p.id)}">
          <span class="biz-pcard-shot"><img src="${esc(p.card)}" alt="" loading="lazy" decoding="async" style="object-position:${esc(p.cardPos || '50% 40%')}">${c2.stat ? `<span class="biz-pcard-stat"><b>${esc(c2.stat[0])}</b>${esc(c2.stat[1])}</span>` : ''}</span>
          <span class="biz-pcard-body"><b>${esc(p.company)}</b><em>${esc(c2.tagline)}</em>${single ? `<span class="biz-pcard-sum">${esc(c2.summary)}</span>` : ''}<span class="biz-pcard-go">${esc(s('view'))}<span aria-hidden="true">→</span></span></span>
        </a>`; }).join('')}</div>
    </div>`;
  }

  /* ── Routing on the showcase: #work/<id> opens a project, #work or nothing shows the list ── */
  let lastCardId = '';
  function route(fromHash) {
    const detail = d.getElementById('work-detail');
    if (!detail) return;
    const m = /^#work\/([a-z0-9-]+)$/.exec(window.location.hash);
    const p = m && byId(m[1]);
    const main = d.getElementById('main');
    const others = main ? Array.from(main.children).filter((el) => el !== detail && !el.classList.contains('contact') && el.tagName === 'SECTION') : [];
    if (p) {
      renderDetail(p);
      others.forEach((el) => { el.hidden = true; });
      detail.hidden = false;
      d.body.classList.add('is-project');
      lastCardId = p.id;
      d.title = s('doc_title').replace('{name}', p.company);
      window.scrollTo({ top: 0, behavior: 'instant' });
      if (fromHash) { const h = d.getElementById('wd-title'); if (h) h.focus({ preventScroll: true }); }
    } else {
      const wasOpen = !detail.hidden;
      detail.hidden = true;
      detail.innerHTML = '';
      others.forEach((el) => { el.hidden = false; });
      d.body.classList.remove('is-project');
      if (wasOpen && lastCardId) {
        const a = d.querySelector(`.wcard[href="#work/${lastCardId}"]`);
        if (a) { a.scrollIntoView({ block: 'center', behavior: 'instant' }); a.focus({ preventScroll: true }); }
      }
    }
  }

  function renderAll() {
    applyStrings();
    renderFilters();
    renderGrid();
    renderBiz();
    route(false);
  }

  d.addEventListener('click', (e) => {
    const f = e.target.closest('.wf');
    if (f) { filter = f.dataset.filter; renderFilters(); renderGrid(); return; }
    const tab = e.target.closest('.biz-item');
    if (tab) {
      bizTab = tab.dataset.biz; renderBiz();
      const n = d.getElementById('biz-tab-' + bizTab); if (n) n.focus({ preventScroll: true });
    }
  });
  d.addEventListener('keydown', (e) => {
    const tab = e.target.closest && e.target.closest('.biz-item');
    const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    if (!tab || !(fwd || e.key === 'ArrowUp' || e.key === 'ArrowLeft')) return;
    const i = BIZ.findIndex((b) => b.id === tab.dataset.biz);
    bizTab = BIZ[(i + (fwd ? 1 : BIZ.length - 1)) % BIZ.length].id;
    renderBiz();
    const n = d.getElementById('biz-tab-' + bizTab); if (n) n.focus();
    e.preventDefault();
  });
  d.addEventListener('pointerover', (e) => { const it = e.target.closest && e.target.closest('.biz-item'); if (it) warmArt(it.dataset.biz); });
  d.addEventListener('focusin', (e) => { const it = e.target.closest && e.target.closest('.biz-item'); if (it) warmArt(it.dataset.biz); });
  if (d.getElementById('biz-art')) {
    warmed.add('saas');
    window.addEventListener('load', () => {
      if (window.innerWidth <= 900) return;
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
      idle(() => BIZ.forEach((x) => warmArt(x.id)));
    }, { once: true });
  }
  window.addEventListener('hashchange', () => route(true));
  new MutationObserver(() => renderAll()).observe(root, { attributes: true, attributeFilter: ['lang'] });
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', renderAll); else renderAll();
})();
