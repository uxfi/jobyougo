import { createElement, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThinkingOrb } from 'thinking-orbs';
import { BorderBeam } from 'border-beam';
import { BotAvatar } from 'bot-avatars';
import { MetalText } from 'metal-fx';

type OrbState =
  | 'working'
  | 'searching'
  | 'solving'
  | 'listening'
  | 'connecting'
  | 'composing'
  | 'breathing'
  | 'weaving'
  | 'shaping';

type AgentBusy = {
  active: boolean;
  state?: OrbState;
  label?: string;
};

type StoreListener = () => void;

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<StoreListener>();
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener: StoreListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useStore<T>(store: ReturnType<typeof createStore<T>>): T {
  const [value, setValue] = useState(store.get);
  useEffect(() => store.subscribe(() => setValue(store.get())), [store]);
  return value;
}

const roots = new WeakMap<Element, Root>();

function ensureRoot(el: Element): Root {
  let root = roots.get(el);
  if (!root) {
    root = createRoot(el);
    roots.set(el, root);
  }
  return root;
}

function renderInto(el: Element, node: ReactNode) {
  ensureRoot(el).render(node);
}

/* ─── Cmd dock status (Career Ops dashboard) ───────────────────────── */

const cmdBusy = createStore<AgentBusy>({ active: false, state: 'working', label: '' });

function CmdStatusIsland() {
  const busy = useStore(cmdBusy);
  if (!busy.active) {
    return busy.label
      ? createElement('span', null, busy.label)
      : null;
  }
  return createElement(
    'span',
    {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
      },
    },
    createElement(ThinkingOrb, {
      state: busy.state || 'working',
      size: 20,
      theme: 'dark',
    }),
    createElement(
      'span',
      {
        style: {
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      },
      busy.label || 'Working…',
    ),
  );
}

export function mountCmdStatus(el: Element) {
  renderInto(el, createElement(CmdStatusIsland));
}

export function setCmdBusy(next: AgentBusy) {
  cmdBusy.set({
    active: Boolean(next.active),
    state: next.state || 'working',
    label: next.label || '',
  });
}

/* ─── Jarvos / HRHV chat (portfolio) ───────────────────────────────── */

const hrhvBusy = createStore(false);

function HrhvAvatarIsland() {
  const busy = useStore(hrhvBusy);
  return createElement(BotAvatar, {
    type: 'mech',
    state: busy ? 'working' : 'default',
    size: 32,
  });
}

function HrhvTypingIsland() {
  return createElement(
    'span',
    {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      },
      'aria-label': 'Jarvos is thinking',
    },
    createElement(ThinkingOrb, {
      state: 'breathing',
      size: 20,
      theme: 'light',
    }),
    createElement('span', { style: { fontSize: 12, color: 'rgba(12,11,9,.55)' } }, 'Thinking…'),
  );
}

type BeamProps = { children: ReactNode; active: boolean };

function HrhvInputBeam({ children, active }: BeamProps) {
  return createElement(
    BorderBeam,
    {
      size: 'md',
      colorVariant: 'ocean',
      theme: 'light',
      active,
      style: { display: 'block', width: '100%', borderRadius: 10 },
    },
    children,
  );
}

function DomSlot({ element }: { element: HTMLElement }) {
  return createElement('div', {
    ref: (node: HTMLDivElement | null) => {
      if (!node || node.contains(element)) return;
      node.appendChild(element);
    },
    style: {
      width: '100%',
      borderRadius: 10,
      background: '#f8f7f4',
    },
  });
}

function HrhvInputIsland({ host }: { host: HTMLElement }) {
  const busy = useStore(hrhvBusy);
  return createElement(HrhvInputBeam, { active: busy }, createElement(DomSlot, { element: host }));
}

export function mountHrhv(opts: {
  avatarEl: Element;
  inputEl: HTMLElement;
}) {
  const avatarHost = document.createElement('div');
  avatarHost.style.cssText = 'display:flex;align-items:center;justify-content:center;width:32px;height:32px';
  opts.avatarEl.replaceChildren(avatarHost);
  (opts.avatarEl as HTMLElement).style.background = 'transparent';
  (opts.avatarEl as HTMLElement).style.boxShadow = 'none';
  (opts.avatarEl as HTMLElement).style.animation = 'none';
  renderInto(avatarHost, createElement(HrhvAvatarIsland));

  const beamHost = document.createElement('div');
  beamHost.style.cssText = 'flex:1;min-width:0';
  opts.inputEl.parentNode?.insertBefore(beamHost, opts.inputEl);
  renderInto(beamHost, createElement(HrhvInputIsland, { host: opts.inputEl }));
}

export function setHrhvBusy(active: boolean) {
  hrhvBusy.set(Boolean(active));
}

export function mountTypingOrb(el: Element) {
  renderInto(el, createElement(HrhvTypingIsland));
}

export function unmount(el: Element) {
  const root = roots.get(el);
  if (root) {
    root.unmount();
    roots.delete(el);
  }
}

/* ─── Metal headline (dashboard) ───────────────────────────────────── */

const metalText = createStore({ text: '', font: '', color: '' });

function MetalHeroIsland() {
  const value = useStore(metalText);
  if (!value.text) return null;
  return createElement(MetalText, {
    font: value.font,
    color: value.color,
    strength: 0.9,
    children: value.text,
  });
}

export function mountMetalHero(
  el: Element,
  opts: { text: string; font: string; color: string },
) {
  metalText.set(opts);
  renderInto(el, createElement(MetalHeroIsland));
}

export function setMetalHeroText(text: string) {
  const prev = metalText.get();
  metalText.set({ ...prev, text });
}
