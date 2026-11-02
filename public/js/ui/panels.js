// Right-hand dock: two groups of text-tabbed panels, like the Studio layout
// (Tool Options / Color / History above Layers / Navigator).

import { app } from '../app.js';
import { BLEND_MODES } from '../model.js';
import { FONTS } from '../text.js';
import { icon } from '../icons.js';
import { clamp, createCanvas, el, rafThrottle } from '../util.js';
import { addLayer, deleteLayer, duplicateLayer, mergeDown, moveLayer, selectLayerAlpha, setLayerProps } from '../ops.js';
import { check, colorPicker, iconButton, numberField, segmented, select, spinScale } from './widgets.js';
import { colorSwatch, promptText } from './dialogs.js';
import { contextMenu } from './menu.js';

const panels = {};

function panel(id, title, build) { panels[id] = { id, title, build }; }

export function buildDock(root) {
  const groups = [['options', 'color', 'history'], ['layers', 'navigator']];
  const els = groups.map((ids, gi) => {
    const tabs = el('div', { class: 'panel-tabs', role: 'tablist' });
    const body = el('div', { class: 'panel-stack' });
    const g = el('section', { class: 'panel-group', dataset: { group: gi } }, tabs, body);
    const saved = app.settings[`dockTab${gi}`];
    let current = ids.includes(saved) ? saved : ids[0];
    const bodies = {};
    for (const id of ids) {
      const p = panels[id];
      const tab = el('button', { type: 'button', class: 'panel-tab', role: 'tab', dataset: { id } }, p.title);
      const content = el('div', { class: `panel-body panel-${id}`, role: 'tabpanel' });
      bodies[id] = { tab, content, built: false };
      tab.addEventListener('click', () => show(id));
      tabs.append(tab);
      body.append(content);
    }
    const show = (id) => {
      current = id;
      app.settings[`dockTab${gi}`] = id;
      app.saveSettings();
      for (const [k, b] of Object.entries(bodies)) {
        b.tab.classList.toggle('active', k === id);
        b.tab.setAttribute('aria-selected', k === id);
        b.content.hidden = k !== id;
        if (k === id && !b.built) { panels[k].build(b.content); b.built = true; }
      }
    };
    show(current);
    g.show = show;
    return g;
  });
  const splitter = el('div', { class: 'dock-split', role: 'separator', 'aria-orientation': 'horizontal' });
  root.append(els[0], splitter, els[1]);
  const apply = () => {
    const f = clamp(app.settings.dockSplit ?? 0.5, 0.15, 0.85);
    els[0].style.flex = `${f} 1 0`;
    els[1].style.flex = `${1 - f} 1 0`;
  };
  apply();
  splitter.addEventListener('pointerdown', (e) => {
    splitter.setPointerCapture(e.pointerId);
    const r = root.getBoundingClientRect();
    const mv = (ev) => { app.settings.dockSplit = (ev.clientY - r.top) / r.height; apply(); };
    const up = () => { splitter.removeEventListener('pointermove', mv); splitter.removeEventListener('pointerup', up); app.saveSettings(); };
    splitter.addEventListener('pointermove', mv);
    splitter.addEventListener('pointerup', up);
  });
  return { show: (id) => els.find((g) => g.querySelector(`[data-id="${id}"]`))?.show(id) };
}

// ------------------------------------------------------------ tool options

const BRUSH_PRESETS = [[5, 100], [13, 100], [30, 100], [60, 100], [13, 0], [30, 0], [60, 0], [120, 0], [250, 0], [30, 50]];

