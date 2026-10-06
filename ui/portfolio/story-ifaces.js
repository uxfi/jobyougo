/* Story modal + interfaces */
const STORY_CONTENT = {"en": {"lines": ["I have spent <strong>12 years in UX</strong>, starting in digital design and working at <strong>Marcel/Publicis</strong>.", "I then went <strong>freelance</strong>, working with startups and larger companies.", "In <strong>2015</strong>, I founded <strong>Newflux.fr</strong>, a French UX/UI publication. I published 300+ articles and organized events and workshops.", "In <strong>2017</strong>, I co-founded <strong>Vloggy</strong>, a video social network with a mobile editing studio.", "We raised <strong>€100K</strong> and reached delivery stage. We later stopped operations when funding ran out.", "In <strong>2020</strong>, I founded <strong>Agence V0</strong>, a product design agency.", "I managed up to <strong>7 junior freelance designers</strong>. The agency generated around <strong>€400K over three years</strong>.", "My client work included <strong>LVMH</strong>, <strong>Société Générale</strong>, Renault and Shiseido.", "I have worked with <strong>AI for 4 years</strong>, and rebuilt my UX and design workflow around it.", "Independent products include <strong>UXfi</strong>, <strong>Flemme OS</strong> and <strong>Creads.io</strong>, which has 1,200 registered users and 20 paying clients.", "Today I work on product strategy and design at <strong>OneAsset</strong>, alongside my independent projects."]}, "fr": {"lines": ["Je travaille dans <strong>l’UX depuis 12 ans</strong>. J’ai commencé dans le design digital, puis travaillé chez <strong>Marcel/Publicis</strong>.", "Je suis ensuite devenu <strong>freelance</strong>, auprès de startups et de grands groupes.", "En <strong>2015</strong>, j’ai fondé <strong>Newflux.fr</strong>, un média UX/UI français. J’y ai publié 300+ articles et organisé des événements et des ateliers.", "En <strong>2017</strong>, j’ai cofondé <strong>Vloggy</strong>, un réseau social vidéo avec un studio de montage mobile.", "Nous avons levé <strong>100K EUR</strong> et atteint le stade de livraison. Nous avons ensuite arrêté l’activité faute de financement.", "En <strong>2020</strong>, j’ai fondé <strong>Agence V0</strong>, une agence de product design.", "J’y ai encadré jusqu’à <strong>7 designers freelances juniors</strong>. L’agence a réalisé environ <strong>400K EUR sur trois ans</strong>.", "J’ai notamment travaillé pour <strong>LVMH</strong>, <strong>Société Générale</strong>, Renault et Shiseido.", "Je travaille avec l’<strong>IA depuis 4 ans</strong>, et j’ai adapté mon workflow UX et design autour d’elle.", "Parmi les produits indépendants : <strong>UXfi</strong>, <strong>Flemme OS</strong> et <strong>Creads.io</strong>, qui compte 1 200 utilisateurs inscrits et 20 clients payants.", "Aujourd’hui, je travaille sur la stratégie produit et le design chez <strong>OneAsset</strong>, en parallèle de mes projets indépendants."]}};

let storyScrollRaf = 0;

