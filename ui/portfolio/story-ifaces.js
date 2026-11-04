/* Story modal + interfaces */
const STORY_CONTENT = {"en": {"lines": ["I have spent <strong>12 years in UX</strong>, starting in digital design and working at <strong>Marcel/Publicis</strong>.", "I then went <strong>freelance</strong>, working with startups and larger companies.", "In <strong>2015</strong>, I founded <strong>Newflux.fr</strong>, a French UX/UI publication. I published 300+ articles and organized events and workshops.", "In <strong>2017</strong>, I co-founded <strong>Vloggy</strong>, a video social network with a mobile editing studio.", "We raised <strong>€100K</strong> and reached delivery stage. We later stopped operations when funding ran out.", "In <strong>2020</strong>, I founded <strong>Agence V0</strong>, a product design agency.", "I managed up to <strong>7 junior freelance designers</strong>. The agency generated around <strong>€400K over three years</strong>.", "My client work included <strong>LVMH</strong>, <strong>Société Générale</strong>, Renault and Shiseido.", "I have worked with <strong>AI for 4 years</strong>, and rebuilt my UX and design workflow around it.", "Independent products include <strong>UXfi</strong>, <strong>Flemme OS</strong> and <strong>Creads.io</strong>.", "Today I work on product strategy and design at <strong>OneAsset</strong>, alongside my independent projects."]}, "fr": {"lines": ["Je travaille dans <strong>l’UX depuis 12 ans</strong>. J’ai commencé dans le design digital, puis travaillé chez <strong>Marcel/Publicis</strong>.", "Je suis ensuite devenu <strong>freelance</strong>, auprès de startups et de grands groupes.", "En <strong>2015</strong>, j’ai fondé <strong>Newflux.fr</strong>, un média UX/UI français. J’y ai publié 300+ articles et organisé des événements et des ateliers.", "En <strong>2017</strong>, j’ai cofondé <strong>Vloggy</strong>, un réseau social vidéo avec un studio de montage mobile.", "Nous avons levé <strong>100K EUR</strong> et atteint le stade de livraison. Nous avons ensuite arrêté l’activité faute de financement.", "En <strong>2020</strong>, j’ai fondé <strong>Agence V0</strong>, une agence de product design.", "J’y ai encadré jusqu’à <strong>7 designers freelances juniors</strong>. L’agence a réalisé environ <strong>400K EUR sur trois ans</strong>.", "J’ai notamment travaillé pour <strong>LVMH</strong>, <strong>Société Générale</strong>, Renault et Shiseido.", "Je travaille avec l’<strong>IA depuis 4 ans</strong>, et j’ai adapté mon workflow UX et design autour d’elle.", "Parmi les produits indépendants : <strong>UXfi</strong>, <strong>Flemme OS</strong> et <strong>Creads.io</strong>.", "Aujourd’hui, je travaille sur la stratégie produit et le design chez <strong>OneAsset</strong>, en parallèle de mes projets indépendants."]}};

const STORY_CHAPTERS = {
  en: [
    {
      id: 'story-now',
      label: 'Now',
      fig: 'desk',
      figTitle: 'Product desk',
      figHint: 'Click a panel',
      figStatus: ['Brief', 'Screens', 'Agent'],
      title: 'The whole product goes through my hands',
      paragraphs: [
        'At OneAsset I’m the product manager and the only designer, so the product, the admin and the marketing site stay with one person.',
        'I prototype with AI coding tools and send the design through agents on GitHub. Figmol is the tool I built to review that work. My own products stay open beside it.'
      ]
    },
    {
      id: 'story-products',
      label: 'Products',
      fig: 'products',
      figTitle: 'Own products',
      figHint: 'Click a product',
      figStatus: ['UXfi', 'Flemme OS', 'Creads.io'],
      title: 'I still run what I started',
      paragraphs: [
        'UXfi, Flemme OS and Creads.io are mine. I built them, and I still look after them.',
        'A shop gets a score and a suggested redesign. A social account gets posts and outreach. A brand gets ads.'
      ]
    },
    {
      id: 'story-ai',
      label: 'AI',
      fig: 'workflow',
      figTitle: 'Workflow',
      figHint: 'Click a step',
      figStatus: ['Prompt', 'Screen', 'Check'],
      title: 'I stay with the answer',
      paragraphs: [
        'AI sits inside the design work. I write the prompts, connect the data and the integrations.',
        'Then I stay with what comes back, until it’s something I would publish.'
      ]
    },
    {
      id: 'story-agency',
      label: 'Agency',
      fig: 'studio',
      figTitle: 'Studio',
      figHint: 'Click a seat',
      figStatus: ['Seat 1', 'Seat 2', 'Seat 3', 'Seat 4'],
      title: 'I ran the studio and the people in it',
      paragraphs: [
        'I founded Agence V0 and led junior freelance designers on the work.',
        'LVMH, Renault, Société Générale, Shiseido. Shared data-marketing across the maisons, an international marketplace, investment journeys that had to follow the rules.'
      ]
    },
    {
      id: 'story-earlier',
      label: 'Team',
      fig: 'archive',
      figTitle: 'From scratch',
      figHint: 'Click a mode',
      figStatus: ['Solo', 'Team', 'Ship'],
      title: 'I start before there’s anything to click',
      paragraphs: [
        'I take a product with no screens yet through to a version people can use, alone or while I’m running the team.',
        'Agence V0 was that: junior freelance designers on the work, and me staying on the product.'
      ]
    }
  ],
  fr: [
    {
      id: 'story-now',
      label: 'Maintenant',
      fig: 'desk',
      figTitle: 'Bureau produit',
      figHint: 'Cliquer un panneau',
      figStatus: ['Brief', 'Écrans', 'Agent'],
      title: 'Tout le produit passe par mes mains',
      paragraphs: [
        'Chez OneAsset, je suis product manager et le seul designer, donc le produit, l’admin et le site marketing restent avec une seule personne.',
        'Je prototype avec des outils de code IA, et j’envoie le design dans des agents sur GitHub. Figmol, c’est l’outil que j’ai fait pour relire ça. Mes produits restent ouverts à côté.'
      ]
    },
    {
      id: 'story-products',
      label: 'Produits',
      fig: 'products',
      figTitle: 'Mes produits',
      figHint: 'Cliquer un produit',
      figStatus: ['UXfi', 'Flemme OS', 'Creads.io'],
      title: 'Je fais encore tourner ce que j’ai lancé',
      paragraphs: [
        'UXfi, Flemme OS et Creads.io sont à moi. Je les ai construits, et je m’en occupe encore.',
        'Une boutique reçoit une note et une piste de refonte. Un compte social reçoit des posts et de la prospection. Une marque reçoit des pubs.'
      ]
    },
    {
      id: 'story-ai',
      label: 'IA',
      fig: 'workflow',
      figTitle: 'Workflow',
      figHint: 'Cliquer une étape',
      figStatus: ['Prompt', 'Écran', 'Contrôle'],
      title: 'Je reste sur la réponse',
      paragraphs: [
        'L’IA est dans le travail de design. J’écris les prompts, je branche les données et les intégrations.',
        'Ensuite je reste sur ce qui sort, jusqu’à ce que ce soit quelque chose que je publierais.'
      ]
    },
    {
      id: 'story-agency',
      label: 'Agence',
      fig: 'studio',
      figTitle: 'Studio',
      figHint: 'Cliquer une place',
      figStatus: ['Place 1', 'Place 2', 'Place 3', 'Place 4'],
      title: 'J’ai tenu l’agence, et les gens dedans',
      paragraphs: [
        'J’ai monté Agence V0 et j’ai dirigé des designers freelances juniors sur le travail.',
        'LVMH, Renault, Société Générale, Shiseido. Du data marketing partagé entre les maisons, une marketplace internationale, des parcours d’investissement qui devaient rester dans les règles.'
      ]
    },
    {
      id: 'story-earlier',
      label: 'Équipe',
      fig: 'archive',
      figTitle: 'Depuis zéro',
      figHint: 'Cliquer un mode',
      figStatus: ['Seul', 'Équipe', 'Livraison'],
      title: 'Je commence avant qu’il y ait quelque chose à cliquer',
      paragraphs: [
        'Je prends un produit sans écrans et je le mène jusqu’à une version que les gens peuvent utiliser, seul ou en dirigeant l’équipe.',
        'Agence V0, c’était ça : des designers freelances juniors sur le travail, et moi qui reste sur le produit.'
      ]
    }
  ]
};

/* ═══════════════════════════════════════════
   STORY MODAL (2026-11-04 immersive pass, CSS in /portfolio/story.css)
   - Opening: a curtain splits on an emerald hairline while the parallax scene settles and the title rises.
   - Pre-scroll: the hero is pinned. Scrolling it moves the layers apart, dims the scene, lights the intro
     line word by word, then the chapter index, and the scene dissolves into chapter 01.
   - Chapters: iso dioramas built from grouped SVG pieces. They drop into place on first view, the current
     step lifts and lights, small loops run while the figure is on screen, and the steps advance on their
     own (the timer bar under the step) until the reader hovers, focuses or clicks.
   Reduced motion: no curtain, no pin, no loops, no auto-advance; everything is shown at rest.
═══════════════════════════════════════════ */
const storyClamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const storySmooth = t => t * t * (3 - 2 * t);
const storySeg = (p, a, b) => storyClamp((p - a) / (b - a));
const storyReduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Iso kit. Plan units: x runs right-down, y left-down, z up. Light from the upper left, so the top face is
   the lightest, the +y face (front, lower left) mid and the +x face (side, lower right) the darkest. ── */
