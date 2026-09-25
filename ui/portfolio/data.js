/* Portfolio data — cached separately from portfolio.html */
/* ═══════════════════════════════════════════
   DATA
═══════════════════════════════════════════ */

/* Method schema — 3D icons, one GLB per step type.
   Drop each finished file at ../images/method/{id}.glb then set `src`.
   Until then the CSS 3D token is shown. */
const METHOD_STEPS = {
  research:        { id:'research',        label:{ en:'Research',          fr:'Recherche' },            src:null },
  'user-research': { id:'user-research',   label:{ en:'User research',     fr:'Recherche utilisateur' }, src:null },
  workshops:       { id:'workshops',       label:{ en:'Workshops',         fr:'Ateliers' },              src:null },
  'user-flows':    { id:'user-flows',      label:{ en:'User flows',        fr:'User flows' },            src:null },
  ia:              { id:'ia',              label:{ en:'Information architecture', fr:'Architecture de l’information' }, src:null },
  wireframe:       { id:'wireframe',       label:{ en:'Wireframes',        fr:'Wireframes' },            src:null },
  prototype:       { id:'prototype',       label:{ en:'Prototype',         fr:'Prototype' },             src:null },
  'user-tests':    { id:'user-tests',      label:{ en:'User tests',        fr:'Tests utilisateurs' },    src:null },
  'ui-design':     { id:'ui-design',       label:{ en:'UI design',         fr:'UI design' },             src:null },
  'design-system': { id:'design-system',   label:{ en:'Design system',     fr:'Design system' },         src:null },
  'ai-vibe-code':  { id:'ai-vibe-code',    label:{ en:'AI vibe code',      fr:'Vibe coding IA' },        src:null },
  audit:           { id:'audit',           label:{ en:'UX audit',          fr:'Audit UX' },              src:null },
  handoff:         { id:'handoff',         label:{ en:'Dev handoff',       fr:'Handoff dev' },           src:null },
  brand:           { id:'brand',           label:{ en:'Brand',             fr:'Identité' },              src:null },
  'product-vision':{ id:'product-vision',  label:{ en:'Product vision',    fr:'Vision produit' },        src:null },
  'journey-mapping':{ id:'journey-mapping',label:{ en:'Journey mapping',   fr:'Experience map' },        src:null },
  automation:      { id:'automation',      label:{ en:'Automation',        fr:'Automatisation' },        src:null },
  'data-ops':      { id:'data-ops',        label:{ en:'Data ops',          fr:'Data ops' },              src:null },
  'project-mgmt':  { id:'project-mgmt',    label:{ en:'Project management', fr:'Gestion de projet' },    src:null },
  'dev-follow':    { id:'dev-follow',      label:{ en:'Dev follow-up',     fr:'Suivi dev' },             src:null },
  marketing:       { id:'marketing',       label:{ en:'Marketing',         fr:'Marketing' },             src:null },
  'game-3d':       { id:'game-3d',         label:{ en:'3D game',           fr:'Jeu 3D' },                src:null },
};

let currentLang = 'en';

/* Process breakdown per project — only steps backed by the case-study copy. */
const PROJECT_METHODS = {
  creads: [
    { type:'product-vision', note:{ en:'Brand context kept as JSON through the brief and generation.', fr:'Contexte de marque structuré en JSON, du brief à la génération.' } },
    { type:'ai-vibe-code',   note:{ en:'SaaS built solo: Firecrawl, Mem0, Cloud Run, Supabase, Vercel.', fr:'SaaS construit en solo : Firecrawl, Mem0, Cloud Run, Supabase, Vercel.' } },
    { type:'ui-design',      note:{ en:'Landing, admin dashboard and AI bot interface.', fr:'Landing, dashboard admin et interface du bot IA.' } },
  ],
  'challenge-live-ops': [
    { type:'user-flows',  note:{ en:'Opt-in landing designed as a data contract.', fr:'Landing d’opt-in conçue comme un contrat de data.' } },
    { type:'data-ops',    note:{ en:'Canonical Sheet: dedupe, E.164, consent, send priority.', fr:'Sheet canonique : dédoublonnage, E.164, consentement, priorité d’envoi.' } },
    { type:'automation',  note:{ en:'Make + Twilio SMS with cost guards and status callbacks.', fr:'Make + Twilio SMS, garde-fous de coût et status callbacks.' } },
  ],
  uxfi: [
    { type:'product-vision', note:{ en:'Multi-axis scoring: hierarchy, navigation, CTA, mobile, conversion.', fr:'Scoring multi-axes : hiérarchie, navigation, CTA, mobile, conversion.' } },
    { type:'ai-vibe-code',   note:{ en:'Audit pipeline on Vercel v0 and OpenAI.', fr:'Pipeline d’audit sur Vercel v0 et OpenAI.' } },
    { type:'ui-design',      note:{ en:'Score dashboard, issue list and redesign previews.', fr:'Dashboard de score, liste d’issues et prévisualisations de redesign.' } },
  ],
  panfy: [
    { type:'ia',            note:{ en:'Market data hierarchy: prices, volume, Fear & Greed, Hyperliquid.', fr:'Hiérarchie data marché : prix, volume, Fear & Greed, Hyperliquid.' } },
    { type:'ui-design',     note:{ en:'Dense dark dashboard with token detail and depth panels.', fr:'Dashboard dense en dark mode, détail token et panels de profondeur.' } },
    { type:'ai-vibe-code',  note:{ en:'AI signal layer on live Hyperliquid data. Built with v0.', fr:'Couche de signaux IA sur data Hyperliquid live. Construit avec v0.' } },
  ],
  oneasset: [
    { type:'user-flows',     note:{ en:'Investor, Property Manager and admin workflows, including KYB.', fr:'Parcours investisseur, Property Manager et admin, dont le KYB.' } },
    { type:'prototype',      note:{ en:'Interactive prototypes built with AI coding tools.', fr:'Prototypes interactifs construits avec des outils de coding IA.' } },
    { type:'ai-vibe-code',   note:{ en:'GitHub agents, product requirements, and PR reviews. Figmol is OneAsset\'s internal tool.', fr:'Agents GitHub, specs produit et revues de PR. Figmol est l\'outil interne d\'OneAsset.' } },
    { type:'design-system',  note:{ en:'Shared system across product, admin and marketing.', fr:'Système partagé entre produit, admin et marketing.' } },
  ],
  upviral: [
    { type:'user-research',  note:{ en:'Repeated interviews with live customers.', fr:'Entretiens répétés avec des clients en production.' } },
    { type:'ia',             note:{ en:'Sitemap simplified around how campaigns are actually set up.', fr:'Sitemap simplifié autour du montage réel des campagnes.' } },
    { type:'user-flows',     note:{ en:'Campaign builder rebuilt: opt-in, sharing, referral tracking.', fr:'Campaign builder reconstruit : opt-in, partage, suivi de parrainage.' } },
    { type:'design-system',  note:{ en:'Documented palette, shape language and reusable components.', fr:'Palette, langage de formes et composants documentés.' } },
  ],
  edenred: [
    { type:'user-research', note:{ en:'Discovery with fleet managers: float, cards, stations.', fr:'Discovery avec les gestionnaires de flotte : float, cartes, stations.' } },
    { type:'ia',            note:{ en:'App rebuilt around three jobs-to-be-done.', fr:'App reconstruite autour de trois jobs-to-be-done.' } },
    { type:'prototype',     note:{ en:'High-fidelity prototypes for user validation and iOS/Android handoff.', fr:'Prototypes haute fidélité pour validation et handoff iOS/Android.' } },
    { type:'ui-design',     note:{ en:'Balance, card controls, history and station locator.', fr:'Solde, contrôle des cartes, historique et localisateur de stations.' } },
  ],
  renault: [
    { type:'workshops',   note:{ en:'Requirements from international teams and dealerships.', fr:'Besoins collectés auprès des équipes internationales et des concessions.' } },
    { type:'ia',          note:{ en:'Mapped for 23,900+ vehicles across European markets.', fr:'Cartographiée pour 23 900+ véhicules sur les marchés européens.' } },
    { type:'wireframe',   note:{ en:'Iterative wireframe cycles to keep stakeholders aligned.', fr:'Cycles de wireframes itératifs pour aligner les parties prenantes.' } },
    { type:'ui-design',   note:{ en:'Marketplace plus two back-office tools for stock and brand reporting.', fr:'Marketplace et deux back-offices : stock concessions et reporting marque.' } },
  ],
  lvmh: [
    { type:'user-research',    note:{ en:'CRM interviews mixing maisons, sectors and seniority.', fr:'Entretiens CRM mélangeant maisons, secteurs et séniorité.' } },
    { type:'user-tests',       note:{ en:'User tests on the shared CRM platform.', fr:'Tests utilisateurs sur la plateforme CRM partagée.' } },
    { type:'journey-mapping',  note:{ en:'Customer journey from social discovery to post-purchase sharing.', fr:'Parcours client, de la découverte sociale au partage post-achat.' } },
    { type:'ui-design',        note:{ en:'Shared onboarding, field mapping, import and cleaning flow.', fr:'Onboarding partagé, mapping de champs, import et nettoyage.' } },
  ],
  arlequin: [
    { type:'brand',           note:{ en:'Visual identity from scratch for a regulated trading product.', fr:'Identité visuelle from scratch pour un produit de trading régulé.' } },
    { type:'design-system',   note:{ en:'Design system for the trading platform.', fr:'Design system de la plateforme de trading.' } },
    { type:'ui-design',       note:{ en:'Interface variants for portfolio, live trading room and funds.', fr:'Variantes d’interface : portefeuille, salle de trading, fonds.' } },
    { type:'prototype',       note:{ en:'Mobile and desktop platform, including KYC onboarding.', fr:'Plateforme mobile et desktop, dont l’onboarding KYC.' } },
  ],
  skiset: [
    { type:'user-research', note:{ en:'Real-condition tests on the legacy booking flow.', fr:'Tests en conditions réelles sur le funnel de réservation existant.' } },
    { type:'user-flows',    note:{ en:'Purchase journey restructured across devices.', fr:'Parcours d’achat restructuré sur tous les devices.' } },
    { type:'wireframe',     note:{ en:'Streamlined wireframes before visual design.', fr:'Wireframes allégés avant le design visuel.' } },
    { type:'prototype',     note:{ en:'High-fidelity interactive prototypes, mobile-first.', fr:'Prototypes interactifs haute fidélité, mobile first.' } },
    { type:'user-tests',    note:{ en:'Prototype tests before client presentation. 15/20 mobile, 16/20 desktop.', fr:'Tests du prototype avant présentation client. 15/20 mobile, 16/20 desktop.' } },
  ],
  casino: [
    { type:'ia',          note:{ en:'Site architecture across Drive and Livraison modes.', fr:'Architecture du site sur les modes Drive et Livraison.' } },
    { type:'wireframe',   note:{ en:'Low to mid-fi mobile wireframes before visual design.', fr:'Wireframes mobile low à mid-fi avant le design visuel.' } },
    { type:'prototype',   note:{ en:'Mobile-first mockups with Nutri-Score and mode toggle.', fr:'Maquettes mobile first, Nutri-Score et bascule de mode.' } },
    { type:'user-tests',  note:{ en:'Prototype tests with the project manager and Casino team.', fr:'Tests du prototype avec le chef de projet et l’équipe Casino.' } },
  ],
  sg: [
    { type:'user-research',  note:{ en:'User research and interviews on the savings and investment journeys.', fr:'Recherche utilisateur et entretiens sur les parcours d’épargne et d’investissement.' } },
    { type:'user-tests',     note:{ en:'User tests on the regulated flows.', fr:'Tests utilisateurs sur les parcours réglementés.' } },
    { type:'user-flows',     note:{ en:'Savings, allocation and investment under MIF2.', fr:'Épargne, allocation et investissement sous contraintes MIF2.' } },
    { type:'ui-design',      note:{ en:'High-fidelity Figma mockups on desktop and mobile.', fr:'Maquettes Figma haute fidélité, desktop et mobile.' } },
    { type:'design-system',  note:{ en:'Handover specs and contributions to the bank’s design system.', fr:'Specs de handoff et contributions au design system de la banque.' } },
  ],
  shiseido: [
    { type:'user-research', note:{ en:'User research on loyalty enrollment in the shopping journey.', fr:'Recherche utilisateur sur l’enrôlement fidélité dans le parcours d’achat.' } },
    { type:'user-flows',    note:{ en:'Loyalty placed across browsing, cart and account.', fr:'Fidélité intégrée au parcours : browsing, panier et compte.' } },
    { type:'ui-design',     note:{ en:'Product pages, My Shiseido points, samples and checkout.', fr:'Fiches produit, points My Shiseido, échantillons et checkout.' } },
  ],
  vloggy: [
    { type:'product-vision', note:{ en:'24-min 1080p editing, 10-second video comments, creator monetization.', fr:'Montage 24 min 1080p, commentaires vidéo 10 s, monétisation créateurs.' } },
    { type:'ui-design',      note:{ en:'Complete iOS and Android experience: feed, editor, profile, dashboard.', fr:'Expérience iOS et Android complète : feed, éditeur, profil, dashboard.' } },
    { type:'project-mgmt',   note:{ en:'Project management of the product.', fr:'Gestion de projet du produit.' } },
    { type:'dev-follow',     note:{ en:'Development follow-up.', fr:'Suivi développement.' } },
    { type:'marketing',      note:{ en:'Marketing.', fr:'Marketing.' } },
  ],
  flemme: [
    { type:'product-vision', note:{ en:'Social Monitor, DeepFlow, DM Prospection and Ad Library.', fr:'Social Monitor, DeepFlow, DM Prospection et Ad Library.' } },
    { type:'ai-vibe-code',   note:{ en:'Modular agentic system coordinated from one dashboard.', fr:'Système agentique modulaire, coordonné depuis un dashboard.' } },
  ],
  jarvos: [
    { type:'product-vision', note:{ en:'Semantic dispatch: the model proposes, the backend decides.', fr:'Dispatch sémantique : le modèle propose, le backend décide.' } },
    { type:'ai-vibe-code',   note:{ en:'Plan / execute / verify loop with tool resolution and approvals.', fr:'Boucle plan / execute / verify, résolution d’outils et approvals.' } },
    { type:'ui-design',      note:{ en:'Next.js cockpit: chat, system health, schema view.', fr:'Cockpit Next.js : chat, system health, vue schéma.' } },
  ],
  'ancient-world': [
    { type:'product-vision', note:{ en:'Three classes, two factions, seasonal Pyramidion PvPvE.', fr:'Trois classes, deux factions, Pyramidion PvPvE saisonnier.' } },
    { type:'game-3d',        note:{ en:'3D game production.', fr:'Production 3D du jeu.' } },
    { type:'prototype',      note:{ en:'Local multiplayer loop on Unreal 5.7, OWS and Supabase.', fr:'Boucle multijoueur locale sur Unreal 5.7, OWS et Supabase.' } },
  ],
  bmw: [
    { type:'audit',      note:{ en:'UX/UI audit and data analysis of conversion weak points.', fr:'Audit UX/UI et analyse data des points de friction à la conversion.' } },
    { type:'prototype',  note:{ en:'Prototypes of the redesigned pages.', fr:'Prototypes des pages redesignées.' } },
    { type:'ui-design',  note:{ en:'Key pages redesigned within BMW’s visual identity.', fr:'Pages clés redesignées dans l’identité visuelle BMW.' } },
    { type:'handoff',    note:{ en:'Design specs for development teams across markets.', fr:'Spécifications pour les équipes de développement, multi-marchés.' } },
  ],
  sncf: [
    { type:'workshops',        note:{ en:'Workshops to align internal, investor and passenger needs.', fr:'Ateliers pour aligner besoins internes, investisseurs et voyageurs.' } },
    { type:'user-research',    note:{ en:'Personas, including an institutional investor for green bonds.', fr:'Personas, dont un investisseur institutionnel pour les green bonds.' } },
    { type:'journey-mapping',  note:{ en:'TGV experience map covering every touchpoint.', fr:'Experience map TGV, de bout en bout.' } },
    { type:'ia',               note:{ en:'Interaction trees for internal platforms, including concertation.', fr:'Arbres d’interaction pour les plateformes internes, dont la concertation.' } },
    { type:'prototype',        note:{ en:'High-fidelity SNCF Concerter on desktop and mobile.', fr:'SNCF Concerter haute fidélité, desktop et mobile.' } },
  ],
  galian: [
    { type:'user-research',  note:{ en:'User research and interviews on the insurance journeys.', fr:'Recherche utilisateur et entretiens sur les parcours d’assurance.' } },
    { type:'user-tests',     note:{ en:'User tests on the subscription and claims flows.', fr:'Tests utilisateurs sur les parcours de souscription et de sinistre.' } },
    { type:'user-flows',     note:{ en:'Subscription, endorsement, claims and renewal mapped into linear flows.', fr:'Souscription, avenant, sinistre et renouvellement en parcours linéaires.' } },
    { type:'ui-design',      note:{ en:'Desktop platform: onboarding, policies, documents, claims, advisor portal.', fr:'Plateforme desktop : onboarding, contrats, documents, sinistres, portail conseiller.' } },
    { type:'design-system',  note:{ en:'Component library built for compliance-heavy flows.', fr:'Librairie de composants pour des parcours très contraints réglementairement.' } },
  ],
};