panel('options', 'Tool Options', (root) => {
  let muted = false;
  const render = () => {
    const tool = app.tool;
    root.replaceChildren();
    if (!tool) return;
    const o = app.opts(tool);
    root.append(el('div', { class: 'opt-title' }, el('span', { html: icon(tool.icon, 18) }), tool.name.replace(' Tool', '')));
    const set = (id, v, rerender) => {
      muted = true;
      app.setOpt(tool, id, v);
      muted = false;
      tool.optionChanged?.(id, v);
      if (rerender) render();
      app.viewport?.render();
    };
    const hasShowIf = (tool.options || []).some((f) => f.showIf);
    for (const f of tool.options || []) {
      if (f.showIf && !f.showIf(o)) continue;
      const v = o[f.id];
      switch (f.type) {
        case 'range':
          root.append(spinScale({ ...f, value: v, onInput: (x) => set(f.id, x) }).el);
          break;
        case 'number':
          root.append(numberField({ ...f, value: v, onChange: (x) => set(f.id, x) }));
          break;
        case 'select':
          root.append(el('label', { class: 'field' }, el('span', { class: 'field-label' }, f.label),
            select({ ...f, value: v, onChange: (x) => set(f.id, x, hasShowIf) })));
          break;
        case 'check':
          root.append(check({ label: f.label, value: v, onChange: (x) => set(f.id, x, hasShowIf) }));
          break;
        case 'segmented':
          root.append(el('div', { class: 'field' }, el('span', { class: 'field-label' }, f.label),
            segmented({ ...f, value: v, onChange: (x) => set(f.id, x, hasShowIf) })));
          break;
        case 'color':
          root.append(el('div', { class: 'field' }, el('span', { class: 'field-label' }, f.label), colorSwatch(v, (c) => set(f.id, c), f.label)));
          break;
        case 'textcolor': {
          const l = tool.editing?.layer || (app.doc?.active?.text ? app.doc.active : null);
          root.append(el('div', { class: 'field' }, el('span', { class: 'field-label' }, f.label),
            colorSwatch(l ? l.text.color : app.fg, (c) => { app.setColor('fg', c); tool.optionChanged?.('color', c); }, 'Text color')));
          break;
        }
        case 'font': {
          const input = el('input', { type: 'text', class: 'text-input', list: 'font-list', value: v, 'aria-label': 'Font' });
          input.addEventListener('change', () => set(f.id, input.value || 'Arial'));
          root.append(el('label', { class: 'field' }, el('span', { class: 'field-label' }, f.label), input));
          break;
        }
        case 'textstyle': {
          const mk = (k, ic, title) => {
            const b = iconButton(ic, title, () => { set(k, !o[k]); b.classList.toggle('on', !!o[k]); });
            b.classList.toggle('on', !!o[k]);
            return b;
          };
          root.append(el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Style'),
            el('div', { class: 'segmented' }, mk('bold', 'bold', 'Bold'), mk('italic', 'italic', 'Italic'))));
          break;
        }
        case 'buttons':
          root.append(el('div', { class: 'btn-row' }, f.buttons.map(([label, fn, cls]) =>
            el('button', { type: 'button', class: `btn ${cls || ''}`, onclick: fn }, label))));
          break;
        case 'presets':
          root.append(el('div', { class: 'field-label sub' }, f.label), el('div', { class: 'presets' }, BRUSH_PRESETS.map(([size, hard]) => {
            const c = createCanvas(34, 34);
            const ctx = c.getContext('2d');
            const r = Math.max(1.5, Math.min(14, Math.sqrt(size) * 1.6));
            const g = ctx.createRadialGradient(17, 17, 0, 17, 17, r);
            g.addColorStop(0, 'rgba(230,230,230,1)'); g.addColorStop(hard / 100 * 0.95, 'rgba(230,230,230,1)'); g.addColorStop(1, 'rgba(230,230,230,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(17, 17, r, 0, 7); ctx.fill();
            const b = el('button', { type: 'button', class: 'preset', title: `${size} px, ${hard}% hardness` }, c, el('span', {}, size));
            b.addEventListener('click', () => { set('size', size); if ('hardness' in o) set('hardness', hard); render(); });
            return b;
          })));
          break;
        case 'transform':
          root.append(transformFields());
          break;
        default:
      }
    }
    if (tool.hint) root.append(el('p', { class: 'hint tool-hint' }, tool.hint));
  };
  const transformFields = () => {
    const s = app.tools.get('transform').session;
    if (!s) return el('div');
    const mk = (label, get, setv, unit) => {
      const input = el('input', { type: 'number', class: 'num', step: 'any', value: get() });
      input.addEventListener('change', () => { setv(+input.value || 0); s.update(); });
      return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), input, el('span', { class: 'unit' }, unit));
    };
    const box = el('div', { class: 'form' });
    const fill = () => box.replaceChildren(
      mk('Width', () => +(s.sx * 100).toFixed(2), (v) => { s.sx = v / 100; }, '%'),
      mk('Height', () => +(s.sy * 100).toFixed(2), (v) => { s.sy = v / 100; }, '%'),
      mk('Angle', () => +((s.rot * 180) / Math.PI).toFixed(2), (v) => { s.rot = (v * Math.PI) / 180; }, '°'),
      mk('X', () => Math.round(s.cx - (s.w * s.sx) / 2), (v) => { s.cx = v + (s.w * s.sx) / 2; }, 'px'),
      mk('Y', () => Math.round(s.cy - (s.h * s.sy) / 2), (v) => { s.cy = v + (s.h * s.sy) / 2; }, 'px'));
    fill();
    const off = app.on('transform', () => { if (!box.isConnected) { off(); return; } if (!box.contains(document.activeElement)) fill(); });
    return box;
  };
  app.on('tool', render);
  app.on('options', () => { if (!muted) render(); });
  app.on('change', () => { if (app.tool?.id === 'text' || app.tool?.id === 'transform') render(); });
  render();
});