function storyIso(x, y, z) {
  return [(x - y) * 0.8660254, (x + y) * 0.5 - z];
}
function sfP(x, y, z) {
  const [a, b] = storyIso(x, y, z);
  return `${a.toFixed(1)},${b.toFixed(1)}`;
}
function sfPoly(points, cls) {
  return `<polygon class="${cls}" points="${points.map(p => sfP(p[0], p[1], p[2])).join(' ')}"/>`;
}
function sfBox(x, y, z, w, d, h) {
  return sfPoly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], 'sf-f sf-l')
    + sfPoly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], 'sf-f sf-r')
    + sfPoly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], 'sf-f sf-t');
}
// Face mappers: (u, w) on a face to a plan point.
const sfFront = y => (u, w) => [u, y, w]; // +y face: u = x, w = z
const sfSide = x => (u, w) => [x, u, w];  // +x face: u = y, w = z
const sfTop = z => (u, w) => [u, w, z];   // top: u = x, w = y
function sfD(map, pts, close) {
  return pts.map(([u, w], i) => `${i ? 'L' : 'M'}${sfP(...map(u, w))}`).join('') + (close ? 'Z' : '');
}
function sfPath(map, segs, cls, attrs = '') {
  return `<path class="${cls}"${attrs} d="${segs.map(s => sfD(map, s)).join('')}"/>`;
}
function sfRect(map, u0, w0, u1, w1, cls, attrs = '') {
  return `<path class="${cls}"${attrs} d="${sfD(map, [[u0, w0], [u1, w0], [u1, w1], [u0, w1]], true)}"/>`;
}
// A circle drawn on a face, starting at its top and going clockwise (so a dash fills it like a gauge).
function sfCircle(map, uc, wc, r, cls, attrs = '') {
  const pts = [];
  for (let i = 0; i < 36; i += 1) {
    const a = Math.PI / 2 - (i / 36) * Math.PI * 2;
    pts.push([uc + r * Math.cos(a), wc + r * Math.sin(a)]);
  }
  return `<path class="${cls}"${attrs} d="${sfD(map, pts, true)}"/>`;
}
// Plan lines, for cables and routes that turn between faces.
function sfPlan(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${sfP(p[0], p[1], p[2])}`).join('');
}
function sfCable(points, steps) {
  const d = sfPlan(points);
  return `<path class="sf-cable-o" d="${d}"/><path class="sf-cable" d="${d}"/>`
    + `<path class="sf-flow" data-steps="${steps}" d="${d}"/>`;
}
function sfEllipse(x, y, z, r, cls, attrs = '') {
  const [sx, sy] = storyIso(x, y, z);
  return `<ellipse class="${cls}"${attrs} cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" rx="${(r * 1.2247).toFixed(1)}" ry="${(r * 0.7071).toFixed(1)}"/>`;
}
// Light pooled on the floor. steps = 'static' keeps it on.
function sfPool(x, y, z, r, steps) {
  const cls = steps === 'static' ? 'sf-pool is-static' : 'sf-pool';
  const data = steps === 'static' ? '' : ` data-steps="${steps}"`;
  return sfEllipse(x, y, z, r, cls, ` fill="url(#sfg-__U__)"${data}`);
}
function sfShadow(x, y, w, d, h) {
  const L = Math.min(h * 0.5, 26);
  return sfPoly([[x + 1, y, 0], [x + w + L, y, 0], [x + w + L, y + d, 0], [x + 1, y + d, 0]], 'sf-shadow');
}
function sfCyl(cx, cy, z, r, h) {
  const [sx, sy] = storyIso(cx, cy, z);
  const rx = r * 1.2247;
  const ry = r * 0.7071;
  const ty = sy - h;
  const f = n => n.toFixed(1);
  return `<path class="sf-f sf-l" d="M${f(sx - rx)},${f(ty)}L${f(sx - rx)},${f(sy)}A${f(rx)},${f(ry)} 0 0 0 ${f(sx + rx)},${f(sy)}L${f(sx + rx)},${f(ty)}Z"/>`
    + `<path class="sf-f sf-r sf-seam" d="M${f(sx)},${f(ty + ry)}L${f(sx)},${f(sy + ry)}A${f(rx)},${f(ry)} 0 0 0 ${f(sx + rx)},${f(sy)}L${f(sx + rx)},${f(ty)}Z"/>`
    + `<ellipse class="sf-f sf-t" cx="${f(sx)}" cy="${f(ty)}" rx="${f(rx)}" ry="${f(ry)}"/>`;
}
/** One piece of a scene. o = build-in order, steps = the step(s) that light it, lift = px it rises when lit. */
function sfPiece(inner, o, steps = null, lift = null, cls = '') {
  const data = steps == null ? '' : ` data-steps="${steps}"`;
  const style = `--o:${o}${lift == null ? '' : `;--lift:${-lift}px`}`;
  return `<g class="sf-p${cls ? ` ${cls}` : ''}" style="${style}"${data}><g class="sf-lift">${inner}</g></g>`;
}
function sfSlab(x, y, w, d) {
  const T = sfTop(0);
  const segs = [];
  for (let u = x + 12; u < x + w - 4; u += 12) segs.push([[u, y + 3], [u, y + d - 3]]);
  for (let v = y + 12; v < y + d - 4; v += 12) segs.push([[x + 3, v], [x + w - 3, v]]);
  const rim = sfD(T, [[x + 4, y + 4], [x + w - 4, y + 4], [x + w - 4, y + d - 4], [x + 4, y + d - 4]], true);
  return sfPiece(sfBox(x, y, -7, w, d, 7) + sfPath(T, segs, 'sf-grid') + `<path class="sf-rim" d="${rim}"/>`, 0, null, null, 'sf-slab');
}

