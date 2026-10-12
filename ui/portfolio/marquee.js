/* Perspective marquee */
(function initPerspectiveMarquee() {
  const track = document.getElementById('marquee-track');
  if (!track) return;

  // Host page (window.SITE.marqueeExclude): drop each logo whose file path or alt contains one of
  // the substrings, case-insensitive. Without SITE the list is returned as is.
  function marqueeSiteFilter(list) {
    const site = window.SITE && typeof window.SITE === 'object' ? window.SITE : null;
    const exclude = site && Array.isArray(site.marqueeExclude)
      ? site.marqueeExclude.filter(s => typeof s === 'string' && s).map(s => s.toLowerCase())
      : [];
    if (!exclude.length) return list;
    return list.filter(item => !exclude.some(s =>
      item.src.toLowerCase().includes(s) || item.alt.toLowerCase().includes(s)));
  }

  const items = marqueeSiteFilter([
    { alt: 'UpViral', src: '../images/marquee-white/upviral.png' },
    { alt: 'LVMH', src: '../images/marquee-white/lvmh.png' },
    { alt: 'BMW', src: '../images/marquee-white/bmw.svg' },
    { alt: 'Edenred', src: '../images/marquee-white/edenred.png' },
    { alt: 'Shiseido', src: '../images/marquee-white/shisideo.png' },
    { alt: 'Société Générale', src: '../images/marquee-white/societegenerale.png' },
    { alt: 'Renault', src: '../images/marquee-white/renault.png' },
    { alt: 'Casino', src: '../images/marquee-white/casino.png' },
    { alt: 'GALIAN', src: '../images/marquee-white/galian.png' },
    { alt: 'SNCF', src: '../images/marquee-white/sncf.png' },
    { alt: 'Publicis', src: '../images/marquee-white/publicis.png' },
    { alt: 'France Télévisions', src: '../images/marquee-white/francetv.png' },
  ]);

  const ITEM_PADDING = 72;
  const PIXELS_PER_FRAME = 1.2;

  const rendered = [...items, ...items, ...items];

  rendered.forEach(item => {
    const span = document.createElement('span');
    span.className = 'marquee-item';
    span.style.paddingRight = ITEM_PADDING + 'px';
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = item.alt;
    img.draggable = false;
    span.appendChild(img);
    track.appendChild(span);
  });

  const itemElements = track.querySelectorAll('.marquee-item');
  let itemData = [];
  let singleSetWidth = 0;
  let viewportHalfWidth = window.innerWidth / 2;
  let frame = 0;
  let isVisible = false;
  let hovered = false;
  let rafId = null;
  const hoverZone = track.closest('.hero-divider-band') || track.parentElement;

  function calculateMetrics() {
    itemData = [];
    let acc = 0;
    itemElements.forEach((el, i) => {
      const w = el.offsetWidth;
      itemData.push({ el, width: w, offset: acc });
      acc += w;
    });
    singleSetWidth = 0;
    for(let i=0; i<items.length; i++) {
      if (itemData[i]) singleSetWidth += itemData[i].width;
    }
    const totalTrackWidth = itemData.reduce((a, b) => a + b.width, 0);
    const viewWidth = window.innerWidth;
    const trackLeftOnScreen = (viewWidth / 2) - (totalTrackWidth / 2);
    
    viewportHalfWidth = viewWidth / 2;
    // Store these on the track for the animate function
    track.dataset.singleWidth = singleSetWidth;
    track.dataset.trackLeft = trackLeftOnScreen;
  }

  function paint() {
    const sWidth = parseFloat(track.dataset.singleWidth);
    if (!sWidth) return;
    const scrollPos = ((frame * PIXELS_PER_FRAME) % sWidth) - sWidth;
    track.style.transform = `rotateX(8deg) rotateY(28deg) translateX(${scrollPos}px)`;
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    paint();
  }

  function animate() {
    if (!isVisible || !hovered) {
      rafId = null;
      return;
    }
    frame++;
    paint();
    rafId = requestAnimationFrame(animate);
  }

  function play() {
    if (!isVisible || !hovered || rafId) return;
    // Host page (window.SITE): honour reduced motion; /portfolio keeps its behaviour.
    if (window.SITE && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    rafId = requestAnimationFrame(animate);
  }

  const observer = new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting;
    if (isVisible && hovered) play();
    else stop();
  }, { rootMargin: '100px' });

  hoverZone.addEventListener('pointerenter', () => {
    hovered = true;
    play();
  });
  hoverZone.addEventListener('pointerleave', () => {
    hovered = false;
    stop();
  });

  function whenImagesReady(cb) {
    const imgs = [...track.querySelectorAll('img')];
    let pending = imgs.length;
    if (!pending) { cb(); return; }
    const done = () => { if (--pending === 0) cb(); };
    imgs.forEach(img => {
      if (img.complete) done();
      else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }
    });
  }

  function start() {
    whenImagesReady(() => {
      calculateMetrics();
      paint(false);
      observer.observe(track.parentElement);
      window.addEventListener('resize', () => {
        calculateMetrics();
        if (!rafId) paint(false);
      });
    });
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();

/** ── CONTACT MODAL LOGIC ── **/
(function() {
  const modal = document.getElementById('contact-modal');
  const chars = {
    purple: document.getElementById('char-purple'),
    black: document.getElementById('char-black'),
    orange: document.getElementById('char-orange'),
    yellow: document.getElementById('char-yellow')
  };
  
  let isTyping = false;
  let mouseX = 0;
  let mouseY = 0;

  // opts: optional {offer: 'refonte'|'creation'|'accompagnement'|...}. On a host page
  // (window.SITE) the offer id may also be passed as a plain string: openContactModal('refonte').
  // Anything else (an Event from an inline handler, a string without SITE) is ignored.
  window.openContactModal = function(opts) {
    const isPlain = opts && Object.prototype.toString.call(opts) === '[object Object]';
    let offer = isPlain && typeof opts.offer === 'string' ? opts.offer : '';
    const hasSite = !!(window.SITE && typeof window.SITE === 'object');
    if (!offer && hasSite && typeof opts === 'string') offer = opts;
    if (offer) modal.dataset.offer = offer;
    else delete modal.dataset.offer;
    const offerSelect = modal.querySelector('#contact-offer');
    if (offerSelect) offerSelect.value = offer;
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  };
  // A visitor who changes the offer select by hand overrides the offer the modal was opened with
  // (including a reset to the empty placeholder).
  modal.querySelector('#contact-offer')?.addEventListener('change', () => {
    delete modal.dataset.offer;
  });

  window.closeContactModal = function() {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  };

  window.setTyping = function(typing) {
    isTyping = typing;
    Object.values(chars).forEach(c => {
      if (typing) c.classList.add('is-typing');
      else c.classList.remove('is-typing');
    });
  };

  window.setFocused = function(focused) {
    Object.values(chars).forEach(c => {
      if (focused) c.classList.add('is-focused');
      else c.classList.remove('is-focused');
    });
  };

  const contactInputs = modal.querySelectorAll('.contact-form-input');
  window.checkTyping = function() {
    const hasValue = Array.from(contactInputs).some(input => input.value.trim().length > 0);
    setTyping(hasValue);
  };

  window.handleContactSubmit = function(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    // Host page (window.SITE): write into the label span so its data-i18n and the ripple span survive.
    const btnLabel = (window.SITE && typeof window.SITE === 'object' && btn.querySelector('.btn-text')) || btn;
    const originalText = btnLabel.textContent;
    const lang = typeof currentLang === 'string' ? currentLang : 'en';
    const dict = (typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS && TRANSLATIONS[lang]) || {};
    btnLabel.textContent = dict.contact_sending !== undefined ? dict.contact_sending : 'Opening email app...';
    btn.disabled = true;

    const name = document.getElementById('contact-name').value;
    const email = document.getElementById('contact-email').value;
    const message = document.getElementById('contact-message').value;

    // Optional offer picked on a host page (window.SITE): #contact-offer select, else the
    // offer passed to openContactModal({offer}).
    const site = window.SITE && typeof window.SITE === 'object' ? window.SITE : null;
    const contactCfg = site && site.contact ? site.contact : null;
    const recipient = (contactCfg && typeof contactCfg.email === 'string' && contactCfg.email) || 'chilka.v@gmail.com';
    const offerSelect = modal.querySelector('#contact-offer');
    // dataset.offer survives when the select has no option for it (e.g. {offer:'audit'}).
    const offer = (offerSelect && offerSelect.value) || modal.dataset.offer || '';
    let offerLabel = '';
    if (offerSelect && offerSelect.value && offerSelect.selectedIndex >= 0) {
      offerLabel = (offerSelect.options[offerSelect.selectedIndex].text || '').trim();
    }
    if (offer && !offerLabel) offerLabel = offer;
    // Optional <input id="contact-link"> on a host page. '' when the modal has none (/portfolio).
    const linkInput = modal.querySelector('#contact-link');
    const link = linkInput ? String(linkInput.value || '').trim() : '';

    // Direct mailto link as requested, but also could be an API call
    let subject = `Portfolio Contact from ${name}`;
    if (contactCfg && typeof contactCfg.subject === 'function') {
      try {
        const custom = contactCfg.subject({ name, offer, offerLabel, link, lang });
        if (typeof custom === 'string' && custom) subject = custom;
      } catch (err) {
        console.error('SITE.contact.subject failed', err);
      }
    }
    const offerLine = offer ? `Offer: ${offerLabel}\n` : '';
    const linkLine = link ? `Link: ${link}\n` : '';
    let body = `Name: ${name}\nEmail: ${email}\n${offerLine}${linkLine}\nMessage:\n${message}`;
    if (contactCfg && typeof contactCfg.body === 'function') {
      try {
        const custom = contactCfg.body({ name, email, link, message, offer, offerLabel, lang });
        if (typeof custom === 'string' && custom) body = custom;
      } catch (err) {
        console.error('SITE.contact.body failed', err);
      }
    }

    // Simulate a bit of delay for effect
    setTimeout(() => {
      window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      btnLabel.textContent = dict.contact_sent !== undefined ? dict.contact_sent : 'Send your message from your email app';
      setTimeout(() => {
        btnLabel.textContent = originalText;
        btn.disabled = false;
        closeContactModal();
      }, 2000);
    }, 800);
  };

  // Tracking and Animations
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    updateEyes();
  });

  function updateEyes() {
    if (!modal.classList.contains('is-open')) return;
    
    Object.keys(chars).forEach(key => {
      const char = chars[key];
      const rect = char.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 3;
      
      const dx = mouseX - centerX;
      const dy = mouseY - centerY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      // Face Skew/Shift
      const faceX = Math.max(-15, Math.min(15, dx / 40));
      const faceY = Math.max(-10, Math.min(10, dy / 60));
      
      const eyesWrap = char.querySelector('.char-eyes');
      if (eyesWrap) {
        const baseLeft = parseInt(eyesWrap.style.left);
        const baseTop = parseInt(eyesWrap.style.top);
        eyesWrap.style.transform = `translate(${faceX}px, ${faceY}px)`;
      }
      
      // Pupils tracking
      const pupils = char.querySelectorAll('.pupil');
      pupils.forEach(p => {
        const pMax = key === 'orange' || key === 'yellow' ? 6 : 4;
        const px = Math.max(-pMax, Math.min(pMax, dx / 20));
        const py = Math.max(-pMax, Math.min(pMax, dy / 30));
        p.style.transform = `translate(${px}px, ${py}px)`;
      });
    });
  }

  // Blinking logic
  function blink() {
    const blinkers = modal.querySelectorAll('.eye-white');
    blinkers.forEach(eye => {
      if (Math.random() > 0.7) {
        eye.style.height = '1px';
        setTimeout(() => {
          eye.style.height = '';
        }, 120);
      }
    });
    setTimeout(blink, 2000 + Math.random() * 3000);
  }
  blink();
  
  // Random Peek for Purple
  function peek() {
    if (isTyping && Math.random() > 0.5) {
      chars.purple.classList.add('is-peeking');
      setTimeout(() => {
        chars.purple.classList.remove('is-peeking');
      }, 1000);
    }
    setTimeout(peek, 3000 + Math.random() * 4000);
  }
  peek();

  // Contact Button Ripple
  function initContactRipple() {
    const btn = document.getElementById('ripple-btn-contact');
    const ripple = document.getElementById('ripple-span-contact');
    if (!btn || !ripple) return;

    btn.addEventListener('mouseenter', (e) => {
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.style.transition = 'transform 600ms ease-out';
      ripple.style.transform = `translate(-50%, -50%) scale(1)`;
    });

    btn.addEventListener('mouseleave', () => {
      ripple.style.transition = 'transform 600ms ease-in';
      ripple.style.transform = `translate(-50%, -50%) scale(0)`;
    });
  }
  initContactRipple();
})();
