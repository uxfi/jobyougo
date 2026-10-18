/* v2 studio (/agence) page data + window.SITE hooks.
   Classic script: runs after data.js and before agence-i18n.js / app.js. Loaded on /agence only.
   - AGENCY_OFFERS: single source for the price cards AND the chatbot prompt. lib/agence-site.mjs
     JSON.parses the text between the two markers below, so it must stay STRICT JSON
     (double quotes, no comments, no trailing commas).
   - Mutates PROJECTS / PROJECT_METHODS for this page only (hidden cases, O-H18 corrections,
     no en/em dashes in displayed strings). data.js itself is never edited.
   - Hooks read TRANSLATIONS lazily (agence-i18n.js loads after this file). */

const AGENCY_OFFERS = /*OFFERS_JSON*/{
  "currency": "USD",
  "offers": [
    {
      "id": "refonte",
      "name": {
        "en": "Redesign",
        "fr": "Refonte"
      },
      "price": 390,
      "cadence": "one-off",
      "checkout": "card",
      "pages": {
        "en": "1 page or 1 flow",
        "fr": "1 page ou 1 parcours"
      },
      "highlighted": false,
      "workingDays": 5,
      "for": {
        "en": "Your site, app or SaaS page is live and gets visits, but people leave before they act.",
        "fr": "Votre site, votre app ou votre page SaaS est en ligne et reçoit des visites, mais les visiteurs partent avant d’agir."
      },
      "outcome": {
        "en": "The page your customers see first, redesigned and coded, ready for your developer.",
        "fr": "La page que vos clients voient en premier, repensée et codée, prête pour votre développeur."
      },
      "note": {
        "en": "You get the coded redesign and its source. Your developer puts it live.",
        "fr": "Vous recevez la refonte codée et son code source. Votre développeur la met en ligne."
      },
      "includes_icons": [
        "page",
        "devices",
        "code",
        "grid",
        "call",
        "notes",
        "chart"
      ],
      "includes": {
        "en": [
          "1 key page (up to 6 sections, plus header and footer) or 1 key flow (up to 5 screens), redesigned",
          "Desktop and mobile versions, with your real content",
          "Clickable prototype coded in Cursor or Claude Code, with the source",
          "The 12 checks, with the completed and signed grid",
          "30-min kickoff call",
          "Handoff notes for your developer",
          "A 30-day follow-up call to look at your numbers together"
        ],
        "fr": [
          "1 page clé (jusqu’à 6 sections, plus en-tête et pied de page) ou 1 parcours clé (jusqu’à 5 écrans), repensé",
          "Versions desktop et mobile, avec vos vrais contenus",
          "Prototype cliquable codé dans Cursor ou Claude Code, avec le code source",
          "Les 12 contrôles, avec la grille complétée et signée",
          "Appel de lancement de 30 min",
          "Notes de passation pour votre développeur",
          "Un appel de suivi à 30 jours pour regarder vos chiffres ensemble"
        ]
      },
      "delivery": {
        "en": "5 business days",
        "fr": "5 jours ouvrés"
      },
      "revisions": {
        "en": "1 round",
        "fr": "1 aller-retour"
      },
      "revisions_detail": {
        "en": "After delivery, within the agreed brief, to be used within 14 days of delivery.",
        "fr": "Après livraison, dans le cadre du brief validé, à utiliser dans les 14 jours suivant la livraison."
      },
      "not_included": {
        "en": [
          "Other pages or flows (add-ons at posted prices)",
          "Copywriting from scratch (add-on). We edit and tighten your text.",
          "Integration into your CMS, codebase or back end",
          "A new brand identity",
          "Hosting"
        ],
        "fr": [
          "Autres pages ou parcours (options à prix affichés)",
          "Rédaction complète (option). Nous retravaillons et resserrons vos textes.",
          "Intégration dans votre CMS, votre code ou votre back-end",
          "Une nouvelle identité de marque",
          "Hébergement"
        ]
      },
      "cta": {
        "en": "Order a Redesign",
        "fr": "Commander une refonte"
      },
      "mail_subject": {
        "en": "v2 studio · Redesign · {name}",
        "fr": "v2 studio · Refonte · {name}"
      }
    },
    {
      "id": "creation",
      "name": {
        "en": "Build",
        "fr": "Création"
      },
      "price": 590,
      "cadence": "one-off",
      "checkout": "card",
      "pages": {
        "en": "1 page or 1 flow",
        "fr": "1 page ou 1 parcours"
      },
      "highlighted": true,
      "workingDays": 7,
      "for": {
        "en": "You are launching an offer, a landing page or an AI product idea, and nothing is built yet.",
        "fr": "Vous lancez une offre, une landing page ou une idée de produit IA, et rien n’est encore construit."
      },
      "outcome": {
        "en": "A first version people can use: a landing page that is live, or an AI prototype that answers for real.",
        "fr": "Une première version utilisable : une landing page en ligne, ou un prototype IA qui répond pour de vrai."
      },
      "tracks": [
        {
          "id": "landing",
          "name": {
            "en": "Landing page",
            "fr": "Landing page"
          },
          "includes_icons": [
            "page",
            "code",
            "text",
            "tag"
          ],
          "includes": {
            "en": [
              "One new page (up to 6 sections), built in code",
              "Deployed to a preview link or your domain",
              "UX copy: headings, buttons, forms, errors",
              "Title, meta description and share preview set up"
            ],
            "fr": [
              "Une nouvelle page (jusqu’à 6 sections), développée en code",
              "Mise en ligne sur un lien de prévisualisation ou votre domaine",
              "Textes d’interface : titres, boutons, formulaires, erreurs",
              "Titre, meta description et aperçu de partage configurés"
            ]
          }
        },
        {
          "id": "ai",
          "name": {
            "en": "AI prototype",
            "fr": "Prototype IA"
          },
          "includes_icons": [
            "ai",
            "code",
            "notes",
            "eye"
          ],
          "includes": {
            "en": [
              "A clickable prototype of one core flow (up to 5 screens)",
              "Real model calls, on test data",
              "A plan for the prompts and the data",
              "A second check on the model’s answers"
            ],
            "fr": [
              "Un prototype cliquable d’un parcours clé (jusqu’à 5 écrans)",
              "De vrais appels au modèle, sur des données de test",
              "Un plan des prompts et des données",
              "Une seconde vérification des réponses du modèle"
            ]
          }
        }
      ],
      "includes_icons": [
        "map",
        "devices",
        "grid",
        "code",
        "wrench",
        "chart"
      ],
      "includes": {
        "en": [
          "Kickoff call to map the user journey",
          "Desktop and mobile versions",
          "The 12 checks, with the completed and signed grid",
          "Source code and handoff notes",
          "Small fixes for 14 days after delivery",
          "A 30-day follow-up call to look at your numbers together"
        ],
        "fr": [
          "Appel de lancement pour cartographier le parcours utilisateur",
          "Versions desktop et mobile",
          "Les 12 contrôles, avec la grille complétée et signée",
          "Code source et notes de passation",
          "Petites corrections pendant les 14 jours suivant la livraison",
          "Un appel de suivi à 30 jours pour regarder vos chiffres ensemble"
        ]
      },
      "delivery": {
        "en": "7 business days",
        "fr": "7 jours ouvrés"
      },
      "revisions": {
        "en": "2 rounds + 14 days of fixes",
        "fr": "2 allers-retours + 14 jours de corrections"
      },
      "revisions_detail": {
        "en": "After delivery, within the agreed brief. Rounds and small fixes both run in the 14 days after delivery.",
        "fr": "Après livraison, dans le cadre du brief validé. Allers-retours et petites corrections courent pendant les 14 jours suivant la livraison."
      },
      "not_included": {
        "en": [
          "Domain name and hosting fees",
          "AI model usage costs (billed by the provider to your account)",
          "Back end, user accounts, database or payments",
          "Marketing copy from scratch (add-on). We edit and tighten your text.",
          "Extra pages or flows (add-ons at posted prices)",
          "A second language version",
          "Ongoing maintenance"
        ],
        "fr": [
          "Nom de domaine et frais d’hébergement",
          "Coûts d’utilisation des modèles IA (facturés par le fournisseur sur votre compte)",
          "Back-end, comptes utilisateurs, base de données ou paiements",
          "Rédaction marketing complète (option). Nous retravaillons et resserrons vos textes.",
          "Pages ou parcours supplémentaires (options à prix affichés)",
          "Une version dans une deuxième langue",
          "Maintenance continue"
        ]
      },
      "cta": {
        "en": "Order a Build",
        "fr": "Commander une création"
      },
      "mail_subject": {
        "en": "v2 studio · Build · {name}",
        "fr": "v2 studio · Création · {name}"
      }
    },
    {
      "id": "accompagnement",
      "name": {
        "en": "Coaching",
        "fr": "Accompagnement"
      },
      "price": 90,
      "cadence": "month",
      "checkout": "subscription",
      "open": false,
      "highlighted": false,
      "for": {
        "en": "Founders and small teams who design and build their product themselves, often with AI tools, and want a senior product designer to look at their work.",
        "fr": "Fondateurs et petites équipes qui conçoivent et construisent leur produit eux-mêmes, souvent avec des outils d’IA, et veulent le regard d’un designer produit senior sur leur travail."
      },
      "outcome": {
        "en": "Two calls a month and written answers in between, so your team ships with a senior eye on every screen.",
        "fr": "Deux appels par mois et des réponses écrites entre les deux, pour que votre équipe livre avec un regard senior sur chaque écran."
      },
      "includes_icons": [
        "video",
        "message",
        "eye",
        "list",
        "sparkles",
        "cancel"
      ],
      "includes": {
        "en": [
          "2 video calls of 45 minutes a month",
          "Written questions between calls, answered within 1 business day",
          "A written, annotated review of up to 2 of your screens a month",
          "A short list of priorities after each call",
          "Help setting up an AI design workflow: prototype in Cursor or Claude Code, review, Git handoff",
          "Cancel any time before the next billing date"
        ],
        "fr": [
          "2 appels en visio de 45 minutes par mois",
          "Questions écrites entre les appels, réponse sous 1 jour ouvré",
          "Une revue écrite et annotée de 2 de vos écrans par mois",
          "Une courte liste de priorités après chaque appel",
          "Aide pour mettre en place une méthode de design avec l’IA : prototype dans Cursor ou Claude Code, revue, passation via Git",
          "Résiliable à tout moment avant la prochaine échéance"
        ]
      },
      "delivery": {
        "en": "Starts within 5 business days",
        "fr": "Démarrage sous 5 jours ouvrés"
      },
      "delivery_detail": {
        "en": "First call within 5 business days of payment. Billed monthly.",
        "fr": "Premier appel sous 5 jours ouvrés après le paiement. Facturé au mois."
      },
      "revisions": {
        "en": "Not applicable",
        "fr": "Sans objet"
      },
      "revisions_detail": {
        "en": "We review and advise, your team builds.",
        "fr": "Nous relisons et conseillons, votre équipe construit."
      },
      "not_included": {
        "en": [
          "Design or build work done for you (order a Redesign or a Build for that)",
          "Unused calls carried over to the next month",
          "Recorded video reviews",
          "On-site workshops"
        ],
        "fr": [
          "Travail de design ou de développement réalisé à votre place (commandez une Refonte ou une Création pour cela)",
          "Report des appels non utilisés sur le mois suivant",
          "Revues vidéo enregistrées",
          "Ateliers sur place"
        ]
      },
      "cta": {
        "en": "Join the waiting list",
        "fr": "Rejoindre la liste d’attente"
      },
      "mail_subject": {
        "en": "v2 studio · Coaching · {name}",
        "fr": "v2 studio · Accompagnement · {name}"
      }
    },
    {
      "id": "custom",
      "name": {
        "en": "Custom",
        "fr": "Sur devis"
      },
      "price": 2500,
      "cadence": "quote",
      "checkout": "call",
      "highlighted": false,
      "for": {
        "en": "Several pages, a full product, a design system or an AI feature built end to end.",
        "fr": "Plusieurs pages, un produit complet, un design system ou une fonctionnalité IA développée de bout en bout."
      },
      "outcome": {
        "en": "A written scope and a fixed quote within 2 business days of the call, with dates you can plan around.",
        "fr": "Un périmètre écrit et un devis fixe sous 2 jours ouvrés après l’appel, avec des dates sur lesquelles vous appuyer."
      },
      "pages": {
        "en": "Several pages or a full product",
        "fr": "Plusieurs pages ou un produit complet"
      },
      "note": {
        "en": "Paid in two parts: a deposit to book the dates, the balance at delivery. Both amounts are written in the quote.",
        "fr": "Réglé en deux fois : un acompte pour réserver les dates, le solde à la livraison. Les deux montants figurent au devis."
      },
      "includes_icons": [
        "call",
        "quote",
        "page",
        "devices",
        "code",
        "grid",
        "notes"
      ],
      "includes": {
        "en": [
          "30-min scoping call",
          "Written scope and a fixed quote, within 2 business days",
          "Pages, flows or product screens as listed in the scope",
          "Desktop and mobile versions, with your real content",
          "Built in code, with the source",
          "The 12 checks on every page, with the signed grids",
          "Handoff notes for your team"
        ],
        "fr": [
          "Appel de cadrage de 30 min",
          "Périmètre écrit et devis fixe, sous 2 jours ouvrés",
          "Pages, parcours ou écrans produit listés dans le périmètre",
          "Versions desktop et mobile, avec vos vrais contenus",
          "Développé en code, avec le code source",
          "Les 12 contrôles sur chaque page, grilles signées",
          "Notes de passation pour votre équipe"
        ]
      },
      "delivery": {
        "en": "Set in the quote",
        "fr": "Fixé au devis"
      },
      "revisions": {
        "en": "Set in the quote",
        "fr": "Fixés au devis"
      },
      "revisions_detail": {
        "en": "Rounds and dates are written in the quote before you pay.",
        "fr": "Allers-retours et dates sont écrits dans le devis avant le paiement."
      },
      "not_included": {
        "en": [
          "A full online shop, a native app from scratch, or a back end built in a week",
          "Hosting, domain and AI model usage fees",
          "Ongoing maintenance (quoted separately)"
        ],
        "fr": [
          "Une boutique en ligne complète, une app native de zéro, ou un back-end en une semaine",
          "Hébergement, nom de domaine et coûts des modèles IA",
          "Maintenance continue (devis séparé)"
        ]
      },
      "cta": {
        "en": "Book a scoping call",
        "fr": "Réserver un appel de cadrage"
      },
      "mail_subject": {
        "en": "v2 studio · Custom project · {name}",
        "fr": "v2 studio · Projet sur devis · {name}"
      }
    }
  ],
  "addons": [
    {
      "id": "extra-page",
      "name": {
        "en": "Extra page, same style",
        "fr": "Page supplémentaire, même style"
      },
      "price": 190,
      "for": [
        "refonte",
        "creation"
      ],
      "max": 5
    },
    {
      "id": "extra-flow",
      "name": {
        "en": "Extra flow, up to 5 screens",
        "fr": "Parcours supplémentaire, jusqu’à 5 écrans"
      },
      "price": 290,
      "for": [
        "refonte",
        "creation"
      ],
      "max": 3
    },
    {
      "id": "copy",
      "name": {
        "en": "Copywriting, per page",
        "fr": "Rédaction, par page"
      },
      "price": 150,
      "for": [
        "refonte",
        "creation"
      ],
      "max": 6
    },
    {
      "id": "revision",
      "name": {
        "en": "Extra revision round",
        "fr": "Aller-retour supplémentaire"
      },
      "price": 90,
      "for": [
        "refonte",
        "creation"
      ],
      "max": 3
    },
    {
      "id": "session",
      "name": {
        "en": "Extra coaching call",
        "fr": "Appel d’accompagnement supplémentaire"
      },
      "price": 45,
      "for": [
        "accompagnement"
      ],
      "max": 4,
      "open": false
    }
  ],
  "payment": {
    "one_off": {
      "en": "Paid in full before Day 1. Every payment gets an invoice.",
      "fr": "Réglé en totalité avant le jour 1. Chaque paiement donne lieu à une facture."
    },
    "month": {
      "en": "Billed monthly in advance. Cancel before the next billing date.",
      "fr": "Facturé chaque mois d’avance. Résiliable avant la prochaine échéance."
    },
    "quote": {
      "en": "A deposit to book the dates, the balance at delivery, as written in the quote.",
      "fr": "Un acompte pour réserver les dates, le solde à la livraison, comme écrit au devis."
    }
  },
  "custom": {
    "priceFrom": 2500,
    "en": "Custom project: several pages, a full product, a design system or an AI feature built end to end. Scoped on a 30-min call, fixed quote, from $2,500.",
    "fr": "Projet sur devis : plusieurs pages, un produit complet, un design system ou une fonctionnalité IA développée de bout en bout. Cadré lors d’un appel de 30 min, devis fixe, à partir de 2 500 $.",
    "cta": {
      "en": "Book a call",
      "fr": "Réserver un appel"
    },
    "mail_subject": {
      "en": "v2 studio · Custom project · {name}",
      "fr": "v2 studio · Projet sur devis · {name}"
    }
  }
}/*END_OFFERS_JSON*/;