/* ── Scenes. Each returns its slab (x, y, w, d), the floor (shadows, pools) and the pieces back to front. ── */
const STORY_SCENES = {
  // Now: one desk where the brief, the screens and the agent sit together.
  desk() {
    const pieces = [];
    // notebook: the brief
    pieces.push(sfPiece(
      sfBox(-78, -6, 0, 30, 22, 2.5)
        + sfPath(sfTop(2.5), [[[-74, -1], [-58, -1]], [[-74, 4], [-54, 4]], [[-74, 9], [-62, 9]], [[-74, 14], [-57, 14]]], 'sf-d sf-type', ' pathLength="1"'),
      1, 0, 4
    ));
    // monitor: three panels, one per step
    const F = sfFront(-36);
    const panel = (i, w0, w1, detail) => `<g class="sf-panel" data-steps="${i}">${sfRect(F, -45, w0, 45, w1, 'sf-scr')}${detail}</g>`;
    const brief = panel(0, 54.6, 68,
      sfPath(F, [[[-40, 64.5], [-6, 64.5]], [[-40, 61], [14, 61]], [[-40, 57.5], [-16, 57.5]]], 'sf-d sf-type', ' pathLength="1"'));
    const screens = panel(1, 38.3, 51.6,
      sfRect(F, -40, 41, -16, 49, 'sf-d-fill sf-seq', ' style="--k:0"')
        + sfRect(F, -12, 41, 12, 49, 'sf-d-fill sf-seq', ' style="--k:1"')
        + sfRect(F, 16, 41, 40, 49, 'sf-d-fill sf-seq', ' style="--k:2"'));
    const agent = panel(2, 22, 35.3,
      sfPath(F, [[[-40, 31.4], [-36, 28.6], [-40, 25.8]]], 'sf-d')
        + sfPath(F, [[[-33, 25.8], [-28, 25.8]]], 'sf-d sf-blink')
        + sfPath(F, [[[-22, 28.6], [24, 28.6]]], 'sf-d sf-type', ' pathLength="1"'));
    pieces.push(sfPiece(
      sfBox(-16, -50, 0, 32, 18, 3) + sfBox(-3, -46, 3, 6, 4, 16) + sfBox(-52, -42, 16, 104, 6, 58)
        + sfRect(F, -48, 19.5, 48, 70.5, 'sf-bezel') + brief + screens + agent,
      2
    ));
    // mug with steam
    const [mx, my] = storyIso(-66, 32, 13);
    pieces.push(sfPiece(
      sfCyl(-66, 32, 0, 7, 13)
        + `<path class="sf-steam" style="--k:0" d="M${(mx - 2).toFixed(1)},${(my - 3).toFixed(1)}c-3,-4 3,-7 0,-12"/>`
        + `<path class="sf-steam" style="--k:1" d="M${(mx + 3).toFixed(1)},${(my - 2).toFixed(1)}c-3,-4 3,-7 0,-11"/>`,
      3
    ));
    // keyboard
    const keys = [];
    [0, 4, 8].forEach((v) => { for (let u = -30; u < 27; u += 4.6) keys.push([[u, v], [u + 2.6, v]]); });
    keys.push([[-14, 12.4], [10, 12.4]]);
    pieces.push(sfPiece(sfBox(-34, -4, 0, 66, 20, 3) + sfPath(sfTop(3), keys, 'sf-keys'), 4));
    // agent unit, its halo and the cable that feeds it
    pieces.push(sfPiece(
      sfBox(56, -34, 0, 20, 20, 20)
        + sfCircle(sfFront(-14), 66, 10, 4.6, 'sf-d')
        + sfRect(sfFront(-14), 59, 16, 61.5, 17.6, 'sf-led')
        + sfPath(sfSide(76), [[[-31, 6], [-17, 6]], [[-31, 9], [-17, 9]], [[-31, 12], [-17, 12]]], 'sf-vent')
        + sfEllipse(66, -24, 27, 9, 'sf-halo'),
      5, 2, 7
    ));
    pieces.push(sfPiece(sfCable([[50, -37, 16], [50, -37, 1], [50, -8, 1], [62, -8, 1], [62, -14, 1], [62, -14, 5]], 2), 6));
    // phone: the screens leave the desk
    pieces.push(sfPiece(
      sfBox(4, 26, 0, 16, 26, 2.5)
        + sfRect(sfTop(2.5), 6, 28, 18, 50, 'sf-scr')
        + sfPath(sfTop(2.6), [[[8, 32], [16, 32]], [[8, 37], [16, 37]], [[8, 42], [13, 42]]], 'sf-d'),
      7, 1, 5
    ));
    // trackpad
    pieces.push(sfPiece(sfBox(40, -2, 0, 14, 18, 2) + sfRect(sfTop(2), 42, 0, 52, 14, 'sf-d'), 8));
    return {
      view: '-145 -128 290 216',
      slab: [-88, -58, 176, 116],
      shadows: sfShadow(-78, -6, 30, 22, 3) + sfShadow(-52, -42, 104, 6, 74) + sfShadow(-16, -50, 32, 18, 3)
        + sfShadow(-34, -4, 66, 20, 3) + sfShadow(56, -34, 20, 20, 20) + sfShadow(4, 26, 16, 26, 3)
        + sfShadow(40, -2, 14, 18, 2) + sfShadow(-73, 25, 14, 14, 13),
      pools: sfPool(0, -20, 0, 40, 'static') + sfPool(-63, 5, 0, 18, 0) + sfPool(12, 39, 0, 18, 1) + sfPool(66, -16, 0, 20, 2),
      pieces: pieces.join(''),
    };
  },

  // Products: three monoliths, one per product, each with what it hands back on a card in front of it.
  products() {
    const xs = [-74, -18, 38];
    const F = sfFront(-8);
    const glyph = [
      x => sfCircle(F, x + 18, 42, 9, 'sf-d sf-dim')
        + sfCircle(F, x + 18, 42, 9, 'sf-d sf-arc', ' pathLength="100"')
        + sfRect(F, x + 8, 12, x + 13, 20, 'sf-d-fill sf-bar', ' style="--k:0"')
        + sfRect(F, x + 15.5, 12, x + 20.5, 25, 'sf-d-fill sf-bar', ' style="--k:1"')
        + sfRect(F, x + 23, 12, x + 28, 30, 'sf-d-fill sf-bar', ' style="--k:2"'),
      x => [[44, 53], [32, 41], [20, 29]].map(([w0, w1], r) => sfRect(F, x + 7, w0, x + 16, w1, 'sf-d-fill sf-seq', ` style="--k:${r * 2}"`)
        + sfRect(F, x + 20, w0, x + 29, w1, 'sf-d-fill sf-seq', ` style="--k:${r * 2 + 1}"`)).join('')
        + sfPath(F, [[[x + 7, 13], [x + 29, 13]]], 'sf-d'),
      x => sfRect(F, x + 6, 24, x + 30, 52, 'sf-d')
        + sfPath(F, [[[x + 15, 31], [x + 15, 45], [x + 25, 38]]], 'sf-d-fill sf-play', '').replace('"/>', 'Z"/>')
        + sfPath(F, [[[x + 6, 17], [x + 24, 17]], [[x + 6, 13], [x + 18, 13]]], 'sf-d'),
    ];
    const pieces = [];
    let shadows = '';
    let pools = '';
    xs.forEach((x, i) => {
      const vents = [];
      for (let w = 10; w <= 56; w += 4) vents.push([[-19, w], [-10, w]]);
      pieces.push(sfPiece(
        sfBox(x - 4, -24, 0, 44, 20, 3) + sfBox(x, -20, 3, 36, 12, 60) + glyph[i](x) + sfPath(sfSide(x + 36), vents, 'sf-vent'),
        1 + i * 2, i, 10
      ));
      pieces.push(sfPiece(
        sfBox(x + 2, 6, 0, 32, 18, 2)
          + sfPath(sfTop(2), [[[x + 6, 10], [x + 26, 10]], [[x + 6, 14], [x + 20, 14]], [[x + 6, 18], [x + 28, 18]]], 'sf-d sf-type', ' pathLength="1"'),
        2 + i * 2, i, 3
      ));
      shadows += sfShadow(x - 4, -24, 44, 20, 63) + sfShadow(x + 2, 6, 32, 18, 2);
      pools += sfPool(x + 18, 0, 0, 24, i);
    });
    return { view: '-145 -126 290 214', slab: [-88, -54, 176, 108], shadows, pools, pieces: pieces.join('') };
  },

  // AI: prompt, screen, check, with the work flowing along the pipes up to the current step.
  workflow() {
    const cubes = [[-76, -22], [-14, -14], [48, -6]];
    const glyph = [
      (x, F) => sfPath(F, [[[x + 7, 20], [x + 12, 16], [x + 7, 12]]], 'sf-d') + sfPath(F, [[[x + 15, 12], [x + 21, 12]]], 'sf-d sf-blink'),
      (x, F) => sfRect(F, x + 6, 9, x + 22, 23, 'sf-d')
        + sfPath(F, [[[x + 9, 19], [x + 19, 19]], [[x + 9, 15], [x + 16, 15]]], 'sf-d sf-type', ' pathLength="1"'),
      (x, F) => sfCircle(F, x + 14, 16, 8, 'sf-d sf-dim') + sfPath(F, [[[x + 9, 16], [x + 12.5, 12], [x + 20, 20.5]]], 'sf-d sf-tick', ' pathLength="1"'),
    ];
    const cube = (i, o) => {
      const [x, y] = cubes[i];
      const F = sfFront(y + 28);
      const vents = [];
      for (let w = 7; w <= 27; w += 3.4) vents.push([[y + 4, w], [y + 11, w]]);
      const dots = [];
      [-7, 0, 7].forEach(a => [-7, 0, 7].forEach(b => dots.push([[x + 14 + a, y + 14 + b], [x + 14.8 + a, y + 14 + b]])));
      return sfPiece(
        sfBox(x - 3, y - 3, 0, 34, 34, 2) + sfBox(x, y, 2, 28, 28, 28) + glyph[i](x, F)
          + sfPath(sfSide(x + 28), vents, 'sf-vent') + sfPath(sfTop(30), dots, 'sf-dots'),
        o, i, 7
      );
    };
    const pieces = [
      cube(0, 1),
      sfPiece(sfBox(-33, -6, 0, 4, 4, 13) + sfCable([[-48, -8, 14], [-31, -8, 14], [-31, 0, 14], [-14, 0, 14]], '1 2'), 2),
      cube(1, 3),
      sfPiece(sfBox(29, 2, 0, 4, 4, 13) + sfCable([[14, 0, 14], [31, 0, 14], [31, 8, 14], [48, 8, 14]], 2), 4),
      cube(2, 5),
    ];
    return {
      view: '-145 -98 290 184',
      slab: [-88, -46, 176, 92],
      shadows: cubes.map(([x, y]) => sfShadow(x - 3, y - 3, 34, 34, 30)).join(''),
      pools: cubes.map(([x, y], i) => sfPool(x + 14, y + 36, 0, 16, i)).join(''),
      pieces: pieces.join(''),
    };
  },

  // Agency: the studio table, four seats, and the lead's line out to whoever is on the work.
  studio() {
    const seats = [[-62, -38], [-18, -38], [26, -38], [-62, 0]];
    const seat = (i, o) => {
      const [x, y] = seats[i];
      const F = sfFront(y + 4);
      return sfPiece(
        sfBox(x, y, 6, 28, 18, 3) + sfBox(x + 5, y + 1, 9, 18, 3, 14)
          + sfRect(F, x + 7, 11.5, x + 21, 21, 'sf-scr')
          + sfPath(F, [[[x + 9, 18], [x + 19, 18]], [[x + 9, 14.5], [x + 15, 14.5]]], 'sf-d sf-type', ' pathLength="1"')
          + sfPath(sfTop(9), [[[x + 7, y + 11], [x + 21, y + 11]], [[x + 7, y + 14], [x + 17, y + 14]]], 'sf-keys'),
        o, i, 6
      );
    };
    const links = seats.map(([x, y], i) => sfCable([[22, 11, 6.2], [x + 14, y + 18, 6.2]], i)).join('');
    const tablePools = seats.map(([x, y], i) => sfPool(x + 14, y + 22, 6.1, 13, i)).join('');
    const pieces = [
      sfPiece(sfBox(-70, -44, 0, 140, 80, 6) + tablePools, 1),
      sfPiece(links, 2),
      seat(0, 3), seat(3, 4), seat(1, 5), seat(2, 6),
      sfPiece(
        sfBox(22, -2, 6, 26, 26, 22)
          + sfCircle(sfFront(24), 35, 17, 5.5, 'sf-d')
          + sfPath(sfFront(24), [[[35, 13.5], [35, 20.5]], [[31.5, 17], [38.5, 17]]], 'sf-d')
          + sfPath(sfSide(48), [[[2, 12], [20, 12]], [[2, 16], [20, 16]], [[2, 20], [20, 20]]], 'sf-vent')
          + sfEllipse(35, 11, 30, 8, 'sf-halo is-static'),
        7, null, null, 'sf-lead'
      ),
    ];
    return {
      view: '-145 -90 290 180',
      slab: [-88, -54, 176, 108],
      shadows: sfShadow(-70, -44, 140, 80, 6),
      pools: sfPool(0, 40, 0, 30, 'static'),
      pieces: pieces.join(''),
    };
  },

  // Team / from scratch: the plan, the modules built on it, and the version that ships.
  archive() {
    const T = sfTop(3);
    const grid = [];
    for (let u = -68; u < 22; u += 10) grid.push([[u, -44], [u, 36]]);
    for (let v = -36; v < 38; v += 10) grid.push([[-76, v], [20, v]]);
    const outlines = [[-68, -36, -40, -14], [-34, -36, -6, -14], [-68, -8, -40, 14]]
      .map(([u0, w0, u1, w1]) => sfRect(sfTop(3.1), u0, w0, u1, w1, 'sf-plan')).join('');
    const module = (x, y, o, k) => sfPiece(
      sfBox(x, y, 3, 28, 22, 16)
        + sfPath(sfFront(y + 22), [[[x + 5, 14], [x + 20, 14]], [[x + 5, 10], [x + 14, 10]]], 'sf-d sf-type', ' pathLength="1"')
        + sfRect(sfFront(y + 22), x + 21, 8, x + 24, 11, 'sf-led', ` style="--k:${k}"`),
      o, 1, 8
    );
    const towerSide = [];
    for (let w = 8; w <= 40; w += 5.4) towerSide.push([[-22, w], [-4, w]]);
    const pieces = [
      sfPiece(
        sfBox(-78, -46, 0, 100, 84, 3) + sfPath(T, grid, 'sf-grid sf-plan-grid') + outlines
          + sfBox(-30, 18, 3, 30, 4, 3) + sfPoly([[0, 18, 3], [6, 20, 4.5], [0, 22, 3]], 'sf-f sf-t'),
        1, 0, 3
      ),
      sfPool(-37, -11, 3.2, 30, 1),
      module(-68, -36, 2, 0), module(-68, -8, 3, 1), module(-34, -36, 4, 2),
      sfPiece(
        sfBox(40, -26, 0, 26, 26, 46)
          + sfPath(sfFront(0), [[[53, 12], [53, 34]], [[47, 28], [53, 34], [59, 28]]], 'sf-d sf-arrow')
          + sfPath(sfSide(66), towerSide, 'sf-vent')
          + `<path class="sf-pole" d="${sfPlan([[53, -13, 46], [53, -13, 66]])}"/>`
          + sfPoly([[53, -13, 66], [53, -13, 57], [66, -13, 61.5]], 'sf-flag'),
        5, 2, 8
      ),
      sfPiece(`<path class="sf-route" d="${sfPlan([[22, 26, 0.5], [40, 26, 0.5], [53, 8, 0.5]])}"/>`
        + `<path class="sf-flow" data-steps="2" d="${sfPlan([[22, 26, 0.5], [40, 26, 0.5], [53, 8, 0.5]])}"/>`, 6),
    ];
    return {
      view: '-145 -90 290 180',
      slab: [-88, -54, 176, 108],
      shadows: sfShadow(-78, -46, 100, 84, 3) + sfShadow(40, -26, 26, 26, 46) + sfShadow(-68, -36, 62, 44, 16),
      pools: sfPool(-28, 44, 0, 24, 0) + sfPool(53, 10, 0, 20, 2),
      pieces: pieces.join(''),
    };
  },
};

