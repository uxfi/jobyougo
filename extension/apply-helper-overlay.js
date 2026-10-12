// Injected into the offer tab by background.js (show-helper). Draws the
// quick-fill helper as a floating panel over the posting: profile values, the
// report's answers and the regional CV, one Copy click away.
//
// The panel lives in a closed shadow root, so field collection, form probes
// and PAGE_HTML never see its buttons and the page's CSS never reaches it.
// background.js sets self.__jobyougoHelperData before injecting this file and
// injects it again after each navigation of the tab.

(() => {
  const data = self.__jobyougoHelperData;
  if (!data) return;
  const HOST_ID = 'jobyougo-apply-helper';
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 16px; right: 16px;';
  const root = host.attachShadow({ mode: 'closed' });

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

  const copyValues = [];
  const copyButton = (value) => `<button class="btn copy" data-copy="${copyValues.push(value) - 1}">Copy</button>`;
  const row = (label, value, extraClass = '') => `<div class="row"><div><div class="label">${esc(label)}</div>
    <div class="value ${extraClass}">${esc(value)}</div></div>${copyButton(value)}</div>`;

  const fields = Array.isArray(data.fields) ? data.fields : [];
  const answers = Array.isArray(data.answers) ? data.answers : [];
  const sections = [
    data.cv ? `<h2>CV to attach</h2>${row(data.cvLabel || 'CV', data.cv)}` : '',
    `<h2>Profile</h2>${fields.map((f) => row(f.label, f.value)).join('') || '<p class="sub">No profile fields found.</p>'}`,
    answers.length ? `<h2>Answers from the report</h2>${answers.map((a) => row(a.question, a.answer, 'answer')).join('')}` : '',
  ].join('');

  // A constructed sheet, not a <style> tag: nothing for the page's CSP to block.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
  :host { color-scheme: dark; }
  * { box-sizing: border-box; }
  .panel { width: 360px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); display: flex; flex-direction: column;
    background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0) 110px), #0e1112;
    color: #f2f5f3; border: 1px solid rgba(255,255,255,0.10); border-radius: 18px;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 28px 70px -12px rgba(0,0,0,0.7), 0 0 50px -24px rgba(45,212,160,0.35), inset 0 1px 0 rgba(255,255,255,0.06);
    font: 13px/1.5 Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    transform-origin: top right; animation: in 260ms cubic-bezier(.22,1.2,.36,1); }
  @keyframes in { from { opacity: 0; transform: translateY(-8px) scale(0.97); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .panel, .pill { animation: none; } }
  .head { display: flex; gap: 6px; align-items: flex-start; padding: 16px 12px 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.07); }
  .head > div { flex: 1; min-width: 0; }
  .kicker { font: 500 10px/1 ui-monospace, Menlo, monospace; text-transform: uppercase; letter-spacing: .08em; color: #2dd4a0; }
  h1 { font-size: 15px; font-weight: 650; margin: 4px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { color: #8a948f; margin: 0; }
  .body { overflow: auto; overscroll-behavior: contain; padding: 12px 16px 16px; }
  h2 { font: 500 10px/1 ui-monospace, Menlo, monospace; text-transform: uppercase; letter-spacing: .08em; color: #8a948f; margin: 14px 0 8px; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .actions { gap: 8px; }
  .btn { font: inherit; font-weight: 600; border-radius: 999px; cursor: pointer; height: 36px; padding: 0 16px;
    border: 1px solid rgba(255,255,255,0.085); background: rgba(255,255,255,0.04); color: #f2f5f3;
    transition: background 140ms, border-color 140ms, transform 160ms; }
  .btn:hover { border-color: rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); }
  .btn:active { transform: scale(0.97); }
  .btn.primary { flex: 1; background: #2dd4a0; border-color: #2dd4a0; color: #03140d;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.28), 0 6px 18px rgba(45,212,160,0.2); }
  .btn.primary:hover { background: #5eefc0; }
  .btn.copy { flex: none; height: 28px; padding: 0 12px; font-size: 12px; color: #5eefc0; background: rgba(45,212,160,0.10); border-color: transparent; }
  .btn.copy:hover { background: rgba(45,212,160,0.18); }
  .btn.icon { flex: none; width: 32px; height: 32px; padding: 0; font-size: 16px; color: #b9c2bd; background: transparent; border-color: rgba(255,255,255,0.06); }
  .btn:focus-visible { outline: 2px solid #2dd4a0; outline-offset: 2px; }
  .row { display: flex; gap: 10px; justify-content: space-between; align-items: center; padding: 10px 12px;
    border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; background: rgba(255,255,255,0.02); margin-bottom: 6px;
    transition: border-color 140ms, background 140ms; }
  .row:hover { border-color: rgba(45,212,160,0.25); background: rgba(45,212,160,0.04); }
  .row > div { min-width: 0; }
  .label { font-size: 11px; color: #8a948f; margin-bottom: 2px; }
  .value { white-space: pre-wrap; word-break: break-word; }
  .answer { max-height: 8em; overflow: auto; color: #b9c2bd; }
  .note { margin: 8px 0 0; color: #e8b86d; font-size: 12px; }
  .pill { display: none; font: 600 12px/1 Inter, system-ui, sans-serif; cursor: pointer; padding: 11px 16px; border-radius: 999px; animation: in 220ms ease-out;
    border: 1px solid #2dd4a0; background: #07090a; color: #2dd4a0; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
  :host([data-min]) .panel { display: none; }
  :host([data-min]) .pill { display: block; }
`);
  root.adoptedStyleSheets = [sheet];

  root.innerHTML = `
    <button class="pill" id="restore" title="Show the quick-fill helper">JobYouGo · quick-fill</button>
    <div class="panel" role="dialog" aria-label="JobYouGo quick-fill helper">
      <div class="head">
        <div>
          <span class="kicker">JobYouGo · quick-fill</span>
          <h1 title="${esc(data.company)}">${esc(data.company || 'Offer')}</h1>
          <p class="sub">${esc(data.role || '')}</p>
        </div>
        <button class="btn icon" id="minimize" title="Minimize" aria-label="Minimize">–</button>
        <button class="btn icon" id="close" title="Close the helper for this tab" aria-label="Close">×</button>
      </div>
      <div class="body">
        <div class="actions">
          ${data.canFill ? '<button class="btn primary" id="fill">Fill with the plugin</button>' : ''}
          <button class="btn" id="copy-all">Copy all fields</button>
        </div>
        <p class="note" id="note" hidden></p>
        ${sections}
      </div>
    </div>`;

  const $ = (id) => root.getElementById(id);
  const flash = (btn, text) => {
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 1200);
  };
  const copy = async (value, btn) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement('textarea');
      area.value = value;
      root.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      if (!ok) return flash(btn, 'Copy failed');
    }
    flash(btn, 'Copied');
  };
  const send = (type) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type }, (res) => resolve(chrome.runtime.lastError ? null : res));
    } catch {
      resolve(null); // extension reloaded: this panel is orphaned
    }
  });
  const setMinimized = (min) => {
    if (min) host.setAttribute('data-min', '');
    else host.removeAttribute('data-min');
    send(min ? 'helper-minimize' : 'helper-restore');
  };
  if (data.minimized) host.setAttribute('data-min', '');

  root.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => copy(copyValues[Number(btn.dataset.copy)] ?? '', btn));
  });
  $('copy-all').addEventListener('click', (e) => {
    copy(fields.map((f) => `${f.label}: ${f.value}`).join('\n'), e.currentTarget);
  });
  $('minimize').addEventListener('click', () => setMinimized(true));
  // Escape folds the panel away when focus is inside it (the page keeps its own Escape otherwise).
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !host.hasAttribute('data-min')) {
      e.stopPropagation();
      setMinimized(true);
      $('restore').focus();
    }
  });
  $('restore').addEventListener('click', () => setMinimized(false));
  $('close').addEventListener('click', () => {
    host.remove();
    send('helper-close');
  });
  // The run starts from the dashboard, which shows its progress. The panel
  // folds away so it does not cover the fields the plugin is about to fill.
  $('fill')?.addEventListener('click', async () => {
    const res = await send('helper-fill');
    if (res?.ok) {
      setMinimized(true);
      return;
    }
    const note = $('note');
    note.textContent = 'Open the JobYouGo dashboard in this Chrome to start the fill.';
    note.hidden = false;
  });

  // On <html>: SPAs that swap <body> would drop it, and a transform on <body>
  // would pin it to the page instead of the viewport.
  document.documentElement.appendChild(host);
})();
