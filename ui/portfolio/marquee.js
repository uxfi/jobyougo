/* Perspective marquee */
(function initPerspectiveMarquee() {
  const track = document.getElementById('marquee-track');
  if (!track) return;

  const items = [
    "UpViral", "Louis Vuitton", "BMW", "EdenRed", 
    "Shiseido", "Société Générale", "Renault", "Casino", 
    "GALIAN", "SNCF", "Marcel / Publicis", "France Télévisions"
  ];
  
  const FONT_SIZE = 84;
  const ITEM_PADDING = FONT_SIZE * 0.9;
  const PIXELS_PER_FRAME = 1.2;
  
  const rendered = [...items, ...items, ...items];
  
  rendered.forEach(text => {
    const span = document.createElement('span');
    span.className = 'marquee-item';
    span.textContent = text;
    span.style.paddingRight = ITEM_PADDING + 'px';
    track.appendChild(span);
  });

  const itemElements = track.querySelectorAll('.marquee-item');
  let itemData = [];
  let singleSetWidth = 0;
  let viewportHalfWidth = window.innerWidth / 2;
  let frame = 0;
  let isVisible = false;
  let rafId = null;

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

  function animate() {
    if (!isVisible) {
      rafId = null;
      return;
    }
    frame++;
    const sWidth = parseFloat(track.dataset.singleWidth);
    const tLeft = parseFloat(track.dataset.trackLeft);
    
    // Invert direction: (frame % sWidth) - sWidth moves Left to Right
    const scrollPos = ((frame * PIXELS_PER_FRAME) % sWidth) - sWidth;
    track.style.transform = `rotateX(8deg) rotateY(28deg) translateX(${scrollPos}px)`;

    for (let i = 0; i < itemData.length; i++) {
      const { el, width, offset } = itemData[i];
      
      const itemCenterOnScreen = tLeft + offset + (width / 2) + scrollPos;
      const norm = (itemCenterOnScreen - viewportHalfWidth) / viewportHalfWidth;
      const dist = Math.abs(norm);

      let blurAmount = 0;
      let opacityAmount = 1;

      if (dist > 0.6) {
        const factor = Math.min(1, (dist - 0.6) / 0.4);
        blurAmount = factor * 4;
        opacityAmount = 1 - (factor * 0.4);
      }

      el.style.filter = `blur(${blurAmount.toFixed(1)}px)`;
      el.style.opacity = opacityAmount.toFixed(2);
    }
    rafId = requestAnimationFrame(animate);
  }

  const observer = new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting;
    if (isVisible) {
      if (!rafId) rafId = requestAnimationFrame(animate);
    } else {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }
  }, { rootMargin: '100px' });

  function start() {
    calculateMetrics();
    observer.observe(track.parentElement);
    window.addEventListener('resize', calculateMetrics);
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

  window.openContactModal = function() {
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  };

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
    const originalText = btn.textContent;
    btn.textContent = 'Opening email app...';
    btn.disabled = true;
    
    const name = document.getElementById('contact-name').value;
    const email = document.getElementById('contact-email').value;
    const message = document.getElementById('contact-message').value;
    
    // Direct mailto link as requested, but also could be an API call
    const subject = `Portfolio Contact from ${name}`;
    const body = `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`;
    
    // Simulate a bit of delay for effect
    setTimeout(() => {
      window.location.href = `mailto:chilka.v@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      btn.textContent = 'Send your message from your email app';
      setTimeout(() => {
        btn.textContent = originalText;
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