function drawStoryFigure(kind, uid) {
  const scene = (STORY_SCENES[kind] || STORY_SCENES.archive)();
  const [x, y, w, d] = scene.slab;
  const top = [[x, y, 0], [x + w, y, 0], [x + w, y + d, 0], [x, y + d, 0]].map(p => sfP(...p)).join(' ');
  return `<svg viewBox="${scene.view || '-150 -130 300 250'}" preserveAspectRatio="xMidYMid meet">
    <defs>
      <clipPath id="sfc-${uid}"><polygon points="${top}"/></clipPath>
      <filter id="sfb-${uid}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.6"/></filter>
      <radialGradient id="sfg-${uid}"><stop offset="0" stop-color="#4db88a" stop-opacity=".62"/><stop offset=".55" stop-color="#4db88a" stop-opacity=".18"/><stop offset="1" stop-color="#4db88a" stop-opacity="0"/></radialGradient>
    </defs>
    ${sfSlab(x, y, w, d)}
    <g class="sf-floor" clip-path="url(#sfc-${uid})">
      <g filter="url(#sfb-${uid})">${scene.shadows}</g>
      ${scene.pools}
    </g>
    ${scene.pieces}
  </svg>`.replaceAll('__U__', uid);
}

/** Wraps every word of an HTML string in span.sw (mask: span.sw > span.sw-i for a masked rise). Tags stay. */
function storySplitWords(html, mask = false) {
  const box = document.createElement('div');
  box.innerHTML = html;
  let i = 0;
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          const word = document.createElement('span');
          word.className = 'sw';
          word.style.setProperty('--i', String(i));
          i += 1;
          if (mask) {
            const inner = document.createElement('span');
            inner.className = 'sw-i';
            inner.textContent = part;
            word.appendChild(inner);
          } else {
            word.textContent = part;
          }
          frag.appendChild(word);
        });
        child.replaceWith(frag);
      } else if (child.nodeType === 1 && !child.matches('img, svg, .story-inline-logos, .story-inline-logo')) {
        walk(child);
      }
    });
  };
  walk(box);
  return box.innerHTML;
}

function mountStoryFigures(root) {
  const canHover = window.matchMedia('(hover: hover)').matches;
  root.querySelectorAll('[data-story-fig]').forEach((figure) => {
    const steps = [...figure.querySelectorAll('.story-fig-step')];
    const lit = [...figure.querySelectorAll('[data-steps]')];
    const count = Math.max(1, steps.length);
    const paint = (step) => {
      const index = ((step % count) + count) % count;
      const key = String(index);
      figure.dataset.storyStep = key;
      lit.forEach(el => el.classList.toggle('is-on', el.dataset.steps.split(' ').includes(key)));
      steps.forEach((button, k) => {
        const on = k === index;
        button.classList.toggle('is-on', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      // same step clicked again: restart its timer bar
      const bar = steps[index] && steps[index].querySelector('.story-fig-step-bar');
      if (bar) {
        bar.style.animation = 'none';
        void bar.offsetWidth;
        bar.style.animation = '';
      }
    };
    const next = () => paint(Number(figure.dataset.storyStep || 0) + 1);
    paint(0);
    steps.forEach((button, k) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      paint(k);
    }));
    figure.querySelector('.story-fig-art')?.addEventListener('click', (event) => {
      event.stopPropagation();
      next();
    });
    // The timer bar under the current step is the clock: when it fills, the figure moves on.
    figure.addEventListener('animationend', (event) => {
      if (event.animationName === 'sf-timer' && event.target.closest('.story-fig-step.is-on')) next();
    });
    if (canHover) {
      figure.addEventListener('pointerenter', () => figure.classList.add('is-held'));
      figure.addEventListener('pointerleave', () => figure.classList.remove('is-held'));
    }
    figure.addEventListener('focusin', () => figure.classList.add('is-held'));
    figure.addEventListener('focusout', (event) => {
      if (!figure.contains(event.relatedTarget)) figure.classList.remove('is-held');
    });
  });
}

/** Optional host-page config (window.SITE). null on /portfolio. */
function storySiteCfg() {
  const site = window.SITE;
  return site && typeof site === 'object' ? site : null;
}

/** window.SITE[name](...args), or undefined when unset or when the hook throws. */
function storySiteHook(name, ...args) {
  const site = storySiteCfg();
  if (!site || typeof site[name] !== 'function') return undefined;
  try {
    return site[name](...args);
  } catch (err) {
    console.error(`SITE.${name} failed`, err);
    return undefined;
  }
}

/** True for a chapters array renderStoryModalContent can draw (the STORY_CHAPTERS shape). */
function isStoryChapterList(list) {
  return Array.isArray(list) && list.length > 0 && list.every(ch => ch
    && typeof ch.id === 'string' && typeof ch.label === 'string' && typeof ch.title === 'string'
    && Array.isArray(ch.figStatus) && Array.isArray(ch.paragraphs));
}

/** Contact address for the story modal: window.SITE.contact.email when a host page sets it. */
function storyContactEmail() {
  const email = window.SITE && window.SITE.contact && window.SITE.contact.email;
  return typeof email === 'string' && email ? email : 'chilka.v@gmail.com';
}

/** Intro line lit during the pre-scroll: SITE.storyIntro[lang] on a host page, else the first story line. */
function storyIntroLine() {
  const site = storySiteCfg();
  if (site) {
    const intro = site.storyIntro;
    const text = intro && typeof intro === 'object' ? (intro[currentLang] || intro.en) : '';
    return typeof text === 'string' ? text : '';
  }
  const pack = STORY_CONTENT[currentLang] || STORY_CONTENT.en;
  return (pack && pack.lines && pack.lines[0]) || '';
}

/* Panel chrome that the markup of older host pages does not have: the opening curtain, the reading
   progress line and the ambient glow behind the chapters. Created once, kept across re-renders. */
function ensureStoryChrome(modal) {
  const panel = modal.querySelector('.story-modal-panel');
  const stage = modal.querySelector('.story-modal-stage');
  if (!panel || !stage) return;
  if (!panel.querySelector('.story-curtain')) {
    panel.insertAdjacentHTML('beforeend', `
      <div class="story-curtain" aria-hidden="true">
        <span class="story-curtain-half is-top"></span>
        <span class="story-curtain-half is-bottom"></span>
        <span class="story-curtain-line"></span>
      </div>
      <div class="story-progress" aria-hidden="true"></div>`);
  }
  if (!stage.querySelector('.story-ambient')) {
    stage.insertAdjacentHTML('afterbegin', '<div class="story-ambient" aria-hidden="true"></div>');
  }
}

let storyObserver = null;
function observeStory(scroller) {
  storyObserver?.disconnect();
  const targets = scroller.querySelectorAll('.story-fig, .story-chapter-copy, .story-contact-wrap');
  if (!('IntersectionObserver' in window)) {
    targets.forEach(el => el.classList.add('is-in', 'is-live'));
    return;
  }
  storyObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add('is-in');
      entry.target.classList.toggle('is-live', entry.isIntersecting);
    });
  }, { root: scroller, threshold: 0.28 });
  targets.forEach(el => storyObserver.observe(el));
}