/* ── Page data (not sent to the chatbot) ── */
const AGENCY_CALENDLY = 'https://calendly.com/chilka-v/30min';
const AGENCY_EMAIL = 'chilka.v@gmail.com';
const AGENCY_LINKEDIN = 'https://linkedin.com/in/hugovermot';

/* Section E: 4 services. Copy lives in agence-i18n.js (svc_N_title / _kicker / _promise / _del_K / _evidence). */
const AGENCY_SERVICES = [
  { n: 1, id: 'svc-redesign', icon: 'audit', offer: 'refonte', caseId: 'bmw', deliverables: 5 },
  { n: 2, id: 'svc-ux', icon: 'journey-mapping', offer: 'refonte', caseId: 'upviral', deliverables: 5 },
  { n: 3, id: 'svc-ai', icon: 'ai-agent', offer: 'creation', caseId: 'creads', deliverables: 4 },
  { n: 4, id: 'svc-coaching', icon: 'workshops', offer: 'accompagnement', caseId: null, deliverables: 5 },
];

/* Section I: proof cards (copy in proof_N_*). */
const AGENCY_PROOF = [
  { n: 1, caseId: 'bmw', offer: 'refonte', image: 'bmw-desktop-frame.webp', focus: 'center' },
  { n: 2, caseId: 'shiseido', offer: 'refonte', lead: true, image: 'shiseido-screenshot.webp', focus: 'center center' },
  { n: 3, caseId: 'sg', offer: 'refonte', image: 'societe-generale-desktop.png', fit: 'contain', focus: 'center' },
];

