/* v2 studio (/agence), storytelling build, v4 (2026-10-11).
   Loads after agence-data.js (AGENCY_OFFERS, AGENCY_SERVICES, AGENCY_PROOF, agT, agPrice, window.SITE.contact)
   and agence-i18n.js (TRANSLATIONS). Prices come from AGENCY_OFFERS only, so the page and the chatbot
   quote the same numbers. One rAF pass per scroll reads every rect first, then writes; two clips are
   scrubbed through a lerped playhead; under prefers-reduced-motion each scene is drawn once in its
   arrival state and no clip loads. The same script runs the /agence/<page> documents (SITE.page). */
(function () {
  'use strict';

  const d = document;
  const root = d.documentElement;
  const SITE = (window.SITE && typeof window.SITE === 'object') ? window.SITE : (window.SITE = {});
  const KEY = SITE.langStorageKey || 'v2studio-lang';
  const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const smallMq = window.matchMedia('(max-width: 720px)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let reduced = reducedMq.matches;
  // lang = which hand-written copy to read (en or fr). Any other visitor language (SITE.locale) reads the English
  // copy through agTr / agTrDeep (agence shells), which swap in the machine translation when there is one.
  let lang = SITE.initialLang === 'fr' ? 'fr' : 'en';
  const tr = (s) => (typeof agTr === 'function' ? agTr(s) : s);
  const trDeep = (o) => (typeof agTrDeep === 'function' ? agTrDeep(o) : o);

  const OFFERS_ALL = (typeof AGENCY_OFFERS === 'object' && AGENCY_OFFERS) ? AGENCY_OFFERS : { offers: [], addons: [] };
  /* The home does not show coaching (it has its own "soon" page, /agence/coaching): its offer, the add-ons that only
     belong to it, its service row, its FAQ entry and its contact option are left out. Every other page keeps them. */
  const HOME_PAGE = !!d.getElementById('hero-title');
  const HOME_HIDDEN_OFFER = 'accompagnement';
  const OFFERS = HOME_PAGE ? {
    ...OFFERS_ALL,
    offers: (OFFERS_ALL.offers || []).filter((o) => o.id !== HOME_HIDDEN_OFFER),
    addons: (OFFERS_ALL.addons || []).filter((a) => !(Array.isArray(a.for) && a.for.length && a.for.every((id) => id === HOME_HIDDEN_OFFER))),
  } : OFFERS_ALL;
  const CAL = typeof AGENCY_CALENDLY === 'string' ? AGENCY_CALENDLY : 'https://calendly.com/chilka-v/30min';
  const EMAIL = typeof AGENCY_EMAIL === 'string' ? AGENCY_EMAIL : 'chilka.v@gmail.com';
  const SERVICES = typeof AGENCY_SERVICES !== 'undefined' ? AGENCY_SERVICES : [];
  const PROOF = typeof AGENCY_PROOF !== 'undefined' ? AGENCY_PROOF : [];
  const CHECKS = typeof AGENCY_CHECK_COUNT === 'number' ? AGENCY_CHECK_COUNT : 12;
  const STEPS = typeof AGENCY_STEP_COUNT === 'number' ? AGENCY_STEP_COUNT : 5;
  const FAQ = typeof AGENCY_FAQ_SLUGS !== 'undefined' ? AGENCY_FAQ_SLUGS : [];
  const OFFER_IDS = (typeof AGENCY_OFFER_IDS !== 'undefined' ? AGENCY_OFFER_IDS : ['refonte', 'creation', 'accompagnement', 'custom', 'unsure']).filter((id) => !HOME_PAGE || id !== HOME_HIDDEN_OFFER);

  /* Pigments live in agence-story.css (--p-*). */
  const token = (name) => getComputedStyle(root).getPropertyValue('--p-' + name).trim();
  const PAINT = {
    moss: token('moss'), yellow: token('yellow'), blue: token('blue'), pink: token('pink'), orange: token('orange'),
    cyan: token('cyan'), purple: token('purple'), sienna: token('sienna'), lime: token('lime'), white: token('white'),
  };
  const CHAPTERS = [
    { id: 'forest', target: 'top', key: 's_ch_forest', color: PAINT.moss },
    { id: 'proof', target: 'proof', key: 's_ch_proof', color: PAINT.yellow },
    // The home has no services section any more (the packages are in #pricing): the sub-pages keep this chapter.
    ...(HOME_PAGE ? [] : [{ id: 'services', target: 'services', key: 's_ch_services', color: PAINT.blue }]),
    { id: 'checks', target: 'details', key: 's_ch_checks', color: PAINT.pink },
    { id: 'pricing', target: 'pricing', key: 's_ch_pricing', color: PAINT.cyan },
    { id: 'founder', target: 'founder', key: 's_ch_founder', color: PAINT.sienna },
    { id: 'faq', target: 'faq', key: 's_ch_faq', color: PAINT.orange },
    { id: 'contact', target: 'contact', key: 's_ch_contact', color: PAINT.white },
  ];
  /* One colour per chapter; only the 12 checks (the peak) empty the whole palette. */
  const CHECK_COLORS = [PAINT.pink, PAINT.yellow, PAINT.cyan, PAINT.orange, PAINT.lime, PAINT.purple];

  /* Story lines written for this page, and a few overrides of shared keys (t() reads STORY first).
     The shared keys stay untouched in agence-i18n.js because agence-classic.html still uses them. */
  const STORY = {
    en: {
      s_beat2a: 'A forest of sites that all look alike.',
      s_beat2b: 'Same gradient hero. Same “Get started”. Same silence after the click.',
      s_beat3: 'Ours are still<br><em>finished by hand.</em>',
      s_beat3_line: 'An AI design agency. Redesign or build, at fixed prices from $390.',
      s_same_title: 'AI is fast.<br><em>Fast to look like everyone else, too.</em>',
      s_same_lede: 'AI tools reach for the same gradient hero and the same “Get started” button. We use AI for speed, then the founder finishes every screen by hand.',
      s_same_caption: 'One of these sites went through the 12 checks.',
      proof_headline: 'The results first.<br><em>Then what was done, and how.</em>',
      s_proof_note: 'Figures reported by our founder from each project, before v2 studio. They were not measured by v2 studio, and they describe those projects only. Your results will depend on your product and your traffic.',
      s_all_work: 'See all projects',
      hp_g1: 'More engagement',
      hp_g2: 'Higher loyalty',
      hp_g3: 'Better results',
      hp_from: 'Starts at',
      hp_src: 'Reported by our founder, before v2 studio.',
      hp_d_pages: 'Scope',
      hp_d_delivery: 'Delivery',
      hp_d_rev: 'Revisions',
      hp_d_scope: 'A fixed price, a written scope and a delivery date, all on the page before you pay.',
      hp_panel_aria: 'Project detail',
      px_rev_info: 'More about revision rounds',
      nav_lang_aria: 'Language',
      nav_lang_auto: 'Automatic',
      fx_panel_aria: 'The founder, in detail',
      fq_go_founder: 'Meet the founder',
      fq_go_packages: 'See the packages',
      fq_go_order: 'How ordering works',
      fq_go_checks: 'The 12 checks',
      fq_go_brief: 'Describe your project',
      fq_go_call: 'Book a 30-min call',
      fq_search: 'Search the questions',
      fq_count: '{n} of {total}',
      fq_empty: 'No question matches that.',
      cs_label: 'Not sure how to start?',
      cs_chips: ['My page gets visits, but few people sign up', 'My site looks like every other AI-made site', 'I want a second pair of eyes before launch'],
      fx_1_lede: 'Where the founder worked, before v2 studio.',
      fx_2: 'From 2020 to 2024 the founder ran a product design agency and managed up to 7 junior freelance designers. The 20+ projects covered enterprise, retail, finance, SaaS and mobility.',
      fx_3_lede: 'Products the founder has built since 2022, and where each one stands today.',
      fx_4: 'Creads.io is an AI advertising SaaS built by the founder. It is launched, with 1,200 registered users and 20 paying clients.',
      pf_results: 'Results',
      pf_before: 'before',
      pf_after: 'after',
      pf_dumb_aria: 'Before {a}, after {b}, on an index where before is 100',
      pf_actions: 'Actions',
      pf_actions_lede: 'What we do on your page.',
      pf_a1_t: 'Walk your page as a first-time customer.',
      pf_a1_d: 'On a phone and on a laptop, next to your closest competitors.',
      pf_a2_t: 'Rank every place people get stuck.',
      pf_a2_d: 'You get a written list, ordered by impact, before anything is redrawn.',
      pf_a3_t: 'Redesign the key screens with your real content.',
      pf_a3_d: 'Your longest name, your longest price. No lorem ipsum.',
      pf_a4_t: 'Build it in code and hand it over.',
      pf_a4_d: 'Desktop and mobile, every state designed. The source, the completed grid and the handoff notes come with it.',
      pf_methods: 'Methods',
      pf_methods_lede: 'How we decide what to change.',
      pf_m1_t: 'Evidence before opinion.',
      pf_m1_d: 'An audit and the numbers decide what changes first, not taste.',
      pf_m1_p: 'BMW · UX/UI audit and data analysis',
      pf_m2_t: 'Test, fix, test again.',
      pf_m2_d: 'Prototypes go in front of real users before any development starts.',
      pf_m2_p: 'Skiset · 16/20 desktop satisfaction in tests',
      pf_m3_t: 'AI for speed, a human for the finish.',
      pf_m3_d: 'Every AI-generated line is read and edited by the founder, then checked twelve ways.',
      pf_m3_p: '12 checks on every delivery',
      pf_a1_day: 'Day 1',
      pf_a2_day: 'Day 1',
      pf_a3_day: 'Day 2',
      pf_a4_day: 'Days 3 to 5',
      pf_a1_x: 'We go through your page on a phone and on a laptop as a first-time customer would, and compare it side by side with your closest competitors.',
      pf_a2_x: 'You get a written list of every place people get stuck, ranked by impact.',
      pf_a3_x: 'You see the structure, one key screen and the tone on Day 2. Approve it, or ask for changes before we build.',
      pf_a4_x: 'The full page in code, desktop and mobile, with your real content and every state. Then the 12 checks, and delivery with the source, the completed grid and the handoff notes.',
      pf_m1_x: 'On BMW’s public website, our founder ran a full UX/UI audit and data analysis, then redesigned the key pages: +12% user engagement.',
      pf_m2_x: 'Our founder tested the old booking flow of a ski rental platform with real users, restructured the journey, then tested the prototypes again before handoff: 15/20 satisfaction on mobile, 16/20 on desktop.',
      pf_m3_x: 'You get the 12-check grid with your files, completed and signed by the founder. A point that does not apply is marked N/A.',
      s_dive_a: 'A pretty hero<br>is the surface.',
      s_dive_b: 'The details live<br><em>underneath.</em>',
      s_dive_c: 'Most sites never<br><em>come down here.</em>',
      s_fox_a: 'Someone still has<br>to finish the work.',
      s_fox_line: 'A plane can fly itself. It is still reassuring to have a human pilot.',
      details_headline: 'Every delivery passes the<br><em>same 12 checks.</em>',
      s_checks_title: 'Every delivery is checked.<br><em>And every detail is human-made.</em>',
      s_check_close: 'Close',
      s_checks_lede: 'You get this grid with your files, completed and signed by the founder. A point that doesn’t apply is marked N/A.',
      s_ledger_sign: 'Checked by hand, founder',
      s_ledger_stamp: 'passed',
      s_process_note: 'Build: the same steps with two more build days, delivered on Day 7. Coaching: two calls a month.',
      step_4_body: 'The full page in code, desktop and mobile, with your real content and every state: empty, loading, error, success.',
      faq_cancel_a: 'Yes, any time before the next billing date. The current month stays paid and unused calls don’t roll over.',
      faq_payment_a: 'You order from the package card. Redesign and Build are paid in full before Day 1, and every payment gets an invoice. Coaching is billed monthly in advance. A custom project is paid in two parts: a deposit to book the dates, the balance at delivery. Prices are in US dollars, excluding applicable taxes.',
      pricing_sub: 'Each package has a fixed price, a written scope and a delivery date. You see all of it before you pay.',
      s_price_more: '{n} more included',
      s_price_more_build: '{n} more, with every Build',
      s_price_track: 'Track',
      s_price_or_call: 'or book a 30-min call',
      s_price_or_write: 'or write to us first',
      s_addons_hint: 'Add them when you order a Redesign or a Build.',
      s_addon_for: 'Redesign and Build',
      s_addon_for_coaching: 'Coaching',
      s_steps_title: 'How ordering works',
      s_step_req_1: ['Order on the card', 'Pick the package, the track and any add-ons, then write a short brief.'],
      s_step_req_2: ['Scope in writing', 'Within one business day we confirm the scope and the delivery date.'],
      s_step_req_3: ['Pay, and Day 1 starts', 'You pay by card from a secure link. Day 1 is the next business day.'],
      s_step_pay_1: ['Order and pay on the card', 'Pick the package, the track and any add-ons, write a short brief and pay by card.'],
      s_step_pay_2: ['Kickoff within a day', 'Within one business day we confirm the scope in writing and book the kickoff call.'],
      s_step_pay_3: ['Delivered on the date', 'Day 1 starts once we have your brief and your files. The date is on your receipt.'],
      faq_new_a: 'Yes. The projects on this page are our founder’s work, mostly from before v2 studio: the product design agency he ran from 2020 to 2024, or his freelance work since 2016. Each case study is his own account and says which kind of work it was.',
      contact_modal_subtitle: 'Pick a package and add a few lines. This opens a draft in your email app; nothing is sent until you press send there.',
      s_or_write: 'Or write to',
      s_palette_aria: 'Chapters',
      s_lang: 'Language',
      s_chat_btn: 'Ask a question',
      s_hero_alt: 'A young fox holding a painter’s palette walks out of a misty forest.',
      s_ch_forest: 'The forest',
      s_ch_proof: 'Proof',
      s_ch_services: 'Services',
      s_ch_checks: '12 checks',
      s_ch_pricing: 'Packages',
      s_ch_day2: 'Day 2',
      s_ch_process: 'Process',
      s_ch_founder: 'The founder',
      s_ch_faq: 'FAQ',
      s_ch_contact: 'Contact',
      s_more_done: 'What was done',
      s_pick_title: 'Where are you starting from?',
      s_pick_refonte: 'My site is live, but people leave',
      s_pick_creation: 'I’m starting from a blank page',
      s_pick_accompagnement: 'My team builds it themselves',
      s_pick_custom: 'My project is bigger than one page',
      s_price_pages: 'Pages',
      s_price_from: 'from',
      s_price_quote: 'fixed quote',
      s_pick_line: '{name}: {price}, {delivery}.',
      s_soon: 'Soon',
      s_pricing_pay_home: 'Prices in US dollars, excluding applicable taxes. Packages are paid upfront.',
      faq_payment_a_home: 'You order from the package card. Redesign and Build are paid in full before Day 1, and every payment gets an invoice. A custom project is paid in two parts: a deposit to book the dates, the balance at delivery. Prices are in US dollars, excluding applicable taxes.',
      faq_unhappy_a_home: 'Say so on Day 2, when you see the direction: we change it before building. After you approve it, your revision rounds cover changes within the brief, in the 14 days after delivery.',
      meta_desc_home: 'Fixed-price redesign, UX and AI product prototypes from $390. Led by a founder with 12 years in product and UX. Every delivery passes the same 12-point detail check.',
      doc_title_coaching: 'Coaching, coming soon · v2 studio',
      meta_desc_coaching: 'A coaching offer is on its way. Come back soon.',
      s_coaching_title: 'Coaching —<br><em>coming soon.</em>',
      s_coaching_lede: 'A coaching offer is on its way. Come back soon.',
      s_coaching_back: 'Back to v2 studio',
      s_fig_step_1: 'A phone, for the kickoff call',
      s_fig_step_2: 'A dish aimed at your page',
      s_fig_step_3: 'A padlock: the direction locks in on Day 2',
      s_fig_step_4: 'A keyboard, for the build',
      s_fig_step_5: 'A rack of checked blades, ready to hand off',
    },
    fr: {
      s_beat2a: 'Une forêt de sites qui se ressemblent tous.',
      s_beat2b: 'Même hero en dégradé. Même « Commencer ». Même silence après le clic.',
      s_beat3: 'Les nôtres sont encore<br><em>finis à la main.</em>',
      s_beat3_line: 'Une agence de design IA. Refonte ou création, à prix fixes dès 390 $.',
      s_same_title: 'L’IA va vite.<br><em>Vite vers le même résultat que tout le monde.</em>',
      s_same_lede: 'Les outils d’IA proposent le même hero en dégradé et le même bouton « Commencer ». Nous utilisons l’IA pour la vitesse, puis le fondateur finit chaque écran à la main.',
      s_same_caption: 'Un seul de ces sites est passé par les 12 contrôles.',
      proof_headline: 'D’abord les résultats.<br><em>Puis ce qui a été fait, et comment.</em>',
      s_proof_note: 'Chiffres communiqués par notre fondateur pour chaque projet, avant v2 studio. Ils n’ont pas été mesurés par v2 studio et décrivent uniquement ces projets. Vos résultats dépendront de votre produit et de votre trafic.',
      s_all_work: 'Voir tous les projets',
      hp_g1: 'Plus d’engagement',
      hp_g2: 'Plus de fidélité',
      hp_g3: 'De meilleurs résultats',
      hp_from: 'À partir de',
      hp_src: 'Communiqué par notre fondateur, avant v2 studio.',
      hp_d_pages: 'Périmètre',
      hp_d_delivery: 'Livraison',
      hp_d_rev: 'Retouches',
      hp_d_scope: 'Un prix fixe, un périmètre écrit et une date de livraison, affichés sur la page avant que vous payiez.',
      hp_panel_aria: 'Détail du projet',
      px_rev_info: 'En savoir plus sur les allers-retours',
      nav_lang_aria: 'Langue',
      nav_lang_auto: 'Automatique',
      fx_panel_aria: 'Le fondateur, en détail',
      fq_go_founder: 'Rencontrer le fondateur',
      fq_go_packages: 'Voir les formules',
      fq_go_order: 'Comment commander',
      fq_go_checks: 'Les 12 contrôles',
      fq_go_brief: 'Décrire votre projet',
      fq_go_call: 'Réserver un appel de 30 min',
      fq_search: 'Chercher dans les questions',
      fq_count: '{n} sur {total}',
      fq_empty: 'Aucune question ne correspond.',
      cs_label: 'Pas sûr de la façon de commencer ?',
      cs_chips: ['Ma page reçoit des visites, mais peu d’inscriptions', 'Mon site ressemble à tous les sites faits par IA', 'Je veux un second regard avant le lancement'],
      fx_1_lede: 'Là où le fondateur a travaillé, avant v2 studio.',
      fx_2: 'De 2020 à 2024, le fondateur a dirigé une agence de design produit et encadré jusqu’à 7 designers freelances juniors. Les plus de 20 projets couvraient l’entreprise, le retail, la finance, le SaaS et la mobilité.',
      fx_3_lede: 'Les produits que le fondateur construit depuis 2022, et où en est chacun.',
      fx_4: 'Creads.io est un SaaS de publicité par IA construit par le fondateur. Il est lancé, avec 1 200 utilisateurs inscrits et 20 clients payants.',
      pf_results: 'Résultats',
      pf_before: 'avant',
      pf_after: 'après',
      pf_dumb_aria: 'Avant {a}, après {b}, sur un indice où avant vaut 100',
      pf_actions: 'Actions',
      pf_actions_lede: 'Ce que nous faisons sur votre page.',
      pf_a1_t: 'Parcourir votre page comme un premier client.',
      pf_a1_d: 'Sur téléphone et sur ordinateur, à côté de vos concurrents directs.',
      pf_a2_t: 'Classer chaque endroit où les gens bloquent.',
      pf_a2_d: 'Vous recevez une liste écrite, classée par impact, avant qu’on redessine quoi que ce soit.',
      pf_a3_t: 'Refaire les écrans clés avec vos vrais contenus.',
      pf_a3_d: 'Votre nom le plus long, votre prix le plus long. Aucun lorem ipsum.',
      pf_a4_t: 'La construire en code et vous la remettre.',
      pf_a4_d: 'Desktop et mobile, tous les états dessinés. Le code source, la grille complétée et les notes de passation sont livrés avec.',
      pf_methods: 'Méthodes',
      pf_methods_lede: 'Comment nous décidons de ce qui change.',
      pf_m1_t: 'Les preuves avant l’opinion.',
      pf_m1_d: 'Un audit et les chiffres décident de ce qui change en premier, pas le goût.',
      pf_m1_p: 'BMW · audit UX/UI et analyse de données',
      pf_m2_t: 'Tester, corriger, retester.',
      pf_m2_d: 'Les prototypes passent devant de vrais utilisateurs avant tout développement.',
      pf_m2_p: 'Skiset · 16/20 de satisfaction sur desktop en test',
      pf_m3_t: 'L’IA pour la vitesse, un humain pour la finition.',
      pf_m3_d: 'Chaque ligne générée par l’IA est relue et corrigée par le fondateur, puis vérifiée de douze façons.',
      pf_m3_p: '12 contrôles à chaque livraison',
      pf_a1_day: 'J1',
      pf_a2_day: 'J1',
      pf_a3_day: 'J2',
      pf_a4_day: 'J3 à J5',
      pf_a1_x: 'Nous parcourons votre page sur téléphone et sur ordinateur comme un premier client, et la comparons côte à côte avec vos concurrents directs.',
      pf_a2_x: 'Vous recevez la liste écrite de chaque endroit où les gens bloquent, classée par impact.',
      pf_a3_x: 'Vous voyez la structure, un écran clé et le ton au jour 2. Vous validez, ou demandez des changements avant la construction.',
      pf_a4_x: 'La page complète en code, desktop et mobile, avec vos vrais contenus et tous les états. Puis les 12 contrôles, et la livraison avec le code source, la grille complétée et les notes de passation.',
      pf_m1_x: 'Sur le site public de BMW, notre fondateur a mené un audit UX/UI complet et une analyse de données, puis refait les pages clés : +12 % d’engagement utilisateur.',
      pf_m2_x: 'Notre fondateur a testé avec de vrais utilisateurs l’ancien parcours de réservation d’une plateforme de location de ski, restructuré le parcours, puis retesté les prototypes avant la passation : 15/20 de satisfaction sur mobile, 16/20 sur desktop.',
      pf_m3_x: 'Vous recevez la grille des 12 contrôles avec vos fichiers, complétée et signée par le fondateur. Un point qui ne s’applique pas est marqué N/A.',
      s_dive_a: 'Un beau hero,<br>c’est la surface.',
      s_dive_b: 'Les détails vivent<br><em>en dessous.</em>',
      s_dive_c: 'La plupart des sites<br><em>ne descendent jamais ici.</em>',
      s_fox_a: 'Il faut encore quelqu’un<br>pour finir le travail.',
      s_fox_line: 'Un avion peut voler tout seul. Un pilote humain reste rassurant.',
      details_headline: 'Chaque livraison passe les<br><em>12 mêmes contrôles.</em>',
      s_checks_title: 'Chaque livraison est vérifiée.<br><em>Et chaque détail est fait par un humain.</em>',
      s_check_close: 'Fermer',
      s_checks_lede: 'Vous recevez cette grille avec vos fichiers, complétée et signée par le fondateur. Un point qui ne s’applique pas est marqué « sans objet ».',
      s_ledger_sign: 'Vérifié à la main, fondateur',
      s_ledger_stamp: 'validé',
      s_process_note: 'Création : les mêmes étapes avec deux jours de construction en plus, livraison au jour 7. Accompagnement : deux appels par mois.',
      step_4_body: 'La page complète en code, desktop et mobile, avec vos vrais contenus et tous les états : vide, chargement, erreur, succès.',
      faq_cancel_a: 'Oui, à tout moment avant la prochaine échéance. Le mois en cours reste dû et les appels non utilisés ne sont pas reportés.',
      faq_payment_a: 'Vous commandez depuis la carte de la formule. La Refonte et la Création se règlent en totalité avant le jour 1, et chaque paiement donne lieu à une facture. L’Accompagnement est facturé chaque mois, d’avance. Un projet sur devis se règle en deux fois : un acompte pour réserver les dates, le solde à la livraison. Les prix sont en dollars US, hors taxes applicables.',
      pricing_sub: 'Chaque formule a un prix fixe, un périmètre écrit et une date de livraison. Vous voyez tout avant de payer.',
      s_price_more: '{n} de plus, inclus',
      s_price_more_build: '{n} de plus, dans chaque Création',
      s_price_track: 'Piste',
      s_price_or_call: 'ou réservez un appel de 30 min',
      s_price_or_write: 'ou écrivez-nous d’abord',
      s_addons_hint: 'À ajouter au moment de commander une Refonte ou une Création.',
      s_addon_for: 'Refonte et Création',
      s_addon_for_coaching: 'Accompagnement',
      s_steps_title: 'Comment commander',
      s_step_req_1: ['Commandez sur la carte', 'Choisissez la formule, la piste et les options, puis écrivez un court brief.'],
      s_step_req_2: ['Le périmètre par écrit', 'Sous un jour ouvré, nous confirmons le périmètre et la date de livraison.'],
      s_step_req_3: ['Vous réglez, le jour 1 commence', 'Vous payez par carte via un lien sécurisé. Le jour 1 est le jour ouvré suivant.'],
      s_step_pay_1: ['Commandez et payez sur la carte', 'Choisissez la formule, la piste et les options, écrivez un court brief et payez par carte.'],
      s_step_pay_2: ['Lancement sous un jour', 'Sous un jour ouvré, nous confirmons le périmètre par écrit et fixons l’appel de lancement.'],
      s_step_pay_3: ['Livré à la date', 'Le jour 1 commence dès que nous avons votre brief et vos fichiers. La date figure sur votre reçu.'],
      faq_new_a: 'Oui. Les projets de cette page sont le travail de notre fondateur, pour l’essentiel avant v2 studio : l’agence de product design qu’il a dirigée de 2020 à 2024, ou son activité freelance depuis 2016. Chaque étude de cas est son propre récit et précise de quel travail il s’agit.',
      contact_modal_subtitle: 'Choisissez une formule et ajoutez quelques lignes. Cela ouvre un brouillon dans votre messagerie ; rien n’est envoyé tant que vous n’avez pas cliqué sur Envoyer.',
      s_or_write: 'Ou écrivez à',
      s_palette_aria: 'Chapitres',
      s_lang: 'Langue',
      s_chat_btn: 'Poser une question',
      s_hero_alt: 'Un jeune renard tenant une palette de peintre sort d’une forêt brumeuse.',
      s_ch_forest: 'La forêt',
      s_ch_proof: 'Preuves',
      s_ch_services: 'Services',
      s_ch_checks: '12 contrôles',
      s_ch_pricing: 'Formules',
      s_ch_day2: 'Jour 2',
      s_ch_process: 'Méthode',
      s_ch_founder: 'Le fondateur',
      s_ch_faq: 'FAQ',
      s_ch_contact: 'Contact',
      s_more_done: 'Ce qui a été fait',
      s_pick_title: 'Vous partez d’où ?',
      s_pick_refonte: 'Mon site existe, mais les visiteurs partent',
      s_pick_creation: 'Je pars d’une page blanche',
      s_pick_accompagnement: 'Mon équipe construit elle-même',
      s_pick_custom: 'Mon projet dépasse une page',
      s_price_pages: 'Pages',
      s_price_from: 'à partir de',
      s_price_quote: 'devis fixe',
      s_pick_line: '{name} : {price}, {delivery}.',
      s_soon: 'Bientôt',
      s_pricing_pay_home: 'Prix en dollars US, hors taxes applicables. Les formules se règlent à la commande.',
      faq_payment_a_home: 'Vous commandez depuis la carte de la formule. La Refonte et la Création se règlent en totalité avant le jour 1, et chaque paiement donne lieu à une facture. Un projet sur devis se règle en deux fois : un acompte pour réserver les dates, le solde à la livraison. Les prix sont en dollars US, hors taxes applicables.',
      faq_unhappy_a_home: 'Dites-le au jour 2, quand vous voyez la direction : nous la changeons avant de construire. Une fois la direction validée, vos allers-retours couvrent les changements dans le cadre du brief, pendant les 14 jours suivant la livraison.',
      meta_desc_home: 'Refonte, UX et prototypes de produits IA à prix fixe, dès 390 $. Chaque projet est mené par le fondateur, fort de 12 ans d’expérience en produit et en UX. Chaque livraison passe le même contrôle en 12 points.',
      doc_title_coaching: 'Coaching, bientôt disponible · v2 studio',
      meta_desc_coaching: 'Une offre de coaching arrive bientôt. Revenez vite.',
      s_coaching_title: 'Coaching —<br><em>bientôt disponible.</em>',
      s_coaching_lede: 'Une offre de coaching arrive bientôt. Revenez vite.',
      s_coaching_back: 'Retour à v2 studio',
      s_fig_step_1: 'Un téléphone, pour l’appel de lancement',
      s_fig_step_2: 'Une parabole pointée sur votre page',
      s_fig_step_3: 'Un cadenas : la direction se fixe au jour 2',
      s_fig_step_4: 'Un clavier, pour la construction',
      s_fig_step_5: 'Une baie de lames vérifiées, prête à être livrée',
    },
  };

  /* The picture in each proof bubble: the cited project, or the founder for coaching (no project to cite).
     Loaded on first hover or open (data-src), not with the page. */
  /* Offers not open yet (coaching and its extra session): a 'Soon' tag wherever they are listed. */
  const SOON = new Set([...(OFFERS.offers || []), ...(OFFERS.addons || [])].filter((x) => x && x.open === false).map((x) => x.id));
  const soonTag = (id) => (SOON.has(id) ? `<span class="soon">${esc(t('s_soon'))}</span>` : '');
  /* One drawn scene per service, on the card's dark pigment panel (stroke = cream, accent = --c2, motion in CSS).
     1 a page repainted by a brush, 2 a journey that drops its friction detour, 3 a prompt that becomes a screen,
     4 a review call that circles one detail. Decorative: the row's text says what the offer is. */
  const SVC_ICONS = {
    1: `<svg class="svc-ico" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      <defs><clipPath id="svc-wipe-1"><rect class="ico-wipe" x="20" y="18" width="120" height="84" rx="8"/></clipPath></defs>
      <rect class="ico-frame" x="20" y="18" width="120" height="84" rx="8"/>
      <path class="ico-line" d="M20 31h120"/>
      <circle class="ico-dot" cx="28" cy="24.5" r="1.8"/><circle class="ico-dot" cx="34.5" cy="24.5" r="1.8"/><circle class="ico-dot" cx="41" cy="24.5" r="1.8"/>
      <g class="ico-old"><rect x="30" y="40" width="58" height="6" rx="2"/><rect x="30" y="51" width="40" height="4" rx="2"/><rect x="30" y="66" width="100" height="26" rx="3"/></g>
      <g class="ico-new" clip-path="url(#svc-wipe-1)">
        <circle class="ico-sun" cx="117" cy="51" r="11"/>
        <rect class="ico-fill" x="30" y="39" width="62" height="9" rx="3"/>
        <rect class="ico-soft" x="30" y="52" width="44" height="4" rx="2"/>
        <rect class="ico-fill" x="30" y="60" width="22" height="7" rx="3.5"/>
        <rect class="ico-card" x="30" y="74" width="30" height="20" rx="3"/><rect class="ico-card" x="65" y="74" width="30" height="20" rx="3"/><rect class="ico-card" x="100" y="74" width="30" height="20" rx="3"/>
      </g>
      <g class="ico-brush"><path class="ico-handle" d="M0 44V14"/><rect class="ico-ferrule" x="-3.5" y="44" width="7" height="8" rx="1.5"/><ellipse class="ico-fill" cx="0" cy="60" rx="4" ry="8"/></g>
    </svg>`,
    2: `<svg class="svc-ico" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      <path class="ico-line ico-faint ico-dash" d="M28 60C50 60 56 94 80 94S110 60 132 60"/>
      <path class="ico-warn" d="M75 89l10 10M85 89l-10 10"/>
      <path id="svc-path-2" class="ico-path" d="M28 60C50 60 56 30 80 30S110 60 132 60"/>
      <rect class="ico-card ico-card--solid" x="69" y="20" width="22" height="16" rx="3"/>
      <rect class="ico-soft" x="73" y="25" width="10" height="2.5" rx="1.25"/><rect class="ico-soft" x="73" y="29.5" width="14" height="2.5" rx="1.25"/>
      <circle class="ico-node" cx="28" cy="60" r="6.5"/><circle class="ico-dot" cx="28" cy="60" r="2.2"/>
      <circle class="ico-end" cx="132" cy="60" r="8"/><path class="ico-check" d="M128.2 60.2l2.6 2.6 5-5.4"/>
      <circle class="ico-runner" r="3.6"><animateMotion dur="3.8s" repeatCount="indefinite" calcMode="spline" keyPoints="0;1;1" keyTimes="0;.72;1" keySplines=".45 0 .25 1;0 0 1 1"><mpath href="#svc-path-2"/></animateMotion></circle>
    </svg>`,
    3: `<svg class="svc-ico" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      <path class="ico-frame" d="M26 18h70a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8H46l-9 8v-8H26a8 8 0 0 1-8-8V26a8 8 0 0 1 8-8z"/>
      <rect class="ico-soft" x="28" y="30" width="44" height="4" rx="2"/><rect class="ico-caret" x="76" y="28" width="2" height="8" rx="1"/>
      <path class="ico-line ico-faint ico-dash" d="M37 60v18q0 6 6 6h9"/>
      <rect class="ico-frame ico-screen" x="52" y="62" width="90" height="44" rx="8"/>
      <rect class="ico-type ico-type--1 ico-fill" x="62" y="72" width="46" height="5" rx="2.5"/>
      <rect class="ico-type ico-type--2 ico-soft" x="62" y="82" width="66" height="4" rx="2"/>
      <rect class="ico-type ico-type--3 ico-soft" x="62" y="91" width="34" height="4" rx="2"/>
      <rect class="ico-type ico-type--4 ico-fill" x="106" y="89" width="26" height="8" rx="4"/>
      <path class="ico-spark" d="M129 16c1.3 7 3 8.7 10 10-7 1.3-8.7 3-10 10-1.3-7-3-8.7-10-10 7-1.3 8.7-3 10-10z"/>
      <path class="ico-spark ico-spark--2" d="M147 42c.6 3.5 1.5 4.4 5 5-3.5.6-4.4 1.5-5 5-.6-3.5-1.5-4.4-5-5 3.5-.6 4.4-1.5 5-5z"/>
    </svg>`,
    4: `<svg class="svc-ico" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      <rect class="ico-frame" x="16" y="16" width="128" height="80" rx="8"/>
      <rect class="ico-soft" x="28" y="27" width="50" height="6" rx="3"/><rect class="ico-faintfill" x="28" y="38" width="34" height="4" rx="2"/>
      <rect class="ico-card" x="28" y="52" width="34" height="32" rx="3"/><rect class="ico-card" x="68" y="52" width="32" height="32" rx="3"/>
      <ellipse class="ico-annot" cx="45" cy="68" rx="24" ry="20" transform="rotate(-8 45 68)" pathLength="100"/>
      <rect class="ico-pip" x="107" y="56" width="29" height="32" rx="5"/>
      <circle class="ico-fill" cx="121.5" cy="67" r="4.6"/><path class="ico-fill" d="M112.5 84c2-6 5.5-8.5 9-8.5s7 2.5 9 8.5z"/>
      <circle class="ico-rec" cx="132" cy="27" r="3.4"/>
      <path class="ico-line ico-faint" d="M28 107h104"/><path class="ico-prog" d="M28 107h104" pathLength="100"/>
    </svg>`,
  };
  /* Notes pinned on the fox's last frame, in clip coordinates (0..1 of 1920x1080), shown once the fox has arrived.
     Removed at the user's request (2026-10-12); the host .hero-spots is gone from agence.html too. */
  const SPOTS = [];
  let moreSeq = 0;
  function more(labelKey, inner) {
    const id = 'more-' + (++moreSeq);
    return `<div class="more">
      <button type="button" class="more-btn" aria-expanded="false" aria-controls="${id}"><span class="more-ico" aria-hidden="true"></span><span>${esc(t(labelKey))}</span></button>
      <div class="more-panel" id="${id}" inert><div class="more-inner">${inner}</div></div>
    </div>`;
  }
  function fig(name, labelKey, extra) {
    return `<div class="hairline-fig ${extra || ''}" data-hairline="${name}" data-theme="light" data-intensity="0.6" role="img" aria-label="${esc(t(labelKey))}"></div>`;
  }

  /* Pocket tile: the photo's coordinate space is 1000 px wide; --s scales it to the device box. */
  let pocketRO = null;
  function fitPocket() {
    const dev = d.querySelector('.r-pocket .r-device');
    if (!dev) return;
    const set = () => dev.style.setProperty('--s', (dev.clientWidth / 1000).toFixed(4));
    set();
    if (!pocketRO && 'ResizeObserver' in window) pocketRO = new ResizeObserver(() => { const el = d.querySelector('.r-pocket .r-device'); if (el) el.style.setProperty('--s', (el.clientWidth / 1000).toFixed(4)); });
    if (pocketRO) { pocketRO.disconnect(); pocketRO.observe(dev); }
  }

  /* ── Helpers ── */
  const $ = (id) => d.getElementById(id);
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const seg = (p, a, b) => clamp((p - a) / (b - a));
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const tidy = (s) => (typeof agTidyText === 'function' ? agTidyText(String(s == null ? '' : s)) : String(s == null ? '' : s));
  const pick = (obj) => (obj && typeof obj === 'object') ? trDeep(obj[lang] != null ? obj[lang] : obj.en) : obj;

  function t(key) {
    const own = STORY[lang] && STORY[lang][key];
    if (typeof own === 'string') return tr(own);
    if (typeof agT === 'function') {
      const v = agT(key, lang);
      if (v) return tr(v);
    }
    const en = STORY.en[key];
    return typeof en === 'string' ? tr(en) : '';
  }
  const tlist = (key) => trDeep(STORY[lang] && Array.isArray(STORY[lang][key]) ? STORY[lang][key] : (Array.isArray(STORY.en[key]) ? STORY.en[key] : []));
  const noArrow = (s) => String(s || '').replace(/\s*→\s*$/, '');
  const unquote = (s) => String(s || '').replace(/^[\s“”"«»  ]+|[\s“”"«»  ]+$/g, '');
  function price(amount) {
    return typeof agPrice === 'function' ? agPrice(amount, lang, false) : '$' + amount;
  }

  /* ── i18n ── */
  function splitWords(el) {
    const words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words.map((w, i) => `<span class="word" style="--i:${i}">${esc(w)}</span>`).join(' ');
  }
  /* Wrap every word of an element (keeping <em> and <br>) so the heading can rise word by word on entry. */
  function wrapWords(el) {
    let i = 0;
    const walk = (node) => {
      Array.from(node.childNodes).forEach((n) => {
        if (n.nodeType === 3) {
          const parts = n.textContent.split(/(\s+)/);
          const frag = d.createDocumentFragment();
          parts.forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(d.createTextNode(part)); return; }
            const s = d.createElement('span');
            s.className = 'rw';
            s.style.setProperty('--i', i++);
            s.textContent = part;
            frag.appendChild(s);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    };
    walk(el);
    el.classList.add('is-split');
  }

  function applyText() {
    d.querySelectorAll('[data-t]').forEach((el) => {
      const v = t(el.dataset.t);
      if (v) el.textContent = v;
    });
    d.querySelectorAll('[data-th]').forEach((el) => {
      const v = t(el.dataset.th);
      if (v) el.innerHTML = v;
    });
    d.querySelectorAll('[data-ta]').forEach((el) => {
      el.dataset.ta.split(';').forEach((pair) => {
        const i = pair.indexOf(':');
        if (i < 0) return;
        const v = t(pair.slice(i + 1));
        if (v) el.setAttribute(pair.slice(0, i), v);
      });
    });
    d.querySelectorAll('[data-words]').forEach(splitWords);
    d.querySelectorAll('[data-reveal]').forEach((el) => { el.classList.remove('is-in'); wrapWords(el); });
    watchReveals();
    const pageKey = ({ showcase: 'showcase', services: 'services', pricing: 'pricing', 'secret-touch': 'secret', coaching: 'coaching' })[SITE.page] || '';
    const title = (pageKey && t('doc_title_' + pageKey)) || t('doc_title_home') || t('meta_title');
    if (title) d.title = title;
    const desc = pageKey ? t('meta_desc_' + pageKey) : ((HOME_PAGE && t('meta_desc_home')) || t('meta_desc'));
    const meta = d.querySelector('meta[name="description"]');
    if (desc && meta) meta.setAttribute('content', desc);
    markNav();
  }

  function markNav() {
    const page = SITE.page || '';
    d.querySelectorAll('.nav-links a[data-page]').forEach((a) => {
      if (a.dataset.page === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function setLang(next, save) {
    lang = next === 'fr' ? 'fr' : 'en';
    root.lang = SITE.locale || lang;
    window.currentLang = lang;
    if (save) {
      try { window.localStorage.setItem(KEY, lang); } catch (e) { /* storage blocked */ }
    }
    applyText();
    renderAll();
    root.classList.remove('i18n-pending');
    layout();
  }

  /* ── Renderers ── */
  /* The forest of lookalikes: eight small landing pages that could be anyone's. Same nav, same gradient hero,
     same "Get started", same three feature cards. One of them gets painted into the page's own site. */
  /* Six kinds of generated site, the defaults an AI builder reaches for. Shared copy first, then one voice per kind. */
  const SITES = {
    en: {
      signin: 'Sign in', logos: ['Acme', 'Globex', 'Initech', 'Hooli', 'Vandelay'],
      feats: [['Lightning fast', 'Secure by design', 'Works everywhere'], ['AI insights', 'Real-time sync', '24/7 support'], ['Smart automation', 'Easy integrations', 'Built to scale']],
      stats: [['99.9%', 'uptime'], ['10x', 'faster'], ['2M+', 'users']],
      quote: ['“We set it up in an afternoon and never looked back.”', 'Sarah K.', 'Head of Ops'],
      kinds: {
        dash: { brand: 'Nexora', badge: '✦ New · AI 2.0 is here', head: 'Build faster|with AI', sub: 'The all-in-one platform to streamline your business and grow faster.', cta: 'Get started', alt: 'Watch demo', links: ['Product', 'Pricing', 'Docs', 'Blog'], trust: 'Trusted by 10,000+ teams', kpis: [['12.4k', '+24%'], ['$84k', '+8%'], ['98%', '+2%']] },
        shop: { brand: 'Maison Lumi', badge: 'Spring drop · Free shipping', head: 'Everyday pieces,|made to last', sub: 'Thoughtfully designed essentials in natural fabrics.', cta: 'Shop now', alt: 'See the lookbook', links: ['New in', 'Women', 'Men', 'Sale'], trust: 'Free returns within 30 days', cart: 'Cart · 2', products: [['Linen shirt', '$68'], ['Canvas tote', '$42'], ['Wool cap', '$36']], perks: ['Free shipping', '30-day returns', 'Secure checkout'], add: 'Add' },
        chat: { brand: 'Replyly', badge: 'Powered by GPT', head: 'Answer every customer|in seconds', sub: 'An AI assistant trained on your help center, live in one click.', cta: 'Try it free', alt: 'Book a demo', links: ['Features', 'Pricing', 'Docs'], trust: 'No credit card required', name: 'Assistant', status: 'Online', msgs: [['Hi! How can I help you today?', 0], ['Where is my order #4821?', 1], ['It shipped this morning and arrives Friday 🎉', 0]], placeholder: 'Ask anything…' },
        chart: { brand: 'Metrix', badge: 'Analytics 3.0', head: 'See what actually|moves revenue', sub: 'Every metric, every team, one source of truth.', cta: 'Start free trial', alt: 'View live demo', links: ['Product', 'Customers', 'Pricing'], trust: 'SOC 2 · GDPR · ISO 27001', legend: ['Revenue', 'Churn'], period: 'Last 30 days', total: '$248,920' },
        phone: { brand: 'Pocket', badge: '#1 finance app', head: 'Your money,|finally simple', sub: 'Budgets, savings and cards in one calm place.', cta: 'Download the app', alt: 'Learn more', links: ['Features', 'Security', 'Help'], trust: '4.9 ★ on the App Store', balance: '$12,480.20', balanceLabel: 'Total balance', rows: [['Groceries', '-$42.10'], ['Salary', '+$3,200'], ['Coffee', '-$4.50']], send: 'Send money' },
        redo: { eyebrow: 'Banking, without the noise', head: 'Know where|every euro goes.', sub: 'One account, one card and a clear view of your month. No fees you didn’t ask for.', cta: 'Open an account', alt: 'See how it works', fact: 'No hidden fees. Your card, blocked in one tap.', links: ['Product', 'Cards', 'Savings', 'Help'], balance: 'Balance', amount: '€4,218.40', delta: '+€3,200 this week', cats: [['Groceries', '€312'], ['Transport', '€64'], ['Eating out', '€128']], holder: 'SARAH KOVACS', toast: ['Salary received', '+€3,200.00 · just now'], feats: [['Deposits protected', 'Up to €100,000, by law.'], ['Instant transfers', 'To anyone, in seconds.'], ['Spending sorted', 'Every purchase in its place.']], tag: 'New · Savings pots', ledger: [['€100k', 'deposits protected'], ['10 s', 'to send money'], ['€0', 'hidden fees']], note: 'your month,|at a glance' },
        kanban: { brand: 'Taskflow', badge: 'Now with AI planning', head: 'Plan the work,|skip the chaos', sub: 'Boards, timelines and docs for teams that ship.', cta: 'Get started free', alt: 'Watch the video', links: ['Product', 'Solutions', 'Pricing', 'Changelog'], trust: 'Loved by 4,000+ teams', cols: [['To do', 3], ['In progress', 2], ['Done', 4]] },
      },
    },
    fr: {
      signin: 'Connexion', logos: ['Acme', 'Globex', 'Initech', 'Hooli', 'Vandelay'],
      feats: [['Ultra rapide', 'Sécurisé par design', 'Partout avec vous'], ['Insights IA', 'Synchro en temps réel', 'Support 24/7'], ['Automatisation', 'Intégrations faciles', 'Conçu pour grandir']],
      stats: [['99,9 %', 'disponibilité'], ['10x', 'plus rapide'], ['2M+', 'utilisateurs']],
      quote: ['« Installé en une après-midi, et on n’est jamais revenus en arrière. »', 'Sarah K.', 'Directrice des opérations'],
      kinds: {
        dash: { brand: 'Nexora', badge: '✦ Nouveau · IA 2.0', head: 'Construisez plus vite|avec l’IA', sub: 'La plateforme tout-en-un pour simplifier votre activité et grandir plus vite.', cta: 'Commencer', alt: 'Voir la démo', links: ['Produit', 'Tarifs', 'Docs', 'Blog'], trust: 'Adopté par plus de 10 000 équipes', kpis: [['12,4k', '+24 %'], ['84 k€', '+8 %'], ['98 %', '+2 %']] },
        shop: { brand: 'Maison Lumi', badge: 'Collection printemps · Livraison offerte', head: 'Des pièces du quotidien,|faites pour durer', sub: 'Des essentiels pensés avec soin, en matières naturelles.', cta: 'Découvrir', alt: 'Voir le lookbook', links: ['Nouveautés', 'Femme', 'Homme', 'Soldes'], trust: 'Retours gratuits sous 30 jours', cart: 'Panier · 2', products: [['Chemise en lin', '68 €'], ['Tote en toile', '42 €'], ['Bonnet en laine', '36 €']], perks: ['Livraison offerte', 'Retours 30 jours', 'Paiement sécurisé'], add: 'Ajouter' },
        chat: { brand: 'Replyly', badge: 'Propulsé par GPT', head: 'Répondez à chaque client|en quelques secondes', sub: 'Un assistant IA entraîné sur votre centre d’aide, en ligne en un clic.', cta: 'Essayer gratuitement', alt: 'Réserver une démo', links: ['Fonctions', 'Tarifs', 'Docs'], trust: 'Sans carte bancaire', name: 'Assistant', status: 'En ligne', msgs: [['Bonjour ! Comment puis-je vous aider ?', 0], ['Où en est ma commande #4821 ?', 1], ['Expédiée ce matin, livrée vendredi 🎉', 0]], placeholder: 'Posez votre question…' },
        chart: { brand: 'Metrix', badge: 'Analytics 3.0', head: 'Voyez ce qui fait|vraiment bouger le CA', sub: 'Chaque métrique, chaque équipe, une seule source de vérité.', cta: 'Essai gratuit', alt: 'Voir la démo', links: ['Produit', 'Clients', 'Tarifs'], trust: 'SOC 2 · RGPD · ISO 27001', legend: ['Revenu', 'Churn'], period: '30 derniers jours', total: '248 920 €' },
        phone: { brand: 'Pocket', badge: 'App finance n°1', head: 'Votre argent,|enfin simple', sub: 'Budgets, épargne et cartes dans un seul endroit calme.', cta: 'Télécharger l’app', alt: 'En savoir plus', links: ['Fonctions', 'Sécurité', 'Aide'], trust: '4,9 ★ sur l’App Store', balance: '12 480,20 €', balanceLabel: 'Solde total', rows: [['Courses', '-42,10 €'], ['Salaire', '+3 200 €'], ['Café', '-4,50 €']], send: 'Envoyer' },
        redo: { eyebrow: 'La banque, sans le bruit', head: 'Sachez où va|chaque euro.', sub: 'Un compte, une carte et une vue claire de votre mois. Aucun frais que vous n’avez pas demandé.', cta: 'Ouvrir un compte', alt: 'Voir comment ça marche', fact: 'Aucun frais caché. Votre carte, bloquée en un geste.', links: ['Produit', 'Cartes', 'Épargne', 'Aide'], balance: 'Solde', amount: '4 218,40 €', delta: '+3 200 € cette semaine', cats: [['Courses', '312 €'], ['Transports', '64 €'], ['Restaurants', '128 €']], holder: 'SARAH KOVACS', toast: ['Salaire reçu', '+3 200,00 € · à l’instant'], feats: [['Dépôts protégés', 'Jusqu’à 100 000 €, par la loi.'], ['Virements instantanés', 'À n’importe qui, en secondes.'], ['Dépenses classées', 'Chaque achat à sa place.']], tag: 'Nouveau · Cagnottes', ledger: [['100 k€', 'dépôts protégés'], ['10 s', 'pour envoyer'], ['0 €', 'frais cachés']], note: 'votre mois,|d’un coup d’œil' },
        kanban: { brand: 'Taskflow', badge: 'Avec planification IA', head: 'Planifiez le travail,|sans le chaos', sub: 'Tableaux, plannings et docs pour les équipes qui livrent.', cta: 'Commencer gratuitement', alt: 'Voir la vidéo', links: ['Produit', 'Solutions', 'Tarifs', 'Nouveautés'], trust: 'Adopté par plus de 4 000 équipes', cols: [['À faire', 3], ['En cours', 2], ['Terminé', 4]] },
      },
    },
  };
  /* One of them is painted into this page in miniature: the real hero poster, the aurora line, the rail, the fox and the checks. */
  function renderTiles() {
    const host = $('tiles');
    if (!host) return;
    const small = window.innerWidth <= 720;
    const KINDS = small ? ['dash', 'shop', 'chat', 'phone'] : ['dash', 'shop', 'chat', 'chart', 'phone', 'kanban'];
    const HUES = { dash: 262, shop: 18, chat: 172, chart: 212, phone: 332, kanban: 138 };
    const count = KINDS.length;
    const chosen = small ? 3 : 4;
    const site = trDeep(SITES[lang] || SITES.en);
    const bars = (seed) => Array.from({ length: 9 }, (_, k) => '<i style="--v:' + (0.25 + ((seed * 7 + k * 13) % 11) / 14).toFixed(2) + '"></i>').join('');
    const feats = (names) => '<div class="t-feats">' + names.map((n) => '<div><i class="t-ico"></i><b>' + esc(n) + '</b><s></s><s></s></div>').join('') + '</div>';
    const logos = '<div class="t-logos">' + site.logos.map((l) => '<span>' + esc(l) + '</span>').join('') + '</div>';
    const stats = '<div class="t-stats">' + site.stats.map((k) => '<div><b>' + esc(k[0]) + '</b><span>' + esc(k[1]) + '</span></div>').join('') + '</div>';
    const quote = '<div class="t-quote"><p>' + esc(site.quote[0]) + '</p><span><i></i><b>' + esc(site.quote[1]) + '</b> · ' + esc(site.quote[2]) + '</span></div>';
    const art = {
      dash: (c, i) => '<div class="t-art"><div class="t-blob"></div><div class="t-app"><div class="t-side"><i></i><i></i><i></i><i></i><i></i></div><div class="t-main"><div class="t-kpis">' + c.kpis.map((k) => '<div><b>' + esc(k[0]) + '</b><s>' + esc(k[1]) + '</s></div>').join('') + '</div><div class="t-chart">' + bars(i) + '</div></div></div></div>',
      shop: (c) => '<div class="t-shelf">' + c.products.map((p, k) => '<div class="t-prod"><i class="t-img p' + k + '"></i><b>' + esc(p[0]) + '</b><span>' + esc(p[1]) + '</span><em>' + esc(c.add) + '</em></div>').join('') + '</div>',
      chat: (c) => '<div class="t-convo"><div class="t-chat-h"><i></i><b>' + esc(c.name) + '</b><s>' + esc(c.status) + '</s></div><div class="t-msgs">' + c.msgs.map((m) => '<p class="m' + m[1] + '">' + esc(m[0]) + '</p>').join('') + '<p class="m0 typing"><i></i><i></i><i></i></p></div><div class="t-input"><span>' + esc(c.placeholder) + '</span><i></i></div></div>',
      chart: (c, i) => '<div class="t-chartbox"><div class="t-chart-h"><div><small>' + esc(c.period) + '</small><b>' + esc(c.total) + '</b></div><div class="t-legend"><span><i></i>' + esc(c.legend[0]) + '</span><span><i class="b"></i>' + esc(c.legend[1]) + '</span></div></div>'
        + '<svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="tg' + i + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--g1);stop-opacity:.45"/><stop offset="1" style="stop-color:var(--g1);stop-opacity:0"/></linearGradient></defs>'
        + '<path class="area" fill="url(#tg' + i + ')" d="M0,30 C10,28 14,22 22,24 S36,14 46,16 S60,8 70,10 S86,4 100,6 L100,40 L0,40 Z"/><path class="line" d="M0,30 C10,28 14,22 22,24 S36,14 46,16 S60,8 70,10 S86,4 100,6"/><path class="line b" d="M0,22 C12,24 20,30 32,28 S50,32 62,30 S80,34 100,33"/></svg></div>',
      phone: (c) => '<div class="t-device"><i class="t-notch"></i><div class="t-screen"><small>' + esc(c.balanceLabel) + '</small><b>' + esc(c.balance) + '</b><div class="t-rows">' + c.rows.map((r) => '<div><i></i><span>' + esc(r[0]) + '</span><s>' + esc(r[1]) + '</s></div>').join('') + '</div><em>' + esc(c.send) + '</em></div></div>',
      kanban: (c) => '<div class="t-board">' + c.cols.map((col, k) => '<div class="t-col"><b>' + esc(col[0]) + '<s>' + col[1] + '</s></b>' + Array.from({ length: col[1] }, (_, n) => '<i class="c' + ((k + n) % 3) + '"></i>').join('') + '</div>').join('') + '</div>',
    };
    const below = {
      dash: () => logos + feats(site.feats[0]),
      shop: (c) => '<div class="t-perks">' + c.perks.map((p) => '<span>✓ ' + esc(p) + '</span>').join('') + '</div>' + feats(site.feats[2]),
      chat: () => feats(site.feats[1]) + stats,
      chart: () => stats + feats(site.feats[0]),
      phone: () => quote + stats,
      kanban: () => logos + feats(site.feats[2]),
    };
    let html = '';
    for (let i = 0; i < count; i++) {
      const kind = KINDS[i];
      const c = site.kinds[kind];
      const [h1, h2] = c.head.split('|');
      const right = kind === 'shop' ? '<u class="t-cart">' + esc(c.cart) + '</u>' : '<u>' + esc(site.signin) + '</u>';
      const generic = '<div class="t-nav"><b><i class="t-logo"></i>' + esc(c.brand) + '</b><span>' + c.links.map((l) => '<i>' + esc(l) + '</i>').join('') + '</span>' + right + '<em>' + esc(c.cta) + '</em></div>'
        + '<div class="t-hero"><div class="t-copy"><small>' + esc(c.badge) + '</small><h4>' + esc(h1) + ' <span>' + esc(h2 || '') + '</span></h4><p>' + esc(c.sub) + '</p>'
        + '<div class="t-cta"><em>' + esc(c.cta) + '</em><i>' + esc(c.alt) + '</i></div>'
        + '<div class="t-social"><span class="t-avs"><i></i><i></i><i></i><i></i></span><span class="t-stars">★★★★★</span><b>' + esc(c.trust) + '</b></div></div>'
        + art[kind](c, i) + '</div>' + below[kind](c);
      if (i === chosen) {
        const r = site.kinds.redo;
        const [rh1, rh2] = r.head.split('|');
        const ICON = {
          check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4L19 6"/></svg>',
          nfc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 8.5a6 6 0 0 1 0 7"/><path d="M9.5 6a9.5 9.5 0 0 1 0 12"/><path d="M13 3.5a13 13 0 0 1 0 17"/></svg>',
        };
        // "every euro" goes italic serif over a hand-laid marker stroke; the last word stays roman when the line has 3+ words.
        const words = String(rh2 || '').split(' ');
        const emTxt = words.length > 2 ? words.slice(0, -1).join(' ') : words.join(' ');
        const rest = words.length > 2 ? ' ' + words[words.length - 1] : '';
        const [n1, n2] = String(r.note || '').split('|');
        const paint = '<div class="tile-paint r-pocket">'
          + '<div class="r-nav"><b class="r-logo"><i aria-hidden="true"></i>pocket</b><span class="r-tag"><i class="r-dot" aria-hidden="true"></i>' + esc(r.tag) + '</span><span class="r-links">' + r.links.map((l) => '<i>' + esc(l) + '</i>').join('') + '</span><em>' + esc(r.cta) + '</em></div>'
          + '<div class="r-hero"><div class="r-copy">'
          + '<small><i aria-hidden="true"></i>' + esc(r.eyebrow) + '</small>'
          + '<h4>' + esc(rh1) + '<br><em>' + esc(emTxt) + '<svg class="r-swash" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true"><path d="M3,9 C18,5 34,10 52,7 S82,4 97,8"/></svg></em>' + esc(rest) + '</h4>'
          + '<p>' + esc(r.sub) + '</p>'
          + '<div class="r-cta"><em>' + esc(r.cta) + '</em><i>' + esc(r.alt) + '<span aria-hidden="true">→</span></i></div>'
          + '<div class="r-fact"><i aria-hidden="true"></i>' + esc(r.fact) + '</div></div>'
          + '<div class="r-scene"><div class="r-arch" aria-hidden="true"><svg class="r-cloud r-cloud--a" viewBox="0 0 120 60" aria-hidden="true"><ellipse class="rc-shade" cx="60" cy="47" rx="44" ry="9"/><g class="rc-body"><ellipse cx="34" cy="40" rx="20" ry="13"/><ellipse cx="60" cy="31" rx="24" ry="19"/><ellipse cx="86" cy="39" rx="20" ry="14"/><rect x="18" y="38" width="86" height="14" rx="7"/></g><ellipse class="rc-light" cx="54" cy="24" rx="12" ry="8"/></svg><svg class="r-cloud r-cloud--b" viewBox="0 0 120 60" aria-hidden="true"><ellipse class="rc-shade" cx="60" cy="47" rx="44" ry="9"/><g class="rc-body"><ellipse cx="34" cy="40" rx="20" ry="13"/><ellipse cx="60" cy="31" rx="24" ry="19"/><ellipse cx="86" cy="39" rx="20" ry="14"/><rect x="18" y="38" width="86" height="14" rx="7"/></g><ellipse class="rc-light" cx="54" cy="24" rx="12" ry="8"/></svg></div><div class="r-device">'
          // A real hand and phone (Unsplash photo by Jakub Żerdzicki, cut out, screen left transparent);
          // the HTML screen sits behind the photo, mapped onto the screen's four corners (see fitPocket).
          + '<div class="r-screen">'
          + '<div class="r-status"><b>9:41</b><span class="r-sig"><i></i><i></i><i></i><i></i></span><span class="r-batt"></span></div>'
          + '<div class="r-app"><b>pocket<i>.</i></b><img src="/images/redo-face.jpg" alt="" loading="lazy" decoding="async"></div>'
          + '<div class="r-bal"><small>' + esc(r.balance) + '</small><b>' + esc(r.amount) + '</b><s>' + esc(r.delta) + '</s></div>'
          + '<svg class="r-chart" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="M0,30 C8,29 14,26 22,25 S36,27 44,22 S58,12 68,13 S84,8 100,5 L100,36 L0,36 Z"/><path class="l" d="M0,30 C8,29 14,26 22,25 S36,27 44,22 S58,12 68,13 S84,8 100,5"/><circle class="d" cx="100" cy="5" r="1.8"/></svg>'
          + '<div class="r-cats">' + r.cats.map((cat, k) => '<span><i class="c' + k + '"></i>' + esc(cat[0]) + '<b>' + esc(cat[1]) + '</b></span>').join('') + '</div>'
          + '<div class="r-tabs"><i class="on"></i><i></i><i></i><i></i></div>'
          + '</div>'
          + '<img class="r-hand-photo" src="/images/agence-pocket-hand.webp" alt="" width="1000" height="931" loading="lazy" decoding="async">'
          + '</div>'
          + (n1 ? '<div class="r-note" aria-hidden="true"><span>' + esc(n1) + '<br>' + esc(n2 || '') + '</span><svg viewBox="0 0 110 60"><path d="M4,10 C40,0 78,8 100,44"/><path d="M90,40 L100,45 L103,34"/></svg></div>' : '')
          + '<div class="r-card"><i class="r-chip"></i><span class="r-nfc">' + ICON.nfc + '</span><b>•••• 4821</b><span class="r-holder">' + esc(r.holder) + '</span><em>pocket.</em></div>'
          + '<div class="r-toast"><i>' + ICON.check + '</i><div><b>' + esc(r.toast[0]) + '</b><span>' + esc(r.toast[1]) + '</span></div></div>'
          + '</div></div>'
          + '<div class="r-ledger">' + (r.ledger || []).map((l) => '<div><b>' + esc(l[0]) + '</b><span>' + esc(l[1]) + '</span></div>').join('') + '</div>'
          + '</div>';
        html += '<div class="tile is-chosen k-' + kind + '" style="--h:' + HUES[kind] + '">' + generic + paint + '</div>';
      } else {
        html += '<div class="tile k-' + kind + '" style="--h:' + HUES[kind] + '">' + generic + '</div>';
      }
    }
    host.innerHTML = html;
    host.dataset.size = String(count);
    fitPocket();
    sameTiles = Array.from(host.children);
    // Fog order: deterministic shuffle so the fog rolls in unevenly, not row by row.
    sameOrder = sameTiles.map((_, i) => ((i * 5 + 3) % count));
  }

  /* One flat mark per objective, the same language as the package icons: one colour, no outline, no extrusion. */
  const HP_MARK = {
    bmw: '<svg viewBox="0 0 64 48" aria-hidden="true" focusable="false"><rect x="2" y="26" width="36" height="15" rx="7.5" fill="#6edcb8"/><rect x="10" y="32" width="14" height="2.6" rx="1.3" fill="#f3f1f7"/><path fill="#f3f1f7" d="M21 29.5v9.36l2.39-2.39 2.91 5.82 1.88-.93-2.92-5.83H31.4z"/></svg>',
    shiseido: '<svg viewBox="0 0 64 48" aria-hidden="true" focusable="false"><rect x="8" y="14" width="44" height="26" rx="7" fill="#f3f1f7"/><path d="M8 21a7 7 0 0 1 7-7h30a7 7 0 0 1 7 7v3H8z" fill="#f28eb4"/><rect x="16" y="30" width="16" height="3" rx="1.5" fill="#15190f" fill-opacity=".14"/><circle cx="50" cy="12" r="8" fill="#f3f1f7"/><circle cx="50" cy="12" r="6.2" fill="#1877F2"/><path d="M46.6 12.2l2.2 2.2 4.4-4.6" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sg: '<svg viewBox="0 0 64 48" aria-hidden="true" focusable="false"><rect x="8" y="30" width="12" height="10" rx="3" fill="#f2c85e" fill-opacity=".4"/><rect x="26" y="20" width="12" height="20" rx="3" fill="#f2c85e" fill-opacity=".7"/><rect x="44" y="8" width="12" height="32" rx="3" fill="#f2c85e"/></svg>',
  };
  /* The proof strip under the hero buttons: the client's objective on each project (PROOF), then the entry price.
     No percentages here. Those stay on #proof, lower on the page. */
  function renderHeroProof() {
    const host = $('hero-proof');
    if (!host) return;
    const one = (OFFERS.offers || []).filter((o) => o.cadence !== 'month' && Number(o.price) > 0).sort((a, b) => Number(a.price) - Number(b.price))[0];
    const low = one ? Number(one.price) : 0;
    const total = PROOF.length + (low ? 1 : 0);
    const items = PROOF.map((p, i) => `<li style="--i:${i}"><button type="button" class="hp-item" data-i="${i}" aria-expanded="false" aria-controls="hp-panel"><span class="hp-mark" aria-hidden="true">${HP_MARK[p.caseId] || ''}</span><strong>${esc(t(`hp_g${i + 1}`))}</strong><i class="hp-bar" aria-hidden="true"></i></button></li>`);
    if (low) items.push(`<li class="hp-from" style="--i:${PROOF.length}"><button type="button" class="hp-item" data-i="${PROOF.length}" aria-expanded="false" aria-controls="hp-panel"><strong><small>${esc(t('hp_from'))}</small> ${esc(price(low))}</strong><i class="hp-bar" aria-hidden="true"></i></button></li>`);
    // the second level: one block per figure, stacked in one grid cell so the panel keeps the height of the tallest
    const blocks = PROOF.map((p) => {
      const n = p.n;
      const pkg = String(t('proof_link') || '').replace('{offer}', t(`proof_${n}_offer`)).replace(/\s*→\s*$/, '');
      return `<div class="hpd"><p class="hpd-kick"><b>${esc(t(`proof_${n}_name`))}</b> · ${esc(t(`proof_${n}_kicker`))}</p>
        <p class="hpd-do">${esc(t(`proof_${n}_done`))}</p>
        <p class="hpd-src">${esc(t('hp_src'))}</p>
        <p class="hpd-foot"><a class="link-arrow" href="#pricing" data-pick-offer="${esc(p.offer || 'refonte')}"><span>${esc(pkg)}</span><span aria-hidden="true">→</span></a><a class="link-arrow" href="/agence/showcase"><span>${esc(t('s_all_work'))}</span><span aria-hidden="true">→</span></a></p></div>`;
    });
    if (low) {
      const name = pick(one.name) || t('proof_1_offer');
      blocks.push(`<div class="hpd"><p class="hpd-kick"><b>${esc(name)}</b> · ${esc(price(low))}</p>
        <dl class="hpd-facts"><div><dt>${esc(t('hp_d_pages'))}</dt><dd>${esc(pick(one.pages) || '')}</dd></div><div><dt>${esc(t('hp_d_delivery'))}</dt><dd>${esc(pick(one.delivery) || '')}</dd></div><div><dt>${esc(t('hp_d_rev'))}</dt><dd>${esc(pick(one.revisions) || '')}</dd></div></dl>
        <p class="hpd-do">${esc(t('hp_d_scope'))}</p>
        <p class="hpd-foot"><a class="link-arrow" href="#pricing" data-pick-offer="${esc(one.id || 'refonte')}"><span>${esc(t('hero_cta_primary'))}</span><span aria-hidden="true">→</span></a></p></div>`);
    }
    host.innerHTML = `<div class="hp-wrap"><ul class="hp-list" role="list" style="--n:${total}">${items.join('')}</ul>
      <div class="hp-panel" id="hp-panel" role="region" aria-label="${esc(t('hp_panel_aria'))}" inert>${blocks.join('')}</div></div>`;
    hpOpen = -1; hpPinned = -1;
    hpBind(host);
  }

  /* The second level of the strip: hover (mouse) or tap/Enter opens a figure's detail in a panel under the strip. The
     panel floats over the lines below it, so the headline above never moves. Tapping the open figure closes it, as do
     Esc, a tap elsewhere and scrolling; a click pins it so the pointer can leave. Left and Right move between figures. */
  let hpOpen = -1;
  let hpPinned = -1;
  let hpTimer = 0;
  function hpSet(i) {
    const host = $('hero-proof');
    if (!host) return;
    clearTimeout(hpTimer);
    const items = host.querySelectorAll('.hp-item');
    const blocks = host.querySelectorAll('.hpd');
    const wrap = host.querySelector('.hp-wrap');
    const panel = host.querySelector('.hp-panel');
    if (i >= items.length) i = -1;
    hpOpen = i;
    if (i < 0) hpPinned = -1;
    items.forEach((b, k) => b.setAttribute('aria-expanded', k === i ? 'true' : 'false'));
    blocks.forEach((b, k) => b.classList.toggle('is-on', k === i));
    host.classList.toggle('is-open', i >= 0);
    if (i >= 0 && wrap) {
      const r = items[i].getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      wrap.style.setProperty('--ax', Math.round(r.left - w.left + Math.min(r.width, 90) / 2) + 'px');
    }
    if (panel) panel.inert = i < 0;
  }
  function hpBind(host) {
    if (host.dataset.bound === '1') return;
    host.dataset.bound = '1';
    const idx = (el) => Number(el.dataset.i);
    host.addEventListener('pointerover', (e) => {
      const b = e.target.closest && e.target.closest('.hp-item');
      if (!b || e.pointerType !== 'mouse' || hpPinned >= 0) return;
      clearTimeout(hpTimer);
      hpTimer = setTimeout(() => hpSet(idx(b)), hpOpen >= 0 ? 0 : 90);
    });
    host.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || hpPinned >= 0) return;
      clearTimeout(hpTimer);
      hpTimer = setTimeout(() => hpSet(-1), 220);
    });
    host.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') clearTimeout(hpTimer); });
    host.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.hp-item');
      if (!b) { if (e.target.closest && e.target.closest('.hp-panel a')) hpSet(-1); return; }
      const i = idx(b);
      if (hpOpen === i && hpPinned === i) { hpSet(-1); return; }
      hpSet(i);
      hpPinned = i;
    });
    host.addEventListener('keydown', (e) => {
      const items = Array.from(host.querySelectorAll('.hp-item'));
      const cur = items.indexOf(d.activeElement);
      if (e.key === 'Escape' && hpOpen >= 0) {
        e.preventDefault();
        const keep = items[hpOpen];
        hpSet(-1);
        if (keep) keep.focus();
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && cur >= 0) {
        e.preventDefault();
        const next = items[(cur + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
        next.focus();
        if (hpOpen >= 0) { hpSet(idx(next)); hpPinned = idx(next); }
      }
    });
    d.addEventListener('click', (e) => { if (hpOpen >= 0 && !host.contains(e.target)) hpSet(-1); });
    window.addEventListener('scroll', () => { if (hpOpen >= 0 && window.scrollY > 60) hpSet(-1); }, { passive: true });
  }

  /* The proof, without screenshots (2026-10-26): what people come for is what moved, what was done and how.
     Results: the three reported figures, one per project (PROOF, copy in proof_N_*). Actions: what we do on a
     page, from the package process. Methods: how we decide, each with the project or rule it comes from. The
     interfaces (#reel) and the logos (#brands) follow. Nothing here is invented: every line is already a claim of
     the process copy, the checks or a project's own data. */
  /* The days of the five-day process each action lives on (Day 1 call and look, Day 2 direction, Days 3 to 5 build and check),
     and one drawn glyph per method: evidence (bars under a lens), test and test again (a loop), AI for speed and a human for the finish (a spark and a pen). */
  const PF_DAYS = [[1, 1], [1, 1], [2, 2], [3, 5]];
  const PF_GLYPHS = [
    '<svg viewBox="0 0 48 48"><g class="g-stroke"><path pathLength="1" d="M8 40V28M18 40V20M28 40V31"/><circle pathLength="1" cx="33" cy="17" r="8"/><path pathLength="1" d="M39 23l6 6"/></g><circle class="g-acc" cx="33" cy="17" r="3"/></svg>',
    '<svg viewBox="0 0 48 48"><g class="g-stroke"><path pathLength="1" d="M9 22a15 15 0 0 1 27-8"/><path pathLength="1" d="M36 6v8h-8"/><path pathLength="1" d="M39 26a15 15 0 0 1-27 8"/><path pathLength="1" d="M12 42v-8h8"/></g><circle class="g-acc" cx="24" cy="24" r="3"/></svg>',
    '<svg viewBox="0 0 48 48"><g class="g-stroke"><path pathLength="1" d="M17 8c1.4 6 3.4 8 9.4 9.4-6 1.4-8 3.4-9.4 9.4-1.4-6-3.4-8-9.4-9.4C13.6 16 15.6 14 17 8z"/><path pathLength="1" d="M27 41l14-14 4 4-14 14-6 2z"/></g><circle class="g-acc" cx="17" cy="17.4" r="2.6"/></svg>',
  ];
  function renderProof() {
    const host = $('pf');
    if (!host) return;
    const plus = '<i class="pf-plus" aria-hidden="true"></i>';
    const arrow = '<span aria-hidden="true">→</span>';
    // Results (2026-10-27, visual, second pass): a lead card (the strongest figure, AGENCY_PROOF lead) and two side cards.
    // Each stage shows the project's own screen on a lit floor with its name in a glass tag; the card carries the reported
    // figure and a before/after dumbbell. All three share one 100 to 125 scale (index, before = 100), so the three lengths compare.
    // Only the two reported numbers are drawn: nothing between them is invented, which is why it is a dumbbell and not a curve.
    const TINTS = [['rgba(110, 220, 184, .26)', 'rgba(110, 180, 239, .14)'], ['rgba(177, 141, 243, .3)', 'rgba(242, 142, 180, .16)'], ['rgba(242, 200, 94, .24)', 'rgba(242, 142, 180, .14)']];
    const res = PROOF.map((p, i) => ({ p, i })).sort((u, v) => (v.p.lead ? 1 : 0) - (u.p.lead ? 1 : 0)).map(({ p, i }, k) => {
      const n = p.n;
      const pkg = String(t('proof_link') || '').replace('{offer}', t(`proof_${n}_offer`)).replace(/\s*→\s*$/, '');
      const name = t(`proof_${n}_name`);
      const pct = Math.max(0, parseInt(String(t(`proof_${n}_stat`)).replace(/\D/g, ''), 10) || 0);
      const x = Math.min(100, (pct / 25) * 100);
      const tint = TINTS[i % TINTS.length];
      const flat = p.caseId === 'shiseido';
      return `<li class="pf-res${k === 0 ? ' is-lead' : ''}" style="--i:${k};--in:${reduced ? 1 : 0};--x:${x.toFixed(1)}%;--tint:${tint[0]};--tint2:${tint[1]};--zoom:${p.caseId === 'bmw' ? 1.3 : 1}">
        <figure class="pf-shot${flat ? ' is-flat' : ''}">
          <i class="pf-spot" aria-hidden="true"></i><i class="pf-floor" aria-hidden="true"></i>
          <img src="/images/${esc(p.image)}" alt="${esc(name)}, ${esc(t(`proof_${n}_kicker`))}" loading="lazy" decoding="async">
          <figcaption class="pf-tag"><b>${esc(name)}</b><span class="k"> · ${esc(t(`proof_${n}_kicker`))}</span></figcaption>
        </figure>
        <button type="button" class="pf-rb" aria-expanded="false" aria-controls="pf-r${n}">
          <span class="pf-fig"><strong>${esc(t(`proof_${n}_stat`))}</strong></span>
          <span class="pf-what">${esc(t(`proof_${n}_label`))}</span>
          <span class="pf-dumb" role="img" aria-label="${esc(fillVars(t('pf_dumb_aria'), { a: 100, b: 100 + pct }))}">
            <i class="pd-base"></i><i class="pd-line"></i><i class="pd-a"></i><i class="pd-b"></i>
            <em class="pd-la"><b>100</b>${esc(t('pf_before'))}</em><em class="pd-lb"><b>${100 + pct}</b>${esc(t('pf_after'))}</em><em class="pd-le">125</em>
          </span>${plus}
        </button>
        <div class="pf-more" id="pf-r${n}"><div class="pf-more-in"><p>${esc(t(`proof_${n}_done`))}</p><a class="link-arrow" href="#pricing" data-pick-offer="${esc(p.offer || 'refonte')}"><span>${esc(pkg)}</span>${arrow}</a></div></div>
      </li>`;
    }).join('');
    // Actions: the step, its day in the process, and the detail of what happens that day
    const actions = [1, 2, 3, 4].map((i) => `<li class="pf-item" style="--i:${i - 1};--in:${reduced ? 1 : 0}">
        <span class="pf-no" aria-hidden="true">${pad(i)}</span>
        <div class="pf-body">
          <h4><button type="button" class="pf-q" aria-expanded="false" aria-controls="pf-a${i}"><span class="pf-qt">${esc(t(`pf_a${i}_t`))}</span><span class="pf-day"><span class="sr-only">${esc(t(`pf_a${i}_day`))}</span><span class="pf-gauge" aria-hidden="true">${[1, 2, 3, 4, 5].map((dd) => `<i${dd >= PF_DAYS[i - 1][0] && dd <= PF_DAYS[i - 1][1] ? ' class="on"' : ''}>${dd}</i>`).join('')}</span></span>${plus}</button></h4>
          <p>${esc(t(`pf_a${i}_d`))}</p>
          <div class="pf-more" id="pf-a${i}"><div class="pf-more-in"><p>${esc(t(`pf_a${i}_x`))}</p></div></div>
        </div>
      </li>`).join('');
    // Methods: the rule, where it was proven, and the detail of that proof
    const methods = [1, 2, 3].map((i) => `<li class="pf-item pf-item--m" style="--i:${i - 1};--in:${reduced ? 1 : 0}">
        <span class="pf-glyph" aria-hidden="true">${PF_GLYPHS[i - 1]}</span>
        <div class="pf-body">
          <h4><button type="button" class="pf-q" aria-expanded="false" aria-controls="pf-m${i}"><span class="pf-qt">${esc(t(`pf_m${i}_t`))}</span>${plus}</button></h4>
          <p>${esc(t(`pf_m${i}_d`))}</p>
          <p class="pf-from">${esc(t(`pf_m${i}_p`))}</p>
          <div class="pf-more" id="pf-m${i}"><div class="pf-more-in"><p>${esc(t(`pf_m${i}_x`))}</p></div></div>
        </div>
      </li>`).join('');
    host.innerHTML = `<section class="pf-block" aria-labelledby="pf-h-res">
        <h3 class="pf-label" id="pf-h-res">${esc(t('pf_results'))}</h3>
        <ol class="pf-res-list">${res}</ol>
      </section>
      <div class="pf-cols">
        <section class="pf-block" aria-labelledby="pf-h-act">
          <h3 class="pf-label" id="pf-h-act">${esc(t('pf_actions'))}</h3>
          <p class="pf-lede">${esc(t('pf_actions_lede'))}</p>
          <ol class="pf-list">${actions}</ol>
        </section>
        <section class="pf-block" aria-labelledby="pf-h-met">
          <h3 class="pf-label" id="pf-h-met">${esc(t('pf_methods'))}</h3>
          <p class="pf-lede">${esc(t('pf_methods_lede'))}</p>
          <ul class="pf-list pf-list--m">${methods}</ul>
        </section>
      </div>`;
    if (!reduced) observeIn(host.querySelectorAll('.pf-res, .pf-item'));
    if (host.dataset.bound !== '1') {
      host.dataset.bound = '1';
      if (!reduced && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        // the screen leans a few degrees toward the pointer, and settles when it leaves
        host.addEventListener('pointermove', (e) => {
          const st = e.target.closest && e.target.closest('.pf-shot');
          if (!st) return;
          const r = st.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width - 0.5;
          const py = (e.clientY - r.top) / r.height - 0.5;
          st.style.setProperty('--ry', (px * 9).toFixed(2) + 'deg');
          st.style.setProperty('--rx', (-py * 7).toFixed(2) + 'deg');
        });
        host.addEventListener('pointerout', (e) => {
          const st = e.target.closest && e.target.closest('.pf-shot');
          if (st && !st.contains(e.relatedTarget)) { st.style.removeProperty('--ry'); st.style.removeProperty('--rx'); }
        });
      }
      // one handler for the three lists (the host stays when the language redraws its content)
      host.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('.pf-q, .pf-rb');
        if (!b) return;
        const box = b.closest('.pf-item, .pf-res');
        const open = !box.classList.contains('is-open');
        box.classList.toggle('is-open', open);
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
  }

  /* The ways to work with us (2026-10-19): a quiet list instead of four tiles. One row per offer: the drawn scene
     on its night tile, the package name and price on one line, the promise, then the real proof line. The home
     merges the two Redesign rows (one page or one flow); /agence/services (.page-stack) lists all four with the
     deliverables open. One link for the whole section, in its head. */
  function renderServices() {
    const host = $('svc-track');
    if (!host) return;
    const sec = host.closest('.services');
    const full = !!sec && sec.classList.contains('page-stack');
    const rows = full ? SERVICES : SERVICES.filter((s) => s.n !== 2 && !(HOME_PAGE && s.offer === HOME_HIDDEN_OFFER));
    host.innerHTML = rows.map((s) => {
      const n = s.n;
      /* "Redesign, flow option · $390": the label is the name, the price goes beside it */
      const kicker = String(t(`svc_${n}_kicker`) || '');
      const cut = kicker.lastIndexOf(' · ');
      const name = cut > 0 ? kicker.slice(0, cut) : kicker;
      const price = cut > 0 ? kicker.slice(cut + 3) : '';
      const scope = !full && n === 1 ? t('svc_1_scope') : '';
      const dels = [];
      if (full) for (let k = 1; k <= (s.deliverables || 0); k++) { const v = t(`svc_${n}_del_${k}`); if (v) dels.push(`<li>${esc(v)}</li>`); }
      const ev = t(`svc_${n}_evidence`);
      return `<li class="way" data-svc="${n}">
        <figure class="way-fig" aria-hidden="true">${SVC_ICONS[n] || ''}</figure>
        <div class="way-body">
          <h3 class="way-head"><span class="way-title">${esc(name)}</span>${price ? `<span class="way-price">${esc(price)}</span>` : ''}${scope ? `<span class="way-scope">${esc(scope)}</span>` : ''}${soonTag(s.offer)}</h3>
          <p class="way-promise">${esc(t(`svc_${n}_promise`))}</p>
          ${dels.length ? `<ul class="way-list">${dels.join('')}</ul>` : ''}
          ${ev ? `<p class="way-proof">${esc(ev)}</p>` : ''}
        </div>
      </li>`;
    }).join('');
    svcCards = Array.from(host.children);
    svcActive = -1;
  }

  /* One drawn glyph per check, 64 × 64: ink strokes, one accent in the cell's pigment (--c). Decorative: the
     cell's number and name say what the check is. */
  const CHECK_GLYPHS = {
    1: '<svg viewBox="0 0 64 64"><g class="g-stroke"><rect x="8" y="10" width="22" height="16" rx="3" stroke-dasharray="3 3"/><rect x="34" y="10" width="22" height="16" rx="3"/><path d="M49 18a4 4 0 1 1-4-4"/><rect x="8" y="38" width="22" height="16" rx="3"/><path d="M14 46l3.5 3.5L25 42"/><rect x="34" y="38" width="22" height="16" rx="3"/><path d="M42 43l6 6M48 43l-6 6"/></g><circle class="g-acc" cx="49" cy="14" r="2.2"/></svg>',
    2: '<svg viewBox="0 0 64 64"><g class="g-stroke"><rect x="8" y="22" width="48" height="20" rx="10"/><path d="M18 32h16M30 27l5 5-5 5"/></g><circle class="g-acc" cx="46" cy="32" r="3"/></svg>',
    3: '<svg viewBox="0 0 64 64"><g class="g-stroke"><path d="M10 16h24M10 27h46M10 38h38M10 49h18"/></g><rect class="g-acc" x="56" y="23" width="3" height="8" rx="1.5"/></svg>',
    4: '<svg viewBox="0 0 64 64"><g class="g-stroke"><rect x="18" y="6" width="28" height="52" rx="6"/><path d="M28 12h8"/><path class="g-acc-stroke" d="M24 48a12 12 0 0 1 16 0"/></g><circle class="g-acc" cx="32" cy="44" r="3"/></svg>',
    5: '<svg viewBox="0 0 64 64"><g class="g-stroke"><rect x="20" y="20" width="24" height="24" rx="5"/><path d="M27 32h10"/><rect class="g-acc-stroke" x="12" y="12" width="40" height="40" rx="10" stroke-dasharray="6 4"/></g></svg>',
    6: '<svg viewBox="0 0 64 64"><g class="g-stroke"><circle cx="32" cy="32" r="20"/></g><path class="g-fill" d="M32 12a20 20 0 0 1 0 40z"/><path class="g-acc" d="M32 12a20 20 0 0 0 0 40z" opacity=".45"/></svg>',
    7: '<svg viewBox="0 0 64 64"><g class="g-stroke"><path d="M10 14h18"/><rect x="10" y="20" width="44" height="14" rx="3"/><path d="M10 46h24"/></g><circle class="g-acc" cx="48" cy="27" r="3"/><rect class="g-acc" x="10" y="40" width="3" height="10" rx="1.5"/></svg>',
    8: '<svg viewBox="0 0 64 64"><g class="g-stroke"><path d="M10 54h44"/><rect x="12" y="42" width="8" height="12" rx="1.5"/><rect x="24" y="34" width="8" height="20" rx="1.5"/><rect x="36" y="24" width="8" height="30" rx="1.5"/></g><rect class="g-acc" x="48" y="12" width="8" height="42" rx="1.5"/></svg>',
    9: '<svg viewBox="0 0 64 64"><g class="g-stroke"><path d="M10 22h44M16 22l-6 14h12zM48 22l-6 14h12zM32 22v26M22 48h20"/></g><path class="g-acc" d="M26 14h12l-6 8z"/></svg>',
    10: '<svg viewBox="0 0 64 64"><g class="g-stroke"><path d="M8 42c10 0 10-20 20-20s10 20 20 20"/></g><rect class="g-acc" x="40" y="12" width="4" height="14" rx="1.5"/><rect class="g-acc" x="48" y="12" width="4" height="14" rx="1.5"/></svg>',
    11: '<svg viewBox="0 0 64 64"><g class="g-stroke"><rect x="8" y="12" width="48" height="40" rx="5"/><path d="M8 34h48M14 41h18M14 47h26"/></g><path class="g-acc" d="M14 29l8-9 8 7 6-5 10 7v5H14z"/></svg>',
    12: '<svg viewBox="0 0 64 64"><path class="g-acc" d="M32 10c2 11 5 14 16 16-11 2-14 5-16 16-2-11-5-14-16-16 11-2 14-5 16-16z" opacity=".6"/><g class="g-stroke"><path d="M14 50L50 14"/></g></svg>',
  };
  /* One small interface per check (2026-10-26): what the rule looks like once it is applied. Shown on the back of the
     cell with the rule under it (agence-story.css, "The 12 checks, shown in an interface"). Fictional product UI,
     decorative (aria-hidden), in English like the playground interfaces; the title and the rule carry the text. */
  const CHECK_DEMOS = {
    1: '<span class="d d1"><span class="hd"><b>Invoices</b><span class="seg"><span>Empty</span><span>Loading</span><span>Error</span><span>Done</span></span></span><span class="bd"><span class="st st-e"><i class="ic"></i><b>No invoices yet</b><span class="sm">Create one and get paid faster.</span><span class="bt">New invoice</span></span><span class="st st-l"><span class="lr"><i class="sk"></i><span class="ls"><i class="sk"></i><i class="sk"></i></span></span><span class="lr"><i class="sk"></i><span class="ls"><i class="sk"></i><i class="sk"></i></span></span><span class="lr"><i class="sk"></i><span class="ls"><i class="sk"></i><i class="sk"></i></span></span></span><span class="st st-x"><i class="ic"></i><b>Couldn’t load invoices</b><span class="sm">Check your connection.</span><span class="bt">Try again</span></span><span class="st st-o"><span class="rw"><i class="av">AS</i><b class="nm">Acme Studio</b><b class="am">$420</b><span class="pl">Paid</span></span><span class="rw"><i class="av">SN</i><b class="nm">Studio N</b><b class="am">$1,180</b><span class="pl">Paid</span></span><span class="rw"><i class="av">OL</i><b class="nm">Orbit Labs</b><b class="am">$760</b><span class="pl due">Due</span></span></span></span></span>',
    2: '<span class="d d2"><b class="ti">Get the brief</b><span class="fld"><span>Work email</span><span class="fl">you@company.com</span></span><span class="bt"><span class="was">Submit</span><span class="now">Send my brief</span></span><span class="nt"><i></i>We reply within one business day.</span></span>',
    3: '<span class="d d3"><span class="r"><i class="av">AL</i><span class="nm"><b>Ana Li</b></span><span class="am">$480</span></span><span class="r hot"><i class="av">JM</i><span class="nm"><b>Jean-Baptiste de Montmorency-Laval</b></span><span class="am">$12,480.00</span></span><span class="r"><i class="av">PN</i><span class="nm"><b>Priya N.</b></span><span class="am">$96</span></span><em class="tg">Longest name · longest price</em></span>',
    4: '<span class="d d4"><span class="ph"><i class="zone"></i><b>Cart</b><span class="it"><i></i><span class="ln"></span></span><span class="it"><i></i><span class="ln s"></span></span><span class="bt">Checkout</span></span><span class="lg"><span><i class="g"></i>Easy reach</span><span><i class="a"></i>Stretch</span><span><i class="r"></i>Hard</span></span><span class="br"><em>44 px tap target</em></span></span>',
    5: '<span class="d d5"><span class="hd"><b>Your details</b><span class="key">Tab</span></span><span class="f i1"><i class="n">1</i>Ada Lovelace</span><span class="f i2"><i class="n">2</i>ada@analytical.io</span><span class="bt i3"><i class="n">3</i>Continue</span></span>',
    6: '<span class="d d6"><span class="pr"><span class="sw bad"><b>Aa</b><em>2.3 : 1</em></span><span class="sw good"><b>Aa</b><em>8.6 : 1 · AA</em></span></span><span class="photo"><b>Spring sale</b><span class="bt">Shop now</span></span></span>',
    7: '<span class="d d7"><span class="lb">Email</span><span class="in"><span>hugo@studio</span><i class="cr"></i></span><span class="msg"><i class="wn">!</i><span>Add the part after the @, like name@company.com</span></span><span class="kb"><span class="kr"><i>q</i><i>w</i><i>e</i><i>r</i><i>t</i><i>y</i><i>u</i><i>i</i><i>o</i><i>p</i></span><span class="kr k2"><i class="hl">@</i><i class="sp">space</i><i class="hl">.</i><i class="hl">.com</i></span></span></span>',
    8: '<span class="d d8"><i class="gr"></i><span class="sp"><em>Spacing</em><span class="bars"><i style="--n:1"></i><i style="--n:2"></i><i style="--n:4"></i><i style="--n:6"></i><i style="--n:8"></i></span><em>4 8 16 24 32</em></span><span class="ty"><em>Type</em><span class="t1">Heading<em>28</em></span><span class="t2">Subhead<em>20</em></span><span class="t3">Body<em>16</em></span><span class="t4">Caption<em>12</em></span></span></span>',
    9: '<span class="d d9"><span class="im"><i class="pic"></i><i class="sk"></i><em>16 : 9 · reserved</em></span><b>Winter collection</b><span class="ln"></span><span class="ln s"></span></span>',
    10: '<span class="d d10"><span class="rw"><b>Reduce motion</b><span class="sw"><i class="kn"></i></span></span><span class="st"><i class="ball"></i></span><span class="nt"><i class="ok">✓</i><span>Animation stops. Actions still work.</span></span></span>',
    11: '<span class="d d11"><span class="bub"><span class="lk">yourbrand.com/redesign</span><span class="cd"><span class="im"><i class="sh"></i></span><span class="mt"><em>yourbrand.com</em><b>Redesign in 5 days, fixed price</b><span>Prices on the page, scope on the card.</span></span></span></span><span class="chips"><span class="chip"><i></i>Title</span><span class="chip"><i></i>Description</span><span class="chip"><i></i>Image</span></span></span>',
    12: '<span class="d d12"><span class="ly a"><span class="nv"><i></i><b>Nova</b><span>Features</span><span>Pricing</span><span class="bt">Get started</span></span><i class="orb"></i><h5>Unlock the power of AI</h5><span class="sm">Supercharge your workflow today.</span><span class="bt">Get started</span></span><span class="ly b"><span class="nv"><i></i><b>Maison Verde</b><span>Menu</span><span>Contact</span><span class="bt">Book a table</span></span><h5>Dinner, before the 6 pm rush</h5><span class="sm">Seats at 17:30 and 19:00 in Lyon.</span><span class="bt">Book a table</span><i class="plate"></i></span><i class="wp"></i></span>',
  };
  /* The 12 checks as a contact sheet (2026-10-19): twelve square cells on one paper sheet, each with its glyph,
     number and name. The brush stamps the cells in reading order as the sheet comes up (drawChecks); hover,
     focus or a tap turns a cell over to read the rule. Home and /agence/secret-touch share this. */
  function renderChecks() {
    const host = $('checks-list');
    if (!host) return;
    let html = '';
    for (let i = 1; i <= CHECKS; i++) {
      const c = CHECK_COLORS[(i - 1) % CHECK_COLORS.length];
      html += `<li class="ck" style="--c:${c}" data-i="${i - 1}">
        <button type="button" class="ck-btn" aria-expanded="false" aria-controls="ckd-${i}">
          <span class="ck-glyph" aria-hidden="true">${CHECK_GLYPHS[i] || ''}</span>
          <span class="ck-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="ck-tick" d="M5 12.6l4.3 4.3L19.2 7" pathLength="1"/></svg></span>
          <span class="ck-n">${pad(i)}</span>
          <span class="ck-title">${esc(t(`check_${i}_title`))}</span>
        </button>
        <div class="ck-desc" id="ckd-${i}">
          <span class="ck-demo" aria-hidden="true">${CHECK_DEMOS[i] || ''}</span>
          <p class="ck-rule"><b class="ck-rule-t"><span class="ck-desc-n" aria-hidden="true">${pad(i)}</span>${esc(t(`check_${i}_title`))}</b><span class="ck-rule-d">${esc(t(`check_${i}_desc`))}</span></p>
        </div>
      </li>`;
    }
    host.innerHTML = html;
    checkRows = Array.from(host.children);
    lastTally = -1;
    // The glyphs draw themselves when the brush stamps their cell: every stroke gets a normalised length (dashed
    // strokes keep their dashes), and the accent shapes pop in after the lines. The CSS only applies once marked.
    if (!reduced) {
      host.querySelectorAll('.ck-glyph').forEach((g) => {
        g.querySelectorAll('.g-stroke > :not([stroke-dasharray])').forEach((n) => n.setAttribute('pathLength', '1'));
        g.classList.add('is-draw');
      });
    }
    if (host.dataset.bound !== '1') {
      host.dataset.bound = '1';
      // arrow keys walk the grid, Esc folds an open cell back, a tap elsewhere does too
      host.addEventListener('keydown', (e) => {
        const keys = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 0, ArrowUp: 0 };
        if (e.key === 'Escape') {
          const open = checkRows.find((r) => r.classList.contains('is-open'));
          if (open) { e.preventDefault(); openCheck(open, false); const b = open.querySelector('.ck-btn'); if (b) b.focus(); }
          return;
        }
        if (!(e.key in keys)) return;
        const cur = checkRows.findIndex((r) => r.contains(d.activeElement));
        if (cur < 0) return;
        const cols = Math.max(1, getComputedStyle(host).gridTemplateColumns.split(' ').length);
        const step = e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : keys[e.key];
        const nxt = cur + step;
        if (nxt < 0 || nxt >= checkRows.length) return;
        e.preventDefault();
        const wasOpen = checkRows[cur].classList.contains('is-open');
        const b = checkRows[nxt].querySelector('.ck-btn');
        if (b) b.focus();
        if (wasOpen) openCheck(checkRows[nxt], true);
      });
      d.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('.ck')) return;
        const open = checkRows.find((r) => r.classList.contains('is-open'));
        if (open) openCheck(open, false);
      });
    }
  }

  /* One small stroke icon per "Included" line (offer.includes_icons, same order as includes; unknown or missing = check). */
  const INCL_ICONS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    call: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    page: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    devices: '<rect x="2" y="4" width="13" height="10" rx="2"/><path d="M5 18h7"/><rect x="17" y="8" width="5" height="12" rx="1.5"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    grid: '<path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 6h8M13 18h8"/>',
    notes: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>',
    map: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h5a4 4 0 0 0 0-8h-2a4 4 0 0 1 0-8h5"/>',
    ai: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    text: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
    video: '<path d="m22 8-6 4 6 4z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    sparkles: '<path d="m12 3 2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
    cancel: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    quote: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  };
  const inclIcon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${INCL_ICONS[k] || INCL_ICONS.check}</svg>`;
  const CALENDLY = typeof AGENCY_CALENDLY === 'string' ? AGENCY_CALENDLY : 'https://calendly.com/chilka-v/30min';
  /* "$390", "$90/month", "from $2,500" on the pricing cards. */
  function priceLine(o) {
    if (o.cadence === 'quote') return t('s_price_from') + ' ' + price(o.price);
    return price(o.price) + (o.cadence === 'month' ? t('price_month') : '');
  }
  /* The dialog tile shows the number only. A quote is "$2,500", never "from $2,500". */
  function pkgAmount(o) {
    if (!o || o.price == null || o.price === '') return '';
    return price(o.price) + (o.cadence === 'month' ? t('price_month') : '');
  }

  /* A package card, kept short (2026-10-18): who it is for, the price, the facts in one row (pages, delivery,
     rounds), the first lines of what is included, then ONE fold holding the rest, what is not included and how
     it is paid, and one action. The "or book a call" link lives once under the grid (pricing_unsure).
     Build carries two tracks: a switch picks the four lines that differ. Redesign and Build are ordered from
     the card (agence-checkout.js opens the order on [data-order]); coaching takes a waiting list; custom books a call. */
  const cardTrack = {};
  const INCL_SHOWN = 4;
  function trackLines(o, trackId) {
    const tr = (o.tracks || []).find((x) => x.id === trackId) || (o.tracks || [])[0];
    if (!tr) return '';
    const icons = Array.isArray(tr.includes_icons) ? tr.includes_icons : [];
    return (pick(tr.includes) || []).map((x, i) => `<li>${inclIcon(icons[i])}<span>${esc(tidy(x))}</span></li>`).join('');
  }
  function renderPricing() {
    const host = $('prices');
    if (!host) return;
    const pay = OFFERS.payment || {};
    // Monthly offers (coaching) are not a package: they get their own band under the grid (renderCoach).
    const packages = (OFFERS.offers || []).filter((o) => o.cadence !== 'month');
    host.style.setProperty('--cols', packages.length);
    host.innerHTML = packages.map((o, pi) => {
      const monthly = o.cadence === 'month';
      const quote = o.cadence === 'quote';
      const icons = Array.isArray(o.includes_icons) ? o.includes_icons : [];
      const all = (pick(o.includes) || []).map((x, i) => `<li>${inclIcon(icons[i])}<span>${esc(tidy(x))}</span></li>`);
      const tracks = Array.isArray(o.tracks) ? o.tracks : [];
      const trackId = tracks.length ? (cardTrack[o.id] || tracks[0].id) : '';
      const shown = tracks.length ? [] : all.slice(0, INCL_SHOWN);
      const folded = tracks.length ? all : all.slice(INCL_SHOWN);
      const excl = (pick(o.not_included) || []).map((x) => `<li>${esc(tidy(x))}</li>`).join('');
      const deliveryDetail = monthly ? pick(o.delivery_detail) : '';
      const pages = pick(o.pages);
      const cad = quote ? t('s_price_quote') : (monthly ? t('price_month') : t('price_oneoff'));
      const amount = quote ? `<small>${esc(t('s_price_from'))}</small>${esc(price(o.price))}` : esc(price(o.price));
      const soon = SOON.has(o.id);
      const payLine = pick(quote ? pay.quote : (monthly ? pay.month : pay.one_off));
      let cta;
      if (o.checkout === 'call' || quote) cta = `<a class="btn btn-ink price-cta" href="${esc(CALENDLY)}" target="_blank" rel="noopener noreferrer">${esc(pick(o.cta))}</a>`;
      else if (soon) cta = `<button type="button" class="btn btn-line price-cta" data-offer="${esc(o.id)}">${esc(pick(o.cta))}</button>`;
      else cta = `<button type="button" class="btn ${o.highlighted ? 'btn-primary' : 'btn-ink'} price-cta" data-order="${esc(o.id)}"${trackId ? ` data-track="${esc(trackId)}"` : ''}>${esc(pick(o.cta))}<span class="price-cta-amt">${esc(price(o.price))}</span></button>`;
      const switcher = tracks.length ? `<div class="price-tracks" role="radiogroup" aria-label="${esc(t('s_price_track'))}">
          ${tracks.map((tr) => `<button type="button" role="radio" class="price-track" data-card-track="${esc(o.id)}" data-track="${esc(tr.id)}" aria-checked="${tr.id === trackId ? 'true' : 'false'}" tabindex="${tr.id === trackId ? '0' : '-1'}">${esc(pick(tr.name))}</button>`).join('')}
        </div>
        <ul class="price-incl price-incl--track" data-track-list="${esc(o.id)}">${trackLines(o, trackId)}</ul>` : '';
      // One fold per card: the rest of "Included", then "Not included", then how it is paid.
      const foldLabel = folded.length
        ? fillVars(t(tracks.length ? 's_price_more_build' : 's_price_more'), { n: folded.length })
        : t('price_not_included');
      const foldBody = (folded.length ? `<ul class="price-incl">${folded.join('')}</ul>` : '')
        + (excl ? `<div class="price-excl">${folded.length ? `<p class="price-sub">${esc(t('price_not_included'))}</p>` : ''}<ul>${excl}</ul></div>` : '')
        + (payLine ? `<p class="price-pay">${esc(tidy(payLine))}</p>` : '');
      // The facts row: a value equal to the one before it ("Set in the quote" twice) is shown once.
      const delivery = pick(o.delivery);
      const revisions = monthly ? '' : pick(o.revisions);
      // What a revision round means is the second level of the "Revisions" cell: an info button opens the written detail under the facts.
      const revDetail = monthly ? '' : tidy(pick(o.revisions_detail) || '');
      const revInfo = revDetail ? `<button type="button" class="price-info" aria-expanded="false" aria-controls="px-${esc(o.id)}" aria-label="${esc(t('px_rev_info'))}"><i aria-hidden="true">i</i></button>` : '';
      const facts = [
        pages ? [t('s_price_pages'), esc(pages)] : null,
        [t('price_delivery'), esc(delivery) + (deliveryDetail ? `<small>${esc(tidy(deliveryDetail))}</small>` : '')],
        revisions && revisions !== delivery ? [t('price_revisions'), esc(revisions) + revInfo] : null,
      ].filter(Boolean);
      const hasRevInfo = !!revInfo && revisions !== delivery;
      return `<article class="price${o.highlighted ? ' is-featured' : ''}${quote ? ' is-quote' : ''}${soon ? ' is-soon' : ''}" data-card="${esc(o.id)}" style="--i:${pi};--in:${reduced ? 1 : 0}">
        <header class="price-top">
          <h3 class="price-name">${esc(pick(o.name))}${soonTag(o.id)}</h3>
          ${o.highlighted ? `<span class="price-tag">${esc(t('price_featured_tag'))}</span>` : ''}
        </header>
        <p class="price-for">${esc(tidy(pick(o.for)))}</p>
        <p class="price-amount"><strong>${amount}</strong><span class="price-cad">${esc(cad)}</span></p>
        <dl class="price-meta" style="--n:${facts.length}">
          ${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}
        </dl>
        ${hasRevInfo ? `<div class="px-more" id="px-${esc(o.id)}"><div class="px-more-in"><p>${esc(revDetail)}</p></div></div>` : ''}
        ${switcher}
        ${shown.length ? `<ul class="price-incl">${shown.join('')}</ul>` : ''}
        ${foldBody ? `<details class="price-more"><summary>${esc(foldLabel)}</summary>${foldBody}</details>` : ''}
        <div class="price-act">
          ${cta}
        </div>
      </article>`;
    }).join('');
    if (!reduced) observeIn(host.querySelectorAll('.price'));
    if (host.dataset.bound !== '1') {
      host.dataset.bound = '1';
      // the info button of a card opens or closes the written detail of its revision rounds
      host.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('.price-info');
        if (!b) return;
        const card = b.closest('.price');
        const open = !card.classList.contains('is-info');
        card.classList.toggle('is-info', open);
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    const addons = $('addons');
    if (addons) {
      addons.innerHTML = (OFFERS.addons || []).map((a, ai) => {
        const coaching = Array.isArray(a.for) && a.for.length === 1 && a.for[0] === 'accompagnement';
        return `<li style="--i:${ai};--in:${reduced ? 1 : 0}"><span class="ad-name">${esc(tidy(pick(a.name)))}${soonTag(a.id)}</span><span class="ad-for">${esc(t(coaching ? 's_addon_for_coaching' : 's_addon_for'))}</span><strong>${esc(price(a.price))}</strong></li>`;
      }).join('');
    }
    const note = $('addons-note');
    if (note) note.textContent = t('s_addons_hint');
    if (addons && !reduced) observeIn(addons.querySelectorAll('li'));
    renderOrderSteps();
    renderCoach(pay);
  }
  /* Coaching is a monthly subscription, not a package: one wide band under the packages, in its own pigment,
     with the "who" line, the first lines of what is included, the monthly price and the waiting-list action. */
  const COACH_SHOWN = 4;
  function renderCoach(pay) {
    const host = $('coach');
    if (!host) return;
    const o = (OFFERS.offers || []).find((x) => x.cadence === 'month');
    host.hidden = !o;
    if (!o) { host.innerHTML = ''; return; }
    const icons = Array.isArray(o.includes_icons) ? o.includes_icons : [];
    const lines = (pick(o.includes) || []).slice(0, COACH_SHOWN)
      .map((x, i) => `<li>${inclIcon(icons[i])}<span>${esc(tidy(x))}</span></li>`).join('');
    const soon = SOON.has(o.id);
    const payLine = pick((pay || {}).month);
    host.innerHTML = `<div class="coach-head">
        <p class="coach-kicker">${esc(t('s_pick_' + o.id) || '')}</p>
        <h3 class="coach-name">${esc(pick(o.name))}${soonTag(o.id)}</h3>
        <p class="coach-for">${esc(tidy(pick(o.outcome) || pick(o.for)))}</p>
      </div>
      <ul class="coach-incl price-incl">${lines}</ul>
      <div class="coach-act">
        <p class="coach-amount"><strong>${esc(price(o.price))}</strong><span>${esc(t('price_month'))}</span></p>
        <button type="button" class="btn ${soon ? 'btn-line' : 'btn-ink'} coach-cta" ${soon ? 'data-offer' : 'data-order'}="${esc(o.id)}">${esc(pick(o.cta))}</button>
        ${payLine ? `<p class="coach-pay">${esc(tidy(payLine))}</p>` : ''}
      </div>`;
  }
  /* "How ordering works": three steps, worded for the mode the server runs (card payment on the page, or a payment link). */
  function renderOrderSteps() {
    const host = $('order-steps');
    if (!host) return;
    const paid = root.dataset.pay === 'stripe';
    const keys = paid ? ['s_step_pay_1', 's_step_pay_2', 's_step_pay_3'] : ['s_step_req_1', 's_step_req_2', 's_step_req_3'];
    host.innerHTML = `<h3 class="os-title">${esc(t('s_steps_title'))}</h3><ol class="os-list">${keys.map((k, i) => {
      const [title, body] = tlist(k);
      return `<li style="--i:${i};--in:${reduced ? 1 : 0}"><span class="os-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><b>${esc(title || '')}</b><span class="os-body">${esc(body || '')}</span></li>`;
    }).join('')}</ol>`;
    // the rail draws itself step after step as the block scrolls in
    if (!reduced) observeIn(host.querySelectorAll('.os-list li'));
  }
  function setCardTrack(offerId, trackId) {
    const o = (OFFERS.offers || []).find((x) => x.id === offerId);
    if (!o || !(o.tracks || []).some((x) => x.id === trackId)) return;
    cardTrack[offerId] = trackId;
    const card = d.querySelector(`.price[data-card="${offerId}"]`);
    if (!card) return;
    card.querySelectorAll('.price-track').forEach((b) => {
      const on = b.dataset.track === trackId;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    const list = card.querySelector('[data-track-list]');
    if (list) {
      list.innerHTML = trackLines(o, trackId);
      // the four lines of the other track settle in instead of snapping (the CSS plays only without a reduced-motion request)
      list.classList.remove('is-swap');
      void list.offsetWidth;
      list.classList.add('is-swap');
    }
    const cta = card.querySelector('[data-order]');
    if (cta) cta.dataset.track = trackId;
  }

  /* The agenda: each step stands on its business day; the build step spans two. */
  const STEP_DAYS = [[0, 1], [1, 1], [2, 1], [3, 2], [5, 1]];
  const AGENDA_DAYS = 6;
  function renderSteps() {
    const host = $('steps');
    if (!host) return;
    let html = '';
    for (let i = 1; i <= STEPS; i++) {
      const [day, span] = STEP_DAYS[i - 1] || [i - 1, 1];
      html += `<li class="step" style="--d:${day};--span:${span}">
        <p class="step-marker">${esc(t(`step_${i}_marker`))}</p>
        <h3 class="step-title">${esc(t(`step_${i}_title`))}</h3>
        <p class="step-body">${esc(t(`step_${i}_body`))}</p>
      </li>`;
    }
    host.innerHTML = html;
    stepEls = Array.from(host.children);
    const ruler = $('agenda-ruler');
    if (ruler) {
      // "Day 0" / "J0": the unit comes from the first marker, the numbers from the agenda.
      const unit = String(t('step_1_marker') || 'Day 0').replace(/\d+\s*$/, '');
      let ticks = '';
      for (let n = 0; n < AGENDA_DAYS; n++) {
        ticks += `<span class="tick" style="--n:${n}"><i></i><b>${esc(unit)}${/\s$/.test(unit) || !unit ? '' : ''}${n}</b></span>`;
      }
      ruler.innerHTML = `<span class="ruler-line"></span><span class="ruler-fill"></span><span class="ruler-cursor"></span>${ticks}`;
      tickEls = Array.from(ruler.querySelectorAll('.tick'));
    }
  }

  let currentPick = '';
  function renderPicker() {
    const host = $('pick-opts');
    if (!host) return;
    host.innerHTML = (OFFERS.offers || []).map((o) =>
      `<button type="button" class="pick-btn" data-pick="${esc(o.id)}" aria-pressed="false"><i aria-hidden="true"></i>${esc(t('s_pick_' + o.id) || pick(o.name))}${soonTag(o.id)}</button>`).join('');
    setPick(currentPick);
  }
  function fillVars(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  }
  function setPick(id) {
    currentPick = id || '';
    d.querySelectorAll('.pick-btn').forEach((b) => b.setAttribute('aria-pressed', b.dataset.pick === currentPick ? 'true' : 'false'));
    d.querySelectorAll('.price[data-card]').forEach((c) => {
      c.classList.toggle('is-picked', c.dataset.card === currentPick);
      c.classList.toggle('is-dim', !!currentPick && c.dataset.card !== currentPick);
    });
    const line = $('pick-line');
    const o = (OFFERS.offers || []).find((x) => x.id === currentPick);
    if (line) {
      line.textContent = o ? fillVars(t('s_pick_line'), {
        name: pick(o.name),
        price: priceLine(o),
        delivery: pick(o.delivery),
      }) : '';
    }
  }

  function renderSpots() {
    const host = fox && fox.querySelector('.hero-spots');
    if (!host) return;
    host.innerHTML = SPOTS.map((sp) => `<div class="spot" data-spot="${sp.id}">
        <button type="button" class="spot-btn" aria-expanded="false" aria-controls="spot-${sp.id}" aria-label="${esc(t('s_spot_' + sp.id + '_t'))}"><span aria-hidden="true"></span></button>
        <div class="spot-card" id="spot-${sp.id}" role="note" hidden><strong>${esc(t('s_spot_' + sp.id + '_t'))}</strong><p>${esc(t('s_spot_' + sp.id))}</p></div>
      </div>`).join('');
    placeSpots();
  }
  function placeSpots() {
    const host = fox && fox.querySelector('.hero-spots');
    if (!host) return;
    const box = fox.querySelector('.pin-stage');
    const cw = box.clientWidth;
    const ch = box.clientHeight;
    if (!cw || !ch) return;
    // The clip is 16:9 on desktop and 9:16 on phones; both are "cover" from the centre.
    const portrait = smallMq.matches;
    const iw = portrait ? 720 : 1920;
    const ih = portrait ? 1280 : 1080;
    const k = Math.max(cw / iw, ch / ih);
    const ox = (cw - iw * k) * 0.5;
    const oy = (ch - ih * k) * 0.5;
    host.querySelectorAll('.spot').forEach((el) => {
      const sp = SPOTS.find((x) => x.id === el.dataset.spot);
      // Portrait crop keeps the middle 9:16 of the 16:9 frame: remap x into that window.
      const sx = portrait ? (sp.x - 0.5) * (1920 / 1080) * (720 / 1280) + 0.5 : sp.x;
      const x = ox + sx * iw * k;
      const y = oy + sp.y * ih * k;
      el.style.left = (x / cw * 100).toFixed(3) + '%';
      el.style.top = (y / ch * 100).toFixed(3) + '%';
      el.hidden = x < cw * 0.06 || x > cw * 0.94 || y < 90 || y > ch - 60;
      el.classList.toggle('opens-left', x > cw * 0.55);
    });
  }
  function closeSpots(except) {
    d.querySelectorAll('.spot').forEach((el) => {
      if (el === except) return;
      el.classList.remove('is-open');
      const b = el.querySelector('.spot-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
      const c = el.querySelector('.spot-card');
      if (c) c.hidden = true;
    });
  }

  /* Where an answer sends you next (its second level): the section that holds the detail, the brief form or the call.
     On the sub-pages the anchors go through /agence. */
  const FAQ_LINKS = {
    new: ['fq_go_founder', '#founder'], scope: ['fq_go_packages', '#pricing'], clock: ['fq_go_order', '#pricing'],
    revision: ['fq_go_packages', '#pricing'], generic: ['fq_go_checks', '#details'], who: ['fq_go_founder', '#founder'],
    inputs: ['fq_go_brief', 'dialog'], payment: ['fq_go_packages', '#pricing'], unhappy: ['fq_go_call', 'call'], bigger: ['fq_go_call', 'call'],
  };
  function renderFaq() {
    const host = $('faq-list');
    if (!host) return;
    const rows = FAQ.filter((slug) => !(HOME_PAGE && slug === 'cancel')).map((slug, i) => {
      const q = t(`faq_${slug}_q`);
      if (!q) return '';
      const id = 'faq-p-' + slug;
      const a = (HOME_PAGE && t(`faq_${slug}_a_home`)) || t(`faq_${slug}_a`);
      const go = FAQ_LINKS[slug];
      let next = '';
      if (go) {
        const label = esc(t(go[0]));
        if (go[1] === 'dialog') next = `<button type="button" class="link-arrow qa-go" data-offer=""><span>${label}</span><span aria-hidden="true">→</span></button>`;
        else if (go[1] === 'call') next = `<a class="link-arrow qa-go" href="${esc(CALENDLY)}" target="_blank" rel="noopener noreferrer"><span>${label}</span><span aria-hidden="true">→</span></a>`;
        else next = `<a class="link-arrow qa-go" href="${HOME_PAGE ? '' : '/agence'}${esc(go[1])}"><span>${label}</span><span aria-hidden="true">→</span></a>`;
      }
      return `<div class="qa" id="faq-${esc(slug)}" data-s="${esc((q + ' ' + a).toLowerCase())}" style="--i:${i};--in:${reduced ? 1 : 0}">
        <h3 class="qa-h"><button type="button" class="qa-q" aria-expanded="false" aria-controls="${id}"><span>${esc(q)}</span><i class="qa-ico" aria-hidden="true"></i></button></h3>
        <div class="qa-panel" id="${id}" inert><div class="qa-inner"><p>${esc(a)}</p>${next ? `<p class="qa-next">${next}</p>` : ''}</div></div>
      </div>`;
    }).join('');
    // a search box over the list: the rows that do not match fold away, and an empty result points to the form
    host.innerHTML = `<div class="qa-search"><label class="sr-only" for="faq-search">${esc(t('fq_search'))}</label>
        <input id="faq-search" type="search" autocomplete="off" enterkeyhint="search" placeholder="${esc(t('fq_search'))}"><span class="qa-count" id="faq-count" aria-live="polite"></span></div>${rows}
      <p class="qa-empty" id="faq-empty" hidden>${esc(t('fq_empty'))} <button type="button" class="link-arrow qa-go" data-offer=""><span>${esc(t('fq_go_brief'))}</span><span aria-hidden="true">→</span></button></p>`;
    if (!reduced) observeIn(host.querySelectorAll('.qa'));
    if (host.dataset.bound !== '1') {
      host.dataset.bound = '1';
      const filter = (v) => {
        const words = String(v || '').toLowerCase().split(/\s+/).filter(Boolean);
        const all = host.querySelectorAll('.qa');
        let shown = 0;
        all.forEach((r) => {
          const hit = !words.length || words.every((w) => (r.dataset.s || '').includes(w));
          r.hidden = !hit;
          if (hit) shown++;
        });
        const empty = $('faq-empty');
        if (empty) empty.hidden = shown > 0;
        const count = $('faq-count');
        if (count) count.textContent = words.length ? fillVars(t('fq_count'), { n: shown, total: all.length }) : '';
      };
      host.addEventListener('input', (e) => { if (e.target.id === 'faq-search') filter(e.target.value); });
      host.addEventListener('keydown', (e) => {
        if (e.target.id === 'faq-search' && e.key === 'Escape' && e.target.value) { e.target.value = ''; filter(''); e.stopPropagation(); }
      });
    }
  }

  function renderPortraitRing() {
    const svg = $('portrait-ring');
    if (!svg || svg.childElementCount) return;
    const colors = CHAPTERS.map((c) => c.color);
    svg.innerHTML = colors.map((c, i) => {
      const a = (-120 + i * 13) * Math.PI / 180;
      const x = 50 + Math.cos(a) * 49;
      const y = 50 + Math.sin(a) * 49;
      return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(2.6 + (i % 3) * 0.5).toFixed(1)}" fill="${c}"/>`;
    }).join('');
  }

  /* One small night tile per package, the same ink drawings as the service rows, scaled to a thumbnail.
     Decorative: the name, the price and the line say what the offer is. */
  const PKG_ART = {
    refonte: '<svg viewBox="0 0 48 36" fill="none" aria-hidden="true" focusable="false"><rect x="5" y="6" width="26" height="20" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M5 12h26" stroke="currentColor" stroke-width="1.4"/><path d="M10 17h11M10 21h7" stroke="rgba(243,241,247,.5)" stroke-width="1.4" stroke-linecap="round"/><path d="M28 20c5-1 8 2 11 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M36 24.5l3.2 1.4-2.2 2.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    creation: '<svg viewBox="0 0 48 36" fill="none" aria-hidden="true" focusable="false"><rect x="8" y="8" width="32" height="20" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M14 16h12M14 20h8" stroke="rgba(243,241,247,.55)" stroke-width="1.4" stroke-linecap="round"/><rect x="28" y="18" width="8" height="5" rx="2.5" fill="currentColor"/><path d="M38 6c.6 2.4 1.4 3.2 3.8 3.8-2.4.6-3.2 1.4-3.8 3.8-.6-2.4-1.4-3.2-3.8-3.8 2.4-.6 3.2-1.4 3.8-3.8z" fill="currentColor"/></svg>',
    accompagnement: '<svg viewBox="0 0 48 36" fill="none" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="5" stroke="currentColor" stroke-width="1.6"/><circle cx="32" cy="16" r="5" stroke="currentColor" stroke-width="1.6"/><path d="M12 28c1.2-4 3.2-6 6-6s4.8 2 6 6" stroke="rgba(243,241,247,.55)" stroke-width="1.5" stroke-linecap="round"/><path d="M26 28c1.2-4 3.2-6 6-6s4.8 2 6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    custom: '<svg viewBox="0 0 48 36" fill="none" aria-hidden="true" focusable="false"><rect x="14" y="8" width="20" height="22" rx="2" stroke="rgba(243,241,247,.4)" stroke-width="1.4"/><rect x="10" y="6" width="20" height="22" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M14 12h12M14 16h9M14 20h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    unsure: '<svg viewBox="0 0 48 36" fill="none" aria-hidden="true" focusable="false"><path d="M8 26C16 26 18 10 24 10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M24 10c6 0 8 16 16 16" stroke="rgba(243,241,247,.45)" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="2.5 3"/><circle cx="24" cy="10" r="2.4" fill="currentColor"/><circle cx="8" cy="26" r="2" fill="currentColor"/><circle cx="40" cy="26" r="2" stroke="currentColor" stroke-width="1.4"/></svg>',
  };
  /* The package art is the icon set in agence-order-art.js. The line drawings above are the fallback if that script has not loaded. */
  function pkgArt(id) {
    const A = window.agenceOrderArt;
    if (!A || typeof A.icon !== 'function') return PKG_ART[id] || '';
    return A.icon(id);
  }
  const PKG_PIG = { refonte: 'var(--holo-1)', creation: 'var(--holo-2)', accompagnement: 'var(--holo-3)', custom: 'var(--holo-5)', unsure: 'var(--holo-4)' };
  function offerBlurb(o) {
    if (!o) return '';
    const pages = pick(o.pages);
    const delivery = pick(o.delivery);
    return [pages, delivery].filter(Boolean).join(' · ');
  }
  function syncOfferPicks() {
    const sel = $('f-offer');
    const host = $('f-offer-picks');
    if (!sel || !host) return;
    host.querySelectorAll('input').forEach((inp) => { inp.checked = inp.value === sel.value; });
  }
  function renderOfferOptions() {
    const sel = $('f-offer');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = OFFER_IDS.map((id) => `<option value="${esc(id)}">${esc((t(`contact_opt_${id}`) || id) + (SOON.has(id) ? ' · ' + t('s_soon') : ''))}</option>`).join('');
    if (cur && OFFER_IDS.includes(cur)) sel.value = cur;
    else if (!sel.value) sel.value = OFFER_IDS[0];
    const host = $('f-offer-picks');
    if (host) {
      const chosen = sel.value;
      host.innerHTML = OFFER_IDS.map((id) => {
        const o = (OFFERS.offers || []).find((x) => x.id === id);
        const name = o ? (pick(o.name) || t(`contact_opt_${id}`) || id) : (t(`contact_opt_${id}`) || id);
        const line = o ? offerBlurb(o) : t('mail_price_unsure');
        const amount = o ? pkgAmount(o) : '';
        const soon = SOON.has(id) ? `<span class="soon">${esc(t('s_soon'))}</span>` : '';
        return `<label class="pkg" style="--pig:${PKG_PIG[id] || 'var(--holo-3)'}">
          <input type="radio" name="offer-pick" value="${esc(id)}"${id === chosen ? ' checked' : ''}>
          <span class="pkg-art" aria-hidden="true">${pkgArt(id)}</span>
          <span class="pkg-copy"><span class="pkg-name">${esc(name)}${soon}</span>${line ? `<span class="pkg-line">${esc(line)}</span>` : ''}</span>
          ${amount ? `<span class="pkg-price">${esc(amount)}</span>` : ''}
        </label>`;
      }).join('');
      if (!host.dataset.bound) {
        host.dataset.bound = '1';
        host.addEventListener('change', (e) => {
          const inp = e.target.closest('input');
          if (inp && sel) sel.value = inp.value;
        });
      }
    }
    paintContactStep();
  }

  function renderChatSuggestions() {
    const host = $('chat-suggs');
    if (!host) return;
    host.innerHTML = [1, 2, 3, 4].map((i) => t(`chat_s${i}`)).filter(Boolean)
      .map((s) => `<button type="button">${esc(s)}</button>`).join('');
  }

  /* The rail: one bead per chapter, in reading order. */
  function renderRail() {
    const list = $('rail-list');
    if (!list) return;
    list.innerHTML = CHAPTERS.map((c, i) => `<li><button type="button" class="rail-dot" data-chapter="${c.id}" data-i="${i}" aria-label="${esc(t(c.key))}"><i></i></button></li>`).join('');
    lastChapter = '';
  }
  function railSay(text) {
    const label = $('rail-label');
    if (!label) return;
    label.textContent = text;
  }

  /* Showcase page: every playground interface gets a line figure and a staggered entrance. */
  const PLAY_FIGS = {
    'revenue-command-center': 'vault',
    'accounting-dashboard': 'vault',
    'fleet-tracker': 'terrain',
    'upload-drop-glow': 'riffle',
    'finvest-convert': 'vault',
    'lyon-saas': 'branches',
    'munsit-voice-flow': 'dish',
    'motion-hero': 'turntable',
    'food-details': 'slow',
    'medical-dashboard': 'cabinet',
    'hr-dashboard': 'lockers',
    'opero-hero': 'branches',
    'maritana-hero': 'terrain',
    'n8n-workflow': 'terminal',
    'health-overview': 'phone',
    'expo-sdk-grid': 'exploded',
    'synaptix-hero': 'phosphor',
    'sobers-hero': 'patch',
    'analytics-card': 'vault',
    'devpilot-hero': 'keyboard',
    'bento-features': 'exploded',
    'viora-health': 'phone',
    'remoterecruit-redesign': 'lockers',
    'linkedin-jobs-playground': 'riffle',
  };

  function dressPlayground() {
    if (SITE.page !== 'showcase') return;
    const grid = $('ifaces-grid-el');
    if (!grid || grid.dataset.dressed === '1') return;
    const cards = grid.querySelectorAll('.iface-card');
    if (!cards.length) return;
    grid.dataset.dressed = '1';
    cards.forEach((card, i) => {
      const id = card.dataset.iface || '';
      card.classList.add('play-card');
      card.style.setProperty('--i', String(i % 6));
      const overlay = card.querySelector('.iface-card-overlay');
      if (overlay && !overlay.querySelector('[data-hairline]')) {
        const f = d.createElement('div');
        f.className = 'hairline-fig';
        f.dataset.hairline = PLAY_FIGS[id] || 'laptop';
        f.dataset.theme = 'light';
        f.dataset.intensity = '0.55';
        f.setAttribute('aria-hidden', 'true');
        overlay.prepend(f);
        const relay = (type, e) => {
          f.dispatchEvent(new PointerEvent(type, {
            bubbles: false,
            cancelable: false,
            clientX: e ? e.clientX : 0,
            clientY: e ? e.clientY : 0,
            pointerType: 'mouse',
          }));
        };
        card.addEventListener('pointerenter', (e) => relay('pointerenter', e));
        card.addEventListener('pointermove', (e) => relay('pointermove', e));
        card.addEventListener('pointerleave', (e) => relay('pointerleave', e));
      }
      card.addEventListener('transitionend', (e) => {
        if (e.propertyName === 'opacity') card.style.transitionDelay = '0s';
      });
    });
    const mount = () => {
      if (typeof window.mountHairlines === 'function') window.mountHairlines(grid);
    };
    mount();
    window.addEventListener('load', mount, { once: true });
    if (reduced || !('IntersectionObserver' in window)) {
      cards.forEach((c) => c.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!hasEntered(e)) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.22, rootMargin: '0px 0px -8% 0px' });
    cards.forEach((c) => {
      io.observe(c);
      watchPassed(c, () => { c.classList.add('is-in'); io.unobserve(c); });
    });
  }

  /* The founder's four facts, second level (2026-10-27). Each fact (#facts .fx-btn, static in agence.html so the counters
     and their data-t keys stay as they were) opens one shared panel under the row: the career line from AGENCY_BRANDS
     (every employer and year, before v2 studio), the agency years, the products and where each stands, the Creads.io
     figures. One open at a time; the panel grows from 0 and tweens its height from one fact to the next. */
  const FX_PRODUCTS = [['Creads.io', 'status_launched'], ['Flemme OS', 'status_functional'], ['UXfi', 'status_prototype'], ['Jarvos', 'status_in_progress']];
  let fxOpen = -1;
  let fxMarked = false;
  function fxBlock(i) {
    if (i === 0) {
      const all = typeof AGENCY_BRANDS !== 'undefined' && Array.isArray(AGENCY_BRANDS) ? AGENCY_BRANDS : [];
      const rows = all.slice().sort((a, b) => parseInt(a.years, 10) - parseInt(b.years, 10))
        .map((b, k) => `<li style="--k:${k}"><span class="fx-y">${esc(b.years)}</span><span class="fx-c"><b>${esc(b.name)}</b><small>${esc(pick(b.role) || '')}</small></span></li>`).join('');
      return `<p class="fx-lede">${esc(t('fx_1_lede'))}</p><ol class="fx-line">${rows}</ol>`;
    }
    if (i === 1) return `<p>${esc(t('fx_2'))}</p>`;
    if (i === 2) return `<p class="fx-lede">${esc(t('fx_3_lede'))}</p><ul class="fx-prod">${FX_PRODUCTS.map(([n, k], j) => `<li style="--k:${j}"><b>${esc(n)}</b><span>${esc(t(k))}</span></li>`).join('')}</ul>`;
    return `<p>${esc(t('fx_4'))}</p>`;
  }
  function fxSet(i) {
    const box = $('fx-panel');
    const body = $('fx-body');
    const facts = $('facts');
    if (!box || !body || !facts) return;
    const next = i === fxOpen ? -1 : i;
    facts.querySelectorAll('.fx-btn').forEach((b, k) => b.setAttribute('aria-expanded', k === next ? 'true' : 'false'));
    if (next < 0) {
      box.classList.remove('is-open');
      fxOpen = -1;
      return;
    }
    const inner = body.parentElement;
    const was = fxOpen >= 0;
    const h0 = inner.offsetHeight;
    if (was && !reduced) inner.style.height = h0 + 'px';
    body.innerHTML = fxBlock(next);
    body.classList.remove('is-on');
    void body.offsetWidth;
    body.classList.add('is-on');
    if (was && !reduced) {
      const h1 = inner.scrollHeight;
      requestAnimationFrame(() => { inner.style.height = h1 + 'px'; });
      setTimeout(() => { inner.style.height = ''; }, 520);
    }
    box.classList.add('is-open');
    fxOpen = next;
  }
  /* The contact block (2026-10-27): three sentences people tend to start with, as chips under the buttons. A tap opens
     the brief form on its message step with the sentence already in, caret at the end, so the visitor only has to go on.
     The block's lines rise one after the other as it scrolls in, and the fox slowly settles. */
  let ctMarked = false;
  function renderContactStarters() {
    const host = $('contact-starters');
    if (!host) return;
    const chips = tlist('cs_chips');
    host.innerHTML = chips.length ? `<span class="cs-label">${esc(t('cs_label'))}</span><div class="cs-list" role="group" aria-label="${esc(t('cs_label'))}">${chips.map((c) => `<button type="button" class="cs-chip" data-text="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : '';
    if (host.dataset.bound !== '1') {
      host.dataset.bound = '1';
      host.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('.cs-chip');
        if (!b) return;
        openContact('unsure');
        const msg = $('f-msg');
        if (!msg) return;
        msg.value = b.dataset.text + '. ';
        setTimeout(() => { msg.focus(); msg.setSelectionRange(msg.value.length, msg.value.length); }, 60);
      });
    }
    if (!ctMarked) {
      ctMarked = true;
      if (!reduced) {
        const els = d.querySelectorAll('.contact .wrap > .contact-sub, .contact .wrap > .contact-actions, .contact .wrap > .contact-starters, .contact .wrap > .contact-founder, .contact .wrap > .contact-else');
        els.forEach((el) => el.style.setProperty('--in', 0));
        const bg = d.querySelector('.contact-bg');
        if (bg) { bg.style.setProperty('--in', 0); observeIn([bg]); }
        observeIn(els);
      }
    }
  }
  function renderFounder() {
    const facts = $('facts');
    if (!facts) return;
    if (fxOpen >= 0 && $('fx-body')) $('fx-body').innerHTML = fxBlock(fxOpen);   // the language changed while a fact was open
    if (facts.dataset.bound !== '1') {
      facts.dataset.bound = '1';
      facts.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('.fx-btn');
        if (b) fxSet(Number(b.dataset.i));
      });
      facts.addEventListener('keydown', (e) => {
        const btns = Array.from(facts.querySelectorAll('.fx-btn'));
        const cur = btns.indexOf(d.activeElement);
        if (e.key === 'Escape' && fxOpen >= 0) { e.preventDefault(); const keep = btns[fxOpen]; fxSet(fxOpen); if (keep) keep.focus(); }
        else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && cur >= 0) {
          e.preventDefault();
          const nb = btns[(cur + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
          nb.focus();
          if (fxOpen >= 0) fxSet(Number(nb.dataset.i));
        }
      });
    }
    // entrance, once: the paragraphs, the facts and the buttons rise one after the other as the section scrolls in
    if (!fxMarked) {
      fxMarked = true;
      if (!reduced) {
        const els = d.querySelectorAll('.founder-body > p, #facts li, .founder-actions');
        els.forEach((el) => el.style.setProperty('--in', 0));
        observeIn(els);
      }
    }
  }

  function renderAll() {
    moreSeq = 0;
    renderSpots();
    renderTiles();
    renderProof();
    renderHeroProof();
    renderFounder();
    renderContactStarters();
    renderServices();
    renderChecks();
    renderPricing();
    renderSteps();
    renderFaq();
    renderPortraitRing();
    renderOfferOptions();
    renderChatSuggestions();
    renderRail();
    renderPicker();
    if (typeof window.mountHairlines === 'function') window.mountHairlines();
    dressPlayground();
  }

  /* ── Reveal on enter (cases, headings) ── */
  /* An element counts as entered when it is on screen OR already above the viewport. A fast scroll, a rail jump or a
     reload mid-page can skip an element between two frames: it never reports as intersecting, so it stayed at
     opacity 0 for good (the logos, case shots and headings that "disappeared"). */
  function hasEntered(e) {
    if (e.isIntersecting) return true;
    const top = e.rootBounds ? e.rootBounds.top : 0;
    return e.boundingClientRect.bottom <= top;
  }
  /* An observer never reports an element that goes from "below the screen" to "above it" inside one frame (a fast
     flick, a rail jump, Home/End): isIntersecting stays false both times. So each pending reveal is also registered
     here, and a throttled scroll check shows anything that is already behind the reader. */
  const passedWatch = new Map();
  let passedQueued = false;
  function watchPassed(el, fn) { passedWatch.set(el, fn); }
  function sweepPassed() {
    passedQueued = false;
    passedWatch.forEach((fn, el) => {
      if (!el.isConnected) { passedWatch.delete(el); return; }
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom < 0) { passedWatch.delete(el); fn(); }
    });
  }
  window.addEventListener('scroll', () => {
    if (passedQueued || !passedWatch.size) return;
    passedQueued = true;
    requestAnimationFrame(sweepPassed);
  }, { passive: true });
  let inObserver = null;
  function observeIn(els) {
    if (!('IntersectionObserver' in window)) { els.forEach((el) => el.style.setProperty('--in', 1)); return; }
    if (!inObserver) {
      inObserver = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!hasEntered(e)) return;
          const el = e.target;
          const delay = Array.prototype.indexOf.call(el.parentNode.children, el) * 90;
          setTimeout(() => el.style.setProperty('--in', 1), delay);
          inObserver.unobserve(el);
        });
      }, { rootMargin: '0px 0px -12% 0px' });
    }
    els.forEach((el) => {
      inObserver.observe(el);
      watchPassed(el, () => { el.style.setProperty('--in', 1); inObserver.unobserve(el); });
    });
  }
  let revealObserver = null;
  function watchReveals() {
    const els = d.querySelectorAll('[data-reveal]');
    if (reduced || !('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('is-in')); return; }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!hasEntered(e)) return;
          e.target.classList.add('is-in');
          revealObserver.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px -18% 0px' });
    }
    els.forEach((el) => {
      if (el.classList.contains('is-in')) return;
      revealObserver.observe(el);
      watchPassed(el, () => { el.classList.add('is-in'); revealObserver.unobserve(el); });
    });
  }

  function countUp(el) {
    const final = el.textContent;
    const m = final.match(/^(\D*)([\d\s  .,]+)(.*)$/);
    if (!m || reduced) return;
    const target = parseInt(m[2].replace(/\D/g, ''), 10);
    if (!Number.isFinite(target) || target <= 0) return;
    const grouped = /[\s  ,.]/.test(m[2].trim());
    const fmt = (n) => (grouped ? (lang === 'fr' ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : n.toLocaleString(SITE.intl || 'en-US')) : String(n));
    const start = performance.now();
    const dur = 1400;
    (function step(now) {
      const k = clamp((now - start) / dur);
      el.textContent = k < 1 ? m[1] + fmt(Math.round(target * ease(k))) + m[3] : final;
      if (k < 1) requestAnimationFrame(step);
    })(start);
  }
  function watchFacts() {
    const facts = $('facts') || $('stats');
    if (!facts || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      facts.querySelectorAll('[data-count]').forEach(countUp);
      io.disconnect();
    }, { threshold: 0.5 });
    io.observe(facts);
  }

  /* ── Scrubbed clips: a lerped playhead, a poster until the first frame paints, one source per orientation ── */
  function makeScrub(video) {
    if (!video) return null;
    const poster = video.parentNode.querySelector('.stage-poster');
    const startAt = parseFloat(video.dataset.start || '0') || 0;
    const s = { video, poster, target: 0, head: -1, seeking: false, loaded: false, painted: false, primed: false, running: false, lazy: video.hasAttribute('data-lazy') };
    const lerp = smallMq.matches ? 0.26 : 0.2;
    const dead = smallMq.matches ? 0.02 : 0.009;
    let seekT = 0;
    function markPainted() {
      if (s.painted) return;
      s.painted = true;
      if (poster) poster.classList.add('is-behind');
    }
    // iOS keeps a muted clip blank until it has played once: play, then pause, on the first chance.
    function prime() {
      if (s.primed || !s.loaded) return;
      s.primed = true;
      const p = video.play();
      (p && p.then ? p : Promise.resolve()).then(() => { if (!s.free) video.pause(); }).catch(() => { s.primed = false; });
    }
    s.load = function () {
      if (s.loaded || reduced) return;
      s.loaded = true;
      const src = smallMq.matches && video.dataset.srcM ? video.dataset.srcM : video.dataset.src;
      if (!src) return;
      video.src = src;
      video.preload = 'auto';
      video.load();
      video.addEventListener('loadedmetadata', () => { s.head = -1; prime(); if (s.wantFree != null) { const f = s.wantFree; s.wantFree = null; s.release(f); } else tick(); }, { once: true });
      video.addEventListener('seeked', () => {
        s.seeking = false;
        if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(markPainted); else if (video.readyState >= 2) markPainted();
        tick();
      });
      ['touchend', 'pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, prime, { passive: true, once: true }));
    };
    function want() {
      const dur = video.duration;
      const end = Math.max(startAt, dur - 0.05);
      return startAt + s.target * (end - startAt);
    }
    function tick() {
      if (s.running) return;
      s.running = true;
      requestAnimationFrame(function frame() {
        s.running = false;
        const dur = video.duration;
        if (!s.loaded || !Number.isFinite(dur) || dur <= 0 || s.free) return;
        const w = want();
        if (s.head < 0) s.head = w;
        const gap = w - s.head;
        if (s.seeking && performance.now() - seekT > 700) s.seeking = false; // a seek that never answered
        if (Math.abs(gap) < dead) {
          if (!s.seeking && Math.abs(video.currentTime - w) > dead) { s.seeking = true; seekT = performance.now(); video.currentTime = w; s.head = w; }
          return;
        }
        s.head += gap * lerp;
        if (!s.seeking) { s.seeking = true; seekT = performance.now(); video.currentTime = s.head; }
        s.running = true;
        requestAnimationFrame(frame);
      });
    }
    s.set = function (p) {
      s.target = clamp(p);
      if (!s.loaded) { if (!s.lazy) s.load(); return; }
      if (s.free) return;
      tick();
    };
    /* Free run: once the stage is released, the clip plays out on its own clock instead of waiting for the scroll,
       so the scene finishes even if the hand stops. hold() gives the playhead back to the scroll. */
    s.free = false;
    /* release(from): play on from here; if the hand jumped straight past the scrub (deep link, reload, fast scroll),
       the clip first catches up to `from` so the scene is never stuck on its first frame. */
    s.wantFree = null;
    s.release = function (from) {
      if (s.free) return;
      if (!s.loaded || !(video.duration > 0)) { s.wantFree = from == null ? 0 : from; if (!s.loaded && !s.lazy) s.load(); return; }
      const dur = video.duration;
      if (!Number.isFinite(dur) || dur <= 0 || video.currentTime >= dur - 0.08) return;
      if (from != null && video.currentTime < from - 0.3) { video.currentTime = Math.min(from, dur - 0.1); s.head = from; }
      s.free = true;
      s.seeking = false;
      const p = video.play();
      if (p && p.catch) p.catch(() => { s.free = false; });
    };
    s.hold = function () {
      s.wantFree = null;
      if (!s.free) return;
      s.free = false;
      video.pause();
      s.head = video.currentTime;
      // Stay on the frame reached by the free run; the next set() from the hand moves on from here.
      if (video.duration > 0) s.target = video.currentTime / video.duration;
      tick();
    };
    video.addEventListener('ended', () => { s.free = false; s.head = video.currentTime; });
    return s;
  }
  function pickStill(img) {
    if (!img) return;
    const small = smallMq.matches;
    if (!img.dataset.srcD) img.dataset.srcD = img.getAttribute('src');
    const next = small && img.dataset.srcM ? img.dataset.srcM : img.dataset.srcD;
    if (next && img.getAttribute('src') !== next) img.setAttribute('src', next);
  }

  /* ── Scenes ── */
  const hero = d.querySelector('[data-scene="hero"]');
  const heroScrub = hero ? makeScrub(hero.querySelector('video.scrub')) : null;
  /* The sea at rest (2026-10-27): at the very top (no scroll) a short seamless loop of the same footage plays on its own;
     the first scroll fades it out onto the scrubbed clip, scrolling back to the top fades it back in. No loop under
     reduced motion (the poster stays) and none if the file does not play (the poster and the clip show as before). */
  const heroLoop = hero && !reduced ? hero.querySelector('.hero-loop') : null;
  const loopState = { ready: false, want: false, timer: 0, inited: false };
  function heroLoopInit() {
    if (!heroLoop || loopState.inited) return;
    loopState.inited = true;   // the file loads the first time the page is at the top (a reload far down never fetches it)
    heroLoop.src = smallMq.matches && heroLoop.dataset.srcM ? heroLoop.dataset.srcM : heroLoop.dataset.src;
    heroLoop.preload = 'auto';
    heroLoop.addEventListener('playing', () => { loopState.ready = true; heroLoopSync(); });
    heroLoop.load();
    const go = heroLoop.play();
    if (go && go.catch) go.catch(() => { /* autoplay refused (low-power mode): the poster stays */ });
    d.addEventListener('visibilitychange', () => {
      if (d.hidden) heroLoop.pause();
      else if (loopState.want) { const p = heroLoop.play(); if (p && p.catch) p.catch(() => {}); }
    });
  }
  // want = the page is at the top; the loop shows and runs only then
  function heroLoopWant(on) {
    if (!heroLoop || loopState.want === on) return;
    loopState.want = on;
    if (on) heroLoopInit();
    heroLoopSync();
  }
  function heroLoopSync() {
    if (!heroLoop) return;
    clearTimeout(loopState.timer);
    if (loopState.want) {
      if (heroLoop.paused && loopState.ready) { const p = heroLoop.play(); if (p && p.catch) p.catch(() => {}); }
      heroLoop.classList.toggle('is-on', loopState.ready);
    } else {
      heroLoop.classList.remove('is-on');
      // pause once it has faded out, so it costs nothing while the page scrolls
      loopState.timer = setTimeout(() => { if (!loopState.want) heroLoop.pause(); }, 900);
    }
  }
  const beats = hero ? Array.from(hero.querySelectorAll('.hero-beat')) : [];
  // The lookalike sites have their own pale sheet again (2026-10-17): the fox clip is never covered by them.
  const same = d.querySelector('[data-scene="same"]');
  const services = d.querySelector('[data-scene="services"]');
  const track = $('svc-track');
  const svcDots = Array.from(d.querySelectorAll('#svc-dots i'));
  const fox = d.querySelector('[data-scene="fox"]');
  const foxScrub = fox ? makeScrub(fox.querySelector('video.scrub')) : null;
  const foxBeats = fox ? Array.from(fox.querySelectorAll('.hero-beat')) : [];
  const day2 = d.querySelector('[data-scene="day2"]');
  const checksSec = d.querySelector('[data-scene="checks"]');
  const processSec = d.querySelector('[data-scene="process"]');
  const contact = d.querySelector('[data-scene="contact"]');
  const nav = $('nav');
  const rail = $('rail');
  const progressBar = d.querySelector('.progress');
  const chapterEls = Array.from(d.querySelectorAll('[data-chapter]'));
  const sectionEls = Array.from(d.querySelectorAll('main > section'));

  let sameTiles = [];
  let sameOrder = [];
  let checkRows = [];
  let lastTally = -1;
  let stepEls = [];
  let tickEls = [];
  const agenda = $('agenda');
  let svcCards = [];
  let lastChapter = '';
  let svcDist = 0;
  let svcActive = -1;
  let horizontal = false;
  let heroP = 0;
  let lastHeroP = -1;
  let lastHeroMode = -1;
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };

  function isPinned(el) {
    const stage = el && el.querySelector('.pin-stage');
    return !!stage && getComputedStyle(stage).position === 'sticky';
  }

  /* A pinned scene with a cover (.has-cover) holds its stage for one more viewport after its own travel,
     while the next section slides over it (data-cover="sheet") or opens through it (data-cover="dab").
     Its progress only counts its own travel; coverOf() counts the extra viewport. */
  function progressOf(el, r, vh) {
    if (el._pinned) {
      const total = r.height - vh - (el._cover || 0);
      return total > 0 ? clamp(-r.top / total) : (r.top <= 0 ? 1 : 0);
    }
    return clamp((vh - r.top) / (r.height + vh));
  }
  function coverOf(el, r, vh) {
    const c = el._cover || 0;
    if (!c || !r) return 0;
    return clamp((-r.top - (r.height - vh - c)) / c);
  }
  /* A pinned stage is on screen for a viewport before its travel starts and after it ends: the clip plays across that whole life. */
  function clipProgress(el, r, vh) {
    const start = Math.min(vh, Math.max(0, el.offsetTop));
    const total = r.height - vh + start + vh;
    return total > 0 ? clamp((start - r.top) / total) : 0;
  }

  function setBeat(el, o, y, base) {
    el.style.opacity = o.toFixed(3);
    el.style.transform = `${base || ''} translate3d(0, ${y.toFixed(1)}px, 0)`;
    el.style.visibility = o < 0.02 ? 'hidden' : 'visible';
  }

  /* The hero: the surface, then the dive. */
  function drawHero(clipP, pinP, gone) {
    if (!hero) return;
    const p = heroP;
    if (reduced) {
      beats.forEach((b) => { b.style.opacity = ''; b.style.transform = ''; b.style.visibility = ''; });
      return;
    }
    heroLoopWant(window.scrollY < 6);



    /* The hand drives the clip until the last beat is on screen. That beat fades in from 0.72;
       two or three wheel notches later the clip plays itself out, so it starts as soon as the step appears. */
    const RELEASE = 0.78;
    // Whale clip (10 s): the hand drives the first 80% of it, the rest plays out on its own after RELEASE.
    const dur = heroScrub && heroScrub.video.duration > 0 ? heroScrub.video.duration : 13.58;
    const T_PIN = dur * 0.8;
    const tSec = clamp(pinP) * T_PIN;
    if (heroScrub) {
      if (pinP >= RELEASE && !gone) heroScrub.release(RELEASE * T_PIN); else heroScrub.hold();
      if (pinP < RELEASE) heroScrub.set(tSec / dur);
    }
    clipP = tSec / dur;
    hero.style.setProperty('--scrim', (0.92 - 0.3 * seg(p, 0.3, 0.55)).toFixed(3));
    hero.style.setProperty('--deep', seg(p, 0.4, 0.85).toFixed(3));

    // Three beats over the pin (2026-10-15, shorter pin): the title, the dive, then the invitation while the whale swims.
    const [b1, b3, b4] = beats;
    if (b1) { const k = seg(p, 0.3, 0.42); setBeat(b1, 1 - k, -40 * k); }
    if (b3) {
      const kin = seg(p, 0.5, 0.58);
      const kout = b4 ? seg(p, 0.68, 0.74) : 0;
      setBeat(b3, kin * (1 - kout), 30 * (1 - kin) - 36 * kout);
    }
    if (b4) { const k = seg(p, 0.76, 0.84); setBeat(b4, k, 30 * (1 - k)); }
  }

  /* The painter: the fox walks out of the forest and arrives with its palette. The clip starts with the dab:
     while the circle grows over the lookalike sites (`open`, 0 → 1), the first FOX_OPEN_SHARE of the clip plays,
     so the scene is already moving inside the opening (2026-10-18, user request); the fox's own pin plays the
     rest to its arrival. Without a dab (not pinned), the pin plays the whole clip. */
  const FOX_OPEN_SHARE = 0.18;
  function drawFox(p, near, open) {
    if (!fox) return;
    if (reduced) {
      foxBeats.forEach((b) => { b.style.opacity = ''; b.style.transform = ''; b.style.visibility = ''; });
      fox.style.setProperty('--arrive', 1);
      fox.classList.add('is-arrived');
      return;
    }
    const share = open == null ? 0 : FOX_OPEN_SHARE;
    if (foxScrub && near) foxScrub.set(share * seg(open || 0, 0.06, 1) + (1 - share) * seg(p, 0.02, 0.96));
    fox.style.setProperty('--arrive', seg(p, 0.86, 0.96).toFixed(3));
    fox.classList.toggle('is-arrived', p > 0.9);
    fox.style.setProperty('--scrim', (0.86 - 0.3 * seg(p, 0.14, 0.5)).toFixed(3));
    const [a, b] = foxBeats;
    if (a) { const kin = seg(p, 0.06, 0.16); const kout = seg(p, 0.4, 0.5); setBeat(a, kin * (1 - kout), 20 * (1 - kin) - 36 * kout); }
    if (b) { const k = seg(p, 0.62, 0.74); setBeat(b, k, 30 * (1 - k)); }
  }

  /* Transitions between the pinned scenes (one viewport each, scrubbed by the scroll):
     sheet: the next section slides over the held stage, which sinks back (a little smaller, darker, rounded);
     dab:   the next stage stays put and opens through a paint dab that grows from the painted site. */
  const coveredEls = Array.from(d.querySelectorAll('main > section.has-cover'));
  function measureCovers() {
    coveredEls.forEach((el) => {
      const stage = el.querySelector(':scope > .pin-stage');
      let next = el.nextElementSibling;
      while (next && next.tagName !== 'SECTION') next = next.nextElementSibling;
      el._stage = stage;
      el._next = next && next.classList.contains('covers') ? next : null;
      el._cover = !reduced && el._pinned && el._next && stage ? stage.offsetHeight : 0;
      el._k = -1;
      if (el._next) {
        el._next._stage = el._next.querySelector(':scope > .pin-stage');
        el._next._rim = el._next.querySelector(':scope > .dab-rim');
      }
    });
  }
  function clearDab(next) {
    if (!next) return;
    next.classList.remove('is-opening');
    [next._stage, next._rim].forEach((x) => {
      if (!x) return;
      x.style.transform = '';
      x.style.webkitMaskSize = x.style.maskSize = '';
      x.style.webkitMaskPosition = x.style.maskPosition = '';
    });
  }
  function drawCovers(rects, vh, dabFrom) {
    coveredEls.forEach((el) => {
      const next = el._next;
      if (!next) return;
      const k = el._cover ? coverOf(el, rects.get(el), vh) : 0;
      if (el.dataset.cover === 'dab') {
        const rNext = rects.get(next);
        // How much of the screen the opening already holds (drawChrome reads it for the nav tone).
        next._open = el._cover ? k : 0;
        if (!el._cover || k <= 0 || k >= 1 || !rNext) {
          if (el._k !== k) clearDab(next);
          next.classList.toggle('is-shut', !!el._cover && k <= 0);
          el._k = k;
          return;
        }
        el._k = k;
        next.classList.add('is-opening');
        next.classList.remove('is-shut');
        // .is-opening fixes the stage to the screen while its section is still rising (CSS), so viewport = stage coordinates.
        const ox = dabFrom ? dabFrom.x : window.innerWidth / 2;
        const oy = dabFrom ? dabFrom.y : vh / 2;
        const far = Math.hypot(Math.max(ox, window.innerWidth - ox), Math.max(oy, vh - oy));
        const e = easeInOut(seg(k, 0.04, 0.96));
        const size = (far / 0.42) * e;
        const place = (x, s) => {
          if (!x) return;
          x.style.webkitMaskSize = x.style.maskSize = `${s.toFixed(1)}px ${s.toFixed(1)}px`;
          x.style.webkitMaskPosition = x.style.maskPosition = `${(ox - s / 2).toFixed(1)}px ${(oy - s / 2).toFixed(1)}px`;
        };
        place(next._stage, size);
        // The pigment rim runs just ahead of the opening: a thin line, not a band.
        place(next._rim, size * 1.028 + 10 * (1 - e));
        return;
      }
      if (el._k === k) return;
      el._k = k;
      if (el._stage) el._stage.style.setProperty('--out', k.toFixed(4));
      next.style.setProperty('--in', (el._cover ? k : 1).toFixed(4));
    });
  }

  function drawSame(p) {
    if (!sameTiles.length) return;
    const n = sameTiles.length;
    sameTiles.forEach((tile, i) => {
      if (tile.classList.contains('is-chosen')) {
        const k = reduced ? 1 : easeInOut(seg(p, 0.5, 0.78));
        tile.style.setProperty('--paint', k.toFixed(3));
        tile.classList.toggle('is-live', k > 0.9);
        return;
      }
      const o = sameOrder[i] / n;
      tile.style.setProperty('--fog', (reduced ? 1 : seg(p, 0.12 + o * 0.3, 0.3 + o * 0.3)).toFixed(3));
    });
    if (same) same.style.setProperty('--cap', (reduced ? 1 : seg(p, 0.78, 0.88)).toFixed(3));
  }

  function drawServices(p) {
    if (!track) return;
    if (!horizontal) {
      track.style.transform = '';
      svcCards.forEach((c) => { c.style.removeProperty('--in'); c.classList.remove('is-active'); });
      svcActive = -1;
      return;
    }
    const k = easeInOut(seg(p, 0.06, 0.94));
    track.style.transform = `translate3d(${(-svcDist * k).toFixed(1)}px, 0, 0)`;
    const n = svcDots.length || 1;
    svcDots.forEach((dot, i) => dot.style.setProperty('--f', seg(k, i / n, (i + 1) / n).toFixed(3)));
    // The card nearest the middle of the stage is the active one; the others wait, dimmed, and can be clicked.
    const rail = track.parentElement;
    const mid = (rail ? rail.clientWidth : window.innerWidth) / 2 + svcDist * k;
    let best = 0;
    let bestD = Infinity;
    svcCards.forEach((c, i) => {
      const dist = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (dist < bestD) { bestD = dist; best = i; }
    });
    if (best !== svcActive) {
      svcActive = best;
      svcCards.forEach((c, i) => {
        c.classList.toggle('is-active', i === best);
        c.style.setProperty('--in', i === best ? 1 : 0.6);
      });
    }
  }
  /* The proof bubble: opens below its button, or above when the viewport has no room below. One at a time. */
  /* Scroll the pin so this card sits in the middle of the stage (inverse of drawServices' easing). */
  function centerService(card, behavior) {
    if (!horizontal || !services || !card || svcDist <= 0) return;
    const rail = track.parentElement;
    const want = clamp((card.offsetLeft + card.offsetWidth / 2 - (rail ? rail.clientWidth : window.innerWidth) / 2) / svcDist);
    const x = want < 0.5 ? Math.cbrt(want / 4) : 1 - Math.cbrt(2 * (1 - want)) / 2;
    const p = 0.06 + x * 0.88;
    const vh = window.innerHeight;
    window.scrollTo({ top: services.offsetTop + p * (services.offsetHeight - vh), behavior });
  }

  function drawChecks(vh, tops) {
    let count = 0;
    // The sheet is one block: the brush stamps the twelve cells in reading order while it rises from the bottom of
    // the viewport to its upper third. Reduced motion: all stamped.
    const rise = tops && tops.length ? clamp((vh * 0.92 - tops[0]) / (vh * 0.62)) : 0;
    checkRows.forEach((row, i) => {
      const ink = !reduced && tops ? clamp(rise * (checkRows.length + 1.5) - i) : 1;
      row.style.setProperty('--ink', ink.toFixed(3));
      row.classList.toggle('is-painted', ink >= 0.995);
      if (ink >= 0.995) count++;
    });
    if (count !== lastTally) {
      lastTally = count;
      const n = $('tally-n');
      if (n) n.textContent = pad(count);
      const sheet = $('ledger');
      if (sheet) sheet.classList.toggle('is-passed', checkRows.length > 0 && count >= checkRows.length);
    }
  }

  /* A tap or a click turns a cell over (hover and focus do it in CSS); one open cell at a time. */
  function openCheck(row, open) {
    checkRows.forEach((r) => {
      const on = r === row && open;
      r.classList.toggle('is-open', on);
      const b = r.querySelector('.ck-btn');
      if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
  }

  function drawDay2(p) {
    if (!day2) return;
    const k = reduced ? 1 : easeInOut(seg(p, 0.02, 0.5));
    day2.style.setProperty('--iris', (18 + 76 * k).toFixed(2) + '%');
    day2.style.setProperty('--iz', (1.32 - 0.28 * k).toFixed(4));
    const ring = reduced ? 1 : seg(p, 0.0, 0.22);
    day2.style.setProperty('--ring', (1 - ring).toFixed(3));
    day2.style.setProperty('--ring-s', (1 + 3 * ring).toFixed(3));
    day2.style.setProperty('--copy', (reduced ? 1 : seg(p, 0.1, 0.28)).toFixed(3));
    day2.style.setProperty('--stamp', (reduced ? 1 : seg(p, 0.36, 0.5)).toFixed(3));
  }

  /* The agenda: a cursor walks the week as the section crosses the viewport; each day lights up as it is reached. */
  function drawProcess(p) {
    if (!agenda) return;
    const cursor = reduced ? 1 : easeInOut(seg(p, 0.1, 0.62));
    agenda.style.setProperty('--cursor', cursor.toFixed(4));
    const dayAt = cursor * (AGENDA_DAYS - 1);
    stepEls.forEach((s) => {
      const day = parseFloat(s.style.getPropertyValue('--d')) || 0;
      s.classList.toggle('is-on', reduced || dayAt >= day - 0.02);
    });
    tickEls.forEach((k, n) => k.classList.toggle('is-on', reduced || dayAt >= n - 0.02));
  }

  function drawContact(p) {
    if (!contact || reduced) return;
    contact.style.setProperty('--cy', ((0.5 - p) * 60).toFixed(1) + 'px');
  }

  function drawChrome(vh, y, rects) {
    const max = Math.max(1, d.documentElement.scrollHeight - vh);
    if (progressBar) progressBar.style.setProperty('--read', (y / max).toFixed(4));
    const probe = nav ? nav.offsetHeight : 0;
    let light = false;
    let seen = false;
    let railLight = false;
    const mid = vh * 0.5;
    // Sections overlap while a sheet slides over a held scene: the later one is on top, so the last match wins.
    // A stage opening through a dab is held at the top of the screen before its section gets there.
    for (const el of sectionEls) {
      const r = rects.get(el);
      if (!r) continue;
      const top = el._open > 0.55 ? 0 : r.top;
      if (top <= probe && r.bottom > probe) { light = el.dataset.tone === 'light'; seen = true; }
      if (top <= mid && r.bottom > mid) railLight = el.dataset.tone === 'light';
    }
    if (nav) {
      if (hero) {
        const heroEnd = hero.offsetTop + hero.offsetHeight - vh * 0.9;
        nav.classList.toggle('is-solid', y > heroEnd);
        d.body.classList.toggle('past-hero', y > heroEnd);
      }
      if (hero || seen) nav.classList.toggle('on-light', light);
    }
    // Current chapter: the last chapter section whose top has passed 40% of the viewport.
    let cur = 'forest';
    let curEl = null;
    for (const el of chapterEls) {
      const r = rects.get(el) || el.getBoundingClientRect();
      if (r.top <= vh * 0.4) { cur = el.dataset.chapter; curEl = el; }
    }
    if (rail) {
      rail.classList.toggle('on-light', railLight);
      const idx = Math.max(0, CHAPTERS.findIndex((c) => c.id === cur));
      // The line fills to the current dab, then through it as the chapter's last section is read.
      let within = 0;
      const lastOfChapter = chapterEls.filter((el) => el.dataset.chapter === cur).pop() || curEl;
      if (lastOfChapter) {
        const r = rects.get(lastOfChapter) || lastOfChapter.getBoundingClientRect();
        within = clamp((vh * 0.4 - r.top) / Math.max(1, r.height));
      }
      rail.style.setProperty('--fill', ((idx + within) / Math.max(1, CHAPTERS.length - 1)).toFixed(4));
    }
    if (cur !== lastChapter) {
      lastChapter = cur;
      const ch = CHAPTERS.find((c) => c.id === cur) || CHAPTERS[0];
      root.style.setProperty('--chapter', ch.color);
      d.querySelectorAll('.rail-dot').forEach((b) => { if (b.dataset.chapter === cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
      railSay(t(ch.key));
      if (rail && !reduced) {
        rail.classList.add('is-telling');
        clearTimeout(rail._tell);
        rail._tell = setTimeout(() => rail.classList.remove('is-telling'), 1600);
      }
      d.querySelectorAll('.nav-links a').forEach((a) => {
        if (a.dataset.page) return;
        const id = (a.getAttribute('href') || '').slice(1);
        const sec = $(id);
        if (sec && sec.dataset.chapter === cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
    }
  }

  let ticking = false;
  function frame() {
    ticking = false;
    const vh = window.innerHeight;
    const y = window.scrollY || window.pageYOffset;
    // Read everything first, then write, so the browser lays out once per frame.
    const rects = new Map();
    for (const el of sectionEls) rects.set(el, el.getBoundingClientRect());
    for (const el of chapterEls) if (!rects.has(el)) rects.set(el, el.getBoundingClientRect());
    const rHero = hero && rects.get(hero);
    const rChecks = checksSec && rects.get(checksSec);
    const checkTops = (rChecks && rChecks.bottom > 0 && rChecks.top < vh) ? checkRows.map((r) => r.getBoundingClientRect().top) : null;
    const rProcess = processSec && rects.get(processSec);
    const rFox = fox && rects.get(fox);
    const rSame = same && rects.get(same);
    // Where the dab opens: the centre of the site that was finished by hand (only read while it opens).
    let dabFrom = null;
    // How far the dab has opened onto the fox (null when the lookalike sheet is not pinned, so there is no dab).
    const foxOpen = same && same._cover && rSame ? coverOf(same, rSame, vh) : null;
    if (same && same._cover && rSame) {
      const k = foxOpen;
      const chosen = k > 0 && k < 1 && $('tiles') ? $('tiles').querySelector('.tile.is-chosen') : null;
      if (chosen) { const t0 = chosen.getBoundingClientRect(); dabFrom = { x: t0.left + t0.width / 2, y: t0.top + t0.height / 2 }; }
    }

    if (hero && rHero) {
      heroP = progressOf(hero, rHero, vh);
      const clipP = clipProgress(hero, rHero, vh);
      // Pin progress: 1 once the hero's own travel is done (the covering sheet then slides over the held stage).
      const travel = rHero.height - vh - (hero._cover || 0);
      const pinP = travel > 0 ? clamp(-rHero.top / travel) : 1;
      // 0 scrubbed, 1 released (free run), 2 gone (fully covered or scrolled away): a change of mode always reaches drawHero.
      const gone = hero._cover ? coverOf(hero, rHero, vh) >= 1 : rHero.bottom <= 0;
      const heroMode = pinP >= 1 ? (gone ? 2 : 1) : 0;
      if (!motesRunning || heroP !== lastHeroP || heroMode !== lastHeroMode) { drawHero(clipP, pinP, heroMode === 2); lastHeroP = heroP; lastHeroMode = heroMode; }
    }
    if (same && rSame && (reduced || (rSame.bottom > 0 && rSame.top < vh))) drawSame(progressOf(same, rSame, vh));
    if (fox && rFox) drawFox(progressOf(fox, rFox, vh), rFox.bottom > -vh && rFox.top < vh * 2, foxOpen);
    drawCovers(rects, vh, dabFrom);
    if (services) drawServices(progressOf(services, rects.get(services), vh));
    if (checkTops || reduced) drawChecks(vh, checkTops);
    if (day2) drawDay2(progressOf(day2, rects.get(day2), vh));
    if (rProcess && (reduced || (rProcess.bottom > 0 && rProcess.top < vh))) drawProcess(progressOf(processSec, rProcess, vh));
    if (contact) drawContact(progressOf(contact, rects.get(contact), vh));
    drawChrome(vh, y, rects);
  }
  function requestFrame() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(frame);
  }

  function layout() {
    const vh = window.innerHeight;
    [hero, same, fox, day2].forEach((el) => { if (el) el._pinned = isPinned(el); });
    measureCovers();
    const stage = services && services.querySelector('.pin-stage');
    horizontal = !!services && !!stage && !reduced && window.innerWidth > 900;
    if (services && track) {
      if (horizontal) {
        track.style.transform = '';
        svcDist = Math.max(0, track.scrollWidth - stage.clientWidth);
        services.style.height = Math.round(vh + svcDist + vh * 0.2) + 'px';
      } else {
        svcDist = 0;
        services.style.height = '';
      }
      services._pinned = horizontal && isPinned(services);
    }
    const small = window.innerWidth <= 720;
    const $tiles = $('tiles');
    if ($tiles && $tiles.dataset.size !== String(small ? 4 : 6)) renderTiles();
    d.querySelectorAll('img[data-src-m]').forEach(pickStill);
    sizeMotes();
    placeSpots();
    frame();
  }

  /* ── Hero motes: a little pollen and a few paint specks, so the frame breathes while the hand rests ── */
  const canvas = hero && hero.querySelector('.hero-motes');
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  let motes = [];
  let motesRunning = false;
  let heroVisible = true;
  let lastT = 0;
  let prevW = 0;
  let prevH = 0;
  function sizeMotes() {
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (motes.length && prevW && prevH) {
      const kx = w / prevW;
      const ky = h / prevH;
      motes.forEach((m) => { m.x *= kx; m.y *= ky; });
    } else {
      const n = w < 720 ? 18 : 36;
      const specks = [PAINT.blue, PAINT.yellow, PAINT.orange, PAINT.pink, PAINT.purple, PAINT.cyan];
      motes = Array.from({ length: n }, (_, i) => {
        const paint = i % 6 === 0;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: paint ? 1.5 + Math.random() * 1.4 : 0.6 + Math.random() * 1.2,
          vy: -(0.005 + Math.random() * 0.014),
          sway: 0.4 + Math.random() * 1.2,
          ph: Math.random() * Math.PI * 2,
          a: paint ? 0.7 : 0.2 + Math.random() * 0.35,
          c: paint ? specks[i % specks.length] : '#fff6dc',
          depth: 0.4 + Math.random() * 0.9,
        };
      });
    }
    prevW = w;
    prevH = h;
  }
  function tickMotes(now) {
    if (!motesRunning) return;
    const dt = Math.min(48, now - (lastT || now));
    lastT = now;
    ptr.x += (ptr.tx - ptr.x) * 0.06;
    ptr.y += (ptr.ty - ptr.y) * 0.06;
    if (ctx) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      const lift = heroP * 160;
      for (const m of motes) {
        m.y += m.vy * dt * m.depth;
        m.ph += dt * 0.0012;
        if (m.y < -20) { m.y = h + 20; m.x = Math.random() * w; }
        const x = m.x + Math.sin(m.ph) * 14 * m.sway + ptr.x * -14 * m.depth;
        const y = ((m.y - lift * m.depth) % (h + 40) + h + 40) % (h + 40) - 20;
        ctx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(m.ph * 1.7));
        ctx.fillStyle = m.c;
        ctx.beginPath();
        ctx.arc(x, y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(tickMotes);
  }
  function updateMotes() {
    const should = !reduced && heroVisible && !d.hidden && !!hero;
    if (should && !motesRunning) {
      motesRunning = true;
      lastT = 0;
      requestAnimationFrame(tickMotes);
    } else if (!should && motesRunning) {
      motesRunning = false;
      if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  /* ── Navigation ── */
  function goTo(id) {
    const el = $(id);
    if (!el) return;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    closeMenu();
  }
  function closeMenu() {
    if (!nav) return;
    nav.classList.remove('is-open');
    const b = nav.querySelector('.nav-burger');
    if (b) b.setAttribute('aria-expanded', 'false');
  }

  /* ── Contact (mailto draft) ── */
  const dlg = $('contact-dialog');
  const form = $('contact-form');
  function contactParts() {
    const email = $('f-email').value.trim();
    const sel = $('f-offer');
    const offer = sel.value;
    const offerLabel = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text.trim() : '';
    const link = $('f-link').value.trim();
    const message = $('f-msg').value.trim();
    const cfg = SITE.contact && typeof SITE.contact === 'object' ? SITE.contact : {};
    const args = { email, offer, offerLabel, link, message, lang };
    let subject = 'v2 studio';
    let body = `${email}\n${offerLabel}\n${link ? link + '\n' : ''}\n${message}`;
    try { if (typeof cfg.subject === 'function') subject = cfg.subject(args) || subject; } catch (e) { /* keep default */ }
    try { if (typeof cfg.body === 'function') body = cfg.body(args) || body; } catch (e) { /* keep default */ }
    const to = (typeof cfg.email === 'string' && cfg.email) || EMAIL;
    return { to, subject, body };
  }
  function fillRecap() {
    const recap = $('f-back');
    const chosen = d.querySelector('#f-offer-picks input:checked');
    if (!recap || !chosen) return;
    const pkg = chosen.closest('.pkg');
    const art = pkg.querySelector('.pkg-art');
    const copy = pkg.querySelector('.pkg-copy');
    const price = pkg.querySelector('.pkg-price');
    recap.style.setProperty('--pig', pkg.style.getPropertyValue('--pig'));
    recap.innerHTML = (art ? art.outerHTML : '')
      + `<span class="pkg-copy">${copy ? copy.innerHTML : ''}<span class="pkg-change">${esc(t('contact_step_back'))}</span></span>`
      + (price ? price.outerHTML : '');
  }
  function paintContactStep() {
    if (!dlg) return;
    const step = dlg.dataset.step === '2' ? 2 : 1;
    const sub = dlg.querySelector('.dlg-sub');
    if (sub) sub.textContent = t(step === 2 ? 'contact_modal_subtitle' : 'contact_step1_sub');
    if (step === 2) fillRecap();
  }
  function setContactStep(step) {
    if (!dlg) return;
    const n = step === 2 ? '2' : '1';
    dlg.dataset.step = n;
    dlg.querySelectorAll('[data-pane]').forEach((pane) => { pane.hidden = pane.dataset.pane !== n; });
    dlg.querySelectorAll('.dlg-step').forEach((li) => {
      if (li.dataset.stepDot === n) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    paintContactStep();
    dlg.scrollTop = 0;
  }
  function openContact(offer) {
    if (!dlg) return;
    const sel = $('f-offer');
    const named = !!(offer && OFFER_IDS.includes(offer));
    if (sel) sel.value = named ? offer : (offer ? 'unsure' : sel.value || OFFER_IDS[0]);
    syncOfferPicks();
    $('f-status').textContent = '';
    setContactStep(named ? 2 : 1);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    setTimeout(() => {
      const msg = $('f-msg');
      const picked = d.querySelector('#f-offer-picks input:checked');
      if (named && msg) msg.focus();
      else if (picked) picked.focus();
    }, 30);
  }
  function closeContact() {
    if (!dlg) return;
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const { to, subject, body } = contactParts();
      $('f-status').textContent = t('contact_btn_sending');
      window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      setTimeout(() => { $('f-status').textContent = t('contact_btn_done'); }, 600);
    });
    $('dlg-close').addEventListener('click', closeContact);
    const next = $('f-next');
    if (next) next.addEventListener('click', () => {
      setContactStep(2);
      const msg = $('f-msg');
      if (msg) msg.focus();
    });
    const back = $('f-back');
    if (back) back.addEventListener('click', () => {
      setContactStep(1);
      const picked = d.querySelector('#f-offer-picks input:checked');
      if (picked) picked.focus();
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeContact(); });
  }

  /* ── Assistant (SSE from /api/hrhv) ── */
  const chat = $('chat');
  const chatToggle = $('chat-toggle');
  const msgs = $('chat-msgs');
  const input = $('chat-input');
  const sendBtn = $('chat-send');
  const suggs = $('chat-suggs');
  const MAX_Q = 10;
  const history = [];
  let asked = 0;
  let streaming = false;

  function md(text) {
    const safe = esc(text);
    return safe.split(/\n{2,}/).map((block) => {
      const html = block
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/(^|\n)[-*]\s+/g, '$1• ')
        .replace(/\n/g, '<br>');
      return `<p>${html}</p>`;
    }).join('');
  }
  function bubble(role, text) {
    const div = d.createElement('div');
    div.className = 'bubble ' + role;
    if (role === 'assistant') div.innerHTML = md(text); else div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }
  function updateSend() {
    const limit = asked >= MAX_Q;
    input.disabled = limit;
    if (limit) input.placeholder = t('chat_limit_placeholder');
    sendBtn.disabled = streaming || limit || !input.value.trim();
  }
  function setChat(open) {
    chat.hidden = !open;
    chatToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      if (!msgs.children.length) bubble('assistant', t('chat_greeting'));
      setTimeout(() => { if (!input.disabled) input.focus(); }, 60);
    }
  }
  async function send(text) {
    text = String(text || '').trim().slice(0, 600);
    if (!text || streaming || asked >= MAX_Q) return;
    suggs.hidden = true;
    asked++;
    bubble('user', text);
    history.push({ role: 'user', content: text });
    input.value = '';
    streaming = true;
    updateSend();
    const typing = bubble('assistant typing', '…');
    let full = '';
    let errored = false;
    let out = null;
    try {
      const res = await fetch('/api/hrhv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, persona: 'agency', lang: SITE.locale || lang }),
      });
      if (res.status === 429) {
        typing.remove();
        history.pop();
        asked = Math.max(0, asked - 1);
        bubble('assistant', t('chat_rate_limited'));
        return;
      }
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      typing.remove();
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let ev = 'message';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const raw of lines) {
          const line = raw.replace(/\r$/, '');
          if (line === '') { ev = 'message'; continue; }
          if (line.startsWith('event:')) { ev = line.slice(6).trim(); continue; }
          if (!line.startsWith('data:')) continue;
          if (ev === 'error') { errored = true; continue; }
          try {
            const data = JSON.parse(line.slice(5).trim());
            if (data && typeof data.text === 'string' && data.text) {
              full += data.text;
              if (!out) out = bubble('assistant', '');
              out.innerHTML = md(full);
              msgs.scrollTop = msgs.scrollHeight;
            }
          } catch (e) { /* partial line */ }
        }
      }
      if (full) history.push({ role: 'assistant', content: full }); else history.pop();
      if (errored) bubble('assistant', t('chat_error'));
      else if (!full) bubble('assistant', t('chat_empty'));
      if (asked >= MAX_Q) bubble('assistant', t('chat_limit_msg'));
    } catch (e) {
      typing.remove();
      if (history.length && history[history.length - 1].role === 'user') history.pop();
      bubble('assistant', t('chat_error'));
    } finally {
      streaming = false;
      updateSend();
    }
  }
  if (chat && chatToggle) {
    chatToggle.addEventListener('click', () => setChat(chat.hidden));
    $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 110) + 'px';
      updateSend();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) send(input.value); }
    });
    suggs.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) send(b.textContent);
    });
  }

  /* ── Wiring ── */
  function toggleDisclosure(btn, wrapClass, panelSel) {
    const wrap = btn.closest(wrapClass);
    const open = !wrap.classList.contains('is-open');
    wrap.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    const panel = wrap.querySelector(panelSel);
    if (open) panel.removeAttribute('inert'); else panel.setAttribute('inert', '');
  }
  d.addEventListener('click', (e) => {
    const moreBtn = e.target.closest('.more-btn');
    if (moreBtn) { toggleDisclosure(moreBtn, '.more', '.more-panel'); return; }
    const qaBtn = e.target.closest('.qa-q');
    if (qaBtn) {
      toggleDisclosure(qaBtn, '.qa', '.qa-panel');
      // an open question puts its own address in the URL, so the answer can be shared
      const row = qaBtn.closest('.qa');
      if (row && row.id && row.classList.contains('is-open')) { try { history.replaceState(null, '', '#' + row.id); } catch (err) { /* sandboxed frame */ } }
      return;
    }
    const trackBtn = e.target.closest('.price-track');
    if (trackBtn) { setCardTrack(trackBtn.dataset.cardTrack, trackBtn.dataset.track); return; }
    const ckBtn = e.target.closest('.ck-btn');
    if (ckBtn) { const row = ckBtn.closest('.ck'); openCheck(row, !row.classList.contains('is-open')); return; }
    const spotBtn = e.target.closest('.spot-btn');
    if (spotBtn) {
      const el = spotBtn.closest('.spot');
      const open = !el.classList.contains('is-open');
      closeSpots(el);
      el.classList.toggle('is-open', open);
      spotBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      const card = el.querySelector('.spot-card');
      card.hidden = !open;
      card.style.translate = '';
      if (open) {
        // Keep the note inside the viewport (phones crop the frame hard).
        const r = card.getBoundingClientRect();
        const padX = 12;
        let dx = 0;
        if (r.left < padX) dx = padX - r.left;
        else if (r.right > window.innerWidth - padX) dx = window.innerWidth - padX - r.right;
        if (dx) card.style.translate = dx.toFixed(1) + 'px 0';
      }
      return;
    }
    if (!e.target.closest('.spot')) closeSpots();
    const pickBtn = e.target.closest('.pick-btn');
    if (pickBtn) {
      setPick(currentPick === pickBtn.dataset.pick ? '' : pickBtn.dataset.pick);
      if (currentPick && window.innerWidth <= 1080) {
        // Phones swipe the cards sideways: bring the picked one to the middle of the row, not just into view.
        const card = d.querySelector(`.price[data-card="${currentPick}"]`);
        if (card) card.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: window.innerWidth <= 900 ? 'nearest' : 'center', inline: 'center' });
      }
      return;
    }
    const railDot = e.target.closest('.rail-dot');
    if (railDot) {
      const ch = CHAPTERS.find((c) => c.id === railDot.dataset.chapter);
      if (ch) { root.style.setProperty('--chapter', ch.color); goTo(ch.target); }
      return;
    }
    // The order flow lives in agence-checkout.js; without it, an order button still opens the email form.
    const orderBtn = e.target.closest('[data-order]');
    if (orderBtn && !window.agenceOrder) { e.preventDefault(); openContact(orderBtn.dataset.order || ''); return; }
    const offerBtn = e.target.closest('[data-offer]');
    // Package cards inside the dialog also sit on offer ids; they only change the radio.
    if (offerBtn && !offerBtn.closest('#contact-dialog')) { e.preventDefault(); openContact(offerBtn.dataset.offer || ''); return; }
    const a = e.target.closest('a[href^="#"]');
    if (a) {
      const id = a.getAttribute('href').slice(1);
      if (id && $(id)) {
        e.preventDefault();
        if (a.dataset.pickOffer) setPick(a.dataset.pickOffer);
        goTo(id);
        try { window.history.replaceState(null, '', '#' + id); } catch (err) { /* ignore */ }
      }
    }
  });
  if (rail) {
    const say = (e) => {
      const b = e.target.closest('.rail-dot');
      const ch = b && CHAPTERS.find((c) => c.id === b.dataset.chapter);
      if (ch) railSay(t(ch.key));
    };
    rail.addEventListener('pointerover', say);
    rail.addEventListener('focusin', say);
    const back = () => { const ch = CHAPTERS.find((c) => c.id === lastChapter) || CHAPTERS[0]; railSay(t(ch.key)); };
    rail.addEventListener('pointerleave', back);
    rail.addEventListener('focusout', (e) => { if (!rail.contains(e.relatedTarget)) back(); });
  }
  d.addEventListener('keydown', (e) => {
    const b = e.target.closest && e.target.closest('.price-track');
    if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const all = Array.from(b.parentElement.querySelectorAll('.price-track'));
    const i = all.indexOf(b) + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
    const next = all[(i + all.length) % all.length];
    e.preventDefault();
    setCardTrack(next.dataset.cardTrack, next.dataset.track);
    next.focus();
  });
  // Keyboard users reach the lateral service cards: scroll the pin to the focused card.
  d.addEventListener('focusin', (e) => {
    if (!horizontal || !track || !track.contains(e.target)) return;
    centerService(e.target.closest('.svc'), 'instant');
  });
  // Warm the proof picture as soon as the pointer or the focus reaches its button.
  // A click on a waiting card brings it to the middle and makes it the active one.
  if (track) track.addEventListener('click', (e) => {
    const card = e.target.closest('.svc');
    if (!card || card.classList.contains('is-active') || e.target.closest('a, button')) return;
    centerService(card, reduced ? 'instant' : 'smooth');
  });
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeSpots();
    if (chat && !chat.hidden) { setChat(false); chatToggle.focus(); }
    closeMenu();
  });
  const burger = nav && nav.querySelector('.nav-burger');
  if (burger) {
    burger.addEventListener('click', () => {
      const open = !nav.classList.contains('is-open');
      nav.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // The order steps under the cards follow the payment mode the server reports (agence-checkout.js).
  window.addEventListener('agence:paymode', renderOrderSteps);
  window.addEventListener('scroll', requestFrame, { passive: true });
  let resizeT = 0;
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      // A phone's URL bar only changes the height: redraw, do not relayout.
      if (window.innerWidth === lastW) { frame(); return; }
      lastW = window.innerWidth;
      layout();
    }, 120);
  });
  if (finePointer) {
    window.addEventListener('pointermove', (e) => {
      ptr.tx = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.ty = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }
  const onReduced = () => { reduced = reducedMq.matches; renderAll(); layout(); updateMotes(); };
  if (reducedMq.addEventListener) reducedMq.addEventListener('change', onReduced);
  d.addEventListener('visibilitychange', updateMotes);
  if (hero && 'IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      heroVisible = entries[0].isIntersecting;
      updateMotes();
    }).observe(hero);
  }
  // The fox clip loads when its stage is one viewport away, never before.
  if (fox && foxScrub && !reduced && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      foxScrub.load();
      io.disconnect();
    }, { rootMargin: '100% 0px 100% 0px' });
    io.observe(fox);
  }
  // Reduced motion: the hero keeps the surface (the whale poster); the fox shows its arrival frame.
  if (reduced) {
    const fp = fox && fox.querySelector('.stage-poster');
    if (fp) { fp.dataset.srcM = '/images/agence-fox-close-m.jpg'; fp.dataset.srcD = '/images/agence-fox-close.jpg'; fp.setAttribute('src', '/images/agence-fox-close.jpg'); }
  }

  if ('ResizeObserver' in window && track) {
    let roT = 0;
    let lastTW = 0;
    new ResizeObserver(() => {
      if (track.scrollWidth === lastTW) return;
      lastTW = track.scrollWidth;
      clearTimeout(roT);
      roT = setTimeout(layout, 80);
    }).observe(track);
  }

  setLang(lang, false);
  watchFacts();
  updateMotes();
  if (heroScrub && !reduced) heroScrub.load();
  if (d.fonts && d.fonts.ready) d.fonts.ready.then(layout);
  window.addEventListener('load', layout);
  if (location.hash && $(location.hash.slice(1))) {
    setTimeout(() => $(location.hash.slice(1)).scrollIntoView({ block: 'start' }), 60);
    // a link to one question opens its answer
    const faqRow = /^#faq-[a-z0-9-]+$/.test(location.hash) ? $(location.hash.slice(1)) : null;
    const faqBtn = faqRow && faqRow.querySelector('.qa-q');
    if (faqBtn && !faqRow.classList.contains('is-open')) toggleDisclosure(faqBtn, '.qa', '.qa-panel');
  }
})();