function renderStoryModalContent() {
  let chapters = STORY_CHAPTERS[currentLang] || STORY_CHAPTERS.en;
  // Host page: SITE.storyChapters gets a copy (it may edit it freely) and returns the chapters to draw.
  if (storySiteCfg() && chapters) {
    const custom = storySiteHook('storyChapters', JSON.parse(JSON.stringify(chapters)), currentLang);
    if (isStoryChapterList(custom)) chapters = custom;
  }
  const modal = document.getElementById('story-modal');
  const scroller = document.getElementById('story-modal-scroller');
  const track = document.getElementById('story-modal-track');
  if (!track || !chapters) return;
  let heroTitle = currentLang === 'fr' ? 'Mon parcours' : 'My background';
  const siteStoryTitle = storySiteCfg()?.storyTitle;
  if (siteStoryTitle && typeof siteStoryTitle === 'object') {
    const t = siteStoryTitle[currentLang] || siteStoryTitle.en;
    if (typeof t === 'string' && t) heroTitle = t;
  }
  const fr = currentLang === 'fr';
  const scrollLabel = fr ? 'Défiler' : 'Scroll';
  const chaptersLabel = fr ? 'Chapitres' : 'Chapters';
  const num = i => String(i + 1).padStart(2, '0');
  const introLine = storyIntroLine();

  const heroHtml = `
    <section class="story-intro${introLine ? '' : ' is-short'}" id="story-parallax-hero" aria-label="${escapeHTML(heroTitle)}">
      <div class="story-intro-stage">
        <div class="story-intro-scene">
          <div class="story-parallax-layers">
            <div class="story-parallax-layer" data-parallax-layer="1">
              <video class="story-parallax-layer-img" muted loop playsinline webkit-playsinline preload="none" data-src="../images/video-background.mp4" aria-hidden="true"></video>
            </div>
            <div class="story-parallax-layer" data-parallax-layer="2">
              <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795b4d5ac529e7d3a562_osmo-parallax-layer-2.webp" loading="eager" alt="" class="story-parallax-layer-img" />
            </div>
            <div class="story-parallax-title-wrap" data-parallax-layer="3">
              <h2 class="story-parallax-title">${storySplitWords(`${escapeHTML(heroTitle)}<em>.</em>`, true)}</h2>
            </div>
            <div class="story-parallax-layer" data-parallax-layer="4">
              <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795bb5aceca85011ad83_osmo-parallax-layer-1.webp" loading="eager" alt="" class="story-parallax-layer-img" />
            </div>
          </div>
          <div class="story-intro-veil"></div>
          <div class="story-parallax-fade"></div>
          <button type="button" class="story-parallax-cue" id="story-scroll-cue">
            <span class="story-parallax-cue-label">${scrollLabel}</span>
            <span class="story-parallax-cue-dot" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3.5 6.5L8 11l4.5-4.5"></path>
              </svg>
            </span>
          </button>
        </div>
        <div class="story-intro-copy">
          ${introLine ? `<p class="story-intro-line">${storySplitWords(introLine)}</p>` : ''}
          <ol class="story-intro-index" aria-label="${chaptersLabel}">
            ${chapters.map((chapter, index) => `
              <li style="--k:${index}">
                <button type="button" class="story-intro-link" data-story-target="${chapter.id}"><span>${num(index)}</span>${chapter.label}</button>
              </li>`).join('')}
          </ol>
        </div>
      </div>
    </section>
  `;

  const chaptersHtml = chapters.map((chapter, index) => `
    <section class="story-chapter" id="${chapter.id}">
      <figure class="story-fig" data-story-fig="${chapter.fig}">
        <figcaption class="story-fig-hud">
          <span class="story-fig-lbl">Fig ${num(index)}</span>
          <span class="story-fig-lbl is-title">${chapter.figTitle}</span>
          <span class="story-fig-lbl is-hint">${chapter.figHint}</span>
        </figcaption>
        <div class="story-fig-art" aria-hidden="true">
          ${drawStoryFigure(chapter.fig, `s${index}`)}
        </div>
        <div class="story-fig-steps" role="group" aria-label="${chapter.figTitle}">
          ${chapter.figStatus.map((status, k) => `
            <button type="button" class="story-fig-step" data-step="${k}" aria-pressed="false">
              <span class="story-fig-step-t">${status}</span>
              <span class="story-fig-step-bar" aria-hidden="true"></span>
            </button>`).join('')}
        </div>
      </figure>
      <div class="story-chapter-copy">
        <span class="story-chapter-num" aria-hidden="true">${num(index)}</span>
        <p class="story-chapter-label"><span class="n">${num(index)}</span><span class="bar" aria-hidden="true"></span><span>${chapter.label}</span></p>
        <h3 class="story-chapter-title">${storySplitWords(chapter.title, true)}</h3>
        ${chapter.paragraphs.map((paragraph, k) => `<p class="story-chapter-p" style="--i:${k}">${paragraph}</p>`).join('')}
      </div>
    </section>
  `).join('');

  const navHtml = `
    <nav class="story-chapters" aria-label="${chaptersLabel}">
      ${chapters.map((chapter, index) => `
        <button type="button" class="story-chapter-link" data-story-target="${chapter.id}">
          <span>${num(index)}</span>
          ${chapter.label}
        </button>
      `).join('')}
    </nav>
  `;

  const contactEmail = escapeHTML(storyContactEmail());
  const siteContactHtml = storySiteHook('renderStoryContact', currentLang);
  const contactHtml = typeof siteContactHtml === 'string' && siteContactHtml ? siteContactHtml : `
    <div class="story-contact-wrap">
      <div class="story-contact-stack">
        <a class="story-contact-email" href="mailto:${contactEmail}">${contactEmail}</a>
        <div class="story-contact-actions">
          <a class="story-contact-btn" href="mailto:${contactEmail}">
            <span>${fr ? 'Me contacter' : 'Contact me'}</span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 12L12 4"></path>
              <path d="M6 4h6v6"></path>
            </svg>
          </a>
          <a class="story-contact-btn story-contact-btn--ghost" href="https://calendly.com/chilka-v/30min" target="_blank" rel="noopener noreferrer">
            <span>${fr ? 'Réserver un appel' : 'Book a call'}</span>
          </a>
        </div>
      </div>
    </div>
  `;

  if (scroller) {
    const existingParallax = scroller.querySelector('#story-parallax-hero');
    if (existingParallax) existingParallax.remove();
    track.insertAdjacentHTML('beforebegin', heroHtml);
  }

  track.innerHTML = `
    <div class="story-sheet">
      <div class="story-sheet-main">${chaptersHtml}${contactHtml}</div>
      ${navHtml}
    </div>
  `;

  if (modal) ensureStoryChrome(modal);
  mountStoryFigures(track);
  if (scroller) observeStory(scroller);
  // a language switch while the story is open rebuilds the hero: restart its video
  if (modal && modal.classList.contains('open')) startStoryVideo(modal);
  refreshStoryScroll();
}

/* ── Scroll: one rAF-coalesced pass paints the pinned intro, the per-chapter parallax value (--cp), the
   chapter rail, the reading progress (--sp) and the ambient glow. ── */
function paintStoryIntro(hero, p) {
  if (!hero.__parts) {
    const q = s => hero.querySelector(s);
    hero.__parts = {
      l1: q('[data-parallax-layer="1"]'),
      l2: q('[data-parallax-layer="2"]'),
      l3: q('[data-parallax-layer="3"]'),
      l4: q('[data-parallax-layer="4"]'),
      veil: q('.story-intro-veil'),
      copy: q('.story-intro-copy'),
      cue: q('#story-scroll-cue'),
      words: [...hero.querySelectorAll('.story-intro-line .sw')],
      items: [...hero.querySelectorAll('.story-intro-index li')],
    };
  }
  const P = hero.__parts;
  // not .hidden: the page's .hidden utility is display:none !important and would cut the fade
  P.cue?.classList.toggle('is-hidden', p > 0.02);
  if (storyReduceMotion()) return; // static layout from story.css
  const short = hero.classList.contains('is-short');
  if (P.l1) P.l1.style.transform = `translate3d(0, ${(p * 16).toFixed(2)}%, 0) scale(${(1.04 + p * 0.1).toFixed(4)})`;
  if (P.l2) P.l2.style.transform = `translate3d(0, ${(p * 9).toFixed(2)}%, 0) scale(${(1 + p * 0.14).toFixed(4)})`;
  if (P.l3) {
    P.l3.style.transform = `translate3d(0, ${(p * 24).toFixed(2)}%, 0) scale(${(1 - 0.14 * storySmooth(storySeg(p, 0, 0.5))).toFixed(4)})`;
    P.l3.style.opacity = (1 - storySmooth(storySeg(p, short ? 0.14 : 0.2, short ? 0.34 : 0.42))).toFixed(3);
  }
  if (P.l4) P.l4.style.transform = `translate3d(0, ${(-p * 6).toFixed(2)}%, 0) scale(${(1 + p * 0.32).toFixed(4)})`;
  if (P.veil) P.veil.style.opacity = (0.84 * storySmooth(storySeg(p, 0.12, 0.46)) + 0.16 * storySmooth(storySeg(p, 0.86, 1))).toFixed(3);
  if (P.copy) {
    const o = storySmooth(storySeg(p, short ? 0.18 : 0.24, short ? 0.3 : 0.34));
    P.copy.style.opacity = o.toFixed(3);
    P.copy.classList.toggle('is-active', o > 0.5);
  }
  const wn = P.words.length;
  if (wn) {
    const wp = storySeg(p, 0.3, 0.7) * wn;
    P.words.forEach((word, i) => {
      const v = storyClamp(wp - i).toFixed(3);
      if (word.__v !== v) { word.__v = v; word.style.setProperty('--v', v); }
    });
  }
  const n = P.items.length;
  if (n) {
    const ip = (short ? storySeg(p, 0.32, 0.62) : storySeg(p, 0.66, 0.88)) * n;
    P.items.forEach((item, k) => {
      const v = storyClamp(ip - k).toFixed(3);
      if (item.__v !== v) { item.__v = v; item.style.setProperty('--v', v); }
    });
  }
}

function startStoryVideo(modal) {
  const video = modal.querySelector('video[data-src]');
  if (!video) return;
  if (!video.getAttribute('src')) video.src = video.dataset.src;
  video.play().catch(() => {});
}