/* Section H: 12 checks (copy in check_N_*). Section F: 5 steps (step_N_*). No refund step (0): the Day 2 guarantee was dropped on 2026-10-12. */
const AGENCY_CHECK_COUNT = 12;
const AGENCY_STEP_COUNT = 5;
const AGENCY_REFUND_STEP = 0;

/* Section J: FAQ slugs, in order (faq_{slug}_q / faq_{slug}_a, ids faq-{slug}). */
const AGENCY_FAQ_SLUGS = ['new', 'scope', 'clock', 'revision', 'generic', 'who', 'inputs', 'ownership', 'payment', 'unhappy', 'cancel', 'bigger'];

/* Section L: package each case study leads to. */
const AGENCY_CASE_OFFER = {
  bmw: 'refonte', shiseido: 'refonte', sg: 'refonte', renault: 'refonte', upviral: 'refonte',
  edenred: 'refonte', casino: 'refonte', skiset: 'refonte', galian: 'refonte', sncf: 'refonte',
  oneasset: 'creation', lvmh: 'creation', creads: 'creation', uxfi: 'creation', flemme: 'creation',
  panfy: 'creation', jarvos: 'creation',
};

/* C8: attribution chip on each work-list row. */
const AGENCY_CHIP = {
  bmw: 'ctx_founder_work', shiseido: 'ctx_founder_work', sg: 'ctx_founder_work', renault: 'ctx_founder_work',
  lvmh: 'ctx_founder_work', upviral: 'ctx_founder_work', edenred: 'ctx_founder_work', casino: 'ctx_founder_work',
  skiset: 'ctx_founder_work', galian: 'ctx_founder_work', sncf: 'ctx_founder_work',
  oneasset: 'ctx_current_role',
  creads: 'ctx_in_house',
};

