/**
 * In-page field collector for apply-runner. Self-contained so tests inject the
 * EXACT function the runner evaluates — a reimplementation here would miss
 * the live bugs (invisible Ashby radios, nameless-radio collapse, etc.).
 *
 * Returns an array of field descriptors with data-co-i markers stamped on the DOM.
 */
export const COLLECT_FIELDS = () => {
  document.querySelectorAll('[data-co-i]').forEach(e => e.removeAttribute('data-co-i'));
  document.querySelectorAll('[data-co-opt]').forEach(e => e.removeAttribute('data-co-opt'));
  document.querySelectorAll('[data-co-rg]').forEach(e => e.removeAttribute('data-co-rg'));

  const visible = (el) => {
    if (!el || el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'
      && st.opacity !== '0' && el.getAttribute('aria-hidden') !== 'true';
  };
  const inViewport = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return r.width >= 8 && r.height >= 8
      && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw
      && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };
  const inClosedTab = (el) => {
    const panel = el.closest('[role="tabpanel"]');
    if (!panel) return false;
    if (panel.hidden || panel.getAttribute('hidden') != null) return true;
    if (panel.getAttribute('aria-hidden') === 'true') return true;
    const tabId = panel.getAttribute('aria-labelledby');
    if (tabId) {
      const tab = document.getElementById(tabId);
      if (tab && tab.getAttribute('aria-selected') === 'false') return true;
    }
    return false;
  };
  const looksLikeDropzone = (t) =>
    /click or drag|drag (and|&) drop|upload (a |your )?(file|resume|cv)|parcourir/.test(t)
    || (/\bupload\b/.test(t) && t.length < 80);
  const labelByFor = (el) => el.id
    ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    : null;
  const proxyOf = (el) => {
    const labelled = labelByFor(el);
    if (labelled) return labelled;
    const wrap = el.closest('label');
    if (wrap) return wrap;
    const parent = el.parentElement;
    if (!parent || /^(FORM|BODY|HTML|MAIN|SECTION)$/.test(parent.tagName)) return null;
    if (parent.children.length <= 4) return parent;
    return null;
  };
  const controlVisible = (el) => {
    if (el.closest('[hidden], [inert]')) return false;
    if (visible(el)) return true;
    const proxy = proxyOf(el);
    return !!proxy && visible(proxy);
  };
  const isCheckEl = (el) => el.type === 'checkbox'
    || el.getAttribute('role') === 'checkbox'
    || el.getAttribute('role') === 'switch';
  const isChecked = (el) => !!(el.checked || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true');
  const fieldSelector = 'input, select, textarea, [role="checkbox"], [role="radio"], [role="switch"]';

  const optionTextFor = (el) => {
    const labelled = labelByFor(el);
    const fromFor = (labelled?.innerText || '').trim();
    if (fromFor) return fromFor;
    const wrap = el.closest('label');
    if (wrap && wrap.innerText.trim()) return wrap.innerText.trim();
    const own = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (own && own.length < 120 && !el.querySelector(fieldSelector)) return own;
    let node = el.parentElement;
    for (let d = 0; d < 3 && node; d++, node = node.parentElement) {
      const t = (node.innerText || '').trim();
      if (t && t.length < 120) return t;
    }
    const v = (el.value || '').trim();
    return v.toLowerCase() === 'on' ? '' : v;
  };

  const labelFor = (el) => {
    const parts = [];
    const nonempty = () => parts.some(p => p && String(p).trim());
    const labelled = labelByFor(el);
    if (labelled) parts.push(labelled.innerText);
    const wrap = el.closest('label');
    if (wrap) parts.push(wrap.innerText);
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    const lblBy = el.getAttribute('aria-labelledby');
    if (lblBy) {
      lblBy.split(/\s+/).forEach(id => {
        const n = document.getElementById(id);
        if (n) parts.push(n.innerText);
      });
    }
    if (!nonempty()) {
      let node = el.parentElement;
      for (let d = 0; d < 3 && node; d++, node = node.parentElement) {
        const lab = node.querySelector('label, legend, [class*="label" i]');
        if (lab && !lab.contains(el)) { parts.push(lab.innerText); break; }
        const txt = (node.innerText || '').trim();
        if (txt && txt.length < 220) { parts.push(txt); break; }
      }
    }
    if (!nonempty()) {
      let prev = el.previousElementSibling;
      for (let d = 0; d < 3 && prev; d++, prev = prev.previousElementSibling) {
        const t = (prev.innerText || '').trim();
        if (t && t.length < 160 && !prev.querySelector('input, textarea, select, [contenteditable="true"]')) {
          parts.push(t);
          break;
        }
      }
    }
    if (!nonempty() && el.placeholder) parts.push(el.placeholder);
    let out = [...new Set(parts.filter(Boolean).map(p => p.replace(/\s+/g, ' ').trim()))].join(' ').slice(0, 300);
    const firstQ = out.indexOf('?');
    if (firstQ > 10 && out.indexOf('?', firstQ + 1) > firstQ) out = out.slice(0, firstQ + 1);
    return out;
  };

  const isRequiredNode = (node, text) =>
    /(^|[^a-z])required/i.test((node?.className || '').toString()) || /[*✱]/.test(text || '');

  const groupMeta = (members) => {
    const none = { question: '', required: false };
    if (!members.length) return none;
    let container = members[0].parentElement;
    while (container) {
      if (members.every(m => container.contains(m))) break;
      container = container.parentElement;
    }
    if (!container) return none;
    const optionTexts = members.map(optionTextFor).filter(Boolean);
    const isJustOptions = (t) => optionTexts.includes(t) || optionTexts.join(' ') === t;
    const isOwnLabel = (node) => members.some(m => m.id && node.getAttribute?.('for') === m.id);
    const holdsOtherFields = (node) =>
      [...node.querySelectorAll(fieldSelector)].some(c => !members.includes(c));
    const chain = [];
    for (let d = 0, node = container; d < 4 && node; d++, node = node.parentElement) {
      if (d > 0 && holdsOtherFields(node)) break;
      chain.push(node);
    }
    const usable = (node, t) => t && t.length < 300 && !isJustOptions(t) && !members.some(m => node.contains(m));
    for (const node of chain) {
      for (const heading of node.querySelectorAll(':scope > legend, :scope > [class*="question" i], :scope > label')) {
        if (isOwnLabel(heading)) continue;
        const t = (heading.innerText || '').trim();
        if (usable(heading, t)) return { question: t, required: isRequiredNode(heading, t) };
      }
    }
    for (const node of chain) {
      const prev = node.previousElementSibling;
      const t = (prev?.innerText || '').trim();
      if (prev && usable(prev, t)) return { question: t, required: isRequiredNode(prev, t) };
    }
    if (holdsOtherFields(container)) return none;
    const full = (container.innerText || '').replace(/\s+/g, ' ').trim();
    for (const opt of optionTexts) {
      const idx = full.indexOf(opt);
      if (idx > 8) {
        const q = full.slice(0, idx).trim();
        return { question: q, required: isRequiredNode(container, q) };
      }
    }
    return none;
  };

  // Group radios by name when present; otherwise by radiogroup/fieldset.
  // Empty-name radios used to share key "" and collapse into one ghost entry
  // whose options list was empty (radiosByName skipped !el.name).
  const radiosByKey = new Map();
  const radioKeyByEl = new Map();
  let anonRg = 0;
  const radioKeyOf = (el) => {
    if (el.name) return `n:${el.name}`;
    const g = el.closest('[role="radiogroup"], fieldset');
    if (g) {
      if (!g.hasAttribute('data-co-rg')) g.setAttribute('data-co-rg', String(++anonRg));
      return `g:${g.getAttribute('data-co-rg')}`;
    }
    return `solo:${radioKeyByEl.size}`;
  };
  for (const el of document.querySelectorAll('input[type="radio"], [role="radio"]')) {
    if (el.matches(':disabled') || el.closest('[aria-disabled="true"]')) continue;
    if (!controlVisible(el)) continue;
    const k = radioKeyOf(el);
    radioKeyByEl.set(el, k);
    if (!radiosByKey.has(k)) radiosByKey.set(k, []);
    radiosByKey.get(k).push(el);
  }
  const radioGroupMeta = new Map();
  for (const [key, members] of radiosByKey) radioGroupMeta.set(key, groupMeta(members));

  const checkboxGroupOf = (el) => {
    let node = el.parentElement;
    for (let d = 0; d < 4 && node; d++, node = node.parentElement) {
      const fields = [...node.querySelectorAll(fieldSelector)];
      if (fields.some(f => f !== el && !isCheckEl(f))) return null;
      const mates = fields.filter(c => c !== el && isCheckEl(c) && controlVisible(c));
      if (mates.length) return [el, ...mates];
    }
    return null;
  };

  // Checkbox-widget quirks: some ATS vendors render a Yes/No choice as ONE
  // hidden checkbox plus two visible buttons, where checked=false can't tell
  // "No" from "not answered yet" — only the visible buttons can. Each row
  // names its own wrapper/option selectors so a new vendor is a new table
  // entry, not a new special case in the collection loop below.
  const YES_NO_CHECKBOX_QUIRKS = [
    { wrapperSelector: '.ashby-application-form-input-yesno', optionSelector: 'button[data-option][aria-pressed]', yesValue: 'yes', noValue: 'no' },
  ];
  const yesNoButtonsFor = (el, type) => {
    if (type !== 'checkbox') return [];
    for (const q of YES_NO_CHECKBOX_QUIRKS) {
      const wrapper = el.closest(q.wrapperSelector);
      if (!wrapper) continue;
      const buttons = [...wrapper.querySelectorAll(q.optionSelector)].filter(visible);
      if (buttons.length === 2 && buttons.some(b => b.dataset.option === q.yesValue) && buttons.some(b => b.dataset.option === q.noValue)) {
        return buttons;
      }
    }
    return [];
  };

  let i = 0;
  const out = [];
  for (const el of document.querySelectorAll(
    'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"]',
  )) {
    const tag = el.tagName.toLowerCase();
    if (el.matches(':disabled') || el.readOnly || el.closest('[aria-disabled="true"], [inert], [hidden]')) continue;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'combobox' && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
      const inner = el.querySelector('input:not([type="hidden"]):not([type="file"]), textarea, select');
      if (inner && visible(inner)) continue;
    }
    let isCE = (tag !== 'input' && tag !== 'textarea' && tag !== 'select')
      && (el.getAttribute('contenteditable') === 'true' || role === 'textbox');
    if (isCE) {
      const cls = (el.className || '').toString();
      const r = el.getBoundingClientRect();
      if (/clipboard/i.test(cls) || r.left < -1000 || r.top < -5000) continue;
      if (el.querySelector('input, textarea, [contenteditable="true"], [role="textbox"]')) continue;
    }
    let type;
    if (role === 'checkbox' || role === 'switch') type = 'checkbox';
    else if (role === 'radio') type = 'radio';
    else if (role === 'combobox') type = 'text';
    else type = isCE ? 'textarea' : (el.type || tag).toLowerCase();
    if (role !== 'combobox' && role !== 'checkbox' && role !== 'radio' && role !== 'switch'
      && ['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue;
    const nameId = `${el.name || ''} ${el.id || ''}`.toLowerCase();
    if (/g-recaptcha-response|h-captcha-response|cf-turnstile-response|frc-captcha-response/.test(nameId)) continue;
    const isFile = type === 'file';
    const yesNoButtons = yesNoButtonsFor(el, type);
    if (yesNoButtons.length === 2) type = 'radio';
    const isChoice = type === 'radio' || type === 'checkbox';
    const fileProxyVisible = () => {
      if (el.closest('[hidden], [aria-hidden="true"], [inert]') || inClosedTab(el)) return false;
      if (visible(el) || inViewport(el)) return true;
      const labelled = labelByFor(el);
      if (labelled && (visible(labelled) || inViewport(labelled))) return true;
      const wrap = el.closest('label');
      if (wrap && (visible(wrap) || inViewport(wrap))) return true;
      let node = el.parentElement;
      for (let d = 0; d < 4 && node; d++, node = node.parentElement) {
        if (node.closest('[hidden], [aria-hidden="true"], [inert]') || inClosedTab(node)) return false;
        const st = getComputedStyle(node);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
        if (!inViewport(node)) continue;
        const t = (node.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!t) continue;
        if (t.length > 280) return false;
        if (looksLikeDropzone(t)) return true;
      }
      return false;
    };
    if (isFile ? !fileProxyVisible() : !(isChoice ? controlVisible(el) : visible(el))) continue;
    el.setAttribute('data-co-i', String(i));
    let label = labelFor(el);
    let choiceRequired = false;
    let groupChecked = isChecked(el);
    let radioKey = '';
    if (type === 'radio') {
      radioKey = yesNoButtons.length === 2 ? `yesno:${i}` : radioKeyByEl.get(el) || radioKeyOf(el);
      if (yesNoButtons.length === 2) {
        radiosByKey.set(radioKey, yesNoButtons);
        radioGroupMeta.set(radioKey, groupMeta([el]));
      }
      const meta = radioGroupMeta.get(radioKey) || { question: '', required: false };
      if (meta.question) label = meta.question;
      choiceRequired = meta.required;
    } else if (type === 'checkbox') {
      const mates = checkboxGroupOf(el) || [el];
      const meta = groupMeta(mates);
      if (meta.question && meta.question !== label) label = `${meta.question} — ${label}`.trim();
      choiceRequired = meta.required;
      groupChecked = mates.some(isChecked);
    }
    const requiredAttr = (el.getAttribute('aria-required') || '').toLowerCase() === 'true'
      || ['true', 'required', '1'].includes((el.getAttribute('data-required') || '').toLowerCase());
    let wrapperRequired = false;
    {
      let node = el.parentElement;
      for (let d = 0; d < 4 && node && !/^(FORM|BODY|HTML|MAIN)$/.test(node.tagName); d++, node = node.parentElement) {
        const cls = (node.className || '').toString();
        if (/(^|[\s_-])required([\s_-]|$)/i.test(cls)) { wrapperRequired = true; break; }
        if ((node.getAttribute('aria-required') || '').toLowerCase() === 'true') { wrapperRequired = true; break; }
        if (['true', 'required', '1'].includes((node.getAttribute('data-required') || '').toLowerCase())) { wrapperRequired = true; break; }
      }
    }
    const required = el.required || requiredAttr || /[*✱]/.test(label) || /\brequired\b/i.test(label)
      || choiceRequired || wrapperRequired;
    const selectWrapper = el.closest('[class*="select__container"], [class*="select-shell"], [class*="Select-container" i], [class*="react-select" i]');
    let shadowRequired = null;
    if (selectWrapper) {
      let node = el.parentElement;
      for (let d = 0; d < 6 && node; d++, node = node.parentElement) {
        shadowRequired = node.querySelector('input[aria-hidden="true"][required], [class*="requiredInput" i]');
        if (shadowRequired) break;
      }
    }
    let value = type === 'checkbox' || type === 'radio' ? '' : (isCE ? (el.innerText || '').trim() : (el.value || ''));
    if (shadowRequired) value = shadowRequired.value || '';
    else if (selectWrapper && !value) {
      // react-select clears its own search/filter input once a value is
      // committed, so el.value reads empty even with a real selection made —
      // the shadow-required-input pattern above doesn't exist on every
      // vendor's flavor of the widget (e.g. Greenhouse's phone-country
      // picker), so fall back to the rendered single-value display, which
      // does reflect the actual committed selection.
      const shown = selectWrapper.querySelector('[class*="singleValue" i], [class*="single-value" i]');
      if (shown && shown.textContent.trim()) value = shown.textContent.trim();
    }
    out.push({
      i, type, tag, contentEditable: isCE, label,
      name: el.name || '',
      idAttr: el.id || '',
      required, value,
      fileCount: isFile ? el.files.length : 0,
      ariaInvalid: el.getAttribute('aria-invalid') === 'true',
      invalid: el.getAttribute('aria-invalid') === 'true' || (!!el.willValidate && !el.validity.valid),
      validationMessage: el.validationMessage || '',
      maxLength: el.maxLength >= 0 ? el.maxLength : null,
      description: (el.getAttribute('aria-describedby') || '').split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim() || '').filter(Boolean).join(' ').slice(0, 600),
      nearSelectWrapper: !!selectWrapper,
      checked: isChecked(el),
      groupChecked,
      radioKey,
      role: el.getAttribute('role') || '',
      ariaAutocomplete: el.getAttribute('aria-autocomplete') || '',
      ariaHaspopup: el.getAttribute('aria-haspopup') || '',
      multiple: !!el.multiple || el.getAttribute('aria-multiselectable') === 'true'
        || !!el.closest('[class*="multi-value"],[class*="is-multi"],[class*="multiselect" i]'),
      options: el.tagName === 'SELECT'
        ? [...el.options].map(o => ({ value: o.value, text: o.innerText.trim() }))
        : null,
    });
    i++;
  }

  const seenRadioKeys = new Set();
  const deduped = [];
  for (const entry of out) {
    if (entry.type !== 'radio') { deduped.push(entry); continue; }
    const key = entry.radioKey || (entry.name ? `n:${entry.name}` : `solo:${entry.i}`);
    if (seenRadioKeys.has(key)) continue;
    seenRadioKeys.add(key);
    const members = radiosByKey.get(key) || [];
    entry.options = members.map((m, k) => {
      const optKey = `${entry.i}:${k}`;
      m.setAttribute('data-co-opt', optKey);
      return { value: m.value || '', text: optionTextFor(m) || m.value || '', key: optKey };
    });
    entry.required = entry.required || members.some(m => m.required || m.getAttribute('aria-required') === 'true');
    entry.groupChecked = members.some(isChecked);
    deduped.push(entry);
  }
  return deduped;
};