function refreshStoryScroll() {
  const scroller = document.getElementById('story-modal-scroller');
  const modal = document.getElementById('story-modal');
  if (!scroller || !modal) return;
  const panel = modal.querySelector('.story-modal-panel');
  const base = scroller.getBoundingClientRect().top;
  const vh = scroller.clientHeight || window.innerHeight || 1;
  const open = modal.classList.contains('open');

  // 1. pinned intro
  const hero = scroller.querySelector('#story-parallax-hero');
  let heroBottom = 0;
  if (hero) {
    const rect = hero.getBoundingClientRect();
    const top = rect.top - base;
    heroBottom = top + rect.height;
    const travel = Math.max(1, rect.height - vh);
    if (heroBottom > 0) paintStoryIntro(hero, storyClamp(-top / travel));
    // the background video only plays while the scene is on screen
    const video = hero.querySelector('video');
    if (video && video.getAttribute('src')) {
      if (open && heroBottom > 0) { if (video.paused) video.play().catch(() => {}); }
      else if (!video.paused) video.pause();
    }
  }

  // 2. chapters: parallax value and the current one
  const chapters = [...scroller.querySelectorAll('.story-chapter')];
  const mark = vh * 0.45;
  let current = -1;
  chapters.forEach((chapter, i) => {
    const rect = chapter.getBoundingClientRect();
    const top = rect.top - base;
    if (top < vh && top + rect.height > 0) {
      chapter.style.setProperty('--cp', storyClamp((vh - top) / (vh + rect.height)).toFixed(3));
    }
    if (top <= mark) current = i;
  });
  const currentId = current >= 0 ? chapters[current].id : '';
  scroller.querySelectorAll('.story-chapter-link').forEach((link) => {
    const on = link.dataset.storyTarget === currentId;
    link.classList.toggle('is-current', on);
    if (on) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
  const past = !hero || heroBottom < vh * 0.55;
  scroller.querySelector('.story-chapters')?.classList.toggle('is-shown', past);

  // 3. panel: reading progress and the ambient glow that follows the figure side
  if (panel) {
    const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    panel.style.setProperty('--sp', storyClamp(scroller.scrollTop / max).toFixed(4));
    panel.classList.toggle('is-past-intro', past);
    panel.style.setProperty('--amb-x', current % 2 === 1 ? '72%' : '28%');
  }
}

let storyScrollRaf = 0;
function scheduleStoryScrollRefresh() {
  if (storyScrollRaf) return;
  storyScrollRaf = window.requestAnimationFrame(() => {
    storyScrollRaf = 0;
    refreshStoryScroll();
  });
}
// Names kept for other callers.
const refreshStoryPrompter = refreshStoryScroll;
const refreshStoryParallax = refreshStoryScroll;
const updateStoryScrollCue = refreshStoryScroll;

function storyScrollTo(top) {
  const scroller = document.getElementById('story-modal-scroller');
  if (!scroller) return;
  scroller.scrollTo({ top: Math.max(0, top), behavior: storyReduceMotion() ? 'auto' : 'smooth' });
}

function storyScrollToChapter(id) {
  const scroller = document.getElementById('story-modal-scroller');
  const target = id && document.getElementById(id);
  if (!scroller || !target) return;
  const nav = scroller.querySelector('.story-chapters');
  const bar = nav && getComputedStyle(nav).flexDirection === 'row';
  const offset = bar ? nav.getBoundingClientRect().height + 16 : 0;
  storyScrollTo(target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - offset);
}

// "Scroll" cue: play the pinned intro to the chapter index (the reader then picks a chapter or keeps going).
function scrollStoryDown() {
  const scroller = document.getElementById('story-modal-scroller');
  const hero = scroller?.querySelector('#story-parallax-hero');
  if (!scroller || !hero || storyReduceMotion()) {
    const first = scroller?.querySelector('.story-chapter');
    if (first) storyScrollToChapter(first.id);
    return;
  }
  const travel = Math.max(1, hero.offsetHeight - scroller.clientHeight);
  storyScrollTo(hero.offsetTop + travel * 0.92);
}

// Focus for the two full-screen dialogs: move it in on open, keep Tab inside,
// give it back to the trigger on close.
const modalFocus = (() => {
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, iframe, [tabindex]:not([tabindex="-1"])';
  const returnTo = new Map();
  const isOpen = el => el.classList.contains('open');
  const items = modal => [...modal.querySelectorAll(FOCUSABLE)].filter(el => el.getClientRects().length > 0);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const modal = [...returnTo.keys()].reverse().find(isOpen);
    if (!modal) return;
    const list = items(modal);
    if (!list.length) { e.preventDefault(); modal.focus(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (!modal.contains(active)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && (active === first || active === modal)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  });
  return {
    open(modal, initial) {
      if (!modal) return;
      if (!returnTo.has(modal)) {
        const active = document.activeElement;
        returnTo.set(modal, active && active !== document.body && !modal.contains(active) ? active : null);
      }
      if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
      window.requestAnimationFrame(() => (initial || modal).focus({ preventScroll: true }));
    },
    close(modal) {
      if (!modal || !returnTo.has(modal)) return;
      const target = returnTo.get(modal);
      returnTo.delete(modal);
      if (target && target.isConnected) target.focus({ preventScroll: true });
    },
  };
})();

let storyOpeningTimer = 0;
function playStoryOpening(modal) {
  window.clearTimeout(storyOpeningTimer);
  modal.classList.remove('is-opening');
  if (storyReduceMotion()) return;
  void modal.offsetWidth; // restart the keyframes on a second open
  modal.classList.add('is-opening');
  storyOpeningTimer = window.setTimeout(() => modal.classList.remove('is-opening'), 2300);
}

function openStoryModal() {
  const modal = document.getElementById('story-modal');
  const scroller = document.getElementById('story-modal-scroller');
  if (!modal || !scroller) return;

  renderStoryModalContent();
  playStoryOpening(modal);
  modal.classList.add('open');
  // the background video starts only when the story actually opens
  startStoryVideo(modal);
  scroller.scrollTop = 0;
  syncPageLock();
  modalFocus.open(modal, modal.querySelector('.story-modal-close'));
  refreshStoryScroll();
  window.setTimeout(refreshStoryScroll, 40);
}

function closeStoryModal() {
  const modal = document.getElementById('story-modal');
  if (!modal) return;

  modal.classList.remove('open', 'is-opening');
  window.clearTimeout(storyOpeningTimer);
  const storyVideo = modal.querySelector('video[data-src]');
  if (storyVideo) {
    try { storyVideo.pause(); } catch {}
    storyVideo.removeAttribute('src');
    try { storyVideo.load(); } catch {}
  }
  syncPageLock();
  modalFocus.close(modal);
}

document.getElementById('story-modal-scroller')?.addEventListener('scroll', scheduleStoryScrollRefresh, { passive: true });
window.addEventListener('resize', () => {
  if (document.getElementById('story-modal')?.classList.contains('open')) scheduleStoryScrollRefresh();
}, { passive: true });
document.getElementById('story-modal-scroller')?.addEventListener('click', (event) => {
  if (event.target.closest('#story-scroll-cue')) {
    event.preventDefault();
    scrollStoryDown();
    return;
  }
  const link = event.target.closest('[data-story-target]');
  if (!link) return;
  event.preventDefault();
  event.stopPropagation();
  storyScrollToChapter(link.dataset.storyTarget || '');
});
document.getElementById('story-modal')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeStoryModal();
});

/* ═══════════════════════════════════════════
   INTERFACE SHOWCASE DATA
═══════════════════════════════════════════ */
const INTERFACES = [
  {
    id: 'bereal-posting-flow',
    name: 'BeReal. — Posting Flow',
    tag: 'Mobile · Social · Design challenge',
    type: 'mobile',
    thumb: 'covers/iface-bereal-posting-flow.webp',
    caseStudy: 'bereal', // portfolio case study: /portfolio#project/bereal
    screens: [
      { label: 'Posting flow', src: 'demos/bereal/' },
      { label: 'Feed', src: 'demos/bereal/?step=feed' }
    ]
  },
  {
    id: 'challenge-live-webinar',
    name: '5-Day Challenge — Webinar Opt-in',
    tag: 'Landing · Webinar · Cal-inspired',
    type: 'desktop',
    hidden: true,
    url: 'challenge.local/5-day-live',
    src: 'interfaces/challenge-live-webinar.html'
  },
  {
    id: 'revenue-command-center',
    name: 'Revenue Command Center',
    tag: 'AI SaaS · Revenue · Command Center',
    type: 'desktop',
    thumb: 'covers/iface-revenue-command-center.webp',
    url: 'revenueos.ai/command-center',
    src: 'interfaces/revenue-command-center.html'
  },
  {
    id: 'accounting-dashboard',
    name: 'LedgerStack — IT Accounting',
    tag: 'SaaS · Accounting · Light',
    type: 'desktop',
    thumb: 'covers/iface-accounting-dashboard.jpg',
    url: 'ledgerstack.io/dashboard',
    src: 'interfaces/accounting-dashboard.html'
  },
  {
    id: 'fleet-tracker',
    name: 'Flaety — Fleet Tracker',
    tag: 'Logistics · Dark · Maps',
    type: 'desktop',
    thumb: 'covers/iface-fleet-tracker.jpg',
    url: 'flaety.io/fleet',
    src: 'interfaces/fleet-tracker.html'
  },
  {
    id: 'upload-drop-glow',
    name: 'Upload Drop — Glow',
    tag: 'Micro-interaction · Dark · Glass',
    type: 'desktop',
    thumb: 'covers/iface-upload-drop-glow.jpg',
    url: 'framer.upload/drop',
    src: 'interfaces/upload-drop-glow.html'
  },
  {
    id: 'finvest-convert',
    name: 'Teroxx — Crypto Convert',
    tag: 'Fintech · Dashboard · Light',
    type: 'desktop',
    thumb: 'covers/iface-finvest-convert.jpg',
    url: 'teroxx.app/convert',
    src: 'interfaces/finvest-convert.html'
  },
  {
    id: 'lyon-saas',
    name: 'Lyon — AI Social Media',
    tag: 'SaaS · Landing · AI',
    type: 'desktop',
    thumb: 'covers/iface-lyon-saas.jpg',
    url: 'lyon.ai',
    src: 'interfaces/lyon-saas.html'
  },
  {
    id: 'munsit-voice-flow',
    name: 'Munsit — Arabic TTS Studio',
    tag: 'Mobile · Arabic TTS · AI Voice',
    type: 'mobile',
    thumb: 'covers/iface-munsit-voice-flow.webp',
    screens: [
      { label: 'Dashboard', src: 'interfaces/munsit-compose.html' },
      { label: 'TTS Studio', src: 'interfaces/munsit-studio.html' }
    ]
  },
  {
    id: 'motion-hero',
    name: 'Motion — Photography Hero',
    tag: 'Portfolio · Editorial · Interactive',
    type: 'desktop',
    thumb: 'covers/iface-motion-hero.jpg',
    url: 'motion.studio',
    src: 'interfaces/motion-hero.html'
  },
  {
    id: 'food-details',
    name: 'NutriTrack — Food Details',
    tag: 'Mobile · Nutrition · App Flow',
    type: 'mobile',
    thumb: 'covers/iface-food-details.jpg',
    screens: [
      { label: 'Home', src: 'interfaces/food-home.html' },
      { label: 'Food Details', src: 'interfaces/food-details.html' }
    ]
  },
  {
    id: 'medical-dashboard',
    name: 'HavenMed — Medical Dashboard',
    tag: 'Healthcare · SaaS · Light',
    type: 'desktop',
    thumb: 'covers/iface-medical-dashboard.jpg',
    url: 'havenmed.io/dashboard',
    src: 'interfaces/medical-dashboard.html'
  },
  {
    id: 'hr-dashboard',
    name: 'TalentSync — HR Dashboard',
    tag: 'SaaS · HR · Light',
    type: 'desktop',
    thumb: 'covers/iface-hr-dashboard.jpg',
    url: 'talentsync.com/dashboard',
    src: 'interfaces/hr-dashboard.html'
  },
  {
    id: 'opero-hero',
    name: 'Opero — Automation Platform',
    tag: 'SaaS · B2B · Light',
    type: 'desktop',
    thumb: 'covers/iface-opero-hero.jpg',
    url: 'opero.io',
    src: 'interfaces/opero-hero.html'
  },
  {
    id: 'maritana-hero',
    name: 'Maritana — Minerals Hero',
    tag: 'Mining · Corporate · Editorial',
    type: 'desktop',
    thumb: 'covers/iface-maritana-hero.webp',
    url: 'maritanaminerals.com',
    src: 'interfaces/maritana-hero.html'
  },
  {
    id: 'n8n-workflow',
    name: 'n8n — AI Agent Workflow',
    tag: 'Automation · Dark · Builder',
    type: 'desktop',
    thumb: 'covers/iface-n8n-workflow.jpg',
    url: 'n8n.io/workflows/ai-agent',
    src: 'interfaces/n8n-workflow.html'
  },
  {
    id: 'health-overview',
    name: 'Health App',
    tag: 'Mobile · Wellness',
    type: 'mobile',
    thumb: 'covers/iface-health-overview.jpg',
    screens: [
      { label: 'Overview', src: 'interfaces/health-overview.html' },
      { label: 'Dashboard', src: 'interfaces/health-dashboard.html' }
    ]
  },
  {
    id: 'expo-sdk-grid',
    name: 'Expo — SDK 54',
    tag: 'Bento Grid · Dark',
    type: 'desktop',
    thumb: 'covers/iface-expo-sdk-grid.jpg',
    url: 'expo.dev/sdk-54',
    src: 'interfaces/expo-sdk-grid.html'
  },
  {
    id: 'synaptix-hero',
    name: 'Bloomly — Living Brands',
    tag: 'AI Branding · Glassmorphism',
    type: 'desktop',
    thumb: 'covers/iface-synaptix-hero.jpg',
    url: 'bloomly.studio',
    src: 'interfaces/synaptix-hero.html'
  },
  {
    id: 'sobers-hero',
    name: 'Sobers — Landing Hero',
    tag: 'Mobile App · Cinematic',
    type: 'desktop',
    thumb: 'covers/iface-sobers-hero.jpg',
    url: 'sobers.app',
    src: 'interfaces/sobers-hero.html'
  },
  {
    id: 'analytics-card',
    name: 'Analytics Dashboard',
    tag: 'SaaS · Dark',
    type: 'desktop',
    thumb: 'covers/iface-analytics-card.jpg',
    url: 'localhost/analytics',
    src: 'interfaces/analytics-card.html'
  },
  {
    id: 'devpilot-hero',
    name: 'Devpilot — Hiring Hero',
    tag: 'Recruitment · SaaS · Light',
    type: 'desktop',
    thumb: 'covers/iface-devpilot-hero.jpg',
    url: 'devpilot.io',
    src: 'interfaces/devpilot-hero.html'
  },
  {
    id: 'bento-features',
    name: 'Feature Bento Grid',
    tag: 'Bento · SaaS · Light',
    type: 'desktop',
    thumb: 'covers/iface-bento-features.jpg',
    url: 'saas/features',
    src: 'interfaces/bento-features.html'
  },
  {
    id: 'viora-health',
    name: 'Viora — Health Dashboard',
    tag: 'Healthcare · Light · Analytics',
    type: 'desktop',
    thumb: 'covers/iface-viora-health-v2.jpg',
    url: 'viora.health/overview',
    src: 'interfaces/viora-health.html'
  },
  {
    id: 'remoterecruit-redesign',
    name: 'RemoteRecruit — Employer Browse',
    tag: 'Recruitment · Audit Response · Light',
    type: 'desktop',
    thumb: 'covers/iface-remoterecruit-redesign-v2.jpg',
    url: 'remoterecruit.com/employer-search',
    src: 'interfaces/remoterecruit-redesign.html'
  },
  {
    id: 'linkedin-jobs-playground',
    name: 'LinkedIn Jobs — Search Redesign',
    tag: 'Recruitment · Jobs · Light',
    type: 'desktop',
    thumb: 'covers/iface-linkedin-jobs-playground-v2.jpg',
    url: 'linkedin.com/jobs/search',
    src: 'interfaces/linkedin-jobs-playground.html'
  },
];

const IFACE_COLLAPSED_ROWS = 3;

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function getIfaceInitials(name) {
  return name
    .split(/[\s—-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

/* ═══════════════════════════════════════════
   RENDER INTERFACE GRID
═══════════════════════════════════════════ */
/** SITE.ifaceHiddenIds, or [] (no SITE / not an array). */
function siteIfaceHiddenIds() {
  const ids = storySiteCfg()?.ifaceHiddenIds;
  return Array.isArray(ids) ? ids : [];
}

/** Playground entries shown in the grid: not hidden in data, not hidden by the host page. */
function visibleInterfaces() {
  const siteHidden = siteIfaceHiddenIds();
  return INTERFACES.filter(iface => !iface.hidden && !siteHidden.includes(iface.id));
}

/** Extra card tag from SITE.ifaceBadge(iface, lang), e.g. "Concept". '' on /portfolio. */
function siteIfaceBadgeHtml(iface) {
  const text = storySiteHook('ifaceBadge', iface, currentLang);
  return typeof text === 'string' && text ? `<span class="iface-card-badge">${escapeHTML(text)}</span>` : '';
}

/* Recorded loops of a few interfaces (images/reel/, made for the /agence reel, 2026-10-18): on a card they play over
   the cover while it is hovered or focused, and on touch screens while it sits in view. Key = INTERFACES id. */
const IFACE_MOTION = {
  'sobers-hero': 'sobers-hero',
  'motion-hero': 'motion-hero',
  'munsit-voice-flow': 'munsit-studio',
  'maritana-hero': 'maritana-hero',
  'upload-drop-glow': 'upload-drop-glow',
  'devpilot-hero': 'devpilot-hero',
};
/* On /agence, visitors in languages other than EN and FR get the machine translation (agTr, agence shells). */
function ifaceTr(s) {
  return typeof window.agTr === 'function' ? window.agTr(s) : s;
}
function ifaceMotionHtml(iface) {
  const file = IFACE_MOTION[iface.id];
  if (!file) return '';
  const label = currentLang === 'fr' ? 'Vidéo' : ifaceTr('Motion');
  return `<video class="iface-card-video" muted loop playsinline preload="none" disablepictureinpicture disableremoteplayback tabindex="-1" aria-hidden="true" data-src="/images/reel/${file}.mp4?v=1"></video><span class="iface-card-motion" aria-hidden="true">${label}</span>`;
}
function bindIfaceMotion(grid) {
  const cards = Array.from(grid.querySelectorAll('.iface-card')).filter(card => card.querySelector('.iface-card-video'));
  if (!cards.length) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const play = (card) => {
    const v = card.querySelector('.iface-card-video');
    if (!v.getAttribute('src')) { v.preload = 'auto'; v.src = v.dataset.src; }
    card.classList.add('is-playing');
    const p = v.play();
    if (p && p.catch) p.catch(() => card.classList.remove('is-playing'));
  };
  const stop = (card) => {
    const v = card.querySelector('.iface-card-video');
    v.pause();
    card.classList.remove('is-playing');
  };
  if (hover) {
    cards.forEach(card => {
      card.addEventListener('mouseenter', () => play(card));
      card.addEventListener('mouseleave', () => stop(card));
      card.addEventListener('focusin', () => play(card));
      card.addEventListener('focusout', () => stop(card));
    });
  } else if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) play(e.target); else stop(e.target); });
    }, { threshold: 0.7 });
    cards.forEach(card => io.observe(card));
  }
}