const STORY_CHAPTERS = {
  en: [
    {
      id: 'story-now',
      label: 'Now',
      fig: 'desk',
      figTitle: 'Product desk',
      figHint: 'Click a panel',
      figStatus: ['Brief', 'Screens', 'Agent'],
      title: 'I design the product, and the agents around it',
      paragraphs: [
        'At OneAsset I’m the product manager and the only designer. That means the product, the admin platform and the marketing site.',
        'I prototype with AI coding tools and send the design through agents on GitHub. Figmol is the review tool I built for that. My own products are still going on the side.'
      ]
    },
    {
      id: 'story-products',
      label: 'Products',
      fig: 'products',
      figTitle: 'Three products',
      figHint: 'Click a product',
      figStatus: ['UXfi', 'Flemme OS', 'Creads.io'],
      title: 'I build products on my own',
      paragraphs: [
        'Since 2022 I’ve built UXfi, Flemme OS and Creads.io, on my own.',
        'UXfi scores an e-commerce site and suggests redesigns. Flemme OS does the social posts and the outreach. Creads.io is an AI ad product: 1,200 people signed up, and 20 of them pay.'
      ]
    },
    {
      id: 'story-ai',
      label: 'AI',
      fig: 'workflow',
      figTitle: 'Workflow',
      figHint: 'Click a step',
      figStatus: ['Prompt', 'Screen', 'Check'],
      title: 'AI is in how I design',
      paragraphs: [
        'I’ve worked with AI for 4 years. I rebuilt how I do UX and design around it.',
        'On an AI product I write the prompts, plug in the data and the integrations, then look at what comes back.'
      ]
    },
    {
      id: 'story-agency',
      label: 'Agency',
      fig: 'studio',
      figTitle: 'Studio',
      figHint: 'Click a seat',
      figStatus: ['Seat 1', 'Seat 2', 'Seat 3', 'Seat 4'],
      title: 'I ran a product design agency',
      paragraphs: [
        'In 2020 I started Agence V0 and managed up to 7 junior freelance designers. Over three years the agency made about €400K.',
        'At LVMH I worked on data-marketing flows across 15+ maisons, and at Renault on the international marketplace. Société Générale was regulated investment journeys. Shiseido was a client too.'
      ]
    },
    {
      id: 'story-earlier',
      label: 'Team',
      fig: 'archive',
      figTitle: 'From scratch',
      figHint: 'Click a mode',
      figStatus: ['Solo', 'Team', 'Ship'],
      title: 'I start from scratch and manage the people',
      paragraphs: [
        'For 12 years I’ve taken products from nothing to something people can use, on my own or while managing the team.',
        'At Agence V0 that was up to 7 junior freelance designers.'
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
      title: 'Je conçois le produit, et les agents autour',
      paragraphs: [
        'Chez OneAsset, je suis product manager et le seul designer. Je m’occupe du produit, de l’admin et du site marketing.',
        'Je prototype avec des outils de code IA, et je fais passer le design par des agents sur GitHub. Figmol, c’est l’outil de revue que j’ai fait pour ça. Mes propres produits tournent encore à côté.'
      ]
    },
    {
      id: 'story-products',
      label: 'Produits',
      fig: 'products',
      figTitle: 'Trois produits',
      figHint: 'Cliquer un produit',
      figStatus: ['UXfi', 'Flemme OS', 'Creads.io'],
      title: 'Je construis des produits, seul',
      paragraphs: [
        'Depuis 2022, je construis UXfi, Flemme OS et Creads.io, seul.',
        'UXfi note un site e-commerce et propose une refonte. Flemme OS s’occupe des posts et de la prospection. Creads.io est un produit de pub avec de l’IA : 1 200 inscrits, dont 20 qui paient.'
      ]
    },
    {
      id: 'story-ai',
      label: 'IA',
      fig: 'workflow',
      figTitle: 'Workflow',
      figHint: 'Cliquer une étape',
      figStatus: ['Prompt', 'Écran', 'Contrôle'],
      title: 'L’IA est dans ma façon de concevoir',
      paragraphs: [
        'Ça fait 4 ans que je travaille avec l’IA. J’ai refait ma façon de faire l’UX et le design autour.',
        'Sur un produit IA, j’écris les prompts, je branche les données et les intégrations, puis je regarde ce qui ressort.'
      ]
    },
    {
      id: 'story-agency',
      label: 'Agence',
      fig: 'studio',
      figTitle: 'Studio',
      figHint: 'Cliquer une place',
      figStatus: ['Place 1', 'Place 2', 'Place 3', 'Place 4'],
      title: 'J’ai dirigé une agence de product design',
      paragraphs: [
        'En 2020, j’ai monté Agence V0 et j’ai encadré jusqu’à 7 designers freelances juniors. En trois ans, l’agence a fait environ 400K EUR.',
        'Chez LVMH, des flux de data marketing pour plus de 15 maisons, et chez Renault la marketplace internationale. Société Générale, c’était des parcours d’investissement réglementés. Shiseido était client aussi.'
      ]
    },
    {
      id: 'story-earlier',
      label: 'Équipe',
      fig: 'archive',
      figTitle: 'Depuis zéro',
      figHint: 'Cliquer un mode',
      figStatus: ['Seul', 'Équipe', 'Livraison'],
      title: 'Je pars de zéro, et je dirige les gens',
      paragraphs: [
        'Depuis 12 ans, j’amène des produits de rien jusqu’à une version que les gens peuvent utiliser, seul ou en dirigeant l’équipe.',
        'Chez Agence V0, ça a été jusqu’à 7 designers freelances juniors.'
      ]
    }
  ]
};

function storyIso(x, y, z) {
  return [(x - y) * 0.8660254, (x + y) * 0.5 - z];
}

function storyPoly(points, fill, stroke) {
  const pts = points.map(([x, y, z]) => {
    const [sx, sy] = storyIso(x, y, z);
    return `${sx.toFixed(2)},${sy.toFixed(2)}`;
  }).join(' ');
  return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="1.15" stroke-linejoin="round"/>`;
}

function storyBox(x, y, z, w, d, h, active) {
  const line = active ? 'rgba(77,184,138,.9)' : 'rgba(255,255,255,.3)';
  const front = [[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]];
  const side = [[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]];
  const top = [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]];
  return storyPoly(front, active ? '#12261e' : '#151515', line)
    + storyPoly(side, '#101010', line)
    + storyPoly(top, active ? '#1c3d30' : '#1c1c1c', line);
}

function storyLine(a, b, stroke) {
  const [x1, y1] = storyIso(a[0], a[1], a[2]);
  const [x2, y2] = storyIso(b[0], b[1], b[2]);
  return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="1.2"/>`;
}

function drawStoryFigure(kind, step) {
  if (kind === 'desk') {
    let svg = storyBox(-78, -46, 0, 156, 92, 10, false);
    svg += storyBox(-8, -4, 10, 16, 14, 4, false);
    svg += storyBox(-4, 0, 14, 8, 8, 16, false);
    svg += storyBox(-46, -34, 28, 92, 8, 56, false);
    const padX = 8;
    const padZ = 6;
    const gap = 4;
    const ph = (56 - padZ * 2 - gap * 2) / 3;
    for (let i = 0; i < 3; i += 1) {
      const active = i === step;
      const pz = 28 + padZ + i * (ph + gap);
      const py = -34 + 8 + 0.8;
      svg += storyPoly(
        [[-46 + padX, py, pz], [46 - padX, py, pz], [46 - padX, py, pz + ph], [-46 + padX, py, pz + ph]],
        active ? 'rgba(77,184,138,.5)' : 'rgba(255,255,255,.05)',
        active ? '#4db88a' : 'rgba(255,255,255,.22)'
      );
    }
    svg += storyBox(-30, 10, 10, 60, 20, 3, false);
    return svg;
  }
  if (kind === 'products') {
    let svg = '';
    for (let i = 0; i < 3; i += 1) {
      const active = i === step;
      svg += storyBox(-84 + i * 56, active ? -10 : 0, active ? 8 : 0, 42, 12, active ? 72 : 62, active);
    }
    return svg;
  }
  if (kind === 'workflow') {
    const xs = [-72, -10, 52];
    let svg = '';
    for (let i = 0; i < 2; i += 1) {
      svg += storyLine(
        [xs[i] + 28, 14, 18],
        [xs[i + 1], 14, 18],
        i < step ? '#4db88a' : 'rgba(255,255,255,.32)'
      );
    }
    xs.forEach((x, i) => {
      svg += storyBox(x, 0, 0, 28, 28, 28, i === step);
    });
    return svg;
  }
  if (kind === 'studio') {
    let svg = storyBox(-74, -40, 0, 148, 78, 8, false);
    [[-56, -30], [-8, -30], [36, -30], [-32, 22]].forEach(([x, y], i) => {
      svg += storyBox(x, y, 8, 24, 18, 14, i === step);
    });
    return svg;
  }
  const pieces = [
    [-62, -24, 0, 96, 68, 8],
    [-36, -6, 14, 68, 46, 6],
    [28, 16, 24, 22, 10, 42]
  ];
  return pieces.map((piece, i) => {
    const lift = i === step ? 16 : 0;
    return storyBox(piece[0], piece[1], piece[2] + lift, piece[3], piece[4], piece[5], i === step);
  }).join('');
}

function mountStoryFigures(root) {
  root.querySelectorAll('[data-story-fig]').forEach((figure) => {
    const kind = figure.dataset.storyFig;
    const status = figure.querySelector('[data-story-fig-status]');
    const svg = figure.querySelector('svg');
    const labels = (figure.dataset.storyStatus || '').split('|').filter(Boolean);
    const paint = (step) => {
      const index = ((step % labels.length) + labels.length) % labels.length;
      figure.dataset.storyStep = String(index);
      if (svg) svg.innerHTML = drawStoryFigure(kind, index);
      if (status) status.textContent = labels[index] || '';
    };
    const next = () => paint(Number(figure.dataset.storyStep || 0) + 1);
    paint(0);
    figure.addEventListener('click', (event) => {
      event.stopPropagation();
      next();
    });
    figure.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      next();
    });
  });
}