/* C10: real status of each in-house product (first bento badge; also used in the case banner). */
const AGENCY_STATUS = {
  uxfi: 'status_prototype', flemme: 'status_functional', panfy: 'status_on_hold',
  jarvos: 'status_in_progress', creads: 'status_launched',
};

/* C14: attribution banner under each case-study hero. */
const AGENCY_CASE_NOTE = {
  oneasset: 'case_note_current_role',
  creads: 'case_note_own_product', uxfi: 'case_note_own_product', flemme: 'case_note_own_product',
  panfy: 'case_note_own_product', jarvos: 'case_note_own_product',
};

/* B9 work order, O-H9 / O-H8 hidden cases, O-H10 hidden playground entries, O-H4 marquee excludes. */
const AGENCY_WORK_ORDER = ['bmw', 'shiseido', 'sg', 'oneasset', 'renault', 'lvmh', 'upviral', 'edenred', 'casino', 'skiset', 'galian', 'sncf', 'creads'];
const AGENCY_HIDDEN_IDS = ['arlequin', 'vloggy', 'challenge-live-ops', 'ancient-world'];
const AGENCY_IFACE_HIDDEN = ['devpilot-hero', 'hr-dashboard', 'remoterecruit-redesign', 'linkedin-jobs-playground'];
const AGENCY_MARQUEE_EXCLUDE = ['publicis', 'france'];

