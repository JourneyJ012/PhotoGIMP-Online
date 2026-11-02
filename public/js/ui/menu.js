// Menu bar, dropdowns and context menus.
//
// Items are '-' (separator), an action id (string, see commands.js),
// {label, items: [...]} for a submenu, or {label, run, disabled, checked, shortcut}.

import { el } from '../util.js';
import { icon } from '../icons.js';

let resolveAction = () => null;
let openState = null; // {bar, index, stack: [menuEl]}

export function setActionResolver(fn) { resolveAction = fn; }

export const menuOpen = () => !!openState;

function itemInfo(item) {
  if (typeof item === 'string') {
    const a = resolveAction(item);
    if (!a) return null;
    return {
      label: typeof a.label === 'function' ? a.label() : a.label,
      run: a.run,
      disabled: a.enabled ? !a.enabled() : false,
      checked: a.checked ? a.checked() : undefined,
      shortcut: a.keys?.[0],
    };
  }
  return item;
}

export const prettyKey = (k) => {
  if (!k) return '';
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  return k.split('+').map((p) => {
    if (mac) return { Ctrl: '⌘', Alt: '⌥', Shift: '⇧', Backspace: '⌫', Delete: '⌦', Enter: '↩', Escape: 'Esc' }[p] ?? p;
    return p;
  }).join(mac ? '' : '+');
};

function buildList(items, onRun, depth = 0) {
  const ul = el('div', { class: 'menu', role: 'menu' });
  for (const raw of items) {
    if (raw === '-') { ul.append(el('div', { class: 'menu-sep', role: 'separator' })); continue; }
    const it = itemInfo(raw);
    if (!it) continue;
    const hasSub = Array.isArray(it.items);
    const row = el('div', {
      class: `menu-item${it.disabled ? ' disabled' : ''}${hasSub ? ' has-sub' : ''}`,
      role: 'menuitem', tabindex: -1, 'aria-disabled': it.disabled ? 'true' : null,
    },
    el('span', { class: 'menu-check', html: it.checked ? icon('check', 14) : '' }),
    el('span', { class: 'menu-label' }, it.label),
    el('span', { class: 'menu-key' }, hasSub ? '' : prettyKey(it.shortcut)),
    hasSub ? el('span', { class: 'menu-arrow', html: icon('chevron-right', 14) }) : null);
    if (hasSub) {
      let sub = null;
      const openSub = () => {
        closeSubsAbove(depth);
        sub = buildList(it.items, onRun, depth + 1);
        document.getElementById('menus').append(sub);
        const r = row.getBoundingClientRect();
        placeMenu(sub, r.right - 2, r.top - 4, r.left);
        openState?.stack.splice(depth + 1, Infinity, sub);
      };
      row.addEventListener('pointerenter', openSub);
      row.addEventListener('click', openSub);
    } else {
      row.addEventListener('pointerenter', () => closeSubsAbove(depth));
      row.addEventListener('click', () => {
        if (it.disabled) return;
        closeMenus();
        onRun(it);
      });
    }
    ul.append(row);
  }
  return ul;
}

function closeSubsAbove(depth) {
  if (!openState) return;
  const extra = openState.stack.splice(depth + 1);
  extra.forEach((m) => m.remove());
}

function placeMenu(menu, x, y, altX) {
  menu.style.left = '0px';
  menu.style.top = '0px';
  const r = menu.getBoundingClientRect();
  let left = x, top = y;
  if (left + r.width > innerWidth - 4) left = altX != null ? altX - r.width + 2 : innerWidth - r.width - 4;
  if (top + r.height > innerHeight - 4) top = Math.max(4, innerHeight - r.height - 4);
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${top}px`;
}

export function closeMenus() {
  if (!openState) return;
  openState.stack.forEach((m) => m.remove());
  openState.bar?.querySelectorAll('.menu-title.open').forEach((t) => t.classList.remove('open'));
  openState = null;
  document.removeEventListener('pointerdown', outside, true);
}

function outside(e) {
  if (e.target.closest?.('.menu') || e.target.closest?.('.menu-title')) return;
  closeMenus();
}

const runItem = (it) => { try { it.run?.(); } catch (err) { console.error(err); } };

export function buildMenubar(bar, menus) {
  menus.forEach((m, i) => {
    const t = el('div', { class: 'menu-title', role: 'menuitem', tabindex: -1, 'aria-haspopup': 'true' }, m.label);
    const open = () => {
      closeMenus();
      const list = buildList(m.items, runItem);
      document.getElementById('menus').append(list);
      const r = t.getBoundingClientRect();
      placeMenu(list, r.left, r.bottom);
      t.classList.add('open');
      openState = { bar, index: i, stack: [list] };
      document.addEventListener('pointerdown', outside, true);
    };
    t.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (openState?.index === i) closeMenus(); else open();
    });
    t.addEventListener('pointerenter', () => { if (openState && openState.index !== i && openState.bar) open(); });
    bar.append(t);
  });
}

export function contextMenu(x, y, items) {
  closeMenus();
  const list = buildList(items, runItem);
  document.getElementById('menus').append(list);
  placeMenu(list, x, y);
  openState = { bar: null, index: -1, stack: [list] };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
}