// ------------------------------------------------------------ color

const DEFAULT_SWATCHES = ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00',
  '#34c759', '#00c7be', '#30b0c7', '#2680eb', '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#7f1d1d', '#14532d', '#1e3a8a', '#f5e6c8'];

panel('color', 'Color', (root) => {
  let which = 'fg';
  const fgB = el('button', { type: 'button', class: 'which on' }, 'Foreground');
  const bgB = el('button', { type: 'button', class: 'which' }, 'Background');
  const picker = colorPicker(app.fg, (h) => { muted = true; app.setColor(which, h); muted = false; });
  let muted = false;
  const pick = (w) => { which = w; fgB.classList.toggle('on', w === 'fg'); bgB.classList.toggle('on', w === 'bg'); picker.set(app[w]); };
  fgB.onclick = () => pick('fg');
  bgB.onclick = () => pick('bg');
  const sw = el('div', { class: 'swatches' });
  const renderSwatches = () => {
    const list = app.settings.swatches || DEFAULT_SWATCHES;
    sw.replaceChildren(...list.map((c, i) => {
      const b = el('button', { type: 'button', class: 'swatch', style: { background: c }, title: `${c} — click: foreground, Alt+click: background, right-click: remove` });
      b.addEventListener('click', (e) => app.setColor(e.altKey ? 'bg' : 'fg', c));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const l = [...list]; l.splice(i, 1);
        app.settings.swatches = l; app.saveSettings(); renderSwatches();
      });
      return b;
    }), el('button', { type: 'button', class: 'swatch add', title: 'Add the foreground color', html: icon('plus', 14),
      onclick: () => { app.settings.swatches = [...list, app.fg]; app.saveSettings(); renderSwatches(); } }));
  };
  renderSwatches();
  root.append(el('div', { class: 'segmented which-row' }, fgB, bgB), picker.el, el('div', { class: 'field-label sub' }, 'Swatches'), sw);
  app.on('colors', () => { if (!muted) picker.set(app[which]); });
});

// ------------------------------------------------------------ history