/* Section M: nav ticker. */
const AGENCY_TYPING = {
  en: [
    'Redesign: $390, delivered in 5 business days',
    'Prices on the page, scope on the card',
    '12 checks on every delivery',
    'Empty, loading and error states are part of the job',
    'Prototypes coded in Cursor and Claude Code',
    'You talk to the founder, from the call to the handoff',
    'Our founder has built AI products since 2022',
  ],
  fr: [
    'Refonte : 390 $, livrée en 5 jours ouvrés',
    'Prix affichés, périmètre écrit sur la carte',
    '12 contrôles à chaque livraison',
    'États vides, chargement, erreurs : tout est dessiné',
    'Prototypes codés dans Cursor et Claude Code',
    'Vous parlez au fondateur, de l’appel à la livraison',
    'Notre fondateur construit des produits IA depuis 2022',
  ],
};

/* ── Lookups shared with agence.js ── */
function agLang(lang) {
  if (lang === 'fr' || lang === 'en') return lang;
  return (typeof currentLang === 'string' && currentLang === 'fr') ? 'fr' : 'en';
}

/** TRANSLATIONS[lang][key], then the EN value, then ''. Never throws (TRANSLATIONS loads after this file). */
function agT(key, lang) {
  const l = agLang(lang);
  const dict = (typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS) ? TRANSLATIONS : null;
  if (!dict) return '';
  const own = dict[l] && dict[l][key];
  if (typeof own === 'string') return own;
  const en = dict.en && dict.en[key];
  return typeof en === 'string' ? en : '';
}

function agEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function agFill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}

function agOffer(id) {
  return AGENCY_OFFERS.offers.find(o => o.id === id) || null;
}

/** EN "$2,500" / FR "2 500 $" (no-break spaces), plus "/month" or "/mois" when monthly. */
function agPrice(amount, lang, monthly) {
  const l = agLang(lang);
  const n = Math.round(Number(amount) || 0);
  if (l === 'fr') {
    const grouped = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return grouped + ' $' + (monthly ? '/mois' : '');
  }
  return '$' + n.toLocaleString('en-US') + (monthly ? '/month' : '');
}

/** Page typography for strings reused from data.js / app.js: no en or em dash, typographic apostrophes.
    Ranges read "to"; a pair of em dashes becomes parentheses; a single em dash becomes ": " in short
    labels, "; " before an independent clause, ", " before a modifier, ": " before a list. */