function renderStoryModalContent() {
  const chapters = STORY_CHAPTERS[currentLang] || STORY_CHAPTERS.en;
  const scroller = document.getElementById('story-modal-scroller');
  const track = document.getElementById('story-modal-track');
  if (!track || !chapters) return;
  const heroTitle = currentLang === 'fr' ? 'Mon parcours' : 'My background';
  const scrollLabel = currentLang === 'fr' ? 'Défiler' : 'Scroll';
  const chaptersLabel = currentLang === 'fr' ? 'Chapitres' : 'Chapters';

  const parallaxHtml = `
    <div class="story-parallax-hero" id="story-parallax-hero">
      <div class="story-parallax-layers" data-parallax-layers>
        <div class="story-parallax-layer" data-parallax-layer="1">
          <video class="story-parallax-layer-img" muted loop playsinline webkit-playsinline preload="none" data-src="../images/video-background.mp4" aria-hidden="true"></video>
        </div>
        <div class="story-parallax-layer" data-parallax-layer="2">
          <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795b4d5ac529e7d3a562_osmo-parallax-layer-2.webp" loading="eager" alt="" class="story-parallax-layer-img" />
        </div>
        <div class="story-parallax-title-wrap" data-parallax-layer="3">
          <h2 class="story-parallax-title">${heroTitle}<em>.</em></h2>
        </div>
        <div class="story-parallax-layer" data-parallax-layer="4">
          <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795bb5aceca85011ad83_osmo-parallax-layer-1.webp" loading="eager" alt="" class="story-parallax-layer-img" />
        </div>
      </div>
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
  `;

  const chaptersHtml = chapters.map((chapter, index) => `
    <section class="story-chapter" id="${chapter.id}">
      <figure class="story-fig" data-story-fig="${chapter.fig}" data-story-status="${chapter.figStatus.join('|')}" tabindex="0" role="button" aria-label="${chapter.figTitle}. ${chapter.figHint}">
        <span class="story-fig-lbl tl">Fig ${index + 1}</span>
        <span class="story-fig-lbl tr">${chapter.figTitle}</span>
        <svg viewBox="-150 -130 300 250" role="img" aria-hidden="true"></svg>
        <span class="story-fig-lbl bl">${chapter.figHint}</span>
        <span class="story-fig-lbl br" data-story-fig-status></span>
      </figure>
      <div class="story-chapter-copy">
        <p class="story-chapter-label">${String(index + 1).padStart(2, '0')} ${chapter.label}</p>
        <h3 class="story-chapter-title">${chapter.title}</h3>
        ${chapter.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('')}
      </div>
    </section>
  `).join('');

  const navHtml = `
    <nav class="story-chapters" aria-label="${chaptersLabel}">
      ${chapters.map((chapter, index) => `
        <button type="button" class="story-chapter-link" data-story-target="${chapter.id}">
          <span>${String(index + 1).padStart(2, '0')}</span>
          ${chapter.label}
        </button>
      `).join('')}
    </nav>
  `;

  const contactHtml = `
    <div class="story-contact-wrap">
      <div class="story-contact-stack">
        <a class="story-contact-email" href="mailto:chilka.v@gmail.com">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="2" y="3.5" width="12" height="9" rx="1.8"></rect>
            <path d="M3.5 5l4.5 3.8L12.5 5"></path>
          </svg>
          <span>chilka.v@gmail.com</span>
        </a>
        <a class="story-contact-btn" href="mailto:chilka.v@gmail.com">
          <span>Contact me</span>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 12L12 4"></path>
            <path d="M6 4h6v6"></path>
          </svg>
        </a>
        <a class="story-contact-btn story-contact-btn--ghost" href="https://calendly.com/chilka-v/30min" target="_blank" rel="noopener noreferrer">
          <span>${currentLang === 'fr' ? 'Réserver 30 min' : 'Book 30 min'}</span>
        </a>
      </div>
    </div>
  `;

  if (scroller) {
    const existingParallax = scroller.querySelector('#story-parallax-hero');
    if (existingParallax) existingParallax.remove();
    track.insertAdjacentHTML('beforebegin', parallaxHtml);
  }

  track.innerHTML = `
    <div class="story-sheet">
      <div class="story-sheet-main">${chaptersHtml}${contactHtml}</div>
      ${navHtml}
    </div>
  `;

  mountStoryFigures(track);
  refreshStoryPrompter();
  refreshStoryParallax();
}