panel('history', 'History', (root) => {
  const list = el('ul', { class: 'history-list', role: 'listbox', 'aria-label': 'History' });
  root.append(list);
  const render = () => {
    const doc = app.doc;
    list.replaceChildren();
    if (!doc) return;
    const h = doc.history;
    h.entries.forEach((e, i) => {
      const li = el('li', { class: `hist${i === h.index ? ' current' : ''}${i > h.index ? ' future' : ''}`, role: 'option', 'aria-selected': i === h.index },
        el('span', { class: 'hist-icon', html: icon(i === 0 ? 'file' : 'chevron-right', 14) }), e.label);
      li.addEventListener('click', () => h.jump(i));
      list.append(li);
    });
    list.children[h.index]?.scrollIntoView({ block: 'nearest' });
  };
  app.on('change', render);
  render();
});

// ------------------------------------------------------------ layers

const thumbs = new Map();

function thumbFor(doc, layer, w = 40, h = 30) {
  let t = thumbs.get(layer.id);
  if (!t) { t = { canvas: createCanvas(w, h), version: -1, key: '' }; thumbs.set(layer.id, t); }
  const key = `${doc.width}x${doc.height}|${layer.x},${layer.y}|${layer.canvas.width}x${layer.canvas.height}`;
  if (t.version !== layer.version || t.key !== key || t.canvasRef !== layer.canvas) {
    const ctx = t.canvas.getContext('2d');
    const s = Math.min(w / doc.width, h / doc.height);
    const dw = doc.width * s, dh = doc.height * s, ox = (w - dw) / 2, oy = (h - dh) / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; ctx.fillRect(ox, oy, dw, dh);
    ctx.fillStyle = '#ccc';
    for (let y = 0; y < dh; y += 4) for (let x = (y / 4) % 2 ? 4 : 0; x < dw; x += 8) ctx.fillRect(ox + x, oy + y, Math.min(4, dw - x), Math.min(4, dh - y));
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, dw, dh); ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(layer.canvas, ox + layer.x * s, oy + layer.y * s, layer.canvas.width * s, layer.canvas.height * s);
    ctx.restore();
    t.version = layer.version; t.key = key; t.canvasRef = layer.canvas;
  }
  return t.canvas;
}

export function layerMenuItems(doc, layer) {
  return [
    { label: 'Layer Properties…', run: () => renameLayer(doc, layer) },
    { label: 'Duplicate Layer', run: () => { doc.activeId = layer.id; duplicateLayer(doc); } },
    { label: 'Delete Layer', run: () => deleteLayer(doc, layer) },
    '-',
    { label: 'Select Pixels', run: () => selectLayerAlpha(doc, layer) },
    { label: 'Rasterize Type', disabled: !layer.text, run: () => { doc.activeId = layer.id; doc.structural('Rasterize Type', () => { layer.text = null; }); } },
    '-',
    { label: 'Merge Down', disabled: doc.indexOf(layer) === 0, run: () => { doc.activeId = layer.id; mergeDown(doc); } },
  ];
}

async function renameLayer(doc, layer) {
  const name = await promptText({ title: 'Layer Properties', label: 'Name', value: layer.name });
  if (name != null && name.trim()) setLayerProps(doc, layer, { name: name.trim() }, 'Rename Layer');
}

