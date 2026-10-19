// Minimal {{path}} / {{#each}} / {{#if}} template engine shared by the dashboard
// preview, PDF route and scripts/build-premium-cv.mjs.

function tplGetValue(obj, path, globalData) {
  if (path === 'this') return obj;
  if (path.startsWith('this.')) {
    const key = path.slice(5).trim();
    return obj && typeof obj === 'object' ? obj[key] : undefined;
  }
  return path.split('.').reduce((prev, curr) => prev ? prev[curr] : undefined, globalData);
}

function tplFindClosingTag(content, openTag, closeTag, startIndex) {
  let depth = 1;
  let pos = startIndex;
  while (depth > 0 && pos < content.length) {
    const nextOpen = content.indexOf(openTag, pos);
    const nextClose = content.indexOf(closeTag, pos);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + openTag.length;
    } else {
      depth--;
      pos = nextClose + closeTag.length;
      if (depth === 0) return nextClose;
    }
  }
  return -1;
}

export function tplRender(template, context, globalData) {
  let res = template;

  // 1. Process EACH blocks
  let pos = 0;
  while ((pos = res.indexOf('{{#each')) !== -1) {
    const endOpen = res.indexOf('}}', pos);
    const path = res.slice(pos + 7, endOpen).trim();
    const closePos = tplFindClosingTag(res, '{{#each', '{{/each}}', endOpen + 2);
    if (closePos === -1) break;
    const inner = res.slice(endOpen + 2, closePos);
    const list = tplGetValue(context, path, globalData);
    const rendered = Array.isArray(list) ? list.map(item => tplRender(inner, item, globalData)).join('') : '';
    res = res.slice(0, pos) + rendered + res.slice(closePos + 9);
  }

  // 2. Process IF blocks (with nesting-aware {{else}} support)
  while (true) {
    let pos = res.indexOf('{{#if');
    if (pos === -1) break;
    const endOpen = res.indexOf('}}', pos);
    const path = res.slice(pos + 5, endOpen).trim();
    const closePos = tplFindClosingTag(res, '{{#if', '{{/if}}', endOpen + 2);
    if (closePos === -1) {
      res = res.slice(0, pos) + '<!-- BROKEN IF: ' + path + ' -->' + res.slice(endOpen + 2);
      continue;
    }
    let inner = res.slice(endOpen + 2, closePos);
    const val = tplGetValue(context, path, globalData);
    const truthy = val && (!Array.isArray(val) || val.length > 0);
    
    let elseIdx = -1;
    let depth = 0;
    for (let i = 0; i < inner.length - 8; i++) {
      if (inner.slice(i, i + 5) === '{{#if') depth++;
      if (inner.slice(i, i + 7) === '{{/if}}') depth--;
      if (depth === 0 && inner.slice(i, i + 8) === '{{else}}') {
        elseIdx = i;
        break;
      }
    }

    let rendered;
    if (elseIdx !== -1) {
      rendered = truthy ? tplRender(inner.slice(0, elseIdx), context, globalData) : tplRender(inner.slice(elseIdx + 8), context, globalData);
    } else {
      rendered = truthy ? tplRender(inner, context, globalData) : '';
    }
    res = res.slice(0, pos) + rendered + res.slice(closePos + 7);
  }

  // 3. Variables
  res = res.replace(/\{\{([^#\/][^}]*)\}\}/g, (match, path) => {
    const val = tplGetValue(context, path.trim(), globalData);
    return val !== undefined ? val : '';
  });

  return res;
}
