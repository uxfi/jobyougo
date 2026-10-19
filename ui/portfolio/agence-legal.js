/* v2 studio legal pages (/agence/terms, /agence/legal), 2026-10-18.
   Both languages are in the page and agence-legal.css shows the one that matches <html lang>. This script
   only gives the tab the title and description of the version shown. agence-story.js rewrites <html lang>
   and the title on every language switch, so the observer runs after it, like agence-checkout.js. */
(function () {
  'use strict';

  const d = document;
  const root = d.documentElement;

  function apply() {
    const lang = root.lang === 'fr' ? 'fr' : 'en';
    const doc = d.querySelector(`.legal-doc[data-legal-lang="${lang}"]`);
    if (!doc) return;
    if (doc.dataset.docTitle) d.title = doc.dataset.docTitle;
    const meta = d.querySelector('meta[name="description"]');
    if (meta && doc.dataset.docDesc) meta.setAttribute('content', doc.dataset.docDesc);
  }

  /* The terms are binding in English and French only: visitors reading the site in another language get the
     English text, with a note (machine-translated like the rest of their page) saying so. */
  function noteOtherLanguage() {
    const I = window.AG_I18N;
    const doc = d.querySelector('.legal-doc[data-legal-lang="en"]');
    if (!I || !I.mt || !doc || doc.querySelector('.legal-lang-note')) return;
    const p = d.createElement('p');
    p.className = 'legal-lang-note';
    p.textContent = typeof agTr === 'function'
      ? agTr('This page exists in English and French only. The English version below is the one that applies.')
      : 'This page exists in English and French only. The English version below is the one that applies.';
    doc.prepend(p);
  }
  noteOtherLanguage();

  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['lang'] });
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