function refreshStoryPrompter() {
  const scroller = document.getElementById('story-modal-scroller');
  if (!scroller) return;

  const chapters = Array.from(scroller.querySelectorAll('.story-chapter'));
  const links = Array.from(scroller.querySelectorAll('.story-chapter-link'));
  if (!chapters.length) return;

  const mark = scroller.getBoundingClientRect().top + Math.min(160, scroller.clientHeight * 0.28);
  let current = chapters[0].id;
  chapters.forEach((chapter) => {
    if (chapter.getBoundingClientRect().top <= mark) current = chapter.id;
  });
  links.forEach((link) => {
    const on = link.dataset.storyTarget === current;
    link.classList.toggle('is-current', on);
    if (on) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
}

function scheduleStoryPrompterRefresh() {
  window.cancelAnimationFrame(storyScrollRaf);
  storyScrollRaf = window.requestAnimationFrame(() => {
    refreshStoryPrompter();
    refreshStoryParallax();
  });
}

const STORY_PARALLAX_LAYERS = [
  { selector: '[data-parallax-layer="1"]', max: 70 },
  { selector: '[data-parallax-layer="2"]', max: 55 },
  { selector: '[data-parallax-layer="3"]', max: 40 },
  { selector: '[data-parallax-layer="4"]', max: 10 }
];

function refreshStoryParallax() {
  const scroller = document.getElementById('story-modal-scroller');
  const hero = document.getElementById('story-parallax-hero');
  if (!scroller || !hero) return;

  const heroHeight = hero.offsetHeight || 1;
  const progress = Math.max(0, Math.min(1, scroller.scrollTop / heroHeight));

  STORY_PARALLAX_LAYERS.forEach(({ selector, max }) => {
    const els = hero.querySelectorAll(selector);
    els.forEach((el) => {
      el.style.transform = `translate3d(0, ${(progress * max).toFixed(2)}%, 0)`;
    });
  });
}

function alignStoryStartToFocus() {
  const scroller = document.getElementById('story-modal-scroller');
  const firstLine = scroller?.querySelector('.story-line');
  if (!scroller || !firstLine) return;

  const focusY = scroller.clientHeight * 0.46;
  const targetScrollTop = Math.max(
    0,
    firstLine.offsetTop + (firstLine.offsetHeight / 2) - focusY
  );

  scroller.scrollTop = targetScrollTop;
}

function updateStoryScrollCue() {
  const scroller = document.getElementById('story-modal-scroller');
  const cue = document.getElementById('story-scroll-cue');
  if (!scroller || !cue) return;

  cue.classList.toggle('hidden', scroller.scrollTop > 24);
}

function scrollStoryDown() {
  const scroller = document.getElementById('story-modal-scroller');
  const target = scroller?.querySelector('.story-chapter');
  if (!scroller || !target) return;
  const nav = scroller.querySelector('.story-chapters');
  const bar = nav && getComputedStyle(nav).flexDirection === 'row';
  const offset = bar ? nav.getBoundingClientRect().height + 16 : 24;
  const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - offset;
  scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function openStoryModal() {
  const modal = document.getElementById('story-modal');
  const scroller = document.getElementById('story-modal-scroller');
  if (!modal || !scroller) return;

  renderStoryModalContent();
  modal.classList.add('open');
  // Lazy-start the background video only when the modal actually opens
  const storyVideo = modal.querySelector('video[data-src]');
  if (storyVideo && !storyVideo.src) {
    storyVideo.src = storyVideo.dataset.src;
    storyVideo.play().catch(() => {});
  } else if (storyVideo) {
    storyVideo.play().catch(() => {});
  }
  scroller.scrollTop = 0;
  syncPageLock();
  updateStoryScrollCue();
  refreshStoryParallax();
  window.setTimeout(() => {
    refreshStoryPrompter();
    refreshStoryParallax();
  }, 40);
}

function closeStoryModal() {
  const modal = document.getElementById('story-modal');
  if (!modal) return;

  modal.classList.remove('open');
  const storyVideo = modal.querySelector('video[data-src]');
  if (storyVideo) {
    try { storyVideo.pause(); } catch {}
    storyVideo.removeAttribute('src');
    try { storyVideo.load(); } catch {}
  }
  syncPageLock();
}

document.getElementById('story-modal-scroller').addEventListener('scroll', () => {
  scheduleStoryPrompterRefresh();
  updateStoryScrollCue();
}, { passive: true });
document.getElementById('story-modal-scroller').addEventListener('click', (event) => {
  if (event.target.closest('#story-scroll-cue')) {
    event.preventDefault();
    scrollStoryDown();
    return;
  }
  const link = event.target.closest('.story-chapter-link');
  if (!link) return;
  event.preventDefault();
  event.stopPropagation();
  const scroller = document.getElementById('story-modal-scroller');
  const target = document.getElementById(link.dataset.storyTarget || '');
  if (!scroller || !target) return;
  const nav = scroller.querySelector('.story-chapters');
  const bar = nav && getComputedStyle(nav).flexDirection === 'row';
  const offset = bar ? nav.getBoundingClientRect().height + 16 : 24;
  const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - offset;
  scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
});
document.getElementById('story-modal').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeStoryModal();
});

/* ═══════════════════════════════════════════
   INTERFACE SHOWCASE DATA
═══════════════════════════════════════════ */
const INTERFACES = [
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
    thumb: 'covers/iface-viora-health.jpg',
    url: 'viora.health/overview',
    src: 'interfaces/viora-health.html'
  },
  {
    id: 'remoterecruit-redesign',
    name: 'RemoteRecruit — Employer Browse',
    tag: 'Recruitment · Audit Response · Light',
    type: 'desktop',
    thumb: 'covers/iface-remoterecruit-redesign.jpg',
    url: 'remoterecruit.com/employer-search',
    src: 'interfaces/remoterecruit-redesign.html'
  },
  {
    id: 'linkedin-jobs-playground',
    name: 'LinkedIn Jobs — Search Redesign',
    tag: 'Recruitment · Jobs · Light',
    type: 'desktop',
    thumb: 'covers/iface-linkedin-jobs-playground.webp',
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
function renderIfaceGrid() {
  const el = document.getElementById('ifaces-grid-el');
  if (!el) return;
  el.innerHTML = INTERFACES.filter(iface => !iface.hidden).map(iface => `
    <div class="iface-card" onclick="openIfaceModal('${iface.id}')" title="${escapeHTML(iface.name)}">
      ${iface.thumb
        ? `<img class="iface-card-thumb" src="${iface.thumb}" alt="${escapeHTML(iface.name)}" loading="lazy" decoding="async">`
        : `<div class="iface-card-thumb--empty"><span class="iface-card-initials">${escapeHTML(getIfaceInitials(iface.name))}</span></div>`
      }
      <div class="iface-card-open">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9"/><polyline points="10 1 15 1 15 6"/><line x1="15" y1="1" x2="7" y2="9"/></svg>
      </div>
      <div class="iface-card-overlay">
        <div class="iface-card-name">${escapeHTML(iface.name)}</div>
        <div class="iface-card-tag">${escapeHTML(iface.tag)}</div>
      </div>
    </div>`).join('');
  
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
  
  if (isCollapsed) {
    const overlap = 140; // Must match the negative margin-top in CSS
    const padding = 60; // Total vertical padding (30px top + 30px bottom)
    const h = Math.ceil((cardHeight * IFACE_COLLAPSED_ROWS) + (gap * (IFACE_COLLAPSED_ROWS - 1)) - (overlap * (IFACE_COLLAPSED_ROWS - 1)) + padding);
    limiter.style.maxHeight = h + 'px';
  } else {
    limiter.style.maxHeight = grid.scrollHeight + 'px';
  }
  const labelKey = isCollapsed ? 'show_all' : 'show_fewer';
  label.textContent = (typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][labelKey])
    || (isCollapsed ? 'Show all interfaces' : 'Show fewer interfaces');

  const columns = Math.max(1, getIfaceColumnCount(grid));
  const shouldCollapse = INTERFACES.length > columns * IFACE_COLLAPSED_ROWS;
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

function getIfaceSharePath(iface) {
  return '/portfolio/layout-' + iface.id;
}

function getIfaceFromLocation(pathname = window.location.pathname) {
  const match = pathname.match(/^\/portfolio\/layout-([a-z0-9-]+)$/i);
  if (!match) return null;
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
  if (state === 'copied') return fr ? 'Copié' : 'Copied';
  if (state === 'failed') return fr ? 'Échec' : 'Copy failed';
  return fr ? 'Copier l’URL' : 'Copy URL';
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
    try {
      await navigator.clipboard.writeText(href);
      copyBtn.textContent = copyUrlLabel('copied');
      window.setTimeout(() => { copyBtn.textContent = copyUrlLabel(); }, 1200);
    } catch {
      copyBtn.textContent = copyUrlLabel('failed');
      window.setTimeout(() => { copyBtn.textContent = copyUrlLabel(); }, 1200);
    }
  };
}

function openIfaceModal(id) {
  const iface = INTERFACES.find(x => x.id === id);
  const options = arguments[1] || {};
  if (!iface) return;
  const modal = document.getElementById('iface-modal');

  const isMobile = iface.type === 'mobile';
  modal.classList.toggle('mobile', isMobile);
  setModalUrl(getAbsolutePreviewUrl(getIfaceSharePath(iface)));

  if (options.updateHistory !== false) {
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
}

function closeIfaceModal() {
  const options = arguments[0] || {};
  document.getElementById('iface-modal').classList.remove('open', 'mobile', 'two-screens');
  document.getElementById('iface-modal-frame').src = 'about:blank';
  document.getElementById('iface-phones-row').innerHTML = '';
  setModalUrl('');
  if (options.updateHistory !== false && window.location.pathname.startsWith('/portfolio/layout-')) {
    window.history.pushState({}, '', '/portfolio');
  }
  syncPageLock();
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
document.getElementById('iface-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeIfaceModal();
});
window.addEventListener('popstate', () => {
  if (!window.location.pathname.startsWith('/portfolio/layout-')) {
    closeStoryModal();
  }
  const iface = getIfaceFromLocation();
  if (iface) {
    openIfaceModal(iface.id, { updateHistory: false });
  } else {
    closeIfaceModal({ updateHistory: false });
  }
});
