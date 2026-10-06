import {
  branches, cabinet, dish, elevator, exploded, keyboard, laptop, lockers,
  padlock, patch, phone, phosphor, riffle, router, slow, terminal, terrain, turntable, vault,
} from '@lucasmarkes/hairline';

const figures = {
  branches, cabinet, dish, elevator, exploded, keyboard, laptop, lockers,
  padlock, patch, phone, phosphor, riffle, router, slow, terminal, terrain, turntable, vault,
};

type FigureName = keyof typeof figures;

function mountHairlines(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-hairline]').forEach((el) => {
    if (el.querySelector('svg')) return;
    const name = el.dataset.hairline as FigureName;
    const draw = figures[name];
    if (!draw) return;
    const raw = el.dataset.intensity;
    const intensity = raw == null || raw === '' ? 0.55 : Number(raw);
    const theme = el.dataset.theme === 'light' || el.dataset.theme === 'dark' ? el.dataset.theme : 'dark';
    draw(el, {
      theme,
      intensity: Number.isFinite(intensity) ? intensity : 0.55,
      label: el.getAttribute('aria-label') || undefined,
    });
  });
}

mountHairlines();
window.mountHairlines = mountHairlines;
