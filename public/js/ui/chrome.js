// Toolbar, document tabs, status bar and the start screen.

import { app } from '../app.js';
import { TOOLBAR } from '../tools.js';
import { icon } from '../icons.js';
import { createCanvas, el, formatBytes } from '../util.js';
import { closeDoc, newDoc, openFiles, actions } from '../commands.js';
import { PRESETS, openColorDialog } from './dialogs.js';
import { contextMenu, prettyKey } from './menu.js';

// ------------------------------------------------------------ toolbar

export function buildToolbar(root) {
  const buttons = [];
  for (const group of TOOLBAR) {
    const b = el('button', { type: 'button', class: `tool-btn${group.length > 1 ? ' has-alt' : ''}` });
    const current = () => {
      const saved = app.settings.toolGroups[app.tools.get(group[0]).group || group[0]];
      return app.tools.get(group.includes(saved) ? saved : group[0]);
    };
    const paint = () => {
      const t = group.includes(app.tool?.id) ? app.tool : current();
      b.innerHTML = icon(t.icon, 20);
      const alt = group.length > 1 ? ' — right-click or hold for more' : '';
      b.title = `${t.name}${t.key ? ` (${prettyKey(t.key)})` : ''}${alt}`;
      b.setAttribute('aria-label', t.name);
      b.classList.toggle('active', group.includes(app.tool?.id));
      b.setAttribute('aria-pressed', group.includes(app.tool?.id));
    };
    const flyout = () => {
      const r = b.getBoundingClientRect();
      contextMenu(r.right + 2, r.top, group.map((id) => {
        const t = app.tools.get(id);
        return { label: t.name, shortcut: t.key, checked: app.tool?.id === id, run: () => app.setTool(id) };
      }));
    };
    let hold = 0;
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || group.length < 2) return;
      hold = setTimeout(() => { hold = -1; flyout(); }, 450);
    });
    b.addEventListener('pointerup', () => { if (hold > 0) clearTimeout(hold); });
    b.addEventListener('pointerleave', () => { if (hold > 0) clearTimeout(hold); });
    b.addEventListener('click', () => {
      if (hold === -1) { hold = 0; return; }
      app.setTool(current().id);
    });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); if (group.length > 1) flyout(); });
    root.append(b);
    buttons.push(paint);
  }
  // Foreground / background colors.
  const fg = el('button', { type: 'button', class: 'color-fg', title: 'Foreground color', 'aria-label': 'Foreground color' });
  const bg = el('button', { type: 'button', class: 'color-bg', title: 'Background color', 'aria-label': 'Background color' });
  const swap = el('button', { type: 'button', class: 'color-swap', title: 'Swap colors (X)', 'aria-label': 'Swap colors', html: icon('swap', 12), onclick: () => app.swapColors() });
  const reset = el('button', { type: 'button', class: 'color-reset', title: 'Default colors (D)', 'aria-label': 'Default colors', html: icon('reset-colors', 12), onclick: () => app.resetColors() });
  const pick = (which) => async () => {
    const c = await openColorDialog(app[which], which === 'fg' ? 'Foreground Color' : 'Background Color');
    if (c) app.setColor(which, c);
  };
  fg.onclick = pick('fg');
  bg.onclick = pick('bg');
  root.append(el('div', { class: 'colors' }, bg, fg, swap, reset));
  const paintColors = () => { fg.style.background = app.fg; bg.style.background = app.bg; };
  app.on('tool', () => buttons.forEach((p) => p()));
  app.on('colors', paintColors);
  buttons.forEach((p) => p());
  paintColors();
}

// ------------------------------------------------------------ tabs

