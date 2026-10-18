/* v2 studio (/agence): the order flow, 2026-10-17.
   Loads after agence-data.js (AGENCY_OFFERS, agPrice, agTidyText) and agence-story.js. A [data-order] button opens
   a three-step dialog: the package (track and add-ons), the brief and who is buying, then the review.
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
    },
  };

  const lang = () => (root.lang === 'fr' ? 'fr' : 'en');
  const t = (k) => { const v = COPY[lang()][k]; return v != null ? v : COPY.en[k]; };
  const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  const pick = (o) => (o && typeof o === 'object' ? (o[lang()] != null ? o[lang()] : o.en) : o);
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
  const state = { step: 1, offer: '', track: '', addons: {}, f: { link: '', brief: '', name: '', email: '', kind: 'business', company: '', country: '', vat: '' }, c: { scope: false, terms: false, startNow: false }, busy: false };
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
    dlg.className = 'dlg order';
    dlg.id = 'order-dialog';
    dlg.setAttribute('aria-labelledby', 'order-title');
    dlg.innerHTML = '<form class="order-inner" id="order-form" novalidate></form>';
    d.body.appendChild(dlg);
    dlg.addEventListener('click', onClick);
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
    ensureDialog();
    render();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    focusStep();
    return true;
  }
  function close() {
    if (!dlg) return;
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }
  function focusStep() {
    setTimeout(() => {
      const el = dlg && dlg.querySelector('.order-body [autofocus], .order-body input:not([type=hidden]), .order-body button');
      if (el) el.focus({ preventScroll: true });
    }, 30);
  }

  function radio(name, value, checked, label, extra) {
    return `<label class="opt${checked ? ' is-on' : ''}"><input type="radio" name="${esc(name)}" value="${esc(value)}"${checked ? ' checked' : ''}><span class="opt-main">${label}</span>${extra || ''}</label>`;
  }
  function stepPackage() {
    const o = offerById(state.offer);
    const packs = orderable().map((p) => radio('offer', p.id, p.id === state.offer, `<b>${esc(pick(p.name))}</b><span class="opt-sub">${esc(pick(p.delivery))}</span>`, `<span class="opt-price">${esc(money(p.price))}</span>`)).join('');
    const tracks = (o.tracks || []).map((tr) => radio('track', tr.id, tr.id === state.track, `<b>${esc(pick(tr.name))}</b><span class="opt-sub">${esc(tidy((pick(tr.includes) || [])[0] || ''))}</span>`)).join('');
    const adds = addonsFor(o.id);
    const addRows = adds.map((a) => {
      const q = state.addons[a.id] || 0;
      const max = Number.isInteger(a.max) && a.max > 0 ? a.max : 1;
      return `<li class="add-row${q ? ' is-on' : ''}">
        <span class="add-name">${esc(tidy(pick(a.name)))}<small>${esc(money(a.price))}</small></span>
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
      <fieldset class="order-set"><legend>${esc(t('addons'))}</legend>${addRows ? `<ul class="add-list">${addRows}</ul>` : `<p class="order-muted">${esc(t('addons_none'))}</p>`}</fieldset>`;
  }
  function field(id, label, input, hint) {
    return `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<p class="field-hint">${hint}</p>` : ''}</div>`;
  }
  function stepBrief() {
    const f = state.f;
    const opt = (s) => `${esc(s)} <span class="field-opt">${esc(t('opt'))}</span>`;
    return `${field('o-link', `${esc(t('link'))} <span class="field-opt">${esc(t('link_opt'))}</span>`, `<input id="o-link" name="link" type="url" inputmode="url" autocomplete="url" placeholder="https://" value="${esc(f.link)}">`)}
      ${field('o-brief', esc(t('brief')), `<textarea id="o-brief" name="brief" required minlength="10" maxlength="1000" placeholder="${esc(t('brief_ph'))}">${esc(f.brief)}</textarea>`, esc(t('brief_hint')))}
      <div class="field-row">
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
    return `<ul class="order-lines">${rows}</ul>
      <dl class="order-facts">
        <div><dt>${esc(t('delivery'))}</dt><dd>${esc(fill(t('delivery_line'), { delivery: pick(o.delivery) }))}</dd></div>
        <div><dt>${esc(t('revisions'))}</dt><dd>${esc(pick(o.revisions))}</dd></div>
      </dl>
      <p class="order-nextline">${esc(t(paid ? 'next_pay' : 'next_req'))}</p>
      <div class="order-checks">
        <label class="chk"><input type="checkbox" name="c_scope" required${state.c.scope ? ' checked' : ''}><span>${esc(t('c_scope'))}</span></label>
        ${paid && terms ? `<label class="chk"><input type="checkbox" name="c_terms" required${state.c.terms ? ' checked' : ''}><span>${terms}</span></label>` : ''}
        ${needStart ? `<label class="chk"><input type="checkbox" name="c_start" required${state.c.startNow ? ' checked' : ''}><span>${esc(t('c_start'))}</span></label>` : ''}
      </div>`;
  }
  function render() {
    if (!dlg) return;
    const form = dlg.querySelector('form');
    const o = offerById(state.offer);
    const paid = config.mode === 'stripe';
    const steps = [1, 2, 3].map((n) => `<li${n === state.step ? ' aria-current="step"' : ''}${n < state.step ? ' class="is-done"' : ''}><span>${n}</span>${esc(t('step_' + n))}</li>`).join('');
    const body = state.step === 1 ? stepPackage() : state.step === 2 ? stepBrief() : stepReview();
    let primary;
    if (state.step < 3) primary = `<button type="submit" class="btn btn-primary">${esc(t(state.step === 2 ? 'review' : 'next'))}</button>`;
    else if (paid) primary = `<button type="submit" class="btn btn-primary"${state.busy ? ' disabled' : ''}>${esc(fill(t('pay'), { total: money(total()) }))}</button>`;
    else primary = `<button type="submit" class="btn btn-primary">${esc(t('send'))}</button>`;
    form.innerHTML = `<header class="order-head">
        <div><p class="order-kicker">${esc(t('kicker'))}</p><h2 id="order-title">${esc(pick(o.name))}</h2></div>
        <button type="button" class="dlg-x" data-close aria-label="${esc(t('close'))}">×</button>
      </header>
      <ol class="order-nav" aria-label="${esc(t('steps_aria'))}">${steps}</ol>
      <div class="order-body" data-step="${state.step}">${body}</div>
      <footer class="order-foot">
        <p class="order-total"><span>${esc(t('total'))}</span><b>${esc(money(total()))}</b><small>${esc(t('taxes'))}</small></p>
        <div class="order-btns">
          ${state.step > 1 ? `<button type="button" class="btn btn-line" data-back>${esc(t('back'))}</button>` : ''}
          ${state.step === 3 && !paid ? `<button type="button" class="btn btn-line" data-copy>${esc(t('copy'))}</button>` : ''}
          ${primary}
        </div>
      </footer>
      <p class="order-status" id="order-status" role="status" aria-live="polite"></p>`;
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
    if (['link', 'brief', 'name', 'email', 'company', 'country', 'vat'].includes(el.name)) state.f[el.name] = el.value.trim();
  }
  function onClick(e) {
    if (e.target.closest('[data-close]')) { close(); return; }
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
    if (e.target.closest('[data-back]')) { if (state.step === 2) readFields(); state.step = Math.max(1, state.step - 1); render(); focusStep(); return; }
    if (e.target.closest('[data-copy]')) { copyOrder(); return; }
    if (e.target.closest('[data-mail]')) { e.preventDefault(); sendByMail(); }
  }
  function onSubmit(e) {
    e.preventDefault();
    const form = dlg.querySelector('form');
    if (state.step === 2) readFields();
    if (!form.reportValidity()) { status(t('fix')); return; }
    if (state.step < 3) { state.step += 1; render(); focusStep(); return; }
    if (config.mode === 'stripe') pay(); else sendByMail();
  }

  /* ── Request mode: the order as an email draft ── */
  function mailParts() {
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
    ].filter((x, i, arr) => !(x === '' && arr[i - 1] === '')).join('\n');
    const subject = fill(t('mail_subject'), { offer: pick(o.name), name: f.name });
    return { to: EMAIL, subject, body };
  }
  function sendByMail() {
    const { to, subject, body } = mailParts();
    status(t('sending'));
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setTimeout(() => status(t('sent')), 700);
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
        state.step = 3;
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
    const next = $('thanks-next');
    if (next) next.innerHTML = t('t_next').map(([a, b], i) => `<li><span class="os-n" aria-hidden="true">${i + 1}</span><div><b>${esc(a)}</b><span>${esc(b)}</span></div></li>`).join('');
    const cal = $('thanks-cal');
    if (cal) { cal.textContent = t('t_cal'); cal.href = CAL; }
    const back = page.querySelector('.thanks-actions .btn-line');
    if (back) back.textContent = t('t_back');
    const card = $('thanks-card');
    if (!card) return;
    if (!summary) { card.innerHTML = `<p class="thanks-muted">${esc(fill(t('t_unknown'), { email: EMAIL }))}</p>`; return; }
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
      .then((s) => { thanksLoaded = true; thanksSummary = s; renderThanks(s); })
      .catch(() => {});
  }

  // Language: the story script rewrites <html lang>; follow it.
  new MutationObserver(() => {
    if (dlg && dlg.open) { if (state.step === 2) readFields(); render(); }
    if ($('thanks')) renderThanks(thanksLoaded ? thanksSummary : null);
  }).observe(root, { attributes: true, attributeFilter: ['lang'] });

  loadThanks();
})();