panel('layers', 'Layers', (root) => {
  const blend = select({ label: 'Blend mode', value: 'source-over', options: BLEND_MODES,
    onChange: (v) => { const d = app.doc; if (d?.active) setLayerProps(d, d.active, { blend: v }, 'Blending Change'); } });
  let before = null;
  const opacity = spinScale({ label: 'Opacity', min: 0, max: 100, value: 100, unit: '%',
    onInput: (v) => {
      const d = app.doc, l = d?.active;
      if (!l) return;
      before ||= d.snapshot();
      l.opacity = v / 100;
      d.invalidate();
    },
    onChange: () => { const d = app.doc; if (before && d) d.record('Opacity Change', before); before = null; } });
  const lockBtn = iconButton('lock', 'Lock layer', () => {
    const d = app.doc, l = d?.active;
    if (l) setLayerProps(d, l, { locked: !l.locked }, l.locked ? 'Unlock Layer' : 'Lock Layer');
  });
  const list = el('ul', { class: 'layer-list', role: 'listbox', 'aria-label': 'Layers' });
  const foot = el('div', { class: 'panel-foot' },
    iconButton('new-layer', 'New layer (Ctrl+Alt+Shift+N)', () => app.doc && addLayer(app.doc)),
    iconButton('duplicate', 'Duplicate layer (Ctrl+J)', () => app.doc && duplicateLayer(app.doc)),
    iconButton('up', 'Raise layer (Ctrl+])', () => { const d = app.doc; if (d?.active) moveLayer(d, d.active, d.indexOf(d.active) + 1, 'Raise Layer'); }),
    iconButton('down', 'Lower layer (Ctrl+[)', () => { const d = app.doc; if (d?.active) moveLayer(d, d.active, d.indexOf(d.active) - 1, 'Lower Layer'); }),
    iconButton('merge', 'Merge down (Ctrl+E)', () => app.doc && mergeDown(app.doc)),
    el('span', { class: 'spacer' }),
    iconButton('trash', 'Delete layer', () => app.doc?.active && deleteLayer(app.doc)));
  root.append(el('div', { class: 'layer-props' }, blend, lockBtn), opacity.el, list, foot);

  let dragId = null;
  const render = () => {
    const doc = app.doc;
    const l = doc?.active;
    blend.value = l?.blend || 'source-over';
    blend.disabled = !l;
    if (!before) opacity.set(l ? Math.round(l.opacity * 100) : 100);
    lockBtn.classList.toggle('on', !!l?.locked);
    list.replaceChildren();
    if (!doc) return;
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const layer = doc.layers[i];
      const eye = el('button', { type: 'button', class: `eye${layer.visible ? '' : ' off'}`, title: layer.visible ? 'Hide layer' : 'Show layer',
        'aria-label': 'Toggle visibility', html: layer.visible ? icon('eye', 16) : '' });
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.altKey) {
          // Alt+click: show only this layer (or everything again).
          const solo = doc.layers.every((x) => x === layer || !x.visible) && layer.visible;
          doc.structural('Show/Hide Layers', () => doc.layers.forEach((x) => { x.visible = solo || x === layer; }));
        } else setLayerProps(doc, layer, { visible: !layer.visible }, layer.visible ? 'Hide Layer' : 'Show Layer');
      });
      const th = thumbFor(doc, layer);
      const thumbCopy = el('canvas', { class: 'thumb', width: th.width, height: th.height, title: 'Ctrl+click to select the layer pixels' });
      thumbCopy.getContext('2d').drawImage(th, 0, 0);
      thumbCopy.addEventListener('click', (e) => { if (e.ctrlKey || e.metaKey) { e.stopPropagation(); selectLayerAlpha(doc, layer); } });
      const name = el('span', { class: 'layer-name' }, layer.name);
      const row = el('li', {
        class: `layer${layer.id === doc.activeId ? ' active' : ''}${layer.visible ? '' : ' hidden-layer'}`,
        role: 'option', 'aria-selected': layer.id === doc.activeId, draggable: 'true', dataset: { id: layer.id },
      }, eye, thumbCopy, name,
      layer.text ? el('span', { class: 'badge', title: 'Type layer' }, 'T') : null,
      layer.locked ? el('span', { class: 'badge', html: icon('lock', 12), title: 'Locked' }) : null,
      layer.blend !== 'source-over' || layer.opacity < 1 ? el('span', { class: 'badge dim', title: 'Blend/opacity' }, `${Math.round(layer.opacity * 100)}%`) : null);
      row.addEventListener('click', () => { if (doc.activeId !== layer.id) { doc.activeId = layer.id; doc.notify(); } });
      name.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const input = el('input', { type: 'text', class: 'text-input rename', value: layer.name });
        name.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const fin = (ok) => {
          if (done) return;
          done = true;
          if (ok && input.value.trim()) setLayerProps(doc, layer, { name: input.value.trim() }, 'Rename Layer');
          else render();
        };
        input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') fin(true); if (ev.key === 'Escape') fin(false); });
        input.addEventListener('blur', () => fin(true));
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (doc.activeId !== layer.id) { doc.activeId = layer.id; doc.notify(); }
        contextMenu(e.clientX, e.clientY, layerMenuItems(doc, layer));
      });
      row.addEventListener('dragstart', (e) => { dragId = layer.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', layer.name); row.classList.add('dragging'); });
      row.addEventListener('dragend', () => { dragId = null; render(); });
      row.addEventListener('dragover', (e) => {
        if (!dragId) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const below = e.clientY > r.top + r.height / 2;
        list.querySelectorAll('.drop-above,.drop-below').forEach((x) => x.classList.remove('drop-above', 'drop-below'));
        row.classList.add(below ? 'drop-below' : 'drop-above');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const src = doc.layers.find((x) => x.id === dragId);
        if (!src) return;
        const r = row.getBoundingClientRect();
        const below = e.clientY > r.top + r.height / 2;
        let target = doc.indexOf(layer) + (below ? 0 : 1); // list is top-first
        if (doc.indexOf(src) < target) target--;
        moveLayer(doc, src, target);
      });
      list.append(row);
    }
  };
  const throttled = rafThrottle(render);
  app.on('change', throttled);
  render();
});