const AG_DASH_COMMA_WORDS = /^(with|without|plus|never|and|but|or|so|not|from|to|including|for|then|which|where|while|only)$/i;
const AG_DASH_CLAUSE_WORDS = /^(the|it|its|this|that|they|we|you|i|he|she|these|those|there)$/i;
function agTidyText(value, isLabel) {
  let s = String(value == null ? '' : value);
  if (/[–—]/.test(s)) {
    s = s
      .replace(/\s*–\s*/g, ' to ')
      .replace(/^(\s*)—\s*/, '$1')
      .replace(/\s*—(\s*)$/, '$1')
      .replace(/\s+—\s+([^—.:]+?)\s+—\s+/g, ' ($1) ')
      .replace(/\s*—\s*/g, (m, offset, str) => {
        const before = str.slice(0, offset);
        const sentenceBefore = before.slice(before.lastIndexOf('. ') + 1);
        const clause = str.slice(offset + m.length).split(/[.!?](?:\s|$)/)[0];
        if (sentenceBefore.includes(':') || (isLabel && clause.includes(':'))) return ', ';
        if (isLabel) return ': ';
        const first = (clause.match(/^[A-Za-z]+/) || [''])[0];
        if (AG_DASH_COMMA_WORDS.test(first)) return ', ';
        if (AG_DASH_CLAUSE_WORDS.test(first)) return '; ';
        return (clause.match(/,/g) || []).length >= 2 ? ': ' : ', ';
      });
  }
  if (s.includes("'")) s = s.replace(/([A-Za-zÀ-ÿ])'([A-Za-zÀ-ÿ])/g, '$1’$2');
  return s;
}

const AGENCY_OFFER_IDS = ['refonte', 'creation', 'accompagnement', 'custom', 'unsure'];
function agOfferId(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return AGENCY_OFFER_IDS.includes(v) ? v : 'unsure';
}

/* ── PROJECTS overrides for /agence only (O-H9, O-H18, O-H16) ── */
(function agencyProjectOverrides() {
  if (typeof PROJECTS === 'undefined' || !Array.isArray(PROJECTS)) return;
  const byId = (id) => PROJECTS.find(p => p && p.id === id);
  AGENCY_HIDDEN_IDS.forEach((id) => { const p = byId(id); if (p) p.hidden = true; });
  // The services method count and tiles only reflect cases this page shows.
  if (typeof PROJECT_METHODS !== 'undefined' && PROJECT_METHODS) {
    PROJECTS.forEach((p) => { if (p && p.hidden && p.id) delete PROJECT_METHODS[p.id]; });
  }

  const findBlocks = (p, type) => (Array.isArray(p && p.narrative) ? p.narrative.filter(b => b && b.type === type) : []);
  const replaceIn = (obj, pattern, replacement) => {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      if (typeof v === 'string') obj[k] = v.replace(pattern, replacement);
      else if (v && typeof v === 'object') replaceIn(v, pattern, replacement);
    });
  };

  // Flemme OS: lead / outreach counts are not in article-digest (dg:129).
  const flemme = byId('flemme');
  if (flemme) {
    const text = 'Functional outbound automation platform: social monitoring, DM prospection and outreach sequences.';
    flemme.outcome = text;
    flemme.outcomeStat = 'Functional';
    findBlocks(flemme, 'outcome').forEach((b) => { b.text = text; b.stat = 'Functional'; });
    replaceIn(flemme, /[^.]*\b1,284\b[^.]*\.?/g, text);
    replaceIn(flemme, /[^.]*\b5,692\b[^.]*\.?/g, '');
  }

  // Skiset: satisfaction scores are in no source file.
  const skiset = byId('skiset');
  if (skiset) {
    const text = 'User tests on the interactive prototype found labeling and hierarchy issues, fixed screen by screen before handoff.';
    skiset.outcome = text;
    skiset.outcomeStat = null;
    findBlocks(skiset, 'outcome').forEach((b) => { b.text = text; delete b.stat; });
    replaceIn(skiset, /\s*15\/20 mobile(?: satisfaction)?,? 16\/20 desktop(?: satisfaction)?\.?/g, '');
    // O-H2: "led" only for Renault and UpViral; no unsourced superlative about the client.
    if (typeof skiset.solution === 'string') skiset.solution = skiset.solution.replace(/^Led the end-to-end/, 'Ran the end-to-end');
    replaceIn(skiset, /Redesigning Europe's #1 ski equipment rental platform\./g, 'Redesigning a ski equipment rental platform.');
    replaceIn(skiset, /#1 ski rental in Europe with direct station search entry/g, 'ski rental search with direct station entry');
  }

  // Shiseido: no unsourced superlative about the brand.
  replaceIn(byId('shiseido'), /one of the world's most iconic beauty brands/g, 'a global beauty brand');

  // "Documented" overstates figures the proof footnote calls reported (dg:42, dg:80).
  replaceIn(byId('sg'), /\bdocumented(?= \+12%)/g, 'reported');
  replaceIn(byId('bmw'), /\bThe documented result\b/g, 'The reported result');

  // Panfy is a prototype on hold (dg:131): no "Live" key figure.
  const panfy = byId('panfy');
  if (panfy) {
    panfy.outcomeStat = null;
    findBlocks(panfy, 'outcome').forEach((b) => { delete b.stat; });
  }

  // Creads: the live embed points at a local dev server (127.0.0.1:3000). Not shown on this page.
  const creads = byId('creads');
  if (creads && Array.isArray(creads.narrative)) creads.narrative = creads.narrative.filter(b => !(b && b.type === 'creads-live'));

  // Renault: cv:206 role, dg:30 "23,900+".
  const renault = byId('renault');
  if (renault) {
    renault.role = 'Senior Product Designer';
    replaceIn(renault, /\b23,900 vehicles\b/g, '23,900+ vehicles');
  }

  // OneAsset: dg:36 / dg:96 scope (investor app, admin panel, marketing site, OTC product, one PO).
  const oneasset = byId('oneasset');
  if (oneasset) {
    oneasset.subtitle = 'Investor app, admin panel, marketing site and an OTC product';
    oneasset.role = 'Senior Product Designer / Product Lead';
    oneasset.team = 'Product lead with one Product Owner · engineering team';
    oneasset.desc = 'I lead product and UX at OneAsset with one Product Owner. In the first 6 months I shipped the investor app, the admin panel and the marketing site, plus an OTC product. Every screen is prototyped in Cursor and Claude Code on one shared design system.';
    oneasset.outcome = 'Investor app, admin panel and marketing site shipped in the first 6 months with one Product Owner, plus an OTC product. Each screen is prototyped in Cursor and Claude Code and reviewed in Figmol before handoff to engineering.';
    if (typeof oneasset.solution === 'string') {
      oneasset.solution = oneasset.solution.replace(/^I built the whole product as a React prototype on fixture data/, 'I prototype every surface as a React app on fixture data');
    }
    if (Array.isArray(oneasset.steps) && oneasset.steps[0]) {
      oneasset.steps[0].title = 'Map every surface';
      oneasset.steps[0].desc = 'The investor app, the admin panel and the marketing site, each with its own navigation, onboarding (KYC, KYB) and account states, inside one shared shell.';
    }
    replaceIn(oneasset, /I design the whole product: the investor app, six operator and partner back offices, and the marketing site\./g,
      'I lead product and UX across the investor app, the admin panel and the marketing site, plus an OTC product.');
    findBlocks(oneasset, 'outcome').forEach((b) => { b.text = oneasset.outcome; });
    (oneasset.narrative || []).forEach((b) => {
      if (!b || typeof b.title !== 'string') return;
      if (/^Sole designer/i.test(b.title)) b.title = 'Product lead on a regulated product';
      if (/^Seven portals/i.test(b.title)) b.title = 'Every portal, one shell.';
    });
    replaceIn(oneasset, /\b[Ss]even portals\b/g, 'the portals');
  }

  // LVMH: per-session headcount is not in article-digest.
  const lvmh = byId('lvmh');
  if (lvmh) {
    const line = 'Stakeholder interviews with CRM teams across Dior, Louis Vuitton, Fendi, Kenzo and other maisons.';
    replaceIn(lvmh, /(?:Each session mixed )?1\s*[–-]\s*3 CRM people (?:per session )?from 3\+ maisons,? (?:mixed sectors and seniority|across sectors and seniority)\./g, line);
  }

  // Years and roles per article-digest (dg:52, dg:55, dg:57, dg:25, dg:29, dg:24 + dg:54).
  const set = (id, fields) => { const p = byId(id); if (p) Object.assign(p, fields); };
  set('bmw', { role: 'Senior Product Designer', year: '2021 to 2022' });
  set('edenred', { year: '2023 to 2024', role: 'Senior Product Designer' }); // cv:186
  set('sncf', { year: '2017 to 2020', duration: '2017 to 2020' });
  set('upviral', { year: 'Jul 2024 to Dec 2025', duration: 'Jul 2024 to Dec 2025' });
  set('shiseido', { duration: 'Feb to Jun 2024' });
  const galian = byId('galian');
  if (galian) {
    galian.year = '2020 to 2024';
    galian.duration = 'Agency engagement';
    replaceIn(galian, /,? across 3 years of collaboration/g, '');
    (galian.narrative || []).forEach((b) => {
      if (b && typeof b.title === 'string' && /^Three years/i.test(b.title)) b.title = 'Continuous improvement';
    });
  }

  // PROJECT_METHODS notes shown in the case-study method rail.
  if (typeof PROJECT_METHODS !== 'undefined' && PROJECT_METHODS) {
    (PROJECT_METHODS.oneasset || []).forEach((step) => {
      if (step && step.note && /Seven portals/i.test(step.note.en || '')) {
        step.note = { en: 'Each portal has its own onboarding (KYC, KYB) and account states.', fr: 'Chaque portail a son onboarding (KYC, KYB) et ses états de compte.' };
      }
    });
    (PROJECT_METHODS.skiset || []).forEach((step) => {
      if (step && step.note && /15\/20/.test(step.note.en || '')) {
        step.note = { en: 'Prototype tests before client presentation.', fr: 'Tests du prototype avant présentation client.' };
      }
    });
  }

  // No en dash or em dash on this page (agTidyText), and typographic apostrophes in displayed strings.
  const SKIP = new Set(['id', 'src', 'srcAlt', 'url', 'icon', 'logo', 'cover', 'screenshot', 'heroCover', 'video', 'poster', 'accent', 'landingIfaceId', 'href', 'link', 'dot', 'group', 'num', 'type']);
  const LABEL_KEYS = new Set(['caption', 'title', 'tagline', 'name', 'label', 'subtitle', 'tag', 'company']);
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 10) return;
    Object.keys(node).forEach((k) => {
      const v = node[k];
      if (typeof v === 'string') { if (!SKIP.has(k)) node[k] = agTidyText(v, LABEL_KEYS.has(k)); }
      else if (v && typeof v === 'object') walk(v, depth + 1);
    });
  };
  PROJECTS.forEach(p => walk(p, 0));
  if (typeof PROJECT_METHODS !== 'undefined' && PROJECT_METHODS) walk(PROJECT_METHODS, 0);
})();