const PROJECTS = [
  {
    "id": "creads",
    "num": "01",
    "group": "ai",
    "cover": "covers/creads.webp",
    "logo": "../images/creads-logo.webp",
    "company": "Creads.io",
    "tagline": "AI advertising, from brand context to creative output",
    "role": "Founder & AI Product Builder",
    "year": "2024 – Present",
    "duration": "Ongoing",
    "team": "Solo",
    "platforms": [
      "Desktop"
    ],
    "tag": "AI SaaS · Founder",
    "badges": [
      "Ads eCom"
    ],
    "accent": "#a855f7",
    "desc": "I founded and built Creads.io, an AI advertising SaaS with 1,200 registered users and 20 paying clients. I own the user experience, AI workflow, infrastructure and launch.",
    "subtitle": "Brand analysis, creative briefs and ad generation",
    "challenge": "Carry a brand’s identity, audience and positioning through the brief and generated creative, while keeping the workflow manageable as a solo founder.",
    "goals": "Connect brand onboarding, creative decisions and generation, with a check against the brief before accepting an output.",
    "solution": "Structured brand context as JSON, kept it available through persistent memory, and built a brief around explicit creative criteria. Matching retrieves taxonomy data and brand history; a second prompt checks the generated output against the brief.",
    "steps": [
      {
        "num": "01",
        "title": "Keep the brand context",
        "desc": "The Brand Agent reads the website with Firecrawl and structures identity, tone, audience and positioning as JSON. Mem0 stores brand context between sessions; retrieval supplies taxonomy data and brand history."
      },
      {
        "num": "02",
        "title": "Make creative choices explicit",
        "desc": "The brief records the hook, emotion, bias, composition, format, awareness stage, campaign goal, wording rules, platform and audience. SaaS and e-commerce use separate briefing logic. Matching uses 500+ taxonomy elements and 4,000+ structured templates."
      },
      {
        "num": "03",
        "title": "Check the output against the brief",
        "desc": "One prompt generates the output. A second checks coherence and brief compliance before acceptance. Python workers run on Cloud Run, with Supabase, Vercel and Cloudflare supporting the application."
      }
    ],
    "outcome": "1,200 registered users, 20 paying clients and 5,000 monthly visits, confirmed in September 2026. Zero paid acquisition. Founded and built independently.",
    "outcomeStat": "1,200 users",
    "url": "https://www.creads.io/",
    "screenshot": "../images/screenshot_creads.webp",
    "video": "../images/creads-video-cover.mp4",
    "narrative": [
      {
        "type": "text",
        "label": "My scope",
        "title": "From product design to a launched SaaS",
        "body": "I founded and built Creads.io, an AI advertising SaaS with 1,200 registered users and 20 paying clients. I own the user experience, AI workflow, infrastructure and launch."
      },
      {
        "type": "tools-row",
        "label": "Stack",
        "tools": [
          { "name": "Firecrawl", "icon": "../images/firecrawl.png" },
          { "name": "Mem0" },
          { "name": "Supabase", "icon": "../images/supabase.png" },
          { "name": "Google Cloud Run", "icon": "../images/gcloud.png" },
          { "name": "Vercel", "icon": "../images/vercel-logo.svg" },
          { "name": "Cloudflare", "icon": "../images/cloudflare-logo.svg" }
        ]
      },
      {
        "type": "text",
        "label": "The product problem",
        "title": "Keep brand context through creative production",
        "body": "Carry a brand’s identity, audience and positioning through the brief and generated creative, while keeping the workflow manageable as a solo founder."
      },
      {
        "type": "creads-vitrine",
        "label": "The product",
        "title": "The Creads website",
        "body": "The website introduces the product and its brand-to-creative workflow. The module below recreates the landing page."
      },
      {
        "type": "image-grid",
        "label": "Key interfaces",
        "borderless": true,
        "images": [
          {
            "src": "../images/creads-live-hero.webp",
            "caption": "creads.io live — landing hero: rotating value proposition and the generated-ads wall"
          },
          {
            "src": "../images/creads-live-feature.webp",
            "caption": "Creative Director and product interface"
          }
        ]
      },
      {
        "type": "image-grid",
        "images": [
          {
            "src": "../images/creads-admin.png",
            "caption": "Admin dashboard: campaign management and creative scoring"
          },
          {
            "src": "../images/creads-bot.png",
            "caption": "AI bot interface: brief generation and creative intelligence"
          }
        ]
      },
      {
        "type": "text",
        "label": "Product decisions",
        "title": "Structured inputs and a separate output check",
        "body": "Structured brand context as JSON, kept it available through persistent memory, and built a brief around explicit creative criteria. Matching retrieves taxonomy data and brand history; a second prompt checks the generated output against the brief."
      },
      {
        "type": "creads-brand",
        "label": "The charte",
        "title": "Colours, typography and components",
        "body": "I used near-black surfaces and high-contrast text for Creads. Emerald marks agent status; purple identifies AI functions. The interface uses 2px corners, with Sansation for dashboard titles, Readex Pro for display text and TikTok Sans for controls."
      },
      {
        "type": "creads-console",
        "label": "Interactive module",
        "title": "Inside the product: DNA, scoring, generation.",
        "body": "Use the tabs to try the brand crawler, review the Smart Match scores and inspect a generation output. These are interactive recreations of the product screens."
      },
      {
        "type": "process",
        "title": "How the workflow works"
      },
      {
        "type": "outcome",
        "stat": "1,200 users",
        "text": "1,200 registered users, 20 paying clients and 5,000 monthly visits, confirmed in September 2026. Zero paid acquisition. Founded and built independently."
      }
    ]
  },

  {
    id:'challenge-live-ops', num:'02', group:'automation', logo:null, hidden:true,
    company:'Webinar landing', tagline:'Systeme.io, Google Sheets, Make & Twilio Recovery System',
    role:'Automation & Data Ops Builder',
    year:'2026', duration:'48h rebuild', team:'Solo',
    platforms:['Desktop'], tag:'Automation · CRM Ops', badges:['Make','Twilio','Sheets'], accent:'#8cff2f',
    heroCover:'assets/challenge-hero-human.png',
    desc:'Reconstruction complete du système d\'inscription et de relance SMS pour un challenge francophone dont le premier live a lieu dimanche 24 mai 2026 à 20h.',
    subtitle:'Rebuild d\'un tunnel live après crash des automatisations',
    challenge:'Un créateur francophone lance un 5-Day Challenge. Les inscriptions viennent de Facebook Ads, YouTube Ads, organique, affiliation et TikTok, avec deux offres: Gratuite ou VIP. Un bug a cassé les automatisations avant le premier live du dimanche 24 mai 2026 à 20h.',
    goals:'Reconstruire le tunnel de bout en bout: landing Systeme.io, nettoyage de la base existante, scénario Make + Twilio pour les rappels payants, puis relance des absents malgré l\'absence de liste de présence YouTube.',
    solution:'J\'ai conçu un système data-first: contrat de champs unique, Google Sheet de travail canonique, normalisation téléphone en E.164, segmentation coût avant envoi, batch SMS contrôlé via Make, callbacks Twilio, et présence proxy via liens live trackés.',
    steps:[
      {num:'01', title:'Opt-in Systeme.io propre', desc:'Formulaire avec prénom, nom, email, téléphone, source d\'acquisition et type d\'inscription. Chaque option est mappée vers une valeur canonique pour éviter les variantes libres.'},
      {num:'02', title:'Google Sheet de travail', desc:'Import du Sheet brut, déduplication email/téléphone, normalisation source, offre, pays, téléphone E.164, statut consentement, statut présence et priorité d\'envoi.'},
      {num:'03', title:'Make + Twilio contrôlé', desc:'Filtre paid traffic francophone, estimation du coût par segment SMS, throttling par batch, test sur seed list, puis passage Twilio avec status callbacks avant validation finale.'},
      {num:'04', title:'Absents YouTube', desc:'YouTube ne remontant pas les présents, la présence est mesurée par lien live unique et page de check-in. A T+30, seuls les inscrits non check-in reçoivent la relance.'},
    ],
    outcome:'Système reconstruit de A à Z: collecte propre, base exploitable, rappel SMS à budget contrôlé, et logique de relance des absents sans dépendre d\'une donnée YouTube indisponible.',
    outcomeStat:'4 workflows', landingIfaceId:'challenge-live-webinar',
    narrative: [
      { type:'text', label:'Contexte', title:'Un live à 20h, des ads qui tournent, et plus aucune automatisation',
        body:"Le client avait déjà payé pour acquérir des inscriptions via Facebook Ads et YouTube Ads. Les rappels devaient aider les inscrits à rejoindre le live tout en respectant le budget SMS et leur consentement." },
      { type:'schema-split', label:'01 · Landing page', title:'Un formulaire pensé comme un contrat de data',
        visual:`<div style="background:#0f172a; border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:20px; font-family:sans-serif; color:#f1f5f9; box-shadow:0 10px 25px rgba(0,0,0,.3); display:flex; flex-direction:column; gap:12px;"><div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,.06); padding-bottom:10px; margin-bottom:4px;"><div style="display:flex; gap:6px;"><span style="width:8px; height:8px; background:#ef4444; border-radius:50%;"></span><span style="width:8px; height:8px; background:#fbbf24; border-radius:50%;"></span><span style="width:8px; height:8px; background:#22c55e; border-radius:50%;"></span></div><span style="font-size:9px; font-family:monospace; color:rgba(255,255,255,.4);">Opt-in Preview</span></div><div style="text-align:center; margin-bottom:8px;"><div style="font-size:14px; font-weight:700; color:#fff;">Rejoindre le Live Pro</div><div style="font-size:9.5px; color:rgba(255,255,255,.5); margin-top:2px;">Dimanche 24 Mai à 20h00</div></div><form onsubmit="return false;" style="display:flex; flex-direction:column; gap:10px;"><div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;"><div><label style="display:flex; align-items:center; gap:4px; font-size:9px; font-weight:600; color:rgba(255,255,255,.6); margin-bottom:4px;"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Prénom</label><input type="text" placeholder="Jean" disabled style="width:100%; font-size:10.5px; padding:7px 10px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.1); border-radius:6px; color:#fff; cursor:not-allowed;"></div><div><label style="display:flex; align-items:center; gap:4px; font-size:9px; font-weight:600; color:rgba(255,255,255,.6); margin-bottom:4px;"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Nom</label><input type="text" placeholder="Dupont" disabled style="width:100%; font-size:10.5px; padding:7px 10px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.1); border-radius:6px; color:#fff; cursor:not-allowed;"></div></div><div><label style="display:flex; align-items:center; gap:4px; font-size:9px; font-weight:600; color:rgba(255,255,255,.6); margin-bottom:4px;"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Email</label><input type="email" placeholder="jean.dupont@gmail.com" disabled style="width:100%; font-size:10.5px; padding:7px 10px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.1); border-radius:6px; color:#fff; cursor:not-allowed;"></div><div><label style="display:flex; align-items:center; gap:4px; font-size:9px; font-weight:600; color:rgba(255,255,255,.6); margin-bottom:4px;"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Téléphone (SMS)</label><input type="tel" placeholder="+33 6 12 34 56 78" disabled style="width:100%; font-size:10.5px; padding:7px 10px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.1); border-radius:6px; color:#fff; cursor:not-allowed;"></div><div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;"><div><label style="display:flex; align-items:center; gap:4px; font-size:9px; font-weight:600; color:rgba(255,255,255,.6); margin-bottom:4px;"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><line x1="2" y1="12" x2="22" y2="12"/></svg> Source</label><div style="position:relative;"><select disabled style="width:100%; font-size:10px; padding:7px 10px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.1); border-radius:6px; color:#fff; cursor:not-allowed; appearance:none;"><option>Facebook Ads</option></select><span style="position:absolute; right:8px; top:50%; transform:translateY(-50%); font-size:8px; color:rgba(255,255,255,.4);">▼</span></div></div><div><label style="display:flex; align-items:center; gap:4px; font-size:9px; font-weight:600; color:rgba(255,255,255,.6); margin-bottom:4px;"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Offre</label><div style="position:relative;"><select disabled style="width:100%; font-size:10px; padding:7px 10px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.1); border-radius:6px; color:#fff; cursor:not-allowed; appearance:none;"><option>Option VIP (Accès Prioritaire)</option></select><span style="position:absolute; right:8px; top:50%; transform:translateY(-50%); font-size:8px; color:rgba(255,255,255,.4);">▼</span></div></div></div><button disabled style="margin-top:4px; width:100%; padding:10px; font-size:11px; font-weight:700; color:#071006; background:#8cff2f; border:none; border-radius:8px; display:flex; justify-content:center; align-items:center; gap:6px; cursor:not-allowed; box-shadow:0 4px 14px rgba(140,255,47,.2);">Confirmer l'inscription <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button></form></div>`,
        body:'Dans Systeme.io, je crée une page d\'opt-in avec champs obligatoires et listes fermées. Les labels restent lisibles pour l\'utilisateur, mais les valeurs envoyées sont techniques et stables: facebook_ads, youtube_ads, organic, affiliate, tiktok, free, vip. A l\'arrivée, Make ou le webhook alimente un Sheet avec horodatage, UTM, consentement SMS, pays détecté et statut de validation.<br><br><span style="display:block; padding:12px 16px; background:rgba(140,255,47,.04); border-left:3px solid #8cff2f; border-radius:4px; font-size:12.5px; line-height:1.6; color:var(--ink-2);"><strong style="color:var(--ink);">Note de conception :</strong> Dans ce Playground de démonstration, le champ <em>"Source d’acquisition"</em> est visible pour vous laisser tester et simuler les différents comportements d\'automatisation. Sur une vraie landing en production, ce champ est masqué et capté automatiquement sous le capot via :<br>• <strong>Paramètres URL :</strong> utm_source, utm_medium, utm_campaign, utm_content, utm_term<br>• <strong>Click IDs publicitaires :</strong> fbclid (Meta), gclid (Google), ttclid (TikTok)<br>• <strong>Referrer :</strong> trafic organique, affiliation ou direct<br>• <strong>Pixels de tracking :</strong> Meta, TikTok, Google, YouTube côté tracking<br>• <strong>Cookies first-party :</strong> pour maintenir la provenance sur tout le tunnel.</span>' },
      { type:'schema-split', label:'02 · Nettoyage data', title:'Un Sheet brut transformé en base opérationnelle', flip:true,
        visual:`<div style="background:rgba(16,185,129,.03); border:1px solid rgba(16,185,129,.14); border-radius:14px; padding:20px; font-family:sans-serif; color:var(--ink); display:flex; flex-direction:column; gap:14px;"><div style="font-size:9px; font-family:monospace; letter-spacing:.16em; color:#059669; text-transform:uppercase; font-weight:bold;">Data Cleaning Pipeline · Raw vs Clean</div><div style="display:grid; grid-template-columns:1fr; gap:12px;"><div style="background:#fff; border:1px dashed rgba(239,68,68,.3); border-radius:10px; padding:12px; box-shadow:0 2px 8px rgba(0,0,0,.02);"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"><span style="font-size:11px; font-weight:700; color:#ef4444; text-transform:uppercase; letter-spacing:0.04em;">Données Brutes (Libres)</span><span style="font-size:9px; background:rgba(239,68,68,.08); color:#ef4444; padding:2px 6px; border-radius:4px; font-family:monospace; font-weight:bold;">Doublons / Non normalisé</span></div><table style="width:100%; border-collapse:collapse; font-size:10px; text-align:left;"><thead><tr style="border-bottom:1px solid rgba(0,0,0,.06); color:rgba(0,0,0,.45);"><th style="padding:4px 0;">Nom</th><th style="padding:4px 0;">Email</th><th style="padding:4px 0;">Téléphone</th><th style="padding:4px 0;">Acquisition</th></tr></thead><tbody><tr style="border-bottom:1px solid rgba(0,0,0,.03); color:#dc2626;"><td style="padding:6px 0; font-weight:500;">hugo vermot</td><td style="padding:6px 0;">hugo@vermot.com</td><td style="padding:6px 0;">06.12.34.56.78</td><td style="padding:6px 0;">FB Ads</td></tr><tr style="color:#dc2626;"><td style="padding:6px 0; font-weight:500;">Hugo V.</td><td style="padding:6px 0;">hugo@vermot.com</td><td style="padding:6px 0;">+33 6 12 34 56 78</td><td style="padding:6px 0;">Facebook-Ads</td></tr></tbody></table></div><div style="display:flex; justify-content:center; align-items:center; margin:-6px 0;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(90deg);"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg></div><div style="background:#fff; border:1px solid rgba(16,185,129,.3); border-radius:10px; padding:12px; box-shadow:0 4px 12px rgba(16,185,129,.05);"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"><span style="font-size:11px; font-weight:700; color:#059669; text-transform:uppercase; letter-spacing:0.04em;">Données Opérationnelles</span><span style="font-size:9px; background:rgba(16,185,129,.08); color:#059669; padding:2px 6px; border-radius:4px; font-family:monospace; font-weight:bold;">Dédupliqué & Format E.164</span></div><table style="width:100%; border-collapse:collapse; font-size:10px; text-align:left;"><thead><tr style="border-bottom:1px solid rgba(0,0,0,.06); color:rgba(0,0,0,.45);"><th style="padding:4px 0;">lead_id</th><th style="padding:4px 0;">email_norm</th><th style="padding:4px 0;">phone_e164</th><th style="padding:4px 0;">source</th></tr></thead><tbody><tr style="color:#059669; font-weight:500;"><td style="padding:6px 0; font-family:monospace;">L-042</td><td style="padding:6px 0;">hugo@vermot.com</td><td style="padding:6px 0; font-family:monospace;">+33612345678</td><td style="padding:6px 0; font-family:monospace;">facebook_ads</td></tr></tbody></table></div></div></div>`,
        body:'Je garde le Sheet brut intact, puis je crée mon propre Google Sheet de travail. Les colonnes clés: lead_id, first_name, last_name, email_norm, phone_e164, country, market, acquisition_source, signup_type, sms_consent, live_link_token, attendance_status, sms_segment_count, send_priority et twilio_status. Les doublons sont fusionnés avec priorité au VIP, au téléphone valide et à l\'inscription la plus récente.' },
      { type:'schema-split', label:'03 · SMS rappel', title:'Envoyer le maximum sans brûler le budget',
        visual:`<div style="background:rgba(2,6,23,.96);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:22px;color:#fff"><div style="font-size:9px;font-family:monospace;letter-spacing:.16em;color:#7dd3fc;text-transform:uppercase;margin-bottom:14px">Make scenario · live reminder</div><div style="display:flex;flex-direction:column;gap:8px"><div style="padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.07);display:flex;justify-content:space-between"><span style="font-size:12px">Sheet search rows</span><b style="font-size:11px;color:#7dd3fc">paid + FR market</b></div><div style="padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.07);display:flex;justify-content:space-between"><span style="font-size:12px">Cost guard</span><b style="font-size:11px;color:#7dd3fc">segments x country price</b></div><div style="padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.07);display:flex;justify-content:space-between"><span style="font-size:12px">Batch router</span><b style="font-size:11px;color:#7dd3fc">VIP → valid paid → rest</b></div><div style="padding:10px 12px;border-radius:8px;background:rgba(14,165,233,.2);border:1px solid rgba(125,211,252,.22);display:flex;justify-content:space-between"><span style="font-size:12px">Twilio API</span><b style="font-size:11px;color:#fff">status callback</b></div></div></div>`,
        body:'Le scénario Make part du Sheet propre, filtre uniquement Facebook Ads et YouTube Ads sur marché francophone, exclut les numéros invalides et les opt-outs, calcule le nombre de segments SMS, puis compare l\'estimation au budget restant. L\'étape à ne pas oublier entre la séquence préparée et le SMS reçu: le passage opérateur via Twilio, avec sender/geopermissions validés, débit contrôlé et Status Callback pour écrire sent, delivered, undelivered ou failed dans le Sheet.' },
      { type:'schema-split', label:'04 · Relance absents', title:'Quand YouTube ne donne pas la présence, on crée un signal fiable', flip:true,
        visual:`<div style="background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.2);border-radius:14px;padding:22px"><div style="font-size:9px;font-family:monospace;letter-spacing:.16em;color:#d97706;text-transform:uppercase;margin-bottom:14px">Attendance proxy · T+30</div><div style="display:grid;gap:8px"><div style="padding:12px;background:#fff;border-radius:10px;border:1px solid rgba(12,11,9,.08)"><div style="font-size:11px;font-weight:800;color:#92400e">Unique live link</div><div style="font-size:10px;color:rgba(12,11,9,.48)">/live?token=lead_id_hash → redirect YouTube</div></div><div style="padding:12px;background:#fff;border-radius:10px;border:1px solid rgba(12,11,9,.08)"><div style="font-size:11px;font-weight:800;color:#92400e">Check-in event</div><div style="font-size:10px;color:rgba(12,11,9,.48)">clicked_live or checked_in = present proxy</div></div><div style="padding:12px;background:#fff;border-radius:10px;border:1px solid rgba(12,11,9,.08)"><div style="font-size:11px;font-weight:800;color:#92400e">T+30 relance</div><div style="font-size:10px;color:rgba(12,11,9,.48)">attendance_status != present + SMS consent</div></div></div></div>`,
        body:"YouTube ne fournit pas la liste des participants. Chaque inscrit reçoit donc un lien unique : son clic est enregistré avant la redirection vers YouTube. Une page de check-in peut compléter ce suivi. À 20h30, Make relance les personnes sans clic ni check-in, avec un message adapté à leur inscription VIP ou gratuite. Un clic indique un accès au lien, pas une présence confirmée pendant le live." },
      { type:'process', title:'Execution plan' },
      { type:'outcome', stat:'4 workflows', text:'Landing Systeme.io, Sheet de nettoyage, rappel SMS payé, relance des absents: un système complet, contrôlable et auditable avant le live du dimanche 24 mai 2026 à 20h.' },
    ],
  },
  {
    id:'uxfi', num:'02', group:'ai', cover:'covers/uxfi.jpg', logo:'../images/uxfi.png',
    company:'UXfi.ai', tagline:'AI UX Audit Platform',
    role:'Founder & Builder',
    year:'2022 – Present', duration:'Prototype', team:'Solo',
    platforms:['Desktop'], tag:'AI Tool · Founder', badges:['Ads eCom'], accent:'#6366f1',
    desc:'AI UX audit SaaS with multi-axis scoring and AI redesign suggestions. E-commerce focused, from $10/month.',
    subtitle:'UX scores and redesign suggestions for e-commerce',
    challenge:"Turn my UX audit practice into a tool that gives e-commerce teams an initial assessment and suggested changes.",
    goals:"Help teams identify usability issues and decide which screens to review first.",
    solution:'Built a multi-dimensional UX scoring system powered by AI. Users submit a URL, the system audits the product, generates a multi-axis score, and provides prioritized AI redesign recommendations.',
    steps:[
      {num:'01', title:'Scoring Architecture', desc:'Designed the multi-dimensional scoring system across visual hierarchy, navigation clarity, CTA effectiveness, mobile UX, and conversion optimization dimensions.'},
      {num:'02', title:'AI Audit Pipeline', desc:'Built the AI pipeline to analyze product screenshots and generate structured UX feedback with severity ratings, issue categorization, and prioritized improvement recommendations.'},
      {num:'03', title:'Product Design', desc:'Designed the full product UI: audit dashboard with total score display, dimension breakdown cards, issue list with recommendations, and redesign suggestion previews.'},
    ],
    outcome:'AI UX audit platform: multi-axis scoring, AI redesign suggestions, e-commerce focus. Available from $10/month.',
    outcomeStat:null, url:'https://v0-uxfi.vercel.app/', screenshot:'../images/screenshot_uxfi.webp',
    narrative: [
      { type:'text', label:'The idea', title:'AI that evaluates UX quality, without needing a designer',
        body:"I built UXfi to give e-commerce teams an initial UX assessment. It scores the product across several dimensions and suggests changes for review." },
      { type:'tools-row', label:'Stack', tools:[
        { name:'Vercel v0', icon:'../images/vercel-logo.svg' },
        { name:'OpenAI', icon:'../images/openai-logo.svg' },
      ]},
      { type:'image-full', src:'../images/screenshot_uxfi.webp', bleed:true, link:'https://v0-uxfi.vercel.app/',
        caption:'uxfi.ai live — hero: paste any URL to audit, a live total-score preview, and category cards (media & design and others) scored out of 100' },
      { type:'image-grid', label:'Key interfaces', borderless:true, images:[
          { src:'../images/uxfi-live-hero.webp', caption:'uxfi.ai live — hero: paste a URL, get an AI UX audit instantly, with the 3-step method below' },
          { src:'../images/uxfi-live-feature.webp', caption:'uxfi.ai live — "The website you love but AI optimized": before/after redesign demo' },
        ]},
      { type:'text', label:'The product', title:'Multi-axis scoring and AI redesign suggestions',
        body:'Users submit a URL. The system analyzes the product across 5 axes: visual hierarchy, navigation clarity, CTA effectiveness, mobile UX, and conversion. It generates a total score, ranks issues by severity, and produces prioritized AI redesign suggestions. E-commerce focused, from $10/month.' },
      { type:'process', title:'How I built it' },
      { type:'outcome', text:'AI UX audit platform: multi-axis scoring, AI redesign suggestions, e-commerce focus. Available from $10/month.' },
    ],
  },
  {
    id:'panfy', num:'03', group:'ai', cover:'covers/panfy.webp', logo:'../images/panfy_icon.png',
    company:'Panfy', tagline:'Hyperliquid-based AI trading analysis system',
    role:'Builder',
    year:'2024', duration:'3 months', team:'Solo',
    platforms:['Desktop'], tag:'FinTech · Crypto', badges:['FinTech','Crypto'], accent:'#22c55e',
    desc:"A crypto analysis dashboard combining market data, technical indicators and AI signals, with a $PAN token layer. The project is on hold.",
    subtitle:'AI trading analysis for the Hyperliquid ecosystem',
    challenge:"Bring price movements, market indicators and social trends into a dashboard traders can review together.",
    goals:"Combine market data and AI analysis in one interface, with technical charts and a $PAN token layer.",
    solution:'Built a real-time dashboard and analysis workflow with market overview cards, gainer/loser rankings, token detail views, technical analysis panels, Hyperliquid depth modules, AI signal classification, and a native $PAN token layer.',
    steps:[
      {num:'01', title:'Market Intelligence Architecture', desc:'Mapped the data hierarchy around live prices, market cap, 24h volume, BTC dominance, volatility, Fear & Greed, trending tokens, top gainers, top losers and Hyperliquid ecosystem assets.'},
      {num:'02', title:'Trading UI System', desc:'Designed a dense dark dashboard with scan-friendly cards, tabbed token detail views, side-panel liquidity depth, technical indicator cards and action states that keep the trader focused.'},
      {num:'03', title:'AI Signal Layer', desc:'Added an AI analysis layer for market regime classification, opportunity detection, risk warnings, RSI/MACD interpretation and decision-ready summaries connected to live Hyperliquid data.'},
    ],
    outcome:"A working crypto analytics prototype with technical charts, market indicators and AI signals. The project is on hold.",
    outcomeStat:'Live', url:'https://v0-panfy.vercel.app/', screenshot:'../images/screenshot_panfy.webp', heroCover:'../images/panfy-cover.webp',
    narrative: [
      { type:'text', label:'The product', title:'Market data and analysis in one view',
        body:"Panfy brings market data and AI commentary into one dashboard. It includes token rankings, technical indicators and trader data so users can review them alongside the chart." },
      { type:'tools-row', label:'Stack', tools:[
        { name:'Vercel v0', icon:'../images/vercel-logo.svg' },
        { name:'Hyperliquid' },
        { name:'X API', icon:'../images/x-logo.svg' },
      ]},
      { type:'panfy-screenshots', label:'Screenshots', title:'The product language is dense, dark and scan-first',
        body:'The dashboard borrows from professional trading software: compact navigation, high-contrast market states, neon green opportunity markers, red risk states, tabbed analysis, and side panels that keep actionable data close to the chart.',
        images:[
          { src:'../images/panfy-live-feature.webp', title:'All tokens — live', caption:'The live token dashboard: 230+ tokens with price, market cap, 24h volume and open interest, streamed from Hyperliquid.' },
          { src:'../images/panfy-live-trending.webp', title:'Trending — live', caption:'Trending tokens ranked by score, with per-token watch, alert and quick-trade actions.' },
          { src:'../images/panfy-market-intel.webp', title:'Market overview', caption:'Hero market intelligence and global metrics: market cap, 24h volume, BTC dominance, volatility and Fear & Greed.' },
          { src:'../images/panfy-market-lists.webp', title:'Token rankings', caption:'Top gainers, top losers and HyperSwap-powered trending lists designed for fast scanning.' },
        ] },
      { type:'panfy-flow', label:'System design', title:'From Hyperliquid data to an AI trading signal',
        body:"I separated data collection, market context and AI scoring in the analysis flow. Traders can review the source data alongside the resulting signal." },
      { type:'panfy-analysis', label:'Interactive module', title:'A token detail view designed around signal confidence',
        body:'The detail page combines chart context, RSI/MACD/Bollinger states, Hyperliquid depth, spread, bid/ask ratio and an AI interpretation layer. The trader can switch between market, technical and AI views without losing the surrounding execution context.' },
      { type:'process', title:'How I approached it' },
      { type:'outcome', stat:'Live', text:"A working crypto analytics prototype with technical charts, market indicators and AI signals. The project is on hold." },
    ],
  },
  {
    "id": "oneasset",
    "num": "03c",
    "group": "enterprise",
    "logo": "../images/oneasset-logo.png",
    "company": "OneAsset",
    "tagline": "Regulated Real-World Asset Investment Platform",
    "role": "Product Manager / Product Lead",
    "year": "Feb 2026 – Present",
    "duration": "Ongoing",
    "team": "Sole designer · Product and engineering team",
    "platforms": [
      "Desktop"
    ],
    "tag": "RWA FinTech · Product Lead",
    "badges": [
      "FinTech",
      "Web3"
    ],
    "accent": "#107eff",
    "desc": "I own the design across OneAsset, from the admin platform and investor application to the marketing website. My work includes product strategy, compliance journeys, the design system and interactive prototypes built with AI.",
    "subtitle": "Sole design ownership across product, admin and marketing",
    "challenge": "Keep investor, operator and admin workflows coherent across the platform and marketing website while collaborating with engineering on a changing product.",
    "goals": "Design the investor journey, marketplace, KYB onboarding and Property Manager workspace, with reporting suited to each asset class.",
    "solution": "Designed the product and marketing surfaces, built interactive prototypes with AI coding tools, and organized design work through AI agents on GitHub. Figmol is the internal tool I built to review the live prototype and hand design changes to engineering.",
    "steps": [
      {
        "num": "01",
        "title": "Design across the product",
        "desc": "Mapped investor, Property Manager and admin workflows, including onboarding and compliance. Designed the interface and shared design system across these surfaces and the marketing website."
      },
      {
        "num": "02",
        "title": "Interactive prototypes",
        "desc": "Built interactive prototypes with AI coding tools to review the product as a working experience."
      },
      {
        "num": "03",
        "title": "GitHub agents",
        "desc": "Set up the design process around AI agents on GitHub, with a design repository, product requirements and PR reviews. Built Figmol to review the live prototype and prepare Cursor handoffs."
      }
    ],
    "outcome": "Design ownership across the admin platform, user-facing application and marketing website, with a shared design system, interactive prototypes, a GitHub agent workflow. Figmol is OneAsset's internal review tool.",
    "outcomeStat": null,
    "url": "https://oneasset.io",
    "screenshot": "../images/oneasset-investor-portfolio.webp",
    "heroCover": "../images/oneasset-cover.png",
    "narrative": [
      {
        "type": "text",
        "label": "The context",
        "title": "Sole designer across the product and marketing site",
        "body": "I own the design across OneAsset, from the admin platform and investor application to the marketing website. My work includes product strategy, compliance journeys, the design system and interactive prototypes built with AI."
      },
      {
        "type": "tools-row",
        "label": "Stack",
        "tools": [
          { "name": "Figma", "icon": "../images/figma.png" },
          { "name": "Cursor", "icon": "../images/cursor-logo.jpg" },
          { "name": "Claude Code", "icon": "../images/claude-logo.svg" },
          { "name": "GitHub", "icon": "../images/github-logo.svg" }
        ]
      },
      {
        "type": "image-full",
        "src": "../images/oneasset-investor-portfolio.webp",
        "borderless": true,
        "caption": "The real product — Investor Portfolio: total portfolio value, monthly yield, value trend, and the property marketplace with asset-class filters."
      },
      {
        "type": "image-grid",
        "label": "Key interfaces",
        "borderless": true,
        "images": [
          {
            "src": "../images/oneasset-pm-dashboard.webp",
            "caption": "PM workspace — Dashboard: properties under management, sub-accounts, reports due, and the Investor Q&A activity stream."
          },
          {
            "src": "../images/oneasset-pm-property-detail.webp",
            "caption": "PM workspace — Property detail (Marina Tower A): asset profile, versioned operational reports, and investor count."
          }
        ]
      },
      {
        "type": "browser-window",
        "src": "../images/oneasset-marketing-home.webp",
        "srcAlt": "../images/oneasset-marketing-home-white.webp",
        "url": "oneasset.io",
        "caption": "The live marketing home page — scroll inside the window to walk the full landing, and use the Dark / White switch to flip between the two shipped themes: institutional positioning, the regulatory trust bar (VARA licensed, non-custodial, daily USDC yield, built on Base), the featured live asset, the self-custody explainer, how-it-works, the building-divided-into-shares purchase concept, and the $10,000 entry CTA."
      },
      {
        "type": "oneasset-vitrine",
        "label": "The method",
        "title": "A homepage built like an investment memorandum.",
        "body": "The homepage explains the regulatory context, presents a property and its distribution terms, then describes how ownership works. I used a clear information hierarchy to make those details easy to find."
      },
      {
        "type": "oneasset-shares",
        "label": "How it works",
        "title": "A building, divided into ownership.",
        "body": "Investors select shares in a property and review their allocation and distribution terms. ERC-3643 handles the transfer restrictions behind that purchase flow."
      },
      {
        "type": "oneasset-workspace",
        "label": "Operator side",
        "title": "Inside the Property Manager workspace.",
        "body": "Operators live in a six-module workspace: Overview, Admission, Properties, Reports, Payouts, and Payment Locks. Reporting is asset-class dependent — rent roll and occupancy for commercial, ADR and RevPAR for hospitality — with Published / Needs Info / Corrections review loops. Recreated here as a working console: click the tabs."
      },
      {
        "type": "text",
        "label": "Internal tooling",
        "title": "An AI-agent workflow on GitHub",
        "body": "Designed the product and marketing surfaces, built interactive prototypes with AI coding tools, and organized design work through AI agents on GitHub. Figmol is the internal tool I built to review the live prototype and hand design changes to engineering."
      },
      {
        "type": "image-full",
        "src": "../images/oneasset-figmol.webp",
        "borderless": true,
        "caption": "Figmol — the internal design-ops whiteboard: each persona board mirrors the live app at full page height, with review status, comment pins, and device / theme / shell-version toggles."
      },
      {
        "type": "text",
        "label": "Design direction",
        "title": "Making investment information readable",
        "body": "The white interface uses property images, cards and data tables to explain each investment. The hierarchy keeps ownership terms and reporting easy to find."
      },
      {
        "type": "process",
        "title": "How I approached it"
      },
      {
        "type": "outcome",
        "text": "Design ownership across the admin platform, user-facing application and marketing website, with a shared design system, interactive prototypes, a GitHub agent workflow. Figmol is OneAsset's internal review tool."
      }
    ]
  },

  {
    id:'upviral', num:'04', group:'enterprise', cover:'covers/upviral.jpg', logo:'../images/upviral.png',
    company:'UpViral', tagline:'SaaS Marketing Platform',
    role:'Product Manager / Product Designer',
    year:'2024', duration:'6 months', team:'Chief Product Officer & Developers',
    platforms:['Desktop'], tag:'SaaS · Product', accent:'#0ea5e9',
    desc:"Redesigned UpViral’s information architecture and campaign flows, working with the CPO on priorities and with developers on implementation.",
    subtitle:'Redesigning how customers build referral campaigns',
    challenge:"Reorganize a SaaS product already in use while introducing a consistent design process.",
    goals:"Use customer interviews to simplify the sitemap, redesign campaign flows and establish a shared design system.",
    solution:'Ran continuous user interviews to feed structural decisions, collaborated directly with the CPO on priorities, and led the implementation with developers to ensure high UX standards.',
    steps:[
      {num:'01', title:'UX Research & Strategy', desc:'Conducted multiple rounds of user interviews with real customers to identify pain points, validate mental models, and drive structural product decisions.'},
      {num:'02', title:'Information Architecture', desc:'Reviewed and radically simplified the sitemap. Rebuilt complex campaign setup flows to reduce cognitive load and align with actual user journeys.'},
      {num:'03', title:'Complete UI Overhaul', desc:'Created the design system and worked with developers on the interface rebuild.'},
    ],
    outcome:'Complete structural overhaul of a live SaaS: simplified information architecture, rebuilt user flows, redesigned campaign builder, and an established design process. Delivered iteratively without disrupting active customers.',
    outcomeStat:null, url:'https://upviral.com', heroCover:'../images/upviral-cover.webp',
    narrative: [
      { type:'text', label:'Challenge', title:'Taking ownership of a live product with no design foundation',
        body:"UpViral was already serving customers when I joined. I worked with the CPO and developers to plan the redesign alongside ongoing development." },
      { type:'text', label:'Goals', title:'Simplify the sitemap. Rebuild the flows. Establish a process.',
        body:"I reviewed the sitemap around how customers set up and run campaigns. User interviews helped decide which flows to change and informed discussions with the development team." },
      { type:'upviral-vitrine', label:'The product', title:'The UpViral campaign platform',
        body:'UpViral lets businesses run referral campaigns — sweepstakes, giveaways, waitlists, launches — where every lead earns points by sharing. Below, a live recreation of the upviral.com hero with the numbers the platform runs on.' },
      { type:'before-after', label:'Before / After', images:[
        { label:'Before', src:'../images/before-upviral.png', caption:'Existing interface: limited design foundations, inconsistent components' },
        { label:'After',  src:'../images/after-upviral.png',  caption:'Redesigned interface: structured UI system, clarified campaign builder flow' },
      ]},
      { type:'upviral-brand', label:'The charte', title:'Poppins, pills, and a two-accent system.',
        body:'The UpViral identity is light-first and friendly: Poppins across every weight, teal as the marketing-site primary and violet as the in-app action color, rounded pills for every button and chip. The redesign turned these habits into a documented system: one palette, one shape language, reusable components.' },
      { type:'upviral-builder', label:'Interactive module', title:'The redesigned campaign flow, in three steps.',
        body:'This demo follows the campaign setup from the opt-in widget to the sharing page and referral tracking. Use the tabs to move between stages.' },
      { type:'process', title:'How I approached it' },
      { type:'image-grid', borderless:true, images:[
        { src:'../images/upviral-rework 1.png', caption:'Campaign builder redesign: full-page overhaul with rebuilt information architecture and component hierarchy' },
        { src:'../images/upviral-rework 2.png', caption:'Dashboard and reporting views: clearer data hierarchy and action paths' },
      ]},
      { type:'outcome', text:'Complete structural overhaul of a live SaaS: simplified information architecture, rebuilt user flows, redesigned campaign builder, and an established design process. Delivered step by step without disrupting active customers.' },
    ],
    gallery: {
      beforeAfter: [
        { src:'../images/before-upviral.png', label:'Before', caption:'Existing interface: limited design foundations, inconsistent components' },
        { src:'../images/after-upviral.png',  label:'After',  caption:'Redesigned interface: structured UI system, clarified campaign builder flow' },
      ],
      screens: [
        { src:'../images/upviral-rework 1.png', caption:'Campaign builder redesign: full-page overhaul with rebuilt information architecture and component hierarchy' },
        { src:'../images/upviral-rework 2.png', caption:'Dashboard and reporting views: clearer data hierarchy and action paths' },
      ],
    },
  },
  {
    id:'edenred', num:'04b', group:'enterprise', cover:'covers/edenred.webp', logo:'../images/edenred.png',
    company:'Edenred', tagline:'Fuel Card Payment App Redesign',
    role:'Lead Product Designer',
    year:'2022', duration:'9 months', team:'Product Manager, iOS & Android developers, Operations',
    platforms:['Mobile'], tag:'FinTech · B2B · Mobile', accent:'#e63312',
    desc:'Complete redesign of Edenred\'s B2B fuel card mobile application — a tool used by fleet managers to control fuel spend, manage card float, and locate partner gas stations across France.',
    subtitle:'Redesigning a B2B fuel card app from scratch',
    challenge:"Organize everyday mobility tasks so users can find the information and services they need on mobile.",
    goals:'Rebuild the application\'s information architecture to unify float management, card controls, and station discovery into a single coherent product. Improve clarity, speed up critical actions, and establish a mobile-first design approach.',
    solution:'Ran discovery sessions with fleet managers to map their daily workflows. Redesigned the full app architecture around three core jobs-to-be-done: managing float, controlling cards, and finding stations. Delivered high-fidelity prototypes and worked closely with iOS/Android teams through implementation.',
    steps:[
      {num:'01', title:'Discovery & User Research', desc:'Conducted interviews with fleet managers and field users to map real daily workflows: how they check balance, block cards, add float, and find stations.'},
      {num:'02', title:'Information Architecture', desc:'Rebuilt the full app sitemap around the three core user jobs. Simplified navigation and made critical actions (float top-up, card lock) immediately accessible from the home screen.'},
      {num:'03', title:'UI Design & Prototyping', desc:'Designed high-fidelity screens for the full app experience — balance overview, card management, transaction history, and the station locator with filters and live information. Delivered interactive prototypes for user validation and developer handoff.'},
    ],
    outcome:"Designed mobile experiences for fuel-station and EV-charging location, alongside employee-benefits and meal-voucher management.",
    outcomeStat:null, url:'https://www.edenred.fr/', screenshot:'../images/edenred-desktop.png', heroCover:'../images/edenred-cover.webp',
    narrative: [
      { type:'text', label:'The context', title:'A critical B2B tool that wasn\'t doing its job',
        body:'Edenred\'s fuel card application is used by fleet managers at companies across France to control fuel spend for their vehicles. Every day, these users need to check their available float, adjust card limits, block or unblock cards, and find partner gas stations. The existing app made all of these tasks unnecessarily complex — fragmented flows, unclear balance visibility, and a station locator that felt like an afterthought.' },
      { type:'text', label:'The challenge', title:'Three jobs-to-be-done, one broken experience',
        body:'After running discovery sessions with real fleet managers, three core jobs emerged clearly: managing the float (how much money is loaded on cards), controlling individual cards (limits, activation, blocking), and locating partner stations when on the road. These three workflows existed in the app but were disconnected from each other, buried in nested menus, and offered no clear feedback on actions. My job was to reunite them into a single, fast, and trustworthy mobile experience.' },
      { type:'image-full', src:'../images/edenred-iphone-4.png', bleed:true },
      { type:'text', label:'The approach', title:'Mobile-first, task-first',
        body:"The home screen brings the balance, card actions and station locator together. Secondary information stays available within each task. The mobile layouts focus on reading the relevant information and completing the next action." },
      { type:'image-grid', borderless:true, images:[
        { src:'../images/mockup-edenred.webp', caption:'Fleet management app: card overview, balance control and quick actions' },
        { src:'../images/edenred-desktop.png', caption:'Desktop back-office: fleet card management and reporting dashboard' },
      ]},
      { type:'outcome', text:"Designed mobile experiences for fuel-station and EV-charging location, alongside employee-benefits and meal-voucher management." },
    ],
  },
  {
    "id": "renault",
    "num": "05",
    "group": "enterprise",
    "cover": "covers/renault.webp",
    "logo": "../images/renault.png",
    "company": "Renault Group",
    "tagline": "\"Renew\" Second-hand Cars Marketplace",
    "role": "Product Designer",
    "year": "2020 – 2021",
    "duration": "2020 – 2021",
    "team": "PO, PM, Int. market, Lead car dealership, Dev teams",
    "platforms": [
      "Mobile",
      "Desktop"
    ],
    "tag": "Automotive · eCommerce",
    "accent": "#f59e0b",
    "desc": "Complete redesign of the Renault \"Renew\" secondhand car marketplace: sole designer, international scope, multi-brand, 23,900+ vehicle listings across Europe.",
    "subtitle": "A used-car marketplace across European markets",
    "challenge": "Lead the design of a used-car marketplace across several countries, coordinating requirements from local teams and dealerships.",
    "goals": "Help customers compare vehicle specifications, financing and dealer locations while accounting for the requirements of each market.",
    "solution": "Facilitated multiple cross-functional workshops to collect requirements from international teams and dealerships. Built iterative wireframe cycles to keep all stakeholders aligned. Designed automotive-specific UX patterns for vehicle specs, LOA/credit calculators, and advanced filtering, then shipped two distinct back-office tools for dealership stock management and national brand manager reporting.",
    "steps": [
      {
        "num": "01",
        "title": "Userflow & IA Mapping",
        "desc": "Mapped every page, content type, and feature across the international marketplace. Defined information architecture for 23,900+ vehicle listings across multiple brands and European markets, the foundation for all design decisions."
      },
      {
        "num": "02",
        "title": "Back-office Design",
        "desc": "Designed two distinct tools: a dealership stock management platform (product inflows, listing details, online store management) and a national brand manager monitoring tool (sales data, KPIs, activity reports, action plan generation)."
      },
      {
        "num": "03",
        "title": "Front-office & Automotive UX",
        "desc": "Customer-facing marketplace with automotive-specific UX: LOA/crédit calculators, detailed vehicle specification pages, advanced filter system, dealer locator map, built around what matters most to buyers before a purchase decision."
      }
    ],
    "outcome": "Fully redesigned international secondhand car marketplace: mobile and desktop, 23,900+ vehicles, multiple European markets, back-office tools for dealerships and brand managers.",
    "outcomeStat": "23,900 vehicles",
    "url": "https://fr.renew.auto/",
    "video": "../images/renault-video.mp4",
    "narrative": [
      {
        "type": "text",
        "label": "Challenge",
        "title": "Sole designer on a live international marketplace",
        "body": "I joined a marketplace serving several brands and European markets as the sole design lead. I worked with the teams to coordinate the customer experience and back-office requirements."
      },
      {
        "type": "text",
        "label": "Starting point",
        "title": "Mapping before designing anything",
        "body": "I mapped the marketplace’s pages, content and features around a catalogue of 23,900+ vehicles. That structure guided the screen designs and conversations with teams in different markets."
      },
      {
        "type": "image-full",
        "src": "../images/renault-userflow.png",
        "borderless": true,
        "caption": "Complete information architecture mapped from scratch: all pages, content, and features across a multi-brand, multi-country marketplace"
      },
      {
        "type": "text-image",
        "label": "Front-office",
        "title": "A marketplace built around what buyers actually need",
        "body": "Automotive UX has specific requirements. Customers need specs, financing options, dealer proximity, and vehicle history before making a decision. I designed the full customer-facing experience around these needs: homepage, search results, vehicle detail pages with LOA/crédit calculators, advanced filtering, and dealer locator.",
        "src": "../images/renault-screen.webp",
        "borderless": true,
        "caption": "Homepage: Renault Arkana hero with vehicle search entry point"
      },
      {
        "type": "image-full",
        "src": "../images/renault-screens.webp",
        "bleed": true
      },
      {
        "type": "text-image",
        "label": "Mobile first",
        "title": "Designed for the car buyer on the move",
        "body": "The mobile design covers search, filters, vehicle details and financing. The filter panel and LOA calculator needed particular attention to keep the controls readable on smaller screens.",
        "src": "../images/renault-mobile.webp",
        "borderless": true,
        "caption": "Mobile experience: homepage, search results, vehicle detail, and advanced filter panel on iOS",
        "flip": true
      },
      {
        "type": "text",
        "label": "Back-office",
        "title": "Two distinct tools for two different users",
        "body": "The back office work was as complex as the front. I designed two separate platforms: one for car dealerships to manage stock inflows, product details, and online listings, and one for national brand managers to monitor sales operations, track KPIs, prepare data, and generate activity reports."
      },
      {
        "type": "image-full",
        "src": "../images/renault-screen-dashboard.png",
        "bleed": true
      },
      {
        "type": "image-grid",
        "borderless": true,
        "images": [
          {
            "src": "../images/renault-example.png",
            "caption": "Vehicle detail editor and stock listing table: back-office data management for dealerships"
          },
          {
            "src": "../images/renault-dashboard.png",
            "caption": "National brand manager analytics: total sales, market share, commissions, YoY KPIs"
          }
        ]
      },
      {
        "type": "image-bg",
        "src": "../images/renault-cover.webp",
        "label": "Renault \"Renew\"",
        "title": "23,900 vehicles. Multiple European markets. One design language."
      },
      {
        "type": "process",
        "title": "How I approached it"
      },
      {
        "type": "outcome",
        "stat": "23,900 vehicles",
        "text": "Fully redesigned international secondhand car marketplace: mobile and desktop, 23,900+ vehicles, multiple European markets, back office tools for dealerships and brand managers."
      }
    ],
    "gallery": {
      "sections": [
        {
          "type": "full",
          "label": "User flow & IA mapping",
          "images": [
            {
              "src": "../images/renault-userflow.png",
              "caption": "Complete information architecture mapped from scratch: all pages, content, and features across a multi-brand, multi-country marketplace"
            }
          ]
        },
        {
          "type": "grid-2",
          "label": "Marketplace: desktop and tablet",
          "images": [
            {
              "src": "../images/renault-screen.webp",
              "caption": "Homepage: Renault Arkana hero with vehicle search entry point"
            },
            {
              "src": "../images/renault-screens.webp",
              "caption": "Search results and vehicle detail: desktop and tablet cross-device experience"
            }
          ]
        },
        {
          "type": "full",
          "label": "Mobile first responsive design",
          "images": [
            {
              "src": "../images/renault-mobile.webp",
              "caption": "Mobile first approach: homepage, search results, vehicle detail, and advanced filter panel on iOS"
            }
          ]
        },
        {
          "type": "full",
          "label": "Dealer stock management dashboard",
          "images": [
            {
              "src": "../images/renault-screen-dashboard.png",
              "caption": "Dealer back-office: stock KPIs, publication stats, average age of listed vehicles, and action plan tracking"
            }
          ]
        },
        {
          "type": "full",
          "label": "Back-office: vehicle detail and stock management",
          "images": [
            {
              "src": "../images/renault-example.png",
              "caption": "Vehicle detail editor and stock listing table: back-office tool for dealerships"
            }
          ]
        },
        {
          "type": "grid-2",
          "label": "Brand analytics & product visual",
          "images": [
            {
              "src": "../images/renault-dashboard.png",
              "caption": "National brand manager analytics: total sales, market share breakdown, commissions, and YoY KPIs"
            },
            {
              "src": "../images/renault-cover.webp",
              "caption": ""
            }
          ]
        }
      ]
    }
  },

  {
    "id": "lvmh",
    "num": "06",
    "group": "enterprise",
    "cover": "covers/lvmh.webp",
    "logo": "../images/lvmh.png",
    "company": "LVMH Group",
    "tagline": "Data Marketing Platform Across 15+ Maisons",
    "role": "UX / Product Designer",
    "year": "2022 – 2023",
    "duration": "2022 – 2023",
    "team": "Product Owner, CRM teams across Maisons, Dev teams",
    "platforms": [
      "Desktop"
    ],
    "tag": "Enterprise · Data · Luxury",
    "accent": "#8a7150",
    "desc": "Designed a group-wide data marketing platform unifying customer data and campaign performance across 15+ LVMH maisons, including Dior, Louis Vuitton, Fendi and Kenzo.",
    "subtitle": "One shared data platform, 15+ maisons with different needs",
    "challenge": "Each maison runs its own CRM and customer data practice. Build one shared data marketing platform without flattening what makes Dior's, Louis Vuitton's or Kenzo's customer relationship different.",
    "goals": "Reconcile conflicting brand-level needs into a single data model and onboarding flow, then translate real customer journeys into monitoring tools the maisons' own teams could use day to day.",
    "solution": "Ran structured interviews across maisons to surface where needs converged and where they didn't, built a customer journey map to ground the data model in real behaviour, then designed the platform's onboarding, field-mapping, import and cleaning flow as the shared backbone underneath maison-specific views.",
    "steps": [
      {
        "num": "01",
        "title": "Stakeholder interviews across Maisons",
        "desc": "Recruited 1-3 CRM team participants per session from 3+ different maisons at a time, mixing business sectors and seniority, with a UX designer facilitating and a Product Owner observing. Every session tested the same question: what does this maison actually need from a shared platform."
      },
      {
        "num": "02",
        "title": "Customer journey mapping",
        "desc": "Mapped a full customer journey, from social discovery through in-store trial to purchase and post-purchase sharing, with touchpoints, data collected and pain points at each stage. Used to ground the platform's data model in real customer behaviour rather than an internal org chart."
      },
      {
        "num": "03",
        "title": "Shared data platform",
        "desc": "Designed the platform's onboarding: define a data kind, create fields manually or from a template, import via CSV, SQL query or API, then clean and export. Built as one shared backbone that individual maisons could operate without needing every field to mean the same thing everywhere."
      }
    ],
    "outcome": "A shared data marketing platform live across 15+ LVMH maisons, including Dior, Louis Vuitton, Fendi and Kenzo, built from interviews that reconciled conflicting maison-level needs into one data model and onboarding flow.",
    "outcomeStat": "15+ maisons",
    "url": "https://www.lvmh.com",
    "video": "../images/lvmh-video.mp4",
    "narrative": [
      {
        "type": "text",
        "label": "Challenge",
        "title": "One platform, 15+ maisons that don't work the same way",
        "body": "LVMH wanted a shared data marketing platform spanning Dior, Louis Vuitton, Fendi, Kenzo and other maisons. Each maison runs its own CRM and customer relationship practice, so the platform had to work for all of them without flattening what makes each one different."
      },
      {
        "type": "text",
        "label": "Research",
        "title": "Interviews built to surface where maisons actually disagree",
        "body": "Each session mixed 1-3 CRM team participants from 3+ different maisons, covering different business sectors and seniority levels, with a UX designer facilitating and a Product Owner observing. The goal was never a generic wishlist: it was finding exactly where one maison's need conflicted with another's."
      },
      {
        "type": "image-grid",
        "label": "Research artifacts",
        "borderless": true,
        "images": [
          {
            "src": "../images/lvmh-exp-map.png",
            "caption": "Customer journey map: 7 stages from social discovery to post-purchase sharing, with touchpoints, data collected and pain points per stage"
          },
          {
            "src": "../images/LVMH-persona.png",
            "caption": "Customer persona grounding the journey map in a real buying pattern and set of needs"
          }
        ]
      },
      {
        "type": "text",
        "label": "Platform",
        "title": "One onboarding flow underneath maison-specific views",
        "body": "The platform's backbone is how it takes in data: define a data kind, create fields manually or from a template, import via CSV, SQL query or API, then clean and export. That flow had to work identically for every maison, so that what differs between Dior and Kenzo lives in the data, not in a different tool."
      },
      {
        "type": "image-full",
        "src": "../images/lvmh-userflow.png",
        "bleed": true,
        "caption": "Platform flow: onboarding, kind creation, field definition, data import and cleaning, from raw source to exported entities"
      },
      {
        "type": "image-bg",
        "src": "../images/lvmh-cover.webp",
        "label": "LVMH Group",
        "title": "15+ maisons. One shared data platform."
      },
      {
        "type": "process",
        "title": "How I approached it"
      },
      {
        "type": "outcome",
        "stat": "15+ maisons",
        "text": "A shared data marketing platform live across 15+ LVMH maisons, including Dior, Louis Vuitton, Fendi and Kenzo, built from interviews that reconciled conflicting maison-level needs into one data model and onboarding flow."
      }
    ]
  },

  {
    id:'arlequin', num:'07', group:'enterprise', logo:null,
    company:'Arlequin Finance', tagline:'Trading Platform, Built from Scratch',
    role:'Product Designer',
    year:'2022', duration:'6 months', team:'Product Manager, CEO & Developers',
    platforms:['Mobile','Desktop'], tag:'Fintech · Trading', accent:'#10b981',
    desc:'French startup providing a trading platform enabling users to trade across all markets, create investment funds, or invest in others.',
    subtitle:'A trading platform designed from zero',
    challenge:"Design mobile and web interfaces for a trading platform starting from its initial product concept.",
    goals:"Keep the interface consistent with the brand and practical for the development team to implement.",
    solution:"Explored interface variants for the trading and portfolio views, then refined the design around the required workflows.",
    steps:[
      {num:'01', title:'Brand & Concept Design', desc:'Defined the visual identity and design language from scratch, balancing professional trading aesthetics with accessibility for both beginner and advanced investors.'},
      {num:'02', title:'Interface Variants', desc:'Rapidly produced multiple interface variants for portfolio view, live trading room, and funds marketplace, allowing the team to compare approaches and iterate fast.'},
      {num:'03', title:'Full Platform Build', desc:'Designed the complete trading platform: portfolio dashboard with multi-asset allocation, live trading room with candlestick charts, and investment funds marketplace.'},
    ],
    outcome:'Fully operational trading platform: portfolio management, live trading room, investment funds marketplace, and KYC onboarding flows.',
    outcomeStat:null, url:'https://arlequin.finance/', video:'../images/arlequin-video.mp4',
    narrative: [
      { type:'image-bg', src:'../images/arlequin cover.webp', label:'Arlequin Finance', title:'A regulated trading platform, built from zero.' },
      { type:'text', label:'Challenge', title:'From concept to regulated fintech product',
        body:"The initial concept brought trading, portfolio management and investment funds into one product. The design work covered mobile and desktop interfaces, with attention to financial information and navigation." },
      { type:'text-image', label:'Mobile experience', title:'Designed for active traders on the move',
        body:"I designed the mobile views around portfolio performance, open positions and trading actions. The screens include a daily overview, a balance chart and candlestick charts.",
        src:'../images/arlequin-phone.webp', borderless:true,
        caption:'Portfolio overview, live positions, and candlestick chart on iOS' },
      { type:'tiles', images:[
        { src:'../images/arlequin-example.png',   caption:'Portfolio dashboard: multi-asset overview with live performance' },
        { src:'../images/arlequin-example-2.png', caption:'Live trading room: candlestick charts with order panel' },
        { src:'../images/arlequin-example-3.png', caption:'Investment funds marketplace: browsable fund cards' },
      ]},
      { type:'image-full', src:'../images/arlequin-screen.png', bleed:true },
      { type:'process', title:'How I approached it' },
      { type:'outcome', text:'Fully operational trading platform: portfolio management, live trading room, investment funds marketplace, and KYC onboarding flows.' },
    ],
  },
  {
    id:'skiset', num:'08', group:'enterprise', cover:'covers/skiset.webp', logo:'../images/skiset-logo.png',
    company:'Skiset', tagline:'Ski Equipment Booking Redesign',
    role:'UX / UI Designer',
    year:'2020', duration:'8 months', team:'PO, Marketing brand officer, CEO, Lead Dev',
    platforms:['Mobile','Desktop'], tag:'eCommerce · Sport', accent:'#3b82f6',
    desc:"Redesigned the equipment booking and checkout experience on mobile and desktop.",
    subtitle:'E-commerce booking funnel redesigned for conversion',
    challenge:"Help customers choose rental equipment and complete a booking while giving the client evidence for design decisions.",
    goals:"Simplify equipment selection and checkout on mobile and desktop.",
    solution:'Led the end-to-end product design lifecycle: from auditing the legacy flow via user tests to delivering high-fidelity interactive prototypes optimized for conversion.',
    steps:[
      {num:'01', title:'UX Research & Testing', desc:'Conducted real-condition user testing on the legacy booking flow to identify drop-off points, friction areas, and validate assumptions with real users.'},
      {num:'02', title:'UX Architecture', desc:'Completely restructured the purchase journey, creating streamlined wireframes and user flows to simplify the booking process across all devices.'},
      {num:'03', title:'UI Design & Prototyping', desc:'Delivered high-fidelity interactive prototypes and the final UI design, ensuring a frictionless, mobile-first booking experience designed to maximize sales.'},
    ],
    outcome:'User testing validated design decisions: 15/20 mobile satisfaction, 16/20 desktop satisfaction. Booking flow redesigned without compromising conversion.',
    outcomeStat:'15/20 · 16/20', url:'https://skiset.com', video:'../images/skiset-video.mp4',
    narrative: [
      { type:'image-bg', src:'../images/skiset-cover.webp', label:'Skiset', title:'Redesigning Europe\'s #1 ski equipment rental platform.' },
      { type:'text', label:'Challenge', title:'Guiding a client toward bold design decisions, in an agency context',
        body:"The project covered Skiset’s equipment booking experience. I used prototype testing to review the proposed changes with the client before development." },
      { type:'image-full', src:'../images/skiset-userflow.png', borderless:true,
        caption:'Complete booking flow: from station search and dates to equipment selection, sizing, and payment' },
      { type:'text-image', label:'Desktop experience', title:'Choosing equipment and completing a booking',
        body:'The desktop redesign was built around the specific UX needs of ski equipment rental: users need to configure packages for their whole group, pick skill levels, understand what\'s included, and feel confident about in-store pickup. I redesigned the homepage entry point, pack selection, and equipment detail to make all of this clear and fast.',
        src:'../images/skiset-screen.webp', borderless:true,
        caption:'Homepage: #1 ski rental in Europe with direct station search entry' },
      { type:'image-full', src:'../images/skiset-wireframe.webp', bleed:true },
      { type:'text-image', label:'Mobile experience', title:'Booking skis on the go, two weeks before the trip',
        body:"The mobile booking flow starts with a resort search, then lets customers compare equipment packages. Checkout includes dates, group details and payment.",
        src:'../images/skiset-mobile.webp', borderless:true,
        caption:'Mobile booking: homepage with station search, and reservation summary with date picker',
        flip:true },
      { type:'image-full', src:'../images/skiset-example.webp', borderless:true,
        caption:'Equipment selection: pack comparison with level picker, included gear, and price breakdown' },
      { type:'text-image', label:'User testing', title:'Testing assumptions with real users before shipping',
        body:"I tested the interactive prototype before presenting the design to the client. The sessions identified labeling and information hierarchy issues, which I addressed screen by screen.",
        src:'../images/skiset-usertest.png', borderless:true,
        caption:'User test analysis: observations, UX findings, and recommendations from live sessions' },
      { type:'process', title:'How I approached it' },
      { type:'outcome', stat:'15/20 · 16/20', text:'User testing validated all major design decisions: 15/20 mobile satisfaction, 16/20 desktop satisfaction. Booking flow redesigned without compromising conversion.' },
    ],
  },
  {
    id:'casino', num:'09', group:'enterprise', logo:'../images/casino.png',
    company:'Casino Group', tagline:'Grocery eCommerce Revamp',
    role:'UX / UI Designer',
    year:'2020 – 2021', duration:'10 months', team:'PO, Marketing team, Designers',
    platforms:['Mobile','Desktop'], tag:'Retail · eCommerce', accent:'#ef4444',
    desc:"Designed Casino.fr shopping flows for click and collect, home delivery and store promotions.",
    subtitle:'Grocery flows simplified from store to cart',
    challenge:"Explain the differences between collection, delivery and in-store offers within the same shopping experience.",
    goals:"Review the booking journey and clarify the conditions attached to online and in-store promotions.",
    solution:'Collaborated with the project manager to validate workflows. Conducted user tests on prototype to confirm assumptions and quantify potential business impacts.',
    steps:[
      {num:'01', title:'Information Architecture', desc:'Mapped complete site architecture across Drive (in-store pickup) and Livraison (home delivery) modes. Defined store selector, product catalog, cart, and account flows.'},
      {num:'02', title:'Wireframes to Mockups', desc:'Iterative design from rough wireframes to detailed mockups for Casino.fr, mobile first, with full desktop adaptation. Product pages with Nutri-Score and drive/delivery toggle.'},
      {num:'03', title:'Promotion & Loyalty System', desc:'Designed integrated promotion flows with Drive/Livraison-specific conditions, in-store redemption mechanics, and loyalty wallet integration.'},
    ],
    outcome:"Casino.fr shopping flows covering Drive, Livraison, promotions and loyalty.",
    outcomeStat:null, url:'https://casino.fr', screenshot:'../images/cqsino-screenshot.webp', video:'../images/casino-video.mp4',
    narrative: [
      { type:'image-bg', src:'../images/casino-cover.webp', label:'Casino Group', title:'Bridging the physical store and the e-commerce app' },
      { type:'text', label:'Challenge', title:'Two modes, one product, without breaking the retail side',
        body:"Casino customers can collect an order through Drive or choose home delivery. I worked on these journeys and on explaining the conditions of offers available online and in stores." },
      { type:'text', label:'Approach', title:'Validate with users before presenting to the client',
        body:"I reviewed the workflows with the project manager and Casino team. During prototype tests, I observed how users completed tasks and used those findings to revise the designs." },
      { type:'image-full', src:'../images/casino-userflow.png', borderless:true,
        caption:'Information architecture mapping Drive and Livraison flows: store selector, product catalog, cart, and account' },
      { type:'image-full', src:'../images/casino-wireframe.webp', borderless:true,
        caption:'Low to mid fidelity mobile wireframes, iterating on structure before committing to visual design' },
      { type:'image-full', src:'../images/casino-desktop.png', borderless:true,
        caption:'Product detail page on desktop: Nutri-Score, Drive/Livraison toggle, promotion conditions' },
      { type:'process', title:'How I approached it' },
      { type:'image-grid', images:[
        { src:'../images/casino-mobile-catalog.png', caption:'Mobile catalog: product page with Nutri-Score, Drive/Livraison toggle and promotion integration' },
        { src:'../images/cqsino-screenshot.webp', caption:'Casino.fr live — redesigned grocery eCommerce with unified Drive and Livraison experience' },
      ]},
      { type:'outcome', text:"Casino.fr shopping flows covering Drive, Livraison, promotions and loyalty." },
    ],
  },
  {
    "id": "sg",
    "num": "10",
    "group": "enterprise",
    "logo": "../images/societegenerale.png",
    "company": "Société Générale",
    "tagline": "Investment & Savings Platform",
    "role": "Senior Product Designer",
    "year": "Feb 2023 – Oct 2024",
    "duration": "Feb 2023 – Oct 2024",
    "team": "PO, PM, Regulatory team, Dev teams",
    "platforms": [
      "Mobile",
      "Desktop"
    ],
    "tag": "Finance · Investment",
    "accent": "#dc2626",
    "desc": "Designed savings, allocation and investment flows on desktop and mobile, with a documented +12% increase in investment activity.",
    "subtitle": "Savings and investment flows under MIF2 requirements",
    "challenge": "Make the investment journey clear while meeting MIF2 requirements and validating investor profiles.",
    "goals": "Design savings and investment flows that explain the required information and choices at each step.",
    "solution": "Designed screens and developer handoff specifications, and contributed components to the bank’s design system.",
    "steps": [
      {
        "num": "01",
        "title": "Complex Flow Design",
        "desc": "Designed savings, asset allocation, and investment flows. Successfully translated heavy regulatory constraints into frictionless, consumer-grade user experiences."
      },
      {
        "num": "02",
        "title": "UX Advocacy & Collaboration",
        "desc": "Acted as a strong advocate for user-centric design, effectively convincing development and business teams to implement optimal UX choices over technical shortcuts."
      },
      {
        "num": "03",
        "title": "Design System & Delivery",
        "desc": "Delivered high-fidelity mockups (Figma), comprehensive handover guidelines for developers, and actively contributed to the bank's global Design System."
      }
    ],
    "outcome": "+12% investment activity following work on savings, allocation and investment flows under MIF2 requirements.",
    "outcomeStat": "+12%",
    "url": "https://particuliers.sg.fr/",
    "screenshot": "../images/societe-general-screenshot.webp",
    "heroCover": "../images/sg-cover.webp",
    "narrative": [
      {
        "type": "text",
        "label": "Challenge",
        "title": "Designing regulated financial flows that people actually want to use",
        "body": "At Société Générale, I designed investment flows within MIF2 requirements. The work included investor-profile validation, savings allocation and investment screens on desktop and mobile."
      },
      {
        "type": "text",
        "label": "Scope",
        "title": "Investor profiling, savings dashboards, and asset management flows",
        "body": "The work covered three connected areas: the MIF2 investor profile questionnaire (covering patrimonial situation, sustainable investment sensitivity, financial knowledge, and experience), the savings allocation dashboard with product breakdown and portfolio donut, and the full asset management UI with delegation and advisory service flows, across both desktop and mobile."
      },
      {
        "type": "image-grid",
        "images": [
          {
            "src": "../images/societe-generale-mobile.png",
            "caption": "Mobile investment app: savings overview, portfolio allocation and quick actions on iOS"
          },
          {
            "src": "../images/societe-general-screenshot.webp",
            "caption": "Live platform screenshot: investment flows across Société Générale digital products"
          }
        ]
      },
      {
        "type": "image-full",
        "src": "../images/societe-generale-desktop.png",
        "borderless": true,
        "caption": "Investment allocation dashboard: portfolio donut, savings breakdown by product, and asset management overview"
      },
      {
        "type": "process",
        "title": "How I approached it"
      },
      {
        "type": "outcome",
        "stat": "+12%",
        "text": "+12% investment activity following work on savings, allocation and investment flows under MIF2 requirements."
      }
    ]
  },

  {
    id:'shiseido', num:'11', group:'enterprise', logo:'../images/shisideo.png',
    company:'Shiseido Group', tagline:'eCommerce & Loyalty Redesign',
    role:'Senior Product Designer',
    year:'2024', duration:'6 months', team:'PO, Dev teams, Marketing',
    platforms:['Mobile'], tag:'Beauty · eCommerce', accent:'#ec4899',
    desc:'Redesign of loyalty flows and account-space experiences for the Shiseido Group global eCommerce platform.',
    subtitle:'Loyalty enrollment and account design',
    challenge:"Make the loyalty programme and enrollment steps easier to find throughout the shopping journey.",
    goals:"Redesign loyalty enrollment, onboarding and the account area.",
    solution:"Redesigned the loyalty journey from product browsing and checkout through to the account dashboard.",
    steps:[
      {num:'01', title:'eCommerce Flow Design', desc:'Complete shopping experience redesign: home with skin diagnosis, product catalog with Best Seller tabs, product detail pages with skin concern tags, reviews, and size selection.'},
      {num:'02', title:'Loyalty Integration', desc:'Designed the "My Shiseido" loyalty integration across the purchase flow: points earning (1€ = 10 points), welcome box CTA, exclusive rewards, free samples selection in cart.'},
      {num:'03', title:'Cart & Checkout', desc:'Multi-step cart with product management, free 3-sample selection, loyalty member badge, promo code, multi-payment (Visa, PayPal, Apple Pay, Klarna, Alipay), and order summary.'},
    ],
    outcome:"+20% loyalty enrollment in the quarter following launch, after the loyalty and account redesign.",
    outcomeStat:'+20%', url:'https://www.shiseido.fr/fr/fr/', screenshot:'../images/shiseido-screenshot.webp', video:'../images/shiseido-video.mp4',
    narrative: [
      { type:'text', label:'Challenge', title:'Redesigning loyalty for one of the world\'s most iconic beauty brands',
        body:"I redesigned Shiseido’s loyalty flows, onboarding and account area. The work focused on explaining the programme and making enrollment visible during the shopping journey." },
      { type:'text', label:'Approach', title:'Loyalty information throughout the shopping journey',
        body:"The design places points, welcome offers, rewards and sample selection within the shopping journey. Customers can also review their programme information in the account area." },
      { type:'image-grid', images:[
        { src:'../images/shiseido-mobile.webp', caption:'Mobile eCommerce: product pages with skin concern tags, loyalty points and sample selection' },
        { src:'../images/shiseido-screenshot.webp', caption:'Loyalty account dashboard: points balance, exclusive rewards and welcome box CTA' },
      ]},
      { type:'process', title:'How I approached it' },
      { type:'outcome', stat:'+20%', text:"+20% loyalty enrollment in the quarter following launch, after the loyalty and account redesign." },
    ],
  },
  {
    id:'vloggy', num:'13', group:'ai', logo:'../images/vloggy_logo.png',
    company:'Vloggy', tagline:'100% Video Social Network',
    role:'Co-founder & Product Designer',
    year:'2018 – 2020', duration:'2 years', team:'Co-founding team',
    platforms:['iOS','Android'], tag:'Social · Co-founder', accent:'#f97316',
    desc:'100% video social network for iOS and Android: 24-min 1080p editing, 10-second video comments, creator monetization.',
    subtitle:'A video network with an in-app editing studio',
    challenge:'Building a video social network from zero: product vision, UX design, and shipping on iOS and Android, while raising seed funding.',
    goals:"Build a video network with 24-minute 1080p editing, 10-second video comments and creator monetization.",
    solution:"Co-founded the product, helped design the creator and viewer experience and raised €100K with the founding team.",
    steps:[
      {num:'01', title:'Product Vision', desc:'Defined core differentiators: 24-min 1080p in-app editing, 10-second video comments, creator monetization, targeting the gap between YouTube depth and TikTok accessibility.'},
      {num:'02', title:'Mobile App Design', desc:'Designed complete iOS and Android experience: video feed, in-app editor with 1080p, 10-second video comment recorder, creator profile, and monetization dashboard.'},
      {num:'03', title:'Fundraising Support', desc:'Built the investor presentation and product demo that secured the €100K seed round from Columbus BlueSky Holding.'},
    ],
    outcome:"Raised €100K and reached the delivery stage. Operations stopped when funding ran out.",
    outcomeStat:'€100K',
    narrative: [
      { type:'text', label:'The project', title:'Co-founding a video social network, before TikTok took over',
        body:"Vloggy was a video social network for iOS and Android with an integrated editing studio. The product included 24-minute 1080p editing, 10-second video comments and creator monetization." },
      { type:'vloggy-timeline', label:'My role', title:'Product vision, full UX design, and fundraising support',
        body:"I co-founded Vloggy, designed the creator and viewer experience, and helped raise the seed round." },
      { type:'process', title:'How we built it' },
      { type:'outcome', stat:'€100K', text:"Raised €100K and reached the delivery stage. Operations stopped when funding ran out." },
    ],
  },
  {
    id:'flemme', num:'13', group:'ai', cover:'covers/flemme.jpg', logo:null, badges:['Ads eCom'],
    company:'Flemme OS', tagline:'AI Social Publishing Automation',
    role:'Founder & AI Product Builder',
    year:'2022 – Present', duration:'Ongoing', team:'Solo',
    platforms:['Desktop'], tag:'AI Agent · Social', accent:'#f43f5e',
    desc:'AI social publishing agent. Automates content creation, scheduling, DM prospection, and outreach across Twitter, Instagram, and Threads.',
    subtitle:'Social monitoring, publishing and outreach',
    challenge:"Connect social monitoring, content generation and outreach in a workflow I could manage from one place.",
    goals:"Build a dashboard for social monitoring, content generation, DM outreach and prospect management.",
    solution:'Built Flemme OS as a modular agentic system: Social Monitor tracks engagement signals, DeepFlow handles content pipelines, DM Prospection runs outreach campaigns, and the Ad Library feeds creative generation.',
    steps:[
      {num:'01', title:'Agent Architecture', desc:'Designed the multi-agent system: Social Monitor for signal tracking, Outreach agent for DM sequences, Reply agent for Twitter/Threads/Instagram, all coordinated through a central dashboard.'},
      {num:'02', title:'Publishing Pipeline', desc:'Built automated content creation and scheduling pipelines for Twitter, Instagram, and Threads, with AI-generated posts, replies, and engagement sequences tied to lead monitoring triggers.'},
      {num:'03', title:'DM Prospection & Lead System', desc:'Built scraping + DM automation generating up to 200 qualified leads per click. Includes Cortex intelligence layer, Leads CRM, and ScreenArc for visual content archiving. Live with real users.'},
    ],
    outcome:'Live AI social agent OS: 1,284 active leads and 5,692 total outreach actions tracked on the dashboard, with multi-platform publishing automation, DM prospection, and outreach sequences across Twitter, Instagram, and Threads.',
    outcomeStat:'1,284 leads', url:'https://flemme-three.vercel.app/',
    narrative: [
      { type:'text', label:'The system', title:'Social monitoring and outreach from one dashboard',
        body:"I built Flemme OS to manage social monitoring and outreach across Instagram, X and Threads. Its dashboard connects prospect discovery, generated messages and follow-up workflows." },
      { type:'tools-row', label:'Stack', tools:[
        { name:'Claude', icon:'../images/claude-logo.svg' },
        { name:'OpenRouter', icon:'../images/openrouter.png' },
        { name:'Grok' },
        { name:'Firecrawl', icon:'../images/firecrawl.png' },
        { name:'Playwright', icon:'../images/playwright-logo.svg' },
      ]},
      { type:'flemme-pipeline', label:'System design', title:'Four coordinated agents, one central dashboard',
        body:"Social Monitor, DeepFlow, DM Prospection and the Ad Library share a central dashboard, each one feeding signal into the next instead of running as separate tools." },
      { type:'process', title:'How I built it' },
      { type:'outcome', stat:'1,284 leads', text:'Live AI social agent OS: 1,284 active leads and 5,692 total outreach actions tracked on the dashboard, with multi-platform publishing automation, DM prospection, and outreach sequences across Twitter, Instagram, and Threads.' },
    ],
  },
  {
    id:'jarvos', num:'13b', group:'ai', logo:'../images/jarvos-logo.svg', badges:['Side project','Agent'],
    company:'Jarvos Agent', tagline:'AI Agent OS — Semantic Orchestration',
    role:'Builder (side project)',
    year:'2025 – Present', duration:'Ongoing', team:'Solo',
    platforms:['Desktop'], tag:'AI Agent OS · Side project', accent:'#7c3aed',
    desc:'A personal AI Agent OS: semantic orchestrator that infers intent, resolves tools, plans, executes, and verifies — with the backend as the source of truth for tools, permissions, and execution.',
    subtitle:'An agent workspace with tool checks and approvals',
    challenge:"Let the model propose a plan while the backend checks tools, permissions and execution state.",
    goals:"Build a workspace for agent tasks, memory and integrations, with approval gates and execution logs.",
    solution:'A monorepo with a Next.js cockpit, a TypeScript orchestrator, a Python DeerFlow coding runtime, Supabase Postgres + pgvector, Cloudflare R2 and edge workers, a Telegram bot, and a local Playwright worker. Semantic dispatch replaces keyword routing: infer goal, retrieve capabilities, resolve tools, plan, execute, verify.',
    steps:[
      {num:'01', title:'Semantic Dispatch & Tool Resolution', desc:'Requests flow through goal inference, capability retrieval, and a tool resolver that classifies model-proposed tools as resolved, hallucinated, unavailable, or suggested — protecting the system from fake tool claims.'},
      {num:'02', title:'Plan / Execute / Verify Loop', desc:'Tasks persist in Supabase (tasks, steps, attempts, approvals, execution logs, model-routing decisions). A planner decomposes goals, executor drivers run steps, and a verifier scores results before responding.'},
      {num:'03', title:'Voice vs PC Control', desc:'Two independent modules connected through the orchestrator: a realtime voice layer (STT, voice gateway) and a local control layer (Playwright browser automation, local worker with residential IP, file and OS actions) — with approval gates and risk classes.'},
    ],
    outcome:"A side project in progress with semantic task routing, persistent task state, tool resolution and approval gates.",
    outcomeStat:null,
    narrative: [
      { type:'text', label:'The principle', title:'The model proposes. The backend decides.',
        body:"Jarvos routes requests by their meaning. The backend then checks each proposed tool against the tool catalogue and its permissions before execution." },
      { type:'tools-row', label:'Stack', tools:[
        { name:'Next.js', icon:'../images/nextdotjs-logo.svg' },
        { name:'TypeScript', icon:'../images/typescript-logo.svg' },
        { name:'Python', icon:'../images/python-logo.svg' },
        { name:'Supabase', icon:'../images/supabase.png' },
        { name:'Cloudflare', icon:'../images/cloudflare-logo.svg' },
        { name:'Telegram', icon:'../images/telegram-logo.svg' },
        { name:'Playwright', icon:'../images/playwright-logo.svg' },
      ]},
      { type:'jarvos-pipeline', label:'System design', title:'From a sentence to a verified result.',
        body:"A task moves through planning, tool resolution, execution and verification. Supabase stores the steps, attempts and approvals so the system can track what actually happened." },
      { type:'jarvos-console', label:'Interactive module', title:'Inside the cockpit: stream, resolver, gates.',
        body:"This interactive demo shows the chat stream, tool resolver and approval gate. Use the tabs to explore each stage." },
      { type:'image-grid', label:'The real cockpit', borderless:true, images:[
        { src:'../images/jarvos-chat.webp', caption:'Cockpit — Chat: a multi-conversation workspace with subagents and economical / auto model routing, streaming responses straight from the orchestrator.' },
        { src:'../images/jarvos-system-health.webp', caption:'Cockpit — System Health: a stabilization view over task lifecycle, approvals, model-router decisions, runtime probes and Supabase telemetry, surfaced as OK / Watch regression signals.' },
      ]},
      { type:'text', label:'Architecture', title:'A monorepo built like an operating system',
        body:'Next.js cockpit with routes for chat, tasks, agents, tools, integrations, memory, approvals, files, voice, and local control. A TypeScript orchestrator (planner, executor, verifier), a Python DeerFlow coding runtime, Supabase Postgres + pgvector as the source of truth, Cloudflare R2 and edge workers, a Telegram bot, and a local Playwright worker. Voice and PC control are deliberately independent modules, connected only through the orchestrator.' },
      { type:'browser-window', src:'../images/jarvos-schema.webp', url:'localhost:3000/schema',
        caption:'The architecture, mapped inside the product — scroll the live Schema view: Inputs / Cockpit (web, Telegram, local worker, STT) into Orchestration (dispatch, planner to DAG, executor, tool permissions, verifier, Model Router v2, approvals) into agent execution lanes (coding, browser, research, file, api, memory, local PC) into Data & storage (Supabase Postgres + pgvector, Cloudflare R2, edge gateway, Mem0).' },
      { type:'process', title:'How it works' },
      { type:'outcome', text:"A side project in progress with semantic task routing, persistent task state, tool resolution and approval gates." },
    ],
  },
  {
    id:'ancient-world', num:'13c', group:'game', logo:'../images/ancient-world-logo.svg', badges:['Side project','Game','RPG'],
    company:'Ancient World RPG', tagline:'PC MMORPG — Unreal Engine 5 + OWS + Supabase',
    role:'Builder (side project)',
    year:'2025 – Present', duration:'Ongoing', team:'Solo',
    platforms:['PC'], tag:'MMORPG · Side project', accent:'#d97706',
    desc:'A semi-historical / semi-fantasy PC MMORPG inspired by Ancient Egypt, Mayan civilizations, pyramids, relics, temples and sacred wars — built on Unreal Engine 5.7 + OWS, with Supabase as the persistent source of truth for combat, inventory, loot, progression and quests.',
    subtitle:'An RPG side project built with Unreal Engine and Supabase',
    challenge:"Connect a local multiplayer loop to persistent inventory, loot and quest data while developing the game as a side project.",
    goals:'Ship the full core loop — login, character selection, open world, combat, loot, inventory, equipment, XP, skills, quests — on a stack where the client displays, the server validates, Supabase persists, and Unreal replicates. Build readable early-game choices (3 classes, 2 warring factions) and deep late-game systems (cards, relics, artifacts, hidden pyramid content, seasonal Pyramidion PvPvE).',
    solution:'Unreal Engine 5.7 + OWS + HubWorldMMO on Docker, with a validated OWS → Ancient World identity bridge and a full `aw` schema in Supabase/Postgres. Combat loadouts, abilities, base stats and weapon unlocks are pulled from the database — the first validated pipeline runs `solar_strike` from Supabase through to `GA_AW_SolarStrike` in Unreal GAS. Itemization V1 is audited clean end-to-end.',
    steps:[
      {num:'01', title:'MMO Infrastructure & Identity', desc:'Got the local stack working end-to-end: Docker, OWS, instance launcher, login, character creation, server travel to HubWorldMap, and a stable `character_id` bridge between Unreal/OWS and Supabase — including a retry path when the first server lookup fails.'},
      {num:'02', title:'Supabase Game Backend & Combat', desc:'Built the `aw` schema as source of truth: accounts, characters, progression, classes, factions, inventory, equipment, abilities, XP/levels and skill trees. Unified all classes on Solar Energy, cleaned defensive stats to armor + magic resist, and validated the first ability pipeline: Supabase definition → combat loadout → Unreal GAS.'},
      {num:'03', title:'Itemization, Quests & Pyramidion', desc:'Structured itemization V1 — weapons, cards, relics, currencies, vendors, loot tables and drop rates — with a clean final audit (no orphans, no invalid loot). Quest/narrative V1: 15 quests, 31 objectives, 8 NPCs, 14 areas. Designed the seasonal Pyramidion endgame: factions recover fragments, reconstruct the sacred capstone, and fight for control of the Great Mother Pyramid.'},
    ],
    outcome:"A working local multiplayer foundation with account creation, character creation and movement, plus persistent gameplay data. The MMORPG remains in development.",
    outcomeStat:null, screenshot:'../images/ancient-world-gameplay.png', heroCover:'../images/ancient-world-cover.webp',
    models3d: {
      rimColor: 0xffc266,
      fillColor: 0xffe4b5,
      variants: [
        { id: 'warrior', label: 'Solar Warrior', dot: '#fbbf24', src: '/images/ancient-world-warrior.glb', exposure: 2.5, ambient: 1.3, key: 3.8, rim: 2.8, fill: 1.5 },
        { id: 'guardian', label: 'Sunburst Guardian', dot: '#f59e0b', src: '/images/ancient-world-guardian.glb', exposure: 2.6, ambient: 1.2, key: 3.6, rim: 2.6, fill: 1.4 },
        { id: 'stall', label: 'Desert Market Stall', dot: '#b45309', src: '/images/ancient-world-stall.glb', exposure: 2.3, ambient: 1.4, key: 3.4, rim: 2.4, fill: 1.6 },
      ],
    },
    narrative: [
      { type:'text', label:'The game', title:'Simple to understand, deep to master',
        body:"Ancient World is a PC MMORPG side project inspired by ancient Egyptian and Mesoamerican civilizations. Its game design includes three classes, two factions and seasonal conflict around the Pyramidion. Character progression centres on equipment, loot and quests." },
      { type:'text', label:'Gameplay', title:'WoW/Ragnarok spirit, loot-driven build depth',
        body:'The target feel is close to World of Warcraft or Ragnarok Online, with a stronger emphasis on builds through loot. The main loop: login → character selection → open world → quests → mobs → combat → loot → inventory → equipment → XP → skills → dungeon → Pyramidion progression → faction war. All classes share one resource — Solar Energy — with server-authoritative combat, individual ability cooldowns, stat and skill points, and weapon specialization unlocked at level 5 (two-handed sword, bow, or staff). Rare cards, relic passives, boss drops and pyramid secrets carry the long-term depth.' },
      { type:'tools-row', label:'Stack', tools:[
        { name:'Unreal Engine 5', icon:'../images/unrealengine-logo.svg' },
        { name:'OWS' },
        { name:'Supabase', icon:'../images/supabase.png' },
        { name:'Docker', icon:'../images/docker-logo.svg' },
      ]},
      { type:'image-full', src:'../images/ancient-world-gameplay.png', borderless:true,
        caption:'Sunspire Valley — hub world, quest tracker, combat UI and the early-game loop in action: quests, mobs, loot and faction identity.' },
      { type:'text-image', label:'The world', title:'Deserts, jungles, temples and the Great Mother Pyramid',
        body:"The game world draws on Egyptian and Mesoamerican architecture, with stepped pyramids, markets and solar temples. Players explore ruins and hidden chambers while the factions compete for fragments of the Pyramidion Originel.",
        src:'../images/ancient-world-city.png', borderless:true,
        caption:'Concept art — the Great Mother Pyramid, market plaza, and the golden atmosphere of the Empire of the Sun.' },
      { type:'aw-models', label:'Real-time 3D assets', title:'Three production assets, live in your browser.',
        body:"Drag each viewer to rotate the Solar Warrior, Sunburst Guardian or market stall. The browser renders these game assets with WebGL." },
      { type:'aw-console', label:'Interactive module', title:'Inventory, loot and quests — straight from the `aw` schema.',
        body:"The demo presents inventory, loot and quests from the Supabase data model. Items have rarity tiers, and quests track acceptance, progress and rewards. The itemization audit checks definitions, vendors and drop rates, including orphan inventory records." },
      { type:'aw-pyramidion', label:'Story & endgame', title:'The Night of the Broken Eclipse',
        body:'During the Night of the Broken Eclipse, the Pyramidion Originel — the sacred capstone of the primordial pyramid — was shattered. Its fragments now lie in pyramids, buried temples and secret chambers. The Empire of the Sun seeks to restore divine solar order; the Children of the Jaguar fight to break the old monopoly on sacred power. Each faction gathers shards through exploration, bosses and hidden content, then races to reconstruct and seal the Pyramidion atop the Great Mother Pyramid — while the enemy faction intercepts, sabotages and attacks the ritual. The war runs in seasons: explore → recover → contribute → trigger the event → fight in PvPvE → hold temporary dominion.' },
      { type:'text', label:'Engineering', title:'How the client, server and database work together',
        body:'The technical rule is explicit: Unreal handles visuals and replication, OWS runs the multiplayer instance, Supabase owns persistent gameplay state. Combat loadouts, abilities and weapon unlocks are no longer hardcoded — they flow from the database into Unreal GAS. Inventory loads from Supabase into the Unreal inventory component; the next production milestone is the visible HUD (health, Solar Energy, XP, action bar) wired to live backend data. Immediate roadmap: visible inventory UI → equipment → stats → combat → mobs → loot → XP → quests → dungeon → Pyramidion loop.' },
      { type:'process', title:'How I built it' },
      { type:'outcome', text:"A working local multiplayer foundation with account creation, character creation and movement, plus persistent gameplay data. The MMORPG remains in development." },
    ],
  },
  {
    id:'bmw', num:'14', group:'enterprise', logo:'../images/bmw.png',
    company:'BMW Group', tagline:'UI Design: Automotive Digital',
    role:'UI Designer',
    year:'2020 – 2021', duration:'12 months', team:'Product team, Dev teams',
    platforms:['Desktop','Mobile'], tag:'Automotive · UI', accent:'#1c69d4',
    desc:"UX audit, data analysis and page redesign for BMW’s public website.",
    subtitle:'UX audit and website redesign for BMW',
    challenge:"Identify the website’s weakest conversion points and turn the findings into page designs.",
    goals:"Improve the website’s usability while applying BMW’s visual identity.",
    solution:"Ran a UX/UI audit and data analysis, then redesigned key pages based on the findings.",
    steps:[
      {num:'01', title:'Brand & Design System', desc:'Applied BMW\'s strict visual identity and design principles to digital interfaces: typography, colour, iconography, and spacing aligned with automotive brand standards.'},
      {num:'02', title:'Interface Design', desc:'Designed screens across connected services and digital platforms: clean, precise UI with the attention to detail expected at automotive scale.'},
      {num:'03', title:'Delivery & Handoff', desc:'Produced thorough design specifications and handoff documentation for development teams across multiple markets and platforms.'},
    ],
    outcome:"+12% user engagement following the website audit and page redesign.",
    outcomeStat:null, url:'https://www.bmw.fr/fr/accueil.html', screenshot:'../images/bmw-desktop-frame.webp', heroCover:'../images/bmw-cover.png',
    narrative: [
      { type:'text', label:'The context', title:'Improving the BMW website',
        body:"My BMW work focused on the public website. I reviewed the UX/UI and available data to identify the weakest conversion points." },
      { type:'image-full', src:'../images/bmw-desktop-frame.webp', borderless:true,
        caption:'BMW digital interface: precision UI at automotive brand standard — clean typography, colour, and spacing aligned with the BMW design language' },
      { type:'text', label:'Approach', title:'From audit findings to page designs',
        body:"I used the audit findings to redesign key pages while keeping the interface consistent with BMW’s visual identity. The documented result was +12% user engagement." },
      { type:'image-full', src:'../images/bmw-mobile.webp', bleed:true,
        caption:'BMW mobile app: connected car features with BMW design language on iOS' },
      { type:'image-grid', borderless:true, images:[
        { src:'../images/bmw-desktop.png', caption:'Configurateur — sélection moteur, finition et transmission sur desktop' },
        { src:'../images/bmw-ipda.png', caption:'Configurateur sur iPad — récapitulatif véhicule avec options et prix' },
      ]},
      { type:'image-full', src:'../images/bmw-homepage.webp', borderless:true,
        caption:'BMW.fr homepage: hero Série 1 Edition M Design, sélection de modèles, offres du moment' },
      { type:'process', title:'How I approached it' },
      { type:'outcome', text:"+12% user engagement following the website audit and page redesign." },
    ],
  },
  {
    id:'sncf', num:'15', group:'enterprise', logo:'../images/sncf.png',
    company:'SNCF Group', tagline:'Mobility & Transport Product Design',
    role:'Product Designer',
    year:'2017 – 2019', duration:'2 years', team:'Product, Dev & Marketing teams',
    platforms:['Mobile','Desktop'], tag:'Mobility · Transport', accent:'#e2001a',
    desc:"Designed internal applications, investor-facing research and passenger journey mapping for SNCF Group, including work on SNCF Réseau’s digital tools.",
    subtitle:'Internal tools, investor research and passenger journeys',
    challenge:"Cover three different audiences at SNCF: internal staff workflows, institutional investors evaluating green bond financing, and passengers navigating a TGV journey.",
    goals:"Design usable interfaces for internal workflows, build investor-facing research for green bond financing, and map the passenger journey end to end.",
    solution:"Contributed UX and interface design to SNCF's internal applications and digital tools, an institutional investor persona supporting green bond financing, and a full TGV passenger journey map.",
    steps:[
      {num:'01', title:'Design Thinking & Research', desc:'Facilitated workshops and user research to align complex needs, building detailed personas and comprehensive Experience Maps covering every touchpoint of a TGV journey.'},
      {num:'02', title:'Information Architecture', desc:'Structured massive user flows and interaction trees for multiple internal platforms, ensuring logical navigation through dense, multi-layered business applications.'},
      {num:'03', title:'UI Design & Prototyping', desc:'Designed high-fidelity interfaces for "SNCF Concerter" and other specialized tools across Mobile & Desktop, optimizing complex field data collection for professional agents.'},
    ],
    outcome:"Interface and research deliverables spanning internal SNCF applications, investor-facing content for green bond financing, and TGV passenger journey mapping.",
    outcomeStat:null, url:'https://www.sncf-reseau.com/fr', screenshot:'../images/sncf-desktop.png', heroCover:'../images/sncf-cover.webp',
    narrative: [
      { type:'text', label:'The context', title:'Three audiences, one design practice',
        body:"I worked across three different audiences at SNCF: internal professional applications covering security, information and HR workflows, an institutional investor persona supporting green bond financing, and passenger journey research for TGV travel. The work also included contributions to SNCF Réseau's digital tools." },
      { type:'image-grid', borderless:true, images:[
        { src:'../images/sncf-persona.png', caption:'Institutional investor persona: an asset manager\'s objectives, concerns, technology habits and information needs ahead of a green bond investment in SNCF' },
        { src:'../images/sncf-flow.png', caption:'Information architecture for SNCF Réseau\'s public consultation (concertation) platform: projects, stakeholders, objectives and synthesis' },
      ]},
      { type:'image-full', src:'../images/sncf-journey-map.png', borderless:true,
        caption:'Experience Map: Full Design Thinking deliverable mapping every touchpoint, pain point, and opportunity of a TGV journey' },
      { type:'image-full', src:'../images/sncf-desktop.png', borderless:true,
        caption:'SNCF Concerter on Desktop: Dashboard and project management system for ongoing public consultations' },
      { type:'text-image', label:'Field Application', title:'Optimized for operations on the go',
        body:"The mobile interface lets field staff record local information, community feedback and site conditions in the shared database.",
        src:'../images/sncf-mobile.png', borderless:true,
        caption:'SNCF Concerter on Mobile: Field data collection form factor',
        flip:true },
      { type:'process', title:'How I approached it' },
      { type:'outcome', text:"Interface and research deliverables spanning internal SNCF applications, investor-facing content for green bond financing, and TGV passenger journey mapping." },
    ],
  },
  {
    id:'galian', num:'16', group:'enterprise', logo:'../images/galian.png',
    company:'GALIAN', tagline:'Insurance SaaS Platform',
    role:'Product Designer',
    year:'2018 – 2021', duration:'3 years', team:'Product, Dev & Legal teams',
    platforms:['Desktop'], tag:'Insurance · SaaS', accent:'#0891b2',
    desc:'Product design for GALIAN insurance SaaS platform, digitising professional liability insurance flows for regulated sectors.',
    subtitle:'Policy management and claims on desktop',
    challenge:"Make policy management and claims procedures easier to follow while preserving required legal information.",
    goals:'Design a professional insurance platform that makes policy management, claims, and compliance straightforward for professionals and their advisors.',
    solution:'Collaborated with GALIAN product and legal teams to design the platform architecture and key flows: from onboarding and policy subscription to claims management.',
    steps:[
      {num:'01', title:'Process Mapping & IA', desc:'Mapped complex insurance processes (subscription, endorsement, claims, renewal) and restructured them into clear, linear user flows that reduce cognitive load.'},
      {num:'02', title:'Platform Design', desc:'Designed the full SaaS platform: onboarding flow, policy dashboard, document management, claims submission, and advisor portal. Desktop first, compliance aware.'},
      {num:'03', title:'Regulatory UX', desc:'Worked with legal teams to embed compliance requirements into the UX: disclosure flows, mandatory fields, and regulatory checkpoints, without making the product feel bureaucratic.'},
    ],
    outcome:'Professional insurance SaaS platform designed from the ground up: clear digital flows for policy management, claims, and compliance across 3 years of collaboration.',
    outcomeStat:null, url:'https://www.galian-smabtp.fr/', heroCover:'../images/galian-cover.webp',
    narrative: [
      { type:'text', label:'The challenge', title:'Making insurance procedures easier to follow',
        body:"The platform brings insurance procedures into a desktop interface for professionals and their advisors. The design needs to explain the required information at each stage of policy management and claims." },
      { type:'text-image', label:'Approach', title:'Three years of continuous improvement',
        body:"The work covered onboarding, policy subscription, document management and claims. I organized these procedures into flows that show users what to provide and what happens next.",
        src:'../images/persona-galian.png', imagePosition:'right' },
      { type:'image-grid', borderless:true, images:[
        { src:'../images/galian-macbook.png', caption:'Platform overview: policy dashboard and document management on desktop' },
        { src:'../images/design-system-galian.png', caption:'Design system: component library built for compliance-heavy flows' },
      ]},
      { type:'text-image', label:'UI Design', title:'Explaining each required step',
        body:"Progress indicators, contextual help and validation explain the required steps. Legal information stays available alongside the action it relates to.",
        src:'../images/galian-mockup.webp', imagePosition:'right' },
      { type:'process', title:'How I approached it' },
      { type:'outcome', text:'Professional insurance SaaS platform designed from the ground up: clear digital flows for policy management, claims, and compliance across 3 years of collaboration.' },
    ],
  },
];

