/* Lazy-load project videos: mount src only when visible */
(function () {
  let io = null;

  function ensureIo() {
    if (io || !('IntersectionObserver' in window)) return io;
    io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const el = entry.target;
        if (!(el instanceof HTMLVideoElement)) return;
        if (entry.isIntersecting) activate(el);
        else deactivate(el);
      });
    }, { rootMargin: '120px', threshold: 0.15 });
    return io;
  }

  function activate(video) {
    const src = video.dataset.src;
    if (src && video.getAttribute('src') !== src) video.src = src;
    const play = video.play?.();
    if (play && typeof play.catch === 'function') play.catch(() => {});
  }

  function deactivate(video) {
    if (!video.getAttribute('src') && !video.src) return;
    try { video.pause(); } catch {}
    video.removeAttribute('src');
    try { video.load(); } catch {}
  }

  function observeLazyVideos(root = document) {
    const scope = root?.querySelectorAll ? root : document;
    const videos = scope.querySelectorAll('video.js-lazy-video[data-src]');
    const observer = ensureIo();
    videos.forEach((video) => {
      if (observer) observer.observe(video);
      else activate(video);
    });
  }

  function disconnectLazyVideos(root = document) {
    const scope = root?.querySelectorAll ? root : document;
    scope.querySelectorAll('video.js-lazy-video').forEach((video) => {
      io?.unobserve(video);
      deactivate(video);
    });
  }

  window.observeLazyVideos = observeLazyVideos;
  window.disconnectLazyVideos = disconnectLazyVideos;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      document.querySelectorAll('video.js-lazy-video').forEach((v) => {
        try { v.pause(); } catch {}
      });
    }
  });
})();