/* ── window.SITE (base fields set inline in agence.html <head>) ── */
(function extendSite() {
  const site = (window.SITE && typeof window.SITE === 'object') ? window.SITE : (window.SITE = {});
  const offerName = (id, lang) => agT('mail_offer_' + agOfferId(id), lang);

  function storyChapter(chapter, lang) {
    if (!chapter || typeof chapter !== 'object') return chapter;
    const c = Object.assign({}, chapter, { paragraphs: Array.isArray(chapter.paragraphs) ? chapter.paragraphs.slice() : [] });
    if (c.id === 'story-now') {
      const label = agT('story_now_label', lang);
      const title = agT('story_now_title', lang);
      if (label) c.label = agEsc(label);
      if (title) c.title = agEsc(title);
      const copy = agT('story_now_copy', lang);
      if (copy) c.paragraphs = [agEsc(copy)];
    } else if (c.id === 'story-agency') {
      // O-17: the past agency's title must not read as v2 studio having staff.
      const title = agT('story_agency_title', lang);
      if (title) c.title = agEsc(title);
      const p1 = agT('story_agency_p1', lang);
      const p2 = agT('story_agency_p2', lang);
      if (p1 && p2) c.paragraphs = [agEsc(p1), agEsc(p2)];
    } else if (c.id === 'story-earlier') {
      // O-17: no present-tense team ("while I'm running the team").
      const p1 = agT('story_team_p1', lang);
      if (p1) c.paragraphs[0] = agEsc(p1);
      const p2 = agT('story_team_p2', lang);
      if (p2) c.paragraphs[1] = agEsc(p2);
    }
    return c;
  }

  Object.assign(site, {
    title: {
      get en() { return agT('doc_title_home', 'en') || 'v2 studio · AI design agency for redesign, UX and AI products'; },
      get fr() { return agT('doc_title_home', 'fr') || 'v2 studio · Agence de design IA : refonte, UX et produits IA'; },
    },
    projectTitle(p, lang) {
      const company = p && p.company ? p.company : '';
      return agFill(agT('doc_title_project', lang) || '{company} · v2 studio', { company });
    },
    navSections: ['services', 'pricing', 'work', 'process', 'faq'],
    typingPhrases: AGENCY_TYPING,
    workOrder: AGENCY_WORK_ORDER.slice(),
    aiBentoIds: ['uxfi', 'flemme', 'panfy'],
    aiWideIds: ['jarvos'],
    ifaceHiddenIds: AGENCY_IFACE_HIDDEN.slice(),
    marqueeExclude: AGENCY_MARQUEE_EXCLUDE.slice(),

    contact: {
      email: AGENCY_EMAIL,
      /** Spec K: "v2 studio · {offer} · {name}", or "v2 studio · {offer}" when the name is empty. */
      subject({ name, offer, lang } = {}) {
        const label = offerName(offer, lang);
        const who = String(name || '').trim();
        return who ? `v2 studio · ${label} · ${who}` : `v2 studio · ${label}`;
      },
      /** Spec K mail body, in the page language. */
      body({ name, email, link, message, offer, lang } = {}) {
        const id = agOfferId(offer);
        const l = agLang(lang);
        const linkText = String(link || '').trim() || agT('mail_link_none', l);
        return [
          `${agT('mail_package', l)} ${offerName(id, l)} (${agT('mail_price_' + id, l)})`,
          `${agT('mail_name', l)} ${String(name || '').trim()}`,
          `${agT('mail_email', l)} ${String(email || '').trim()}`,
          `${agT('mail_link', l)} ${linkText}`,
          '',
          agT('mail_project', l),
          String(message || '').trim(),
          '',
          agT('mail_sent_from', l),
        ].join('\n');
      },
    },

    projectChips(p, lang) {
      const key = p && AGENCY_CHIP[p.id];
      const text = key ? agT(key, lang) : '';
      return text ? `<span class="proj-list-badge badge-attrib">${agEsc(text)}</span>` : '';
    },

    bentoBadges(p, lang) {
      const key = p && AGENCY_STATUS[p.id];
      const text = key ? agT(key, lang) : '';
      return text ? [text] : [];
    },

    renderProjectBanner(p, lang) {
      if (!p) return '';
      const key = AGENCY_CASE_NOTE[p.id] || 'case_note_client';
      const status = AGENCY_STATUS[p.id] ? agT(AGENCY_STATUS[p.id], lang) : '';
      const text = agFill(agT(key, lang), { status });
      if (!text) return '';
      return `<p class="ag-case-banner"><span class="ag-case-banner-dot" aria-hidden="true"></span><span>${agEsc(text)}</span></p>`;
    },

    /** Spec L: end-of-case CTA card, before section.proj-next. */
    renderProjectCta(p, lang) {
      if (!p) return '';
      const offer = AGENCY_CASE_OFFER[p.id] || 'refonte';
      const l = agLang(lang);
      const kicker = agT('case_cta_kicker', l);
      const title = agT(`case_cta_${offer}_title`, l);
      const body = agT(`case_cta_${offer}_body`, l);
      const btn = agT(`case_cta_${offer}_btn`, l);
      const all = agT('case_cta_all', l);
      const coach = agT('case_cta_coach_line', l);
      if (!title || !btn) return '';
      const arrow = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';
      return `
    <section class="ag-case-cta" aria-label="${agEsc(kicker)}">
      <div class="ag-case-cta-card">
        <div class="ag-case-cta-copy">
          <p class="ag-case-cta-kicker">${agEsc(kicker)}</p>
          <h2 class="ag-case-cta-title">${agEsc(title)}</h2>
          <p class="ag-case-cta-body">${agEsc(body)}</p>
        </div>
        <div class="ag-case-cta-actions">
          <button type="button" class="ag-case-cta-btn" onclick="openContactModal('${offer}')">${agEsc(btn)}${arrow}</button>
          <button type="button" class="ag-case-cta-link" onclick="window.AgencePage &amp;&amp; AgencePage.comparePackages('${offer}')">${agEsc(all)}</button>
        </div>
        ${coach ? `<button type="button" class="ag-case-cta-coach" onclick="window.AgencePage &amp;&amp; AgencePage.comparePackages('accompagnement')">${agEsc(coach)}</button>` : ''}
      </div>
    </section>
`;
    },

    storyChapters(chapters, lang) {
      return Array.isArray(chapters) ? chapters.map(c => storyChapter(c, lang)) : chapters;
    },
    storyTitle: {
      get en() { return agT('story_modal_title', 'en') || 'The founder'; },
      get fr() { return agT('story_modal_title', 'fr') || 'Le fondateur'; },
    },
    renderStoryContact(lang) {
      const l = agLang(lang);
      return `
    <div class="story-contact-wrap ag-story-contact">
      <p class="ag-story-contact-title">${agEsc(agT('story_contact_title', l))}</p>
      <div class="story-contact-stack">
        <button type="button" class="story-contact-btn" onclick="window.AgencePage &amp;&amp; AgencePage.storyToPricing()">
          <span>${agEsc(agT('story_contact_btn', l))}</span>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"></path></svg>
        </button>
        <a class="story-contact-btn story-contact-btn--ghost" href="${AGENCY_CALENDLY}" target="_blank" rel="noopener noreferrer">
          <span>${agEsc(agT('story_contact_ghost', l))}</span>
        </a>
      </div>
    </div>
`;
    },

    ifaceBadge() {
      return '';
    },

    onLangChange(lang) {
      if (window.AgencePage && typeof window.AgencePage.render === 'function') window.AgencePage.render(lang);
    },
  });
})();