function renderIfaceGrid() {
  const el = document.getElementById('ifaces-grid-el');
  if (!el) return;
  el.innerHTML = visibleInterfaces().map(iface => `
    <div class="iface-card" role="button" tabindex="0" data-iface="${iface.id}" aria-label="${escapeHTML(iface.name)}">${siteIfaceBadgeHtml(iface)}
      ${iface.thumb
        ? `<img class="iface-card-thumb" src="${ifaceThumbSrc(iface.thumb)}" alt="${escapeHTML(iface.name)}" loading="lazy" decoding="async">`
        : `<div class="iface-card-thumb--empty"><span class="iface-card-initials">${escapeHTML(getIfaceInitials(iface.name))}</span></div>`
      }${ifaceMotionHtml(iface)}
      <div class="iface-card-open">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9"/><polyline points="10 1 15 1 15 6"/><line x1="15" y1="1" x2="7" y2="9"/></svg>
      </div>
      <div class="iface-card-overlay">
        <div class="iface-card-name">${escapeHTML(iface.name)}</div>
        <div class="iface-card-tag">${escapeHTML(iface.tag)}</div>
      </div>
    </div>`).join('');
  bindIfaceMotion(el);
  // One delegated click and one key handler for the grid (the cards used to carry an inline onclick).
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', (e) => {
      const c = e.target.closest('.iface-card[data-iface]');
      if (c) openIfaceModal(c.dataset.iface);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const c = e.target.closest('.iface-card[data-iface]');
      if (!c || e.target !== c) return;
      e.preventDefault();
      openIfaceModal(c.dataset.iface);
    });
  }

  // Use requestAnimationFrame to ensure the grid is rendered before calculating height
  requestAnimationFrame(() => {
    initIfaceGrid();
  });
}

function getIfaceColumnCount(grid) {
  const columns = window.getComputedStyle(grid).gridTemplateColumns;
  if (!columns || columns === 'none' || columns === '0px') return 3;
  return columns.split(' ').filter(Boolean).length;
}