export function buildTabs(root) {
  const thumbs = new Map();
  const render = () => {
    root.replaceChildren();
    for (const doc of app.docs) {
      let th = thumbs.get(doc.id);
      if (!th) { th = createCanvas(18, 18); thumbs.set(doc.id, th); }
      const ctx = th.getContext('2d');
      const s = Math.min(18 / doc.width, 18 / doc.height);
      ctx.clearRect(0, 0, 18, 18);
      ctx.drawImage(doc.getComposite(), (18 - doc.width * s) / 2, (18 - doc.height * s) / 2, doc.width * s, doc.height * s);
      const thumb = el('canvas', { class: 'tab-thumb', width: 18, height: 18 });
      thumb.getContext('2d').drawImage(th, 0, 0);
      const title = `${doc.name} @ ${Math.round(doc.view.zoom * 100)}%${doc.dirty ? '*' : ''}`;
      const close = el('button', { type: 'button', class: 'tab-close', title: 'Close', 'aria-label': `Close ${doc.name}`, html: icon('close', 14) });
      close.addEventListener('click', (e) => { e.stopPropagation(); closeDoc(doc); });
      const tab = el('div', { class: `tab${doc === app.doc ? ' active' : ''}`, role: 'tab', 'aria-selected': doc === app.doc,
        title: `${doc.name} — ${doc.width} × ${doc.height} px` }, thumb, el('span', { class: 'tab-title' }, title), close);
      tab.addEventListener('pointerdown', (e) => { if (e.button === 0) app.setDoc(doc); });
      tab.addEventListener('auxclick', (e) => { if (e.button === 1) closeDoc(doc); });
      root.append(tab);
    }
  };
  let timer = 0;
  const later = () => { if (!timer) timer = setTimeout(() => { timer = 0; render(); }, 120); };
  app.on('docs', render);
  app.on('change', later);
  app.on('view', later);
  render();
}

// ------------------------------------------------------------ status bar

export function buildStatusBar(root) {
  const pos = el('span', { class: 'st-pos' }, '');
  const zoomIn = el('input', { class: 'st-zoom', type: 'text', 'aria-label': 'Zoom' });
  const info = el('span', { class: 'st-info' });
  const tool = el('span', { class: 'st-tool' });
  root.append(pos, el('span', { class: 'st-zoom-wrap' }, zoomIn, el('span', {}, '%')), info, tool);
  zoomIn.addEventListener('change', () => {
    const n = parseFloat(zoomIn.value);
    if (n > 0) app.viewport.setZoom(n / 100);
    zoomIn.blur();
  });
  zoomIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') zoomIn.dispatchEvent(new Event('change')); });
  const upd = () => {
    const doc = app.doc;
    zoomIn.disabled = !doc;
    if (document.activeElement !== zoomIn) zoomIn.value = doc ? +(doc.view.zoom * 100).toFixed(doc.view.zoom < 0.1 ? 1 : 0) : '';
    if (!doc) { info.textContent = ''; return; }
    const mem = doc.layers.reduce((n, l) => n + l.canvas.width * l.canvas.height * 4, 0);
    const sel = doc.selection ? ` · selection ${doc.selection.bounds.w} × ${doc.selection.bounds.h}` : '';
    info.textContent = `${doc.width} × ${doc.height} px · ${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'} · ${formatBytes(mem)}${sel}`;
  };
  app.on('pointer', (p) => {
    pos.textContent = p && app.doc ? `${Math.floor(p.x)}, ${Math.floor(p.y)} px` : '';
  });
  app.on('tool', (t) => { tool.textContent = t.name; });
  app.on('change', upd);
  app.on('view', upd);
  app.on('docs', upd);
  upd();
}

// ------------------------------------------------------------ start screen

export function buildWelcome(root) {
  const presets = [PRESETS[0], PRESETS[3], PRESETS[2], PRESETS[5], PRESETS[8]];
  root.append(el('div', { class: 'welcome-card' },
    el('h1', {}, 'Studio'),
    el('p', { class: 'welcome-sub' }, 'A free image editor that runs entirely in your browser.'),
    el('div', { class: 'welcome-actions' },
      el('button', { type: 'button', class: 'btn primary big', onclick: () => newDoc() }, el('span', { html: icon('new-layer', 18) }), 'New Project…'),
      el('button', { type: 'button', class: 'btn big', onclick: () => openFiles() }, el('span', { html: icon('folder', 18) }), 'Open From Computer…')),
    el('div', { class: 'welcome-presets' }, presets.map(([name, w, h]) =>
      el('button', { type: 'button', class: 'preset-tile', onclick: () => newDoc({ width: w, height: h, name: 'Untitled', background: '#ffffff' }) },
        el('span', { class: 'preset-shape', style: { aspectRatio: `${w} / ${h}` } }),
        el('span', { class: 'preset-name' }, name.replace(/\s*\(.*\)$/, '')),
        el('span', { class: 'preset-size' }, `${w} × ${h}`)))),
    el('p', { class: 'welcome-hint' }, 'Drop images or .ora projects anywhere to open them. Paste an image with ',
      el('kbd', {}, prettyKey('Ctrl+V')), '. Your files stay on this device.'),
    el('p', { class: 'welcome-hint' }, el('a', { href: '#', onclick: (e) => { e.preventDefault(); actions.shortcuts.run(); } }, 'Keyboard shortcuts'))));
  const upd = () => { root.hidden = app.docs.length > 0; };
  app.on('docs', upd);
  upd();
}
