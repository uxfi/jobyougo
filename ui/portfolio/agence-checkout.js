/* v2 studio (/agence): the order flow, 2026-10-17.
   Loads after agence-data.js (AGENCY_OFFERS, agPrice, agTidyText), agence-story.js and agence-order-art.js.
   A [data-order] button (the hero's "Improve my website", the package cards) opens a near-fullscreen stepper
   (2026-10-18, agence-order.css): your site and the brief, the package, how the build runs day by day, who is
   buying, then the review with what is paid when. Each step has a scene from agence-order-art.js.
   Two modes, given by GET /api/agence/checkout/config (lib/agence-checkout.mjs):
   - request (default): the last step drafts an email with the whole order; the founder confirms the scope and
     sends a payment link. Nothing is charged from the page.
   - stripe: the last step posts the order; the server prices it from the same offers JSON and returns a
     Stripe Checkout URL. The page never sends an amount.
   The same script fills /agence/thanks (Stripe's return page). Copy lives here (EN/FR); it re-renders on
   <html lang> changes, like agence-work.js. */
(function () {
  'use strict';

  const d = document;
  const root = d.documentElement;
  const OFFERS = (typeof AGENCY_OFFERS === 'object' && AGENCY_OFFERS) ? AGENCY_OFFERS : { offers: [], addons: [] };
  const EMAIL = typeof AGENCY_EMAIL === 'string' ? AGENCY_EMAIL : 'chilka.v@gmail.com';
  const CAL = typeof AGENCY_CALENDLY === 'string' ? AGENCY_CALENDLY : 'https://calendly.com/chilka-v/30min';

  const COPY = {
    en: {
      kicker: 'Your order',
      close: 'Close',
      step_1: 'Package',
      step_2: 'Brief',
      step_3: 'Review',
      steps_aria: 'Order steps',
      package: 'Package',
      track: 'Track',
      addons: 'Add-ons',
      addons_none: 'No add-on for this package.',
      fewer: 'One less',
      more: 'One more',
      addon_info: 'More about {name}',
      included: 'What you walk away with',
      link: 'Link to your site or product',
      link_opt: 'optional',
      brief: 'Your brief',
      brief_ph: 'What should change, for whom, and by when? A line on your customers helps.',
      brief_hint: 'A few lines are enough. We ask the rest on the kickoff call.',
      name: 'Name',
      email: 'Email',
      as: 'You are ordering as',
      as_business: 'A business',
      as_individual: 'An individual',
      company: 'Company',
      country: 'Country',
      vat: 'VAT number',
      opt: 'optional',
      total: 'Total',
      taxes: 'excluding applicable taxes',
      back: 'Back',
      next: 'Continue',
      review: 'Review the order',
      delivery: 'Delivery',
      delivery_line: '{delivery}, counted from the business day after your brief, your files and the payment.',
      revisions: 'Revisions',
      next_req: 'Next: within one business day we confirm the scope and the date in writing, with a secure payment link. Day 1 starts once it is paid.',
      next_pay: 'Next: you pay on Stripe’s secure page. Within one business day we confirm the scope in writing and book the kickoff call.',
      c_scope: 'I have read what this package includes and what it does not.',
      c_terms: 'I accept the {terms}.',
      terms: 'terms of sale',
      c_start: 'I ask you to start before the 14-day withdrawal period ends, and I understand I can no longer withdraw once the work is fully delivered.',
      send: 'Send my order',
      copy: 'Copy the order',
      pay: 'Pay {total}',
      sending: 'Opening your email app with the order…',
      sent: 'Your order is in your email app. Press send there, and we reply within one business day.',
      copied: 'Order copied. Paste it in an email to {email}.',
      copy_failed: 'Copy failed. Write to {email}.',
      paying: 'Opening the secure payment page…',
      pay_failed: 'The payment page did not open. Nothing was charged. Try again, or send the order by email.',
      by_email: 'Send it by email instead',
      fix: 'Check the highlighted fields.',
      mail_subject: 'v2 studio · Order · {offer} · {name}',
      mail_package: 'Package:',
      mail_track: 'Track:',
      mail_addons: 'Add-ons:',
      mail_total: 'Total:',
      mail_name: 'Name:',
      mail_email: 'Email:',
      mail_as: 'Ordering as:',
      mail_link: 'Link:',
      mail_brief: 'Brief:',
      mail_from: 'Sent from the order form on v2 studio.',
      none: 'none',
      // /agence/thanks
      t_doc: 'Order received · v2 studio',
      t_title: 'Thank you.<br><em>Your order is in.</em>',
      t_lede: 'We reply within one business day with the confirmed scope and the date of your kickoff call.',
      t_paid: 'Paid',
      t_pending: 'Payment processing',
      t_receipt: 'A receipt and an invoice go to {email}.',
      t_unknown: 'Your payment page is closed. If you were charged, the receipt is in your inbox; for anything else, write to {email}.',
      t_next: [
        ['Book the kickoff call', 'Thirty minutes to agree on the goal, the page and your customers.'],
        ['Send your files', 'Reply to the receipt with your brand files, your text and any access we need.'],
        ['Day 1', 'The clock starts the business day after your brief and your files are complete.'],
      ],
      t_cal: 'Book the kickoff call',
      t_back: 'Back to v2 studio',
      t_note: 'Your brief comes to me, not to a sales team. I read it and confirm the scope within one business day.',
      t_sig: 'Hugo, founder',
      // 2026-10-18: the founder in the dialog, the delivery day, brief starters, reassurance, the sent state
      who: 'Hugo, the founder, reads every order himself.',
      eta: 'Brief and files in today: delivered by {date}.',
      chips_label: 'Starters for your brief',
      chips: ['We need more sign-ups', 'The site looks dated', 'Customers get lost', 'A launch date is coming', 'We are adding an AI feature'],
      trust_pay: ['Secure payment on Stripe', 'Invoice included', 'Scope confirmed in writing'],
      trust_req: ['Nothing is charged now', 'Reply within one business day', 'Scope confirmed in writing'],
      done_title: 'Your order is ready<br><em>in your email app.</em>',
      done_text: 'Press send there. Hugo reads it and replies within one business day with the confirmed scope, the date and a secure payment link.',
      done_next: [
        ['Press send', 'Your email app opened with the whole order in it.'],
        ['We confirm in writing', 'Scope, delivery date and a payment link, within one business day.'],
        ['Kickoff call', 'Thirty minutes to agree on the goal, the page and your customers.'],
      ],
      done_cal: 'Book the kickoff call now',
      done_close: 'Close',
      too_many: 'Too many attempts from this connection. Try again in ten minutes, or write to {email}.',
      done_sent_title: 'Order received.<br><em>Reference {ref}.</em>',
      done_sent_text: 'A confirmation is on its way to {email}. Hugo reads every order and replies within one business day with the scope in writing, the invoice and a secure payment link. Nothing is charged until then.',
      done_sent_next: [
        ['Within one business day', 'The scope in writing, the invoice and a secure payment link, by email.'],
        ['Before Day 1', 'You pay the full price by card. Day 1 is the business day after your payment, your brief and your files.'],
        ['Kickoff call', 'Book it now or after the payment: 30 minutes, free.'],
      ],
      done_copy: 'Email app did not open? Copy the order',
      // 2026-10-18: "Improve my website", the five-step studio
      improve: 'Improve my website',
      step_names: ['Your site', 'Package', 'How we build', 'About you', 'Review and pay'],
      step_hints: ['The link and what to fix', 'A fixed price, the scope in writing', 'Five dated steps', 'For the invoice', 'What you pay, and when'],
      step_of: 'Step {n} of {total}',
      go_back_to: 'Back to: {step}',
      titles: [
        'Which page should <em>work harder?</em>',
        'Pick the package <em>that fits.</em>',
        'How we build it, <em>day by day.</em>',
        'Who are we <em>building for?</em>',
        'Check it, then <em>we take it from here.</em>',
      ],
      ledes: [
        'Share your link and tell us what’s not working. A few lines is enough.',
        'A fixed price, and the scope written on each package. You see the delivery date before you commit.',
        'Business days, counted from the day after we have your brief, your files and the payment. On Day 2 you see the direction and approve it, or ask for changes, before we build.',
        'For the invoice and the kickoff call. Nothing else: no newsletter, no sales calls.',
      ],
      lede_req: 'Nothing is charged now. Within one business day we confirm the scope and the date in writing, with a secure payment link.',
      lede_pay: 'You pay on Stripe’s secure page. Within one business day we confirm the scope in writing and book the kickoff call.',
      build_ok: 'Sounds good',
      day_one: 'Day {n}',
      day_range: 'Days {a} to {b}',
      bill_title: 'What you pay, and when',
      bill_req: [
        ['Today', 'You send the order. Nothing is charged.'],
        ['Within one business day', 'The scope and the date in writing, with a secure payment link.'],
        ['Before Day 1', 'You pay the full price by card. Every payment comes with an invoice.'],
        ['Day 2', 'You approve the direction, or ask for changes before we build.'],
      ],
      bill_pay: [
        ['Today', 'You pay the full price on Stripe. The receipt and the invoice come by email.'],
        ['Within one business day', 'The scope in writing, and the kickoff call booked.'],
        ['Day 1', 'The work starts the business day after your brief and your files.'],
        ['Day 2', 'You approve the direction, or ask for changes before we build.'],
      ],
    },
    fr: {
      kicker: 'Votre commande',
      close: 'Fermer',
      step_1: 'Formule',
      step_2: 'Brief',
      step_3: 'Récapitulatif',
      steps_aria: 'Étapes de la commande',
      package: 'Formule',
      track: 'Piste',
      addons: 'Options',
      addons_none: 'Aucune option pour cette formule.',
      fewer: 'Un de moins',
      more: 'Un de plus',
      addon_info: 'En savoir plus sur {name}',
      included: 'Ce que vous obtenez',
      link: 'Lien vers votre site ou produit',
      link_opt: 'facultatif',
      brief: 'Votre brief',
      brief_ph: 'Que faut-il changer, pour qui, et pour quand ? Une ligne sur vos clients aide beaucoup.',
      brief_hint: 'Quelques lignes suffisent. Nous demandons le reste lors de l’appel de lancement.',
      name: 'Nom',
      email: 'E-mail',
      as: 'Vous commandez en tant que',
      as_business: 'Entreprise',
      as_individual: 'Particulier',
      company: 'Entreprise',
      country: 'Pays',
      vat: 'Numéro de TVA',
      opt: 'facultatif',
      total: 'Total',
      taxes: 'hors taxes applicables',
      back: 'Retour',
      next: 'Continuer',
      review: 'Vérifier la commande',
      delivery: 'Délai',
      delivery_line: '{delivery}, à compter du jour ouvré qui suit votre brief, vos fichiers et le paiement.',
      revisions: 'Allers-retours',
      next_req: 'Ensuite : sous un jour ouvré, nous confirmons par écrit le périmètre et la date, avec un lien de paiement sécurisé. Le jour 1 commence dès le règlement.',
      next_pay: 'Ensuite : vous réglez sur la page sécurisée de Stripe. Sous un jour ouvré, nous confirmons le périmètre par écrit et fixons l’appel de lancement.',
      c_scope: 'J’ai lu ce que cette formule comprend et ce qu’elle ne comprend pas.',
      c_terms: 'J’accepte les {terms}.',
      terms: 'conditions générales de vente',
      c_start: 'Je demande que le travail commence avant la fin du délai de rétractation de 14 jours, et je comprends que je ne peux plus me rétracter une fois le travail entièrement livré.',
      send: 'Envoyer ma commande',
      copy: 'Copier la commande',
      pay: 'Payer {total}',
      sending: 'Ouverture de votre messagerie avec la commande…',
      sent: 'Votre commande est dans votre messagerie. Cliquez sur Envoyer, et nous répondons sous un jour ouvré.',
      copied: 'Commande copiée. Collez-la dans un e-mail à {email}.',
      copy_failed: 'La copie a échoué. Écrivez à {email}.',
      paying: 'Ouverture de la page de paiement sécurisée…',
      pay_failed: 'La page de paiement ne s’est pas ouverte. Rien n’a été débité. Réessayez, ou envoyez la commande par e-mail.',
      by_email: 'L’envoyer par e-mail',
      fix: 'Vérifiez les champs signalés.',
      mail_subject: 'v2 studio · Commande · {offer} · {name}',
      mail_package: 'Formule :',
      mail_track: 'Piste :',
      mail_addons: 'Options :',
      mail_total: 'Total :',
      mail_name: 'Nom :',
      mail_email: 'E-mail :',
      mail_as: 'Commande en tant que :',
      mail_link: 'Lien :',
      mail_brief: 'Brief :',
      mail_from: 'Envoyé depuis le formulaire de commande de v2 studio.',
      none: 'aucune',
      t_doc: 'Commande reçue · v2 studio',
      t_title: 'Merci.<br><em>Votre commande est passée.</em>',
      t_lede: 'Nous répondons sous un jour ouvré avec le périmètre confirmé et la date de votre appel de lancement.',
      t_paid: 'Payée',
      t_pending: 'Paiement en cours',
      t_receipt: 'Un reçu et une facture partent à {email}.',
      t_unknown: 'La page de paiement est fermée. Si vous avez été débité, le reçu est dans votre boîte mail ; pour le reste, écrivez à {email}.',
      t_next: [
        ['Réservez l’appel de lancement', 'Trente minutes pour fixer l’objectif, la page et vos clients.'],
        ['Envoyez vos fichiers', 'Répondez au reçu avec vos fichiers de marque, vos textes et les accès utiles.'],
        ['Jour 1', 'Le délai démarre le jour ouvré qui suit un brief et des fichiers complets.'],
      ],
      t_cal: 'Réserver l’appel de lancement',
      t_back: 'Retour à v2 studio',
      t_note: 'Votre brief arrive chez moi, pas chez un commercial. Je le lis et confirme le périmètre sous un jour ouvré.',
      t_sig: 'Hugo, fondateur',
      who: 'Hugo, le fondateur, lit chaque commande lui-même.',
      eta: 'Brief et fichiers reçus aujourd’hui : livré le {date}.',
      chips_label: 'Pour démarrer votre brief',
      chips: ['Il nous faut plus d’inscriptions', 'Le site fait daté', 'Les clients se perdent', 'Un lancement approche', 'Nous ajoutons une fonction IA'],
      trust_pay: ['Paiement sécurisé sur Stripe', 'Facture incluse', 'Périmètre confirmé par écrit'],
      trust_req: ['Rien n’est débité maintenant', 'Réponse sous un jour ouvré', 'Périmètre confirmé par écrit'],
      done_title: 'Votre commande est prête<br><em>dans votre messagerie.</em>',
      done_text: 'Cliquez sur Envoyer. Hugo la lit et répond sous un jour ouvré avec le périmètre confirmé, la date et un lien de paiement sécurisé.',
      done_next: [
        ['Cliquez sur Envoyer', 'Votre messagerie s’est ouverte avec toute la commande.'],
        ['Nous confirmons par écrit', 'Périmètre, date de livraison et lien de paiement, sous un jour ouvré.'],
        ['Appel de lancement', 'Trente minutes pour fixer l’objectif, la page et vos clients.'],
      ],
      done_cal: 'Réserver l’appel de lancement',
      done_close: 'Fermer',
      too_many: 'Trop d’essais depuis cette connexion. Réessayez dans dix minutes, ou écrivez à {email}.',
      done_sent_title: 'Commande reçue.<br><em>Référence {ref}.</em>',
      done_sent_text: 'Une confirmation part vers {email}. Hugo lit chaque commande et répond sous un jour ouvré avec le périmètre par écrit, la facture et un lien de paiement sécurisé. Rien n’est débité d’ici là.',
      done_sent_next: [
        ['Sous un jour ouvré', 'Le périmètre par écrit, la facture et un lien de paiement sécurisé, par e-mail.'],
        ['Avant le jour 1', 'Vous réglez la totalité par carte. Le jour 1 est le jour ouvré qui suit votre paiement, votre brief et vos fichiers.'],
        ['Appel de lancement', 'Réservez-le maintenant ou après le paiement : 30 minutes, gratuit.'],
      ],
      done_copy: 'La messagerie ne s’est pas ouverte ? Copier la commande',
      improve: 'Améliorer mon site',
      step_names: ['Votre site', 'Formule', 'La fabrication', 'Vous', 'Récapitulatif'],
      step_hints: ['Le lien et ce qui coince', 'Un prix fixe, le périmètre écrit', 'Cinq étapes datées', 'Pour la facture', 'Ce que vous payez, et quand'],
      step_of: 'Étape {n} sur {total}',
      go_back_to: 'Revenir à : {step}',
      titles: [
        'Quelle page doit <em>mieux travailler ?</em>',
        'Choisissez la formule <em>qui vous va.</em>',
        'Comment on la construit, <em>jour par jour.</em>',
        'Pour qui <em>construisons-nous ?</em>',
        'Vérifiez, <em>on s’occupe du reste.</em>',
      ],
      ledes: [
        'Partagez votre lien et dites-nous ce qui ne va pas. Quelques lignes suffisent.',
        'Un prix fixe et le périmètre écrit sur chaque formule. Vous voyez la date de livraison avant de vous engager.',
        'Jours ouvrés, comptés à partir du lendemain de la réception de votre brief, de vos fichiers et du paiement. Au jour 2, vous voyez la direction et vous la validez, ou demandez des changements, avant la construction.',
        'Pour la facture et l’appel de lancement. Rien d’autre : ni newsletter, ni démarchage.',
      ],
      lede_req: 'Rien n’est débité maintenant. Sous un jour ouvré, nous confirmons par écrit le périmètre et la date, avec un lien de paiement sécurisé.',
      lede_pay: 'Vous réglez sur la page sécurisée de Stripe. Sous un jour ouvré, nous confirmons le périmètre par écrit et fixons l’appel de lancement.',
      build_ok: 'Ça me va',
      day_one: 'Jour {n}',
      day_range: 'Jours {a} à {b}',
      bill_title: 'Ce que vous payez, et quand',
      bill_req: [
        ['Aujourd’hui', 'Vous envoyez la commande. Rien n’est débité.'],
        ['Sous un jour ouvré', 'Le périmètre et la date par écrit, avec un lien de paiement sécurisé.'],
        ['Avant le jour 1', 'Vous réglez la totalité par carte. Chaque paiement donne lieu à une facture.'],
        ['Jour 2', 'Vous validez la direction, ou demandez des changements avant la construction.'],
      ],
      bill_pay: [
        ['Aujourd’hui', 'Vous réglez la totalité sur Stripe. Le reçu et la facture arrivent par e-mail.'],
        ['Sous un jour ouvré', 'Le périmètre par écrit, et l’appel de lancement fixé.'],
        ['Jour 1', 'Le travail commence le jour ouvré qui suit votre brief et vos fichiers.'],
        ['Jour 2', 'Vous validez la direction, ou demandez des changements avant la construction.'],
      ],
    },
  };
  const FOUNDER_PHOTO = '/images/hugo_vermot.optimized.jpg';
  const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ICON_CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  const ICON_LOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.6"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
  // The nav CTA's arrow, on the buttons that move to the next step; and a drawn cross, centred unlike the × glyph.
  const ICON_NEXT = '<svg class="btn-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  const ICON_INFO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.25"/><path d="M8 7.3v3.7"/><circle cx="8" cy="5" r=".9" fill="currentColor" stroke="none"/></svg>';

  /* Paint dabs thrown from the middle of `host` (the thread's palette). Nothing under reduced motion. */
  function dabBurst(host) {
    if (!host || reducedMq.matches) return;
    const cols = ['--p-moss', '--p-yellow', '--p-pink', '--p-cyan', '--p-orange', '--p-purple'].map((v) => getComputedStyle(root).getPropertyValue(v).trim() || '#86e3bf');
    cols.push('#86e3bf');
    const b = d.createElement('span');
    b.className = 'dab-burst';
    b.setAttribute('aria-hidden', 'true');
    b.innerHTML = Array.from({ length: 22 }, (_, i) => {
      const a = (i / 22) * Math.PI * 2 + Math.random() * 0.4;
      const r = 70 + Math.random() * 120;
      return `<i style="--col:${cols[i % cols.length]};--s:${(7 + Math.random() * 9).toFixed(1)}px;--x:${(Math.cos(a) * r).toFixed(0)}px;--y:${(Math.sin(a) * r * 0.8).toFixed(0)}px;--r:${(Math.random() * 300 - 150).toFixed(0)}deg;--dl:${(Math.random() * 0.12).toFixed(2)}s"></i>`;
    }).join('');
    host.appendChild(b);
    setTimeout(() => b.remove(), 1600);
  }
  const etaDate = (offerId) => {
    const x = window.agenceExtras;
    const dt = x && typeof x.etaFor === 'function' ? x.etaFor(offerId) : null;
    return dt ? x.fmtDate(dt) : '';
  };

  const lang = () => (root.lang === 'fr' ? 'fr' : 'en');
  // Visitors in other languages read the English copy through the machine translation (agTrDeep, agence shells).
  const tx = (v) => (typeof agTrDeep === 'function' ? agTrDeep(v) : v);
  const tRaw = (k) => { const v = COPY[lang()][k]; return v != null ? v : COPY.en[k]; };
  const t = (k) => tx(tRaw(k));
  const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  const pickRaw = (o) => (o && typeof o === 'object' ? (o[lang()] != null ? o[lang()] : o.en) : o);
  const pick = (o) => tx(pickRaw(o));
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const tidy = (s) => (typeof agTidyText === 'function' ? agTidyText(String(s == null ? '' : s)) : String(s == null ? '' : s));
  const money = (n) => (typeof agPrice === 'function' ? agPrice(n, lang(), false) : '$' + n);
  const $ = (id) => d.getElementById(id);

  const orderable = () => (OFFERS.offers || []).filter((o) => o.checkout === 'card' && o.open !== false);
  const offerById = (id) => (OFFERS.offers || []).find((o) => o.id === id);
  const addonsFor = (id) => (OFFERS.addons || []).filter((a) => Array.isArray(a.for) && a.for.includes(id) && a.open !== false);

  /* ── Mode, from the server (request until it says otherwise) ── */
  let config = { mode: 'request', termsUrl: '' };
  function setConfig(c) {
    config = { mode: c && c.mode === 'stripe' ? 'stripe' : 'request', termsUrl: (c && c.termsUrl) || '' };
    root.dataset.pay = config.mode;
    window.dispatchEvent(new CustomEvent('agence:paymode', { detail: config.mode }));
    if (dlg && dlg.open) render();
  }
  root.dataset.pay = 'request';
  try {
    fetch('/api/agence/checkout/config', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null)).then((c) => { if (c) setConfig(c); }).catch(() => {});
  } catch (e) { /* offline or blocked: stay on request */ }

  /* ── State ── */
  const DRAFT_KEY = 'v2studio-order';
  const state = { step: 1, offer: '', track: '', addons: {}, f: { link: '', brief: '', name: '', email: '', kind: 'business', company: '', country: '', vat: '' }, c: { scope: false, terms: false, startNow: false }, busy: false, done: false, dir: '' };
  /* The brief and contact fields stay on this device while the visitor fills them (14 days), so closing the dialog
     or the tab loses nothing. Cleared once the order is sent or paid. */
  const SAVE_KEY = 'v2studio-order-draft';
  let saveTimer = 0;
  let draftRestored = false;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const f = state.f;
      if (!f.brief && !f.name && !f.email && !f.link) return;
      try {
        window.localStorage.setItem(SAVE_KEY, JSON.stringify({ at: Date.now(), offer: state.offer, track: state.track, addons: state.addons, f }));
      } catch (e) { /* storage blocked: the form still works */ }
    }, 500);
  }
  function loadDraft() {
    try {
      const x = JSON.parse(window.localStorage.getItem(SAVE_KEY) || 'null');
      return x && x.f && typeof x.at === 'number' && Date.now() - x.at < 14 * 864e5 ? x : null;
    } catch (e) { return null; }
  }
  function clearDraft() {
    clearTimeout(saveTimer);
    try { window.localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }
  function lines() {
    const o = offerById(state.offer);
    if (!o) return [];
    const tr = (o.tracks || []).find((x) => x.id === state.track);
    const out = [{ name: pick(o.name) + (tr ? ' · ' + pick(tr.name) : ''), qty: 1, unit: o.price, amount: o.price }];
    addonsFor(o.id).forEach((a) => {
      const q = state.addons[a.id] || 0;
      if (q > 0) out.push({ name: pick(a.name), qty: q, unit: a.price, amount: a.price * q, id: a.id });
    });
    return out;
  }
  const total = () => lines().reduce((s, l) => s + l.amount, 0);

  /* ── Dialog ── */
  let dlg = null;
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = d.createElement('dialog');
    dlg.className = 'dlg order studio';
    dlg.id = 'order-dialog';
    dlg.setAttribute('aria-labelledby', 'order-title');
    dlg.innerHTML = '<form class="order-inner" id="order-form" novalidate></form>';
    d.body.appendChild(dlg);
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('keydown', onTipKey);
    // A tooltip hidden with Escape comes back the next time the pointer or the focus arrives on its (i).
    const wake = (e) => {
      const h = e.target.closest && e.target.closest('.add-help.is-quiet');
      if (h && !h.contains(e.relatedTarget)) h.classList.remove('is-quiet');
    };
    dlg.addEventListener('pointerover', wake);
    dlg.addEventListener('focusin', wake);
    dlg.addEventListener('input', onInput);
    dlg.addEventListener('change', onInput);
    dlg.addEventListener('submit', onSubmit);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    return dlg;
  }
  function open(offerId, trackId) {
    const list = orderable();
    if (!list.length) return false;
    const o = offerById(offerId) && offerById(offerId).checkout === 'card' && offerById(offerId).open !== false ? offerById(offerId) : list[0];
    if (state.offer !== o.id) { state.addons = {}; }
    state.offer = o.id;
    const tracks = o.tracks || [];
    state.track = tracks.length ? ((tracks.find((x) => x.id === trackId) || tracks.find((x) => x.id === state.track) || tracks[0]).id) : '';
    state.step = 1;
    state.busy = false;
    state.done = false;
    state.ref = '';
    state.openedAt = Date.now();
    state.dir = '';
    if (!draftRestored) {
      draftRestored = true;
      const x = loadDraft();
      if (x) {
        Object.keys(state.f).forEach((k) => { if (k !== 'kind' && !state.f[k] && typeof x.f[k] === 'string') state.f[k] = x.f[k].slice(0, 1000); });
        if (x.f.kind === 'individual' || x.f.kind === 'business') state.f.kind = x.f.kind;
        if (x.offer === state.offer && x.addons && typeof x.addons === 'object') state.addons = x.addons;
      }
    }
    ensureDialog();
    render();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    focusStep();
    return true;
  }
  function close() {
    if (!dlg) return;
    if (state.done) { state.done = false; state.ref = ''; state.step = 1; }
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }
  function focusStep() {
    setTimeout(() => {
      const el = dlg && dlg.querySelector('.order-body [autofocus], .order-body input:not([type=hidden]), .order-body textarea, .order-body button, .order-foot .btn-primary');
      if (el) el.focus({ preventScroll: true });
    }, 30);
  }

  function radio(name, value, checked, label, extra, lead) {
    return `<label class="opt${lead ? ' opt--ico' : ''}${checked ? ' is-on' : ''}"><input type="radio" name="${esc(name)}" value="${esc(value)}"${checked ? ' checked' : ''}>${lead || ''}<span class="opt-main">${label}</span>${extra || ''}</label>`;
  }
  // The package's small 3D icon (agence-order-art.js), when that script has loaded.
  const packIcon = (id) => (window.agenceOrderArt && typeof window.agenceOrderArt.icon === 'function'
    ? `<span class="opt-ico" aria-hidden="true">${window.agenceOrderArt.icon(id)}</span>` : '');
  function etaLine(offerId) {
    const date = etaDate(offerId);
    return date ? `<p class="order-eta"><i class="eta-pulse" aria-hidden="true"></i><span>${fill(esc(t('eta')), { date: `<b>${esc(date)}</b>` })}</span></p>` : '';
  }
  function capLine() {
    const x = window.agenceExtras;
    const c = x && typeof x.capacity === 'function' ? x.capacity() : null;
    return c ? `<p class="order-avail">${x.capacityLine(c)}</p>` : '';
  }
  function stepPackage() {
    const o = offerById(state.offer);
    const packs = orderable().map((p) => radio('offer', p.id, p.id === state.offer, `<b>${esc(pick(p.name))}</b><span class="opt-sub">${esc(pick(p.delivery))}</span>`, `<span class="opt-price">${esc(money(p.price))}</span>`, packIcon(p.id))).join('');
    const tracks = (o.tracks || []).map((tr) => radio('track', tr.id, tr.id === state.track, `<b>${esc(pick(tr.name))}</b><span class="opt-sub">${esc(tidy((pick(tr.includes) || [])[0] || ''))}</span>`)).join('');
    const adds = addonsFor(o.id);
    const addRows = adds.map((a) => {
      const q = state.addons[a.id] || 0;
      const max = Number.isInteger(a.max) && a.max > 0 ? a.max : 1;
      const name = tidy(pick(a.name));
      const info = a.details ? tidy(pick(a.details)) : '';
      const help = info ? ` <span class="add-help"><button type="button" class="add-info" aria-label="${esc(fill(t('addon_info'), { name }))}" aria-describedby="add-tip-${esc(a.id)}" aria-expanded="false">${ICON_INFO}</button><span class="add-tip" id="add-tip-${esc(a.id)}" role="tooltip">${esc(info)}</span></span>` : '';
      return `<li class="add-row${q ? ' is-on' : ''}">
        <span class="add-name">${esc(name)}${help}<small>${esc(money(a.price))}</small></span>
        <span class="stepper" role="group" aria-label="${esc(tidy(pick(a.name)))}">
          <button type="button" class="step-btn" data-add="${esc(a.id)}" data-delta="-1" aria-label="${esc(t('fewer'))}"${q <= 0 ? ' disabled' : ''}>−</button>
          <output aria-live="polite">${q}</output>
          <button type="button" class="step-btn" data-add="${esc(a.id)}" data-delta="1" aria-label="${esc(t('more'))}"${q >= max ? ' disabled' : ''}>+</button>
        </span>
      </li>`;
    }).join('');
    return `<fieldset class="order-set"><legend>${esc(t('package'))}</legend><div class="opts opts--2">${packs}</div></fieldset>
      ${tracks ? `<fieldset class="order-set"><legend>${esc(t('track'))}</legend><div class="opts opts--2">${tracks}</div></fieldset>` : ''}
      ${pick(o.outcome) ? `<p class="order-outcome"><span>${esc(t('included'))}</span>${esc(tidy(pick(o.outcome)))}</p>` : ''}
      ${etaLine(o.id)}
      ${capLine()}
      <fieldset class="order-set"><legend>${esc(t('addons'))}</legend>${addRows ? `<ul class="add-list">${addRows}</ul>` : `<p class="order-muted">${esc(t('addons_none'))}</p>`}</fieldset>`;
  }
  function field(id, label, input, hint) {
    return `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<p class="field-hint">${hint}</p>` : ''}</div>`;
  }
  /* The five steps of "Improve my website". The brief comes first (what is wrong with the site), then the package,
     then how the build runs day by day, then who is buying, then the review with what is paid when. */
  const STEP_KEYS = ['site', 'pack', 'build', 'you', 'pay'];
  const STEPS = STEP_KEYS.length;
  function stepSite() {
    const f = state.f;
    return `${field('o-link', `${esc(t('link'))} <span class="field-opt">${esc(t('link_opt'))}</span>`, `<input id="o-link" name="link" type="url" inputmode="url" autocomplete="url" placeholder="https://" value="${esc(f.link)}">`)}
      ${field('o-brief', esc(t('brief')), `<textarea id="o-brief" name="brief" required minlength="10" maxlength="1000" placeholder="${esc(t('brief_ph'))}">${esc(f.brief)}</textarea>`, esc(t('brief_hint')))}
      <div class="brief-chips" role="group" aria-label="${esc(t('chips_label'))}">${(t('chips') || []).map((c) => `<button type="button" class="brief-chip${f.brief.includes(c) ? ' is-used' : ''}" data-chip="${esc(c)}">+ ${esc(c)}</button>`).join('')}</div>`;
  }
  function stepBuild() {
    const o = offerById(state.offer);
    const n = Number(o.workingDays) > 3 ? Number(o.workingDays) : 5;
    const day = (k) => fill(t('day_one'), { n: k });
    const marks = [day(0), day(1), day(2), n - 1 > 3 ? fill(t('day_range'), { a: 3, b: n - 1 }) : day(3), day(n)];
    // Titles and bodies are the process section's own copy (agence-i18n.js), so the page says it once.
    const T = (k) => (typeof agT === 'function' ? tidy(agT(k, lang())) : '');
    const items = [1, 2, 3, 4, 5].map((k, i) => `<li${k === 3 ? ' class="is-key"' : ''}><span class="sd-day">${esc(marks[i])}</span><div><b>${esc(T(`step_${k}_title`))}</b>${k === 3 ? `<em class="sd-tag">${esc(T('process_key_tag'))}</em>` : ''}<p>${esc(T(`step_${k}_body`))}</p></div></li>`).join('');
    return `<ol class="studio-days">${items}</ol>${etaLine(o.id)}`;
  }
  function stepYou() {
    const f = state.f;
    const opt = (s) => `${esc(s)} <span class="field-opt">${esc(t('opt'))}</span>`;
    return `<div class="field-row">
        ${field('o-name', esc(t('name')), `<input id="o-name" name="name" required autocomplete="name" value="${esc(f.name)}">`)}
        ${field('o-email', esc(t('email')), `<input id="o-email" name="email" type="email" required autocomplete="email" inputmode="email" value="${esc(f.email)}">`)}
      </div>
      <fieldset class="order-set order-set--inline"><legend>${esc(t('as'))}</legend><div class="opts opts--2 opts--sm">
        ${radio('kind', 'business', f.kind === 'business', `<b>${esc(t('as_business'))}</b>`)}
        ${radio('kind', 'individual', f.kind === 'individual', `<b>${esc(t('as_individual'))}</b>`)}
      </div></fieldset>
      <div class="field-row">
        ${f.kind === 'business' ? field('o-company', opt(t('company')), `<input id="o-company" name="company" autocomplete="organization" value="${esc(f.company)}">`) : ''}
        ${field('o-country', esc(t('country')), `<input id="o-country" name="country" required autocomplete="country-name" value="${esc(f.country)}">`)}
        ${f.kind === 'business' ? field('o-vat', opt(t('vat')), `<input id="o-vat" name="vat" autocomplete="off" value="${esc(f.vat)}">`) : ''}
      </div>`;
  }
  function stepReview() {
    const o = offerById(state.offer);
    const rows = lines().map((l) => `<li><span>${esc(tidy(l.name))}${l.qty > 1 ? ` <small>× ${l.qty}</small>` : ''}</span><b>${esc(money(l.amount))}</b></li>`).join('');
    const paid = config.mode === 'stripe';
    const terms = config.termsUrl ? fill(esc(t('c_terms')), { terms: `<a href="${esc(config.termsUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('terms'))}</a>` }) : '';
    const needStart = paid && state.f.kind === 'individual';
    const bill = t(paid ? 'bill_pay' : 'bill_req') || [];
    return `<ul class="order-lines">${rows}</ul>
      <dl class="order-facts">
        <div><dt>${esc(t('delivery'))}</dt><dd>${esc(fill(t('delivery_line'), { delivery: pick(o.delivery) }))}</dd></div>
        <div><dt>${esc(t('revisions'))}</dt><dd>${esc(pick(o.revisions))}</dd></div>
      </dl>
      <section class="studio-bill" aria-labelledby="bill-title"><h3 id="bill-title">${esc(t('bill_title'))}</h3>
        <ol>${bill.map(([a, b]) => `<li><b>${esc(a)}</b><span>${esc(b)}</span></li>`).join('')}</ol></section>
      <div class="order-checks">
        <label class="chk"><input type="checkbox" name="c_scope" required${state.c.scope ? ' checked' : ''}><span>${esc(t('c_scope'))}</span></label>
        ${paid && terms ? `<label class="chk"><input type="checkbox" name="c_terms" required${state.c.terms ? ' checked' : ''}><span>${terms}</span></label>` : ''}
        ${needStart ? `<label class="chk"><input type="checkbox" name="c_start" required${state.c.startNow ? ' checked' : ''}><span>${esc(t('c_start'))}</span></label>` : ''}
      </div>`;
  }
  /* The left side: the step's scene, then the five steps (the done ones go back when pressed). */
  function side(dir) {
    const key = state.done ? 'done' : STEP_KEYS[state.step - 1];
    const art = window.agenceOrderArt && typeof window.agenceOrderArt[key] === 'function' ? window.agenceOrderArt[key]() : '';
    const names = t('step_names') || [];
    const hints = t('step_hints') || [];
    const rail = names.map((nm, i) => {
      const n = i + 1;
      const isDone = state.done || n < state.step;
      const isCur = !state.done && n === state.step;
      const inner = `<span class="sr-n" aria-hidden="true">${isDone ? ICON_CHECK : n}</span><span class="sr-txt"><b>${esc(nm)}</b><small>${esc(hints[i] || '')}</small></span>`;
      const goBack = !state.done && n < state.step;
      return `<li class="${isDone ? 'is-done' : isCur ? 'is-current' : ''}"${isCur ? ' aria-current="step"' : ''}>${goBack
        ? `<button type="button" data-goto="${n}" aria-label="${esc(fill(t('go_back_to'), { step: nm }))}">${inner}</button>`
        : `<div>${inner}</div>`}</li>`;
    }).join('');
    const p = state.done ? 1 : (state.step - 1) / Math.max(1, STEPS - 1);
    const artDir = state.done ? ' is-done' : dir;
    return `<aside class="studio-side">
        <figure class="studio-art${artDir}" aria-hidden="true">${art}</figure>
        <ol class="studio-rail" style="--p:${p.toFixed(3)}" aria-label="${esc(t('steps_aria'))}">${rail}</ol>
        <p class="order-who studio-who"><img src="${FOUNDER_PHOTO}" alt="" width="28" height="28" loading="lazy" decoding="async"><span>${esc(t('who'))}</span></p>
      </aside>`;
  }
  function render() {
    if (!dlg) return;
    const form = dlg.querySelector('form');
    const o = offerById(state.offer);
    const paid = config.mode === 'stripe';
    const dir = state.dir === 'back' ? ' is-back' : state.dir === 'fwd' ? ' is-fwd' : '';
    state.dir = '';
    const top = (count) => `<div class="studio-top"><p class="studio-count">${count}</p><button type="button" class="dlg-x" data-close aria-label="${esc(t('close'))}">${ICON_CLOSE}</button></div>`;
    if (state.done) {
      form.innerHTML = `${side(' is-done')}<section class="studio-main">${top('')}
        <div class="order-body is-fwd" data-step="done"><div class="order-done">
          <span class="done-mark" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/><path d="M20 33l8 8 16-18"/></svg></span>
          <h2 id="order-title">${state.ref ? fill(t('done_sent_title'), { ref: esc(state.ref) }) : t('done_title')}</h2>
          <p>${esc(state.ref ? fill(t('done_sent_text'), { email: state.f.email }) : t('done_text'))}</p>
          <ol>${t(state.ref ? 'done_sent_next' : 'done_next').map(([a, b], i) => `<li><span class="os-n" aria-hidden="true">${i + 1}</span><span><b>${esc(a)}</b>${esc(b)}</span></li>`).join('')}</ol>
          <p><a href="#" class="text-link" data-copy>${esc(t('done_copy'))}</a></p>
        </div></div>
        <footer class="order-foot"><div class="order-btns">
          <button type="button" class="btn btn-line" data-close>${esc(t('done_close'))}</button>
          <a class="btn btn-primary" href="${esc(CAL)}" target="_blank" rel="noopener noreferrer">${esc(t('done_cal'))}</a>
        </div></footer>
        <p class="order-status" id="order-status" role="status" aria-live="polite"></p></section>`;
      return;
    }
    const step = state.step;
    const key = STEP_KEYS[step - 1];
    const title = (t('titles') || [])[step - 1] || '';
    const lede = key === 'pay' ? t(paid ? 'lede_pay' : 'lede_req') : (t('ledes') || [])[step - 1] || '';
    const trust = key === 'pay' ? `<p class="order-trust">${t(paid ? 'trust_pay' : 'trust_req').map((x, i) => `<span>${paid && i === 0 ? ICON_LOCK : ICON_CHECK}${esc(x)}</span>`).join('')}</p>` : '';
    const body = { site: stepSite, pack: stepPackage, build: stepBuild, you: stepYou, pay: stepReview }[key]();
    let primary;
    if (key === 'pay') {
      primary = paid
        ? `<button type="submit" class="btn btn-primary"${state.busy ? ' disabled' : ''}>${esc(fill(t('pay'), { total: money(total()) }))}</button>`
        : `<button type="submit" class="btn btn-primary">${esc(t('send'))}</button>`;
    } else {
      primary = `<button type="submit" class="btn btn-primary btn-next"><span>${esc(t(key === 'build' ? 'build_ok' : key === 'you' ? 'review' : 'next'))}</span>${ICON_NEXT}</button>`;
    }
    const tr = (o.tracks || []).find((x) => x.id === state.track);
    form.innerHTML = `${side(dir)}<section class="studio-main">${top(esc(fill(t('step_of'), { n: step, total: STEPS })))}
      <header class="studio-head${dir}"><h2 id="order-title">${title}</h2>${lede ? `<p class="studio-lede">${esc(lede)}</p>` : ''}</header>
      <div class="order-body${dir}" data-step="${key}">${body}</div>
      <footer class="order-foot">
        <p class="order-total"><b>${esc(money(total()))}</b><span class="order-meta"><span>${esc(pick(o.name))}${tr ? ` · ${esc(pick(tr.name))}` : ''}</span><small>${esc(t('taxes'))}</small></span></p>
        <div class="order-btns">
          ${step > 1 ? `<button type="button" class="btn btn-line" data-back>${esc(t('back'))}</button>` : ''}
          ${key === 'pay' && !paid ? `<button type="button" class="btn btn-line" data-copy>${esc(t('copy'))}</button>` : ''}
          ${primary}
        </div>
        ${trust}
      </footer>
      <p class="order-status" id="order-status" role="status" aria-live="polite"></p></section>`;
  }
  function status(text, html) {
    const el = $('order-status');
    if (!el) return;
    if (html) el.innerHTML = text; else el.textContent = text;
  }

  /* ── Events ── */
  function readFields() {
    const form = dlg.querySelector('form');
    ['link', 'brief', 'name', 'email', 'company', 'country', 'vat'].forEach((k) => {
      const el = form.elements[k];
      if (el) state.f[k] = el.value.trim();
    });
  }
  function onInput(e) {
    const el = e.target;
    if (el.name === 'offer' && el.checked) { state.offer = el.value; state.addons = {}; const o = offerById(el.value); state.track = (o.tracks || [])[0] ? o.tracks[0].id : ''; render(); return; }
    if (el.name === 'track' && el.checked) { state.track = el.value; render(); return; }
    if (el.name === 'kind' && el.checked) { readFields(); state.f.kind = el.value; render(); const r = dlg.querySelector(`input[name="kind"][value="${el.value}"]`); if (r) r.focus(); return; }
    if (el.name === 'c_scope') state.c.scope = el.checked;
    if (el.name === 'c_terms') state.c.terms = el.checked;
    if (el.name === 'c_start') state.c.startNow = el.checked;
    if (['link', 'brief', 'name', 'email', 'company', 'country', 'vat'].includes(el.name)) {
      state.f[el.name] = el.value.trim();
      if (el.name === 'brief') dlg.querySelectorAll('[data-chip]').forEach((c) => c.classList.toggle('is-used', el.value.includes(c.dataset.chip)));
      saveDraft();
    }
  }
  /* Add-on details: hover or keyboard focus shows the tooltip (CSS); a tap or click pins it open, a tap anywhere
     else unpins it, and Escape hides it before it would close the dialog. */
  function pinTip(btn) {
    dlg.querySelectorAll('.add-info[aria-expanded="true"]').forEach((b) => { if (b !== btn) b.setAttribute('aria-expanded', 'false'); });
    if (btn) btn.setAttribute('aria-expanded', btn.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
  }
  function onTipKey(e) {
    if (e.key !== 'Escape') return;
    const help = e.target.closest && e.target.closest('.add-help');
    if (!help && !dlg.querySelector('.add-info[aria-expanded="true"]')) return;
    e.preventDefault();
    e.stopPropagation();
    pinTip(null);
    if (help) help.classList.add('is-quiet');
  }
  function onClick(e) {
    if (e.target.closest('[data-close]')) { close(); return; }
    const info = e.target.closest('.add-info');
    if (info) { pinTip(info); return; }
    if (!e.target.closest('.add-tip')) pinTip(null);
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      const ta = dlg.querySelector('#o-brief');
      if (!ta) return;
      const text = chip.dataset.chip;
      if (!ta.value.includes(text)) {
        const cur = ta.value.trim();
        ta.value = (cur ? (/[.!?]$/.test(cur) ? cur + ' ' : cur + '. ') : '') + text + '.';
        ta.value = ta.value.slice(0, 1000);
      }
      state.f.brief = ta.value.trim();
      chip.classList.add('is-used');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      saveDraft();
      return;
    }
    const stepBtn = e.target.closest('.step-btn');
    if (stepBtn) {
      const a = (OFFERS.addons || []).find((x) => x.id === stepBtn.dataset.add);
      if (!a) return;
      const max = Number.isInteger(a.max) && a.max > 0 ? a.max : 1;
      const q = Math.max(0, Math.min(max, (state.addons[a.id] || 0) + Number(stepBtn.dataset.delta)));
      state.addons[a.id] = q;
      const delta = stepBtn.dataset.delta;
      render();
      const again = dlg.querySelector(`.step-btn[data-add="${a.id}"][data-delta="${delta}"]`);
      if (again && !again.disabled) again.focus(); else { const other = dlg.querySelector(`.step-btn[data-add="${a.id}"]:not([disabled])`); if (other) other.focus(); }
      return;
    }
    if (e.target.closest('[data-back]')) { readFields(); state.step = Math.max(1, state.step - 1); state.dir = 'back'; render(); focusStep(); return; }
    const goto = e.target.closest('[data-goto]');
    if (goto) { readFields(); state.step = Math.max(1, Math.min(state.step, Number(goto.dataset.goto) || 1)); state.dir = 'back'; render(); focusStep(); return; }
    if (e.target.closest('[data-copy]')) { e.preventDefault(); copyOrder(); return; }
    if (e.target.closest('[data-mail]')) { e.preventDefault(); sendByMail(); }
  }
  function onSubmit(e) {
    e.preventDefault();
    const form = dlg.querySelector('form');
    readFields();
    if (!form.reportValidity()) { status(t('fix')); return; }
    if (state.step < STEPS) { state.step += 1; state.dir = 'fwd'; render(); focusStep(); return; }
    if (config.mode === 'stripe') pay(); else sendOrder();
  }

  /* ── Request mode: the order goes to the server, which emails it to the founder and confirms to the buyer.
     When the mail provider is off (503) or the network fails, the visitor's own email app takes over. ── */
  function orderPayload() {
    const f = state.f;
    return {
      offer: state.offer,
      track: state.track,
      addons: Object.entries(state.addons).filter(([, q]) => q > 0).map(([id, qty]) => ({ id, qty })),
      lang: lang(),
      locale: (window.SITE && SITE.locale) || lang(),
      website: '',
      openedAt: state.openedAt || 0,
      customer: {
        name: f.name, email: f.email, kind: f.kind, company: f.company, country: f.country, vat: f.vat, link: f.link, brief: f.brief,
        consent: { scope: state.c.scope, terms: state.c.terms, startNow: state.c.startNow },
      },
    };
  }
  async function sendOrder() {
    if (state.busy) return;
    state.busy = true;
    status(t('sending'));
    let r = null;
    let data = {};
    try {
      r = await fetch('/api/agence/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderPayload()) });
      data = await r.json().catch(() => ({}));
    } catch (err) { r = null; }
    state.busy = false;
    if (r && r.ok && data && typeof data.ref === 'string') {
      state.ref = data.ref;
      state.done = true;
      clearDraft();
      render();
      dabBurst(dlg && dlg.querySelector('.done-mark'));
      const cal = dlg && dlg.querySelector('.order-foot .btn-primary');
      if (cal) cal.focus({ preventScroll: true });
      return;
    }
    if (r && r.status === 429) { status(fill(t('too_many'), { email: EMAIL })); return; }
    if (r && r.status === 422) { status(t('fix')); return; }
    sendByMail();
  }
  function mailParts() {
    // The draft goes to the founder, who reads English and French: in any other language the labels stay
    // English and a line names the visitor's language (the brief itself is in their words).
    const t = tRaw;
    const pick = pickRaw;
    const I = window.AG_I18N || {};
    let langLine = '';
    if (I.mt && I.code) {
      let name = I.code;
      try { name = new Intl.DisplayNames(['en'], { type: 'language' }).of(I.code) || I.code; } catch (e) { /* older browser */ }
      langLine = 'Visitor language: ' + name;
    }
    const o = offerById(state.offer);
    const tr = (o.tracks || []).find((x) => x.id === state.track);
    const f = state.f;
    const adds = lines().slice(1).map((l) => `${l.name} × ${l.qty} (${money(l.amount)})`).join('; ') || t('none');
    const who = [f.kind === 'individual' ? t('as_individual') : t('as_business'), f.company, f.country, f.vat].filter(Boolean).join(' · ');
    const body = [
      `${t('mail_package')} ${pick(o.name)} (${money(o.price)})`,
      tr ? `${t('mail_track')} ${pick(tr.name)}` : '',
      `${t('mail_addons')} ${adds}`,
      `${t('mail_total')} ${money(total())}, ${t('taxes')}`,
      '',
      `${t('mail_name')} ${f.name}`,
      `${t('mail_email')} ${f.email}`,
      `${t('mail_as')} ${who}`,
      `${t('mail_link')} ${f.link || t('none')}`,
      '',
      t('mail_brief'),
      f.brief,
      '',
      t('mail_from'),
      langLine,
    ].filter((x, i, arr) => !(x === '' && arr[i - 1] === '')).join('\n');
    const subject = fill(t('mail_subject'), { offer: pick(o.name), name: f.name });
    return { to: EMAIL, subject, body };
  }
  function sendByMail() {
    const { to, subject, body } = mailParts();
    status(t('sending'));
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setTimeout(() => {
      state.done = true;
      clearDraft();
      render();
      dabBurst(dlg && dlg.querySelector('.done-mark'));
      const cal = dlg && dlg.querySelector('.order-foot .btn-primary');
      if (cal) cal.focus({ preventScroll: true });
    }, 650);
  }
  async function copyOrder() {
    const { to, subject, body } = mailParts();
    try {
      await navigator.clipboard.writeText(`${to}\n${subject}\n\n${body}`);
      status(fill(t('copied'), { email: EMAIL }));
    } catch (err) {
      status(fill(t('copy_failed'), { email: EMAIL }));
    }
  }

  /* ── Stripe mode: the server prices the order and returns the Checkout URL ── */
  async function pay() {
    if (state.busy) return;
    state.busy = true;
    render();
    status(t('paying'));
    const f = state.f;
    const payload = {
      offer: state.offer,
      track: state.track,
      addons: Object.entries(state.addons).filter(([, q]) => q > 0).map(([id, qty]) => ({ id, qty })),
      lang: lang(),
      locale: (window.SITE && SITE.locale) || lang(),
      customer: {
        name: f.name, email: f.email, kind: f.kind, company: f.company, country: f.country, vat: f.vat, link: f.link, brief: f.brief,
        consent: { scope: state.c.scope, terms: state.c.terms, startNow: state.c.startNow },
      },
    };
    try {
      const r = await fetch('/api/agence/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data && typeof data.url === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(data.url)) {
        // Kept for this tab only, so a cancelled payment comes back to the same order.
        try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ offer: state.offer, track: state.track, addons: state.addons, f: state.f })); } catch (e) { /* storage blocked */ }
        clearDraft();
        window.location.assign(data.url);
        return;
      }
      throw new Error((data && data.error) || String(r.status));
    } catch (err) {
      state.busy = false;
      render();
      status(`${esc(t('pay_failed'))} <a href="#" data-mail>${esc(t('by_email'))}</a>`, true);
    }
  }

  /* ── Wiring ── */
  d.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-order]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    open(b.dataset.order, b.dataset.track || '');
  }, true);
  window.agenceOrder = { open, config: () => Object.assign({}, config) };

  // A cancelled Stripe page brings the buyer back to /agence/pricing?order=cancelled: reopen the same order on its review.
  try {
    const q = new URLSearchParams(window.location.search);
    const draft = q.get('order') === 'cancelled' ? JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || 'null') : null;
    if (draft && offerById(draft.offer)) {
      Object.assign(state.f, draft.f || {});
      if (open(draft.offer, draft.track)) {
        state.addons = draft.addons && typeof draft.addons === 'object' ? draft.addons : {};
        state.step = STEPS;
        render();
      }
    }
  } catch (e) { /* storage blocked or bad draft: the page works without it */ }

  /* ── /agence/thanks ── */
  function renderThanks(summary) {
    const page = $('thanks');
    if (!page) return;
    d.title = t('t_doc');
    const h = $('thanks-title');
    if (h) h.innerHTML = t('t_title');
    const lede = $('thanks-lede');
    if (lede) lede.textContent = t('t_lede');
    let note = $('thanks-note');
    if (!note && lede) { note = d.createElement('div'); note.className = 'thanks-note'; note.id = 'thanks-note'; lede.insertAdjacentElement('afterend', note); }
    if (note) note.innerHTML = `<img src="${FOUNDER_PHOTO}" alt="" width="46" height="46" loading="lazy" decoding="async"><p>${esc(t('t_note'))}<span class="sig">${esc(t('t_sig'))}</span></p>`;
    const next = $('thanks-next');
    if (next) next.innerHTML = t('t_next').map(([a, b], i) => `<li><span class="os-n" aria-hidden="true">${i + 1}</span><div><b>${esc(a)}</b><span>${esc(b)}</span></div></li>`).join('');
    const cal = $('thanks-cal');
    if (cal) { cal.textContent = t('t_cal'); cal.href = CAL; }
    const back = page.querySelector('.thanks-actions .btn-ghost, .thanks-actions .btn-line');
    if (back) back.textContent = t('t_back');
    const card = $('thanks-card');
    if (!card) return;
    if (!summary) {
      // While the session is still being fetched the card says "processing", not "your payment page is closed".
      const waiting = !thanksLoaded && !!new URLSearchParams(window.location.search).get('session_id');
      card.innerHTML = `<p class="thanks-muted">${esc(waiting ? t('t_pending') : fill(t('t_unknown'), { email: EMAIL }))}</p>`;
      return;
    }
    const o = offerById(summary.offer);
    const tr = o && (o.tracks || []).find((x) => x.id === summary.track);
    const adds = String(summary.addons || '').split(',').filter(Boolean).map((part) => {
      const m = part.match(/^(.+)x(\d+)$/);
      const a = m && (OFFERS.addons || []).find((x) => x.id === m[1]);
      return a ? `<li><span>${esc(tidy(pick(a.name)))} <small>× ${m[2]}</small></span></li>` : '';
    }).join('');
    card.innerHTML = `<p class="thanks-state${summary.paid ? ' is-paid' : ''}">${esc(summary.paid ? t('t_paid') : t('t_pending'))}</p>
      <p class="thanks-pack">${esc(o ? pick(o.name) : summary.offer)}${tr ? ` · ${esc(pick(tr.name))}` : ''}</p>
      ${adds ? `<ul class="thanks-adds">${adds}</ul>` : ''}
      ${summary.total != null ? `<p class="thanks-total">${esc(money(summary.total))}</p>` : ''}
      ${summary.email ? `<p class="thanks-muted">${esc(fill(t('t_receipt'), { email: summary.email }))}</p>` : ''}`;
  }
  let thanksSummary = null;
  let thanksLoaded = false;
  function loadThanks() {
    if (!$('thanks')) return;
    renderThanks(null);
    const id = new URLSearchParams(window.location.search).get('session_id') || '';
    if (!id) return;
    fetch('/api/agence/checkout/session?id=' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        thanksLoaded = true;
        thanksSummary = s;
        renderThanks(s);
        if (s && s.paid) setTimeout(() => dabBurst($('thanks-card')), 250);
      })
      .catch(() => { thanksLoaded = true; renderThanks(null); });
  }

  // Language: the story script rewrites <html lang>; follow it.
  new MutationObserver(() => {
    if (dlg && dlg.open) { readFields(); render(); }
    if ($('thanks')) renderThanks(thanksLoaded ? thanksSummary : null);
  }).observe(root, { attributes: true, attributeFilter: ['lang'] });

  loadThanks();
})();