function updateIfaceGridHeight() {
  const wrap = document.getElementById('ifaces-grid-wrap');
  const limiter = document.getElementById('ifaces-grid-limiter');
  const grid = document.getElementById('ifaces-grid-el');
  const button = document.getElementById('ifaces-showmore');
  const label = document.getElementById('ifaces-showmore-label');
  if (!wrap || !limiter || !grid || !button || !label) return;

  const card = grid.querySelector('.iface-card');
  if (!card) return;

  const cardHeight = card.offsetHeight || card.getBoundingClientRect().height;
  if (cardHeight === 0) {
    setTimeout(updateIfaceGridHeight, 100);
    return;
  }

  const gap = parseFloat(window.getComputedStyle(grid).rowGap) || 0;
  const isCollapsed = wrap.classList.contains('is-collapsed');
  const showcase = !!wrap.closest('.ag-showcase');
  const collapsedRows = showcase ? 2 : IFACE_COLLAPSED_ROWS;

  if (isCollapsed) {
    // .is-gallery (the /portfolio playground since 2026-10-18) lays cards flat like the agence showcase
    const flat = showcase || wrap.classList.contains('is-gallery');
    const overlap = flat ? 0 : 140; // 140 matches the old playground's negative margin-top
    const padding = flat ? 8 : 60; // old playground: 30px top + 30px bottom
    const h = Math.ceil((cardHeight * collapsedRows) + (gap * (collapsedRows - 1)) - (overlap * (collapsedRows - 1)) + padding);
    limiter.style.maxHeight = h + 'px';
  } else {
    limiter.style.maxHeight = grid.scrollHeight + 'px';
  }
  const labelKey = isCollapsed ? 'show_all' : 'show_fewer';
  label.textContent = ifaceTr((typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][labelKey])
    || (isCollapsed ? 'Show all interfaces' : 'Show fewer interfaces'));

  const columns = Math.max(1, getIfaceColumnCount(grid));
  // A host page counts only the cards it shows; /portfolio keeps counting every entry.
  const ifaceCount = storySiteCfg() ? visibleInterfaces().length : INTERFACES.length;
  const shouldCollapse = ifaceCount > columns * collapsedRows;
  button.hidden = !shouldCollapse;
  button.setAttribute('aria-expanded', String(!isCollapsed));
}

function initIfaceGrid() {
  const wrap = document.getElementById('ifaces-grid-wrap');
  const button = document.getElementById('ifaces-showmore');
  if (!wrap || !button || button.dataset.bound === 'true') {
    updateIfaceGridHeight();
    return;
  }

  button.dataset.bound = 'true';
  button.addEventListener('click', () => {
    wrap.classList.toggle('is-collapsed');
    updateIfaceGridHeight();
  });
  window.addEventListener('resize', updateIfaceGridHeight, { passive: true });
  
  // Extra safety: wait a bit more for layout to settle
  setTimeout(updateIfaceGridHeight, 100);
}

function getIfacePreviewSrc(iface) {
  if (iface.src) return iface.src;
  if (Array.isArray(iface.screens) && iface.screens.length) return iface.screens[0].src;
  return '';
}

/** Path the page lives at: window.SITE.base on a host page (e.g. /agence), else /portfolio. No trailing slash. */
function ifaceBasePath() {
  const base = (window.SITE && window.SITE.base) || '/portfolio';
  let path = String(base).replace(/\/+$/, '');
  // A base without its leading slash ('agence') would make pushState relative and never match pathname.
  if (path && path[0] !== '/') path = '/' + path;
  return path;
}

/** Covers are served from /covers/: a relative 'covers/...' 404s under /<base>/layout-<id>. */
// Bump when the covers are rendered again (scripts/capture-iface-covers.mjs), so browsers drop the old images.
const IFACE_COVERS_V = '20261019b';
function ifaceThumbSrc(thumb) {
  return /^covers\//.test(thumb) ? '/' + thumb + '?v=' + IFACE_COVERS_V : thumb;
}

function getIfaceSharePath(iface) {
  return ifaceBasePath() + '/layout-' + iface.id;
}

function getIfaceFromLocation(pathname = window.location.pathname) {
  const baseRe = ifaceBasePath().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const match = pathname.match(new RegExp('^' + baseRe + '\\/layout-([a-z0-9-]+)$', 'i'));
  if (!match) return null;
  // A host page's hidden entries do not open from a /<base>/layout-<id> URL either.
  if (siteIfaceHiddenIds().includes(match[1])) return null;
  return INTERFACES.find(iface => iface.id === match[1]) || null;
}

function normalizePreviewPath(src) {
  if (!src) return '';
  const clean = src.replace(/^\/+/, '');
  return '/' + clean;
}

function getAbsolutePreviewUrl(src) {
  if (!src) return '';
  try {
    return new URL(normalizePreviewPath(src), window.location.origin).href;
  } catch {
    return src;
  }
}

function copyUrlLabel(state) {
  const fr = typeof currentLang === 'undefined' || currentLang !== 'en';
  if (state === 'copied') return fr ? 'Copié' : ifaceTr('Copied');
  if (state === 'failed') return fr ? 'Échec' : ifaceTr('Copy failed');
  return fr ? 'Copier l’URL' : ifaceTr('Copy URL');
}

function setModalUrl(raw) {
  const bar = document.getElementById('iface-modal-url');
  const copyBtn = document.getElementById('iface-modal-copy');
  const lockSvg = '<svg class="url-lock" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="8" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>';

  if (!raw) {
    bar.innerHTML = lockSvg + '<span class="url-text">localhost</span>';
    bar.classList.remove('is-link');
    bar.title = '';
    copyBtn.onclick = null;
    copyBtn.textContent = copyUrlLabel();
    copyBtn.disabled = true;
    return;
  }

  const href = raw;
  let host = raw;
  let path = '';
  let protocol = 'https://';

  try {
    const parsed = new URL(raw);
    protocol = parsed.protocol + '//';
    host = parsed.host;
    path = parsed.pathname + parsed.search + parsed.hash;
  } catch {
    host = raw.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const slash = host.indexOf('/');
    if (slash !== -1) { path = host.slice(slash); host = host.slice(0, slash); }
  }

  bar.innerHTML = lockSvg +
    '<span class="url-text">' +
    '<span class="url-protocol">' + protocol + '</span>' +
    '<span class="url-host">' + host + '</span>' +
    (path ? '<span class="url-path">' + path + '</span>' : '') +
    '</span>';

  bar.classList.add('is-link');
  bar.title = href;
  copyBtn.disabled = false;
  copyBtn.textContent = copyUrlLabel();
  copyBtn.onclick = async () => {
    // data-state drives the confirmation colour and pop in portfolio.html (#micro-interactions)
    const settle = () => window.setTimeout(() => { copyBtn.textContent = copyUrlLabel(); delete copyBtn.dataset.state; }, 1200);
    try {
      await navigator.clipboard.writeText(href);
      copyBtn.textContent = copyUrlLabel('copied');
      copyBtn.dataset.state = 'copied';
      settle();
    } catch {
      copyBtn.textContent = copyUrlLabel('failed');
      copyBtn.dataset.state = 'failed';
      settle();
    }
  };
}

function openIfaceModal(id) {
  const iface = INTERFACES.find(x => x.id === id);
  const options = arguments[1] || {};
  if (!iface) return;
  const modal = document.getElementById('iface-modal');
  if (!modal) return;

  const isMobile = iface.type === 'mobile';
  modal.classList.toggle('mobile', isMobile);
  setModalUrl(getAbsolutePreviewUrl(getIfaceSharePath(iface)));

  // Subpages stay on their own URL. /agence/layout-* is the homepage, not this preview.
  if (options.updateHistory !== false && !(window.SITE && window.SITE.page)) {
    const nextUrl = getIfaceSharePath(iface);
    if (window.location.pathname !== nextUrl) {
      window.history.pushState({ ifaceId: iface.id }, '', nextUrl);
    }
  }

  if (isMobile) {
    const frame = document.getElementById('iface-modal-frame');
    // about:blank, not '' — an empty src resolves to the page URL and reloads the
    // whole portfolio inside the frame
    frame.src = 'about:blank';
    const row = document.getElementById('iface-phones-row');
    const screens = Array.isArray(iface.screens) ? iface.screens : [{ label: iface.name, src: iface.src }];
    modal.classList.toggle('two-screens', screens.length === 2);
    row.innerHTML = screens.map(s => `
      <div class="iface-phone-wrap">
        <div class="iface-phone">
          <iframe src="${normalizePreviewPath(s.src)}" sandbox="allow-scripts allow-same-origin"></iframe>
        </div>
        ${screens.length > 1 ? `<div class="iface-phone-label">${s.label}</div>` : ''}
      </div>`).join('');
    const resetMobileRow = () => {
      row.scrollTo({ left: 0, top: 0, behavior: 'auto' });
      const firstScreen = row.querySelector('.iface-phone-wrap');
      if (firstScreen) firstScreen.scrollIntoView({ inline: 'start', block: 'nearest' });
    };
    resetMobileRow();
    window.requestAnimationFrame(resetMobileRow);
    window.setTimeout(resetMobileRow, 60);
  } else {
    modal.classList.remove('two-screens');
    document.getElementById('iface-phones-row').innerHTML = '';
    const frame = document.getElementById('iface-modal-frame');
    frame.src = normalizePreviewPath(iface.src);
  }

  modal.classList.add('open');
  syncPageLock();
  modalFocus.open(modal, modal.querySelector('.iface-modal-close'));
}

function closeIfaceModal() {
  const options = arguments[0] || {};
  if (!document.getElementById('iface-modal')) return;
  document.getElementById('iface-modal').classList.remove('open', 'mobile', 'two-screens');
  document.getElementById('iface-modal-frame').src = 'about:blank';
  document.getElementById('iface-phones-row').innerHTML = '';
  setModalUrl('');
  if (options.updateHistory !== false && window.location.pathname.startsWith(ifaceBasePath() + '/layout-')) {
    // A host page keeps its query (e.g. ?lang=fr) when the playground modal closes.
    window.history.pushState({}, '', (ifaceBasePath() || '/') + (storySiteCfg() ? window.location.search : ''));
  }
  syncPageLock();
  modalFocus.close(document.getElementById('iface-modal'));
}

renderIfaceGrid();

const initialIface = getIfaceFromLocation();
if (initialIface) openIfaceModal(initialIface.id, { updateHistory: false });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeIfaceModal({ updateHistory: false });
    closeStoryModal();
  }
});
document.getElementById('iface-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeIfaceModal();
});
window.addEventListener('popstate', () => {
  if (!window.location.pathname.startsWith(ifaceBasePath() + '/layout-')) {
    closeStoryModal();
  }
  const iface = getIfaceFromLocation();
  if (iface) {
    openIfaceModal(iface.id, { updateHistory: false });
  } else {
    closeIfaceModal({ updateHistory: false });
  }
});
