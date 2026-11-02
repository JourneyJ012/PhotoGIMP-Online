// Modal dialogs.

import { app } from '../app.js';
import { clamp, el } from '../util.js';
import { curveLUT, levelsLUT } from '../filters.js';
import { button, check, colorPicker, numberField, select, spinScale } from './widgets.js';

const stack = [];
export const dialogOpen = () => stack.length > 0;

/**
 * buttons: [{label, primary, action}] — action may return false to keep the
 * dialog open. The first non-primary button is treated as Cancel (Esc).
 */
export function modal({ title, body, buttons = [], onClose, className = '', width }) {
  const root = document.getElementById('dialogs');
  const backdrop = el('div', { class: 'backdrop' });
  const head = el('div', { class: 'dlg-head' }, el('span', { class: 'dlg-title' }, title));
  const foot = el('div', { class: 'dlg-foot' });
  const dlg = el('div', { class: `dlg ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
    style: width ? { width: `${width}px` } : null }, head, el('div', { class: 'dlg-body' }, body), foot);
  backdrop.append(dlg);
  root.append(backdrop);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    stack.splice(stack.indexOf(api), 1);
    document.removeEventListener('keydown', onKey, true);
    onClose?.(result);
  };
  const run = (b) => { if (b.action?.() !== false) close(b.primary ? 'ok' : 'cancel'); };
  for (const b of buttons) foot.append(button(b.label, () => run(b), b.primary ? 'primary' : ''));
  const onKey = (e) => {
    if (stack.at(-1) !== api) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const c = buttons.find((b) => !b.primary); if (c) run(c); else close('cancel'); }
    else if (e.key === 'Enter' && !/TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) {
      const p = buttons.find((b) => b.primary);
      if (p) { e.preventDefault(); e.stopPropagation(); e.target.blur?.(); run(p); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  // Drag by the title bar.
  head.addEventListener('pointerdown', (e) => {
    const r = dlg.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      dlg.style.position = 'fixed';
      dlg.style.margin = '0';
      dlg.style.left = `${clamp(ev.clientX - ox, 0, innerWidth - 60)}px`;
      dlg.style.top = `${clamp(ev.clientY - oy, 0, innerHeight - 30)}px`;
    };
    const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); };
    head.addEventListener('pointermove', mv);
    head.addEventListener('pointerup', up);
  });
  const api = { close, root: dlg };
  stack.push(api);
  requestAnimationFrame(() => {
    const f = dlg.querySelector('[autofocus]') || dlg.querySelector('.dlg-body input:not([type=checkbox]), .dlg-body select');
    f?.focus();
    f?.select?.();
  });
  return api;
}

export function confirmDialog(message, okLabel = 'OK', cancelLabel = 'Cancel') {
  return new Promise((res) => {
    modal({
      title: 'Studio', body: el('p', { class: 'dlg-msg' }, message),
      buttons: [{ label: cancelLabel }, { label: okLabel, primary: true, action: () => res(true) }],
      onClose: (r) => { if (r !== 'ok') res(false); },
    });
  });
}

export function alertDialog(title, message) {
  modal({ title, body: el('div', { class: 'dlg-msg' }, message), buttons: [{ label: 'OK', primary: true }] });
}

export function promptNumber({ title, label, value, min, max, unit }) {
  return new Promise((res) => {
    let v = value;
    const field = numberField({ label, value, min, max, unit, onChange: (n) => { v = n; } });
    modal({
      title, body: el('div', { class: 'form' }, field),
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, action: () => {
        const input = field.querySelector('input');
        v = clamp(parseFloat(input.value) || v, min ?? -Infinity, max ?? Infinity);
        res(v);
      } }],
      onClose: (r) => { if (r !== 'ok') res(null); },
    });
  });
}

export function promptText({ title, label, value }) {
  return new Promise((res) => {
    const input = el('input', { type: 'text', class: 'text-input', value, autofocus: true });
    modal({
      title, body: el('div', { class: 'form' }, el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), input)),
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, action: () => res(input.value) }],
      onClose: (r) => { if (r !== 'ok') res(null); },
    });
  });
}

export function openColorDialog(hex, title = 'Color Picker') {
  return new Promise((res) => {
    const oldSw = el('div', { class: 'cp-swatch', style: { background: hex }, title: 'Current' });
    const newSw = el('div', { class: 'cp-swatch', style: { background: hex }, title: 'New' });
    const picker = colorPicker(hex, (h) => { newSw.style.background = h; });
    oldSw.addEventListener('click', () => { picker.set(hex); newSw.style.background = hex; });
    const body = el('div', { class: 'cp-dialog' }, picker.el,
      el('div', { class: 'cp-compare' }, el('span', {}, 'new'), newSw, oldSw, el('span', {}, 'current')));
    modal({
      title, body, width: 300,
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, action: () => res(picker.get()) }],
      onClose: (r) => { if (r !== 'ok') res(null); },
    });
  });
}

export function colorSwatch(value, onChange, title = 'Pick a color') {
  const b = el('button', { type: 'button', class: 'swatch-btn', title, style: { background: value } });
  b.addEventListener('click', async () => {
    const c = await openColorDialog(b.dataset.value || value, title);
    if (c) { b.dataset.value = c; b.style.background = c; onChange(c); }
  });
  b.dataset.value = value;
  return b;
}

// ------------------------------------------------------------ parameter dialogs

function curvesEditor(value, onChange, hist) {
  let ch = 'rgb';
  const curves = JSON.parse(JSON.stringify(value));
  const S = 256;
  const cv = el('canvas', { class: 'curves', width: S, height: S });
  const ctx = cv.getContext('2d');
  const colors = { rgb: '#ddd', r: '#ff5a5a', g: '#5ad25a', b: '#5a8cff' };
  const draw = () => {
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, S, S);
    const h = hist?.(ch);
    if (h) {
      const max = Math.max(...h) || 1;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < 256; i++) { const v = (Math.sqrt(h[i] / max)) * S; ctx.fillRect(i, S - v, 1, v); }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    for (let i = 1; i < 4; i++) { ctx.moveTo((i * S) / 4 + 0.5, 0); ctx.lineTo((i * S) / 4 + 0.5, S); ctx.moveTo(0, (i * S) / 4 + 0.5); ctx.lineTo(S, (i * S) / 4 + 0.5); }
    ctx.moveTo(0, S); ctx.lineTo(S, 0);
    ctx.stroke();
    const lut = curveLUT(curves[ch]);
    ctx.strokeStyle = colors[ch];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < 256; x++) { const y = S - lut[x]; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.lineWidth = 1;
    for (const [x, y] of curves[ch]) {
      ctx.fillStyle = '#1e1e1e'; ctx.strokeStyle = colors[ch];
      ctx.fillRect(x - 3, S - y - 3, 6, 6); ctx.strokeRect(x - 3.5, S - y - 3.5, 7, 7);
    }
  };
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return [clamp(((e.clientX - r.left) / r.width) * 255, 0, 255), clamp((1 - (e.clientY - r.top) / r.height) * 255, 0, 255)];
  };
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const pts = curves[ch];
    const [x, y] = pos(e);
    const r = cv.getBoundingClientRect(), k = 255 / r.width;
    let idx = pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 8 * k);
    if (idx < 0) { pts.push([x, y]); pts.sort((a, b) => a[0] - b[0]); idx = pts.findIndex((p) => p[0] === x && p[1] === y); }
    const pt = pts[idx];
    const mv = (ev) => {
      const rr = cv.getBoundingClientRect();
      const out = ev.clientX < rr.left - 20 || ev.clientX > rr.right + 20 || ev.clientY < rr.top - 20 || ev.clientY > rr.bottom + 20;
      const i = pts.indexOf(pt);
      if (out && pts.length > 2) { if (i >= 0) pts.splice(i, 1); }
      else {
        if (i < 0) { pts.push(pt); pts.sort((a, b) => a[0] - b[0]); }
        const [nx, ny] = pos(ev);
        const j = pts.indexOf(pt);
        const lo = j > 0 ? pts[j - 1][0] + 1 : 0, hi = j < pts.length - 1 ? pts[j + 1][0] - 1 : 255;
        pt[0] = Math.round(clamp(nx, lo, hi)); pt[1] = Math.round(ny);
      }
      draw();
      onChange(curves);
    };
    const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); };
    cv.addEventListener('pointermove', mv);
    cv.addEventListener('pointerup', up);
    draw();
    onChange(curves);
  });
  const chSel = select({ label: 'Channel', value: 'rgb', options: [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']],
    onChange: (v) => { ch = v; draw(); } });
  const reset = button('Reset channel', () => { curves[ch] = [[0, 0], [255, 255]]; draw(); onChange(curves); });
  draw();
  return el('div', { class: 'curves-wrap' }, el('div', { class: 'row' }, el('span', { class: 'field-label' }, 'Channel'), chSel, reset), cv,
    el('p', { class: 'hint' }, 'Click to add points, drag them to shape the curve, drag a point off the graph to remove it.'));
}

function histogramView(hist, getChannel, getLevels) {
  const cv = el('canvas', { class: 'histogram', width: 256, height: 80 });
  const draw = () => {
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, 256, 80);
    const h = hist(getChannel());
    const max = Math.max(...h) || 1;
    ctx.fillStyle = '#aaa';
    for (let i = 0; i < 256; i++) { const v = Math.sqrt(h[i] / max) * 78; ctx.fillRect(i, 80 - v, 1, v); }
    const lv = getLevels();
    const lut = levelsLUT(lv);
    ctx.strokeStyle = '#2680eb';
    ctx.beginPath();
    for (let x = 0; x < 256; x++) { const y = 80 - (lut[x] / 255) * 80; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
  };
  draw();
  return { el: cv, draw };
}

/**
 * Dialog for an adjustment/filter definition {title, fields}. onPreview(values
 * | null) is called (throttled) while editing; onApply(values) on OK.
 */
export function paramDialog({ title, fields, values = {}, onPreview, onApply, onCancel, histogram }) {
  const vals = {};
  for (const f of fields) if (f.id) vals[f.id] = structuredClone(values[f.id] ?? f.value);
  let previewOn = true, timer = 0, busy = false, again = false;
  const schedule = () => {
    if (timer || busy) { again = true; return; }
    timer = setTimeout(async () => {
      timer = 0;
      busy = true;
      try { await onPreview(previewOn ? vals : null); } finally { busy = false; }
      if (again) { again = false; schedule(); }
    }, 30);
  };
  const form = el('div', { class: 'form' });
  let hv = null;
  if (histogram && fields.some((f) => f.id === 'inBlack')) {
    hv = histogramView(histogram, () => vals.channel, () => vals);
    form.append(hv.el);
  }
  const changed = () => { hv?.draw(); schedule(); };
  for (const f of fields) {
    if (f.type === 'heading') form.append(el('div', { class: 'form-heading' }, f.label));
    else if (f.type === 'range') {
      form.append(spinScale({ ...f, value: vals[f.id], onInput: (v) => { vals[f.id] = v; changed(); } }).el);
    } else if (f.type === 'select') {
      form.append(el('label', { class: 'field' }, el('span', { class: 'field-label' }, f.label),
        select({ ...f, value: vals[f.id], onChange: (v) => { vals[f.id] = v; changed(); } })));
    } else if (f.type === 'check') {
      form.append(check({ label: f.label, value: vals[f.id], onChange: (v) => { vals[f.id] = v; changed(); } }));
    } else if (f.type === 'color') {
      form.append(el('label', { class: 'field' }, el('span', { class: 'field-label' }, f.label),
        colorSwatch(vals[f.id], (c) => { vals[f.id] = c; changed(); })));
    } else if (f.type === 'curves') {
      form.append(curvesEditor(vals[f.id], (c) => { vals[f.id] = c; changed(); }, histogram));
    }
  }
  form.append(el('div', { class: 'form-sep' }), check({ label: 'Preview', value: true, onChange: (v) => { previewOn = v; schedule(); } }));
  schedule();
  return new Promise((res) => {
    modal({
      title, body: form, className: 'param-dialog',
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, action: () => { clearTimeout(timer); onApply(vals); res(vals); } }],
      onClose: (r) => { if (r !== 'ok') { clearTimeout(timer); onCancel?.(); res(null); } },
    });
  });
}

// ------------------------------------------------------------ documents

export const PRESETS = [
  ['Default (1920 × 1080)', 1920, 1080], ['HD 1280 × 720', 1280, 720], ['4K UHD 3840 × 2160', 3840, 2160],
  ['Square 1080 × 1080', 1080, 1080], ['Story 1080 × 1920', 1080, 1920], ['A4 300 ppi (2480 × 3508)', 2480, 3508],
  ['Letter 300 ppi (2550 × 3300)', 2550, 3300], ['Web banner 1200 × 628', 1200, 628], ['Icon 512 × 512', 512, 512],
  ['800 × 600', 800, 600],
];

export function newDocDialog({ width = 1920, height = 1080, name = 'Untitled' } = {}) {
  return new Promise((res) => {
    const v = { name, width, height, background: 'white' };
    const nameIn = el('input', { type: 'text', class: 'text-input', value: name });
    const wf = numberField({ label: 'Width', value: width, min: 1, max: 16000, unit: 'px', onChange: (n) => { v.width = n; } });
    const hf = numberField({ label: 'Height', value: height, min: 1, max: 16000, unit: 'px', onChange: (n) => { v.height = n; } });
    const preset = select({ label: 'Preset', value: '', options: [['', 'Custom'], ...PRESETS.map((p, i) => [String(i), p[0]])], onChange: (i) => {
      if (i === '') return;
      const p = PRESETS[+i];
      v.width = p[1]; v.height = p[2];
      wf.querySelector('input').value = p[1];
      hf.querySelector('input').value = p[2];
    } });
    const bg = select({ label: 'Background', value: 'white', onChange: (x) => { v.background = x; },
      options: [['white', 'White'], ['black', 'Black'], ['bg', 'Background color'], ['transparent', 'Transparent']] });
    const body = el('div', { class: 'form' },
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Name'), nameIn),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Preset'), preset),
      wf, hf,
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Background'), bg));
    modal({
      title: 'New Project', body, width: 360,
      buttons: [{ label: 'Cancel' }, { label: 'Create', primary: true, action: () => {
        v.name = nameIn.value || 'Untitled';
        v.width = clamp(Math.round(+wf.querySelector('input').value || v.width), 1, 16000);
        v.height = clamp(Math.round(+hf.querySelector('input').value || v.height), 1, 16000);
        const map = { white: '#ffffff', black: '#000000', bg: app.bg, transparent: null };
        res({ ...v, background: map[v.background] });
      } }],
      onClose: (r) => { if (r !== 'ok') res(null); },
    });
  });
}

export function imageSizeDialog(doc) {
  return new Promise((res) => {
    let w = doc.width, h = doc.height, keep = true;
    const ratio = doc.width / doc.height;
    const wf = numberField({ label: 'Width', value: w, min: 1, max: 16000, unit: 'px', onChange: (n) => { w = n; if (keep) { h = Math.max(1, Math.round(n / ratio)); hf.querySelector('input').value = h; } upd(); } });
    const hf = numberField({ label: 'Height', value: h, min: 1, max: 16000, unit: 'px', onChange: (n) => { h = n; if (keep) { w = Math.max(1, Math.round(n * ratio)); wf.querySelector('input').value = w; } upd(); } });
    const pct = el('div', { class: 'hint' });
    const upd = () => { pct.textContent = `${Math.round((w / doc.width) * 100)}% × ${Math.round((h / doc.height) * 100)}% of ${doc.width} × ${doc.height} px`; };
    upd();
    const body = el('div', { class: 'form' }, wf, hf, check({ label: 'Constrain proportions', value: true, onChange: (x) => { keep = x; } }), pct);
    modal({
      title: 'Image Size', body, width: 340,
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, action: () => res({ width: Math.round(w), height: Math.round(h) }) }],
      onClose: (r) => { if (r !== 'ok') res(null); },
    });
  });
}

export function canvasSizeDialog(doc) {
  return new Promise((res) => {
    let w = doc.width, h = doc.height, anchor = { x: 0.5, y: 0.5 };
    const wf = numberField({ label: 'Width', value: w, min: 1, max: 16000, unit: 'px', onChange: (n) => { w = n; } });
    const hf = numberField({ label: 'Height', value: h, min: 1, max: 16000, unit: 'px', onChange: (n) => { h = n; } });
    const grid = el('div', { class: 'anchor-grid', role: 'radiogroup', 'aria-label': 'Anchor' });
    const cells = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const b = el('button', { type: 'button', class: 'anchor-cell', 'aria-label': `Anchor ${x},${y}` });
      b.addEventListener('click', () => { anchor = { x: x / 2, y: y / 2 }; cells.forEach((c) => c.classList.remove('on')); b.classList.add('on'); });
      if (x === 1 && y === 1) b.classList.add('on');
      cells.push(b);
      grid.append(b);
    }
    const body = el('div', { class: 'form' }, el('div', { class: 'hint' }, `Current size: ${doc.width} × ${doc.height} px`), wf, hf,
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Anchor'), grid));
    modal({
      title: 'Canvas Size', body, width: 340,
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, action: () => res({ width: Math.round(w), height: Math.round(h), anchor }) }],
      onClose: (r) => { if (r !== 'ok') res(null); },
    });
  });
}

export function infoDialog(title, content, width = 560) {
  modal({ title, body: content, width, className: 'info-dialog', buttons: [{ label: 'Close', primary: true }] });
}