// ------------------------------------------------------------ navigator

panel('navigator', 'Navigator', (root) => {
  const cv = el('canvas', { class: 'nav-canvas' });
  const wrap = el('div', { class: 'nav-wrap' }, cv);
  const zoomLabel = el('span', { class: 'nav-zoom' });
  const zoomSlider = spinScale({ label: 'Zoom', min: 1, max: 6400, value: 100, unit: '%', gamma: 4,
    onInput: (v) => app.viewport?.setZoom(v / 100) });
  root.append(wrap, zoomSlider.el, zoomLabel);
  let geo = null;
  const draw = () => {
    const doc = app.doc, vp = app.viewport;
    const W = Math.max(50, wrap.clientWidth), H = Math.max(50, Math.min(220, wrap.clientWidth * 0.75));
    const dpr = devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!doc || !vp) { geo = null; return; }
    const s = Math.min((W - 8) / doc.width, (H - 8) / doc.height);
    const ox = (W - doc.width * s) / 2, oy = (H - doc.height * s) / 2;
    geo = { s, ox, oy };
    ctx.fillStyle = '#fff';
    ctx.fillRect(ox, oy, doc.width * s, doc.height * s);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(doc.getComposite(), ox, oy, doc.width * s, doc.height * s);
    const r = vp.visibleDocRect();
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + r.x * s, oy + r.y * s, r.w * s, r.h * s);
    zoomSlider.set(Math.round(vp.zoom * 100));
    zoomLabel.textContent = `${doc.width} × ${doc.height} px`;
  };
  const throttled = rafThrottle(draw);
  let lastPreview = 0;
  app.on('change', throttled);
  app.on('view', throttled);
  app.on('preview', () => { const t = performance.now(); if (t - lastPreview > 150) { lastPreview = t; throttled(); } });
  new ResizeObserver(throttled).observe(wrap);
  cv.addEventListener('pointerdown', (e) => {
    if (!geo || !app.doc) return;
    cv.setPointerCapture(e.pointerId);
    const go = (ev) => {
      const r = cv.getBoundingClientRect();
      app.viewport.centerOn((ev.clientX - r.left - geo.ox) / geo.s, (ev.clientY - r.top - geo.oy) / geo.s);
    };
    go(e);
    const up = () => { cv.removeEventListener('pointermove', go); cv.removeEventListener('pointerup', up); };
    cv.addEventListener('pointermove', go);
    cv.addEventListener('pointerup', up);
  });
  draw();
});

export function fontDatalist() {
  return el('datalist', { id: 'font-list' }, FONTS.map((f) => el('option', { value: f })));
}
