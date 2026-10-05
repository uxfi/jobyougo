import { dish, keyboard, laptop, riffle } from '@lucasmarkes/hairline';

const figures = { dish, keyboard, laptop, riffle };

type FigureName = keyof typeof figures;

function mountLandingFigures() {
  document.querySelectorAll<HTMLElement>('[data-hairline]').forEach((el) => {
    const name = el.dataset.hairline as FigureName;
    const draw = figures[name];
    if (!draw) return;
    const raw = el.dataset.intensity;
    const intensity = raw == null || raw === '' ? 0.55 : Number(raw);
    draw(el, {
      theme: 'dark',
      intensity: Number.isFinite(intensity) ? intensity : 0.55,
      label: el.getAttribute('aria-label') || undefined,
    });
  });
}

mountLandingFigures();