function publicProjects() {
  return PROJECTS.filter(p => !p.hidden);
}

const EXP_LIST = [
  {num:'01', company:'OneAsset', logo:'../images/oneasset-logo.png', role:'Product Manager / Product Lead', type:'Salaried · Sole designer', year:'2026 – Present'},
  {num:'01', company:'UpViral', logo:'../images/upviral.png', role:'Product Manager / Designer', type:'SaaS · Remote', year:'2024 – 2025'},
  {num:'02', company:'Shiseido Group', logo:'../images/shisideo.png', role:'Senior Product Designer', type:'Beauty · Paris', year:'2024'},
  {num:'03', company:'Société Générale', logo:'../images/societegenerale.png', role:'Senior Product Designer', type:'Finance · Paris', year:'2023 – 2024'},
  {num:'04', company:'EdenRed', logo:'../images/edenred.png', role:'Senior Product Designer', type:'Benefits · Remote', year:'2023 – 2024'},
  {num:'05', company:'LVMH Group', logo:'../images/lvmh.png', role:'UX Designer', type:'Luxury · Paris', year:'2021 – 2022'},
  {num:'06', company:'BMW Group', logo:'../images/bmw.png', role:'UI Designer', type:'Auto · Remote', year:'2020 – 2021'},
  {num:'07', company:'Renault Group', logo:'../images/renault.png', role:'Product Designer', type:'Auto · Paris', year:'2019 – 2020'},
  {num:'08', company:'Casino Group', logo:'../images/casino.png', role:'UX / UI Designer', type:'Retail · Paris', year:'2020 – 2021'},
  {num:'09', company:'GALIAN', logo:'../images/galian.png', role:'Product Designer', type:'Insurance SaaS · Paris', year:'2018 – 2021'},
  {num:'10', company:'SNCF Group', logo:'../images/sncf.png', role:'Product Designer', type:'Mobility · Paris', year:'2017 – 2019'},
  {num:'11', company:'Marcel / Publicis', logo:'../images/publicis.png', role:'UX Designer', type:'Agency · Paris', year:'2015 – 2017'},
  {num:'12', company:'France Télévisions', logo:'../images/francetv.png', role:'Web Graphic Designer', type:'Media · Paris', year:'2013'},
];
