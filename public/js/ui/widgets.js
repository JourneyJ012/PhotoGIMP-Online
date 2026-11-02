// Form widgets shared by panels and dialogs.

import { clamp, el, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../util.js';
import { icon } from '../icons.js';

const decimals = (step, digits) => digits ?? (step < 1 ? String(step).split('.')[1]?.length || 1 : 0);

/**
 * GIMP-style spin scale: a slider bar with the label inside and an editable
 * number at the right. onInput fires while dragging, onChange when done.
 */
export function spinScale({ label, min, max, step = 1, value, unit = '', digits, gamma = 1, onInput, onChange }) {
  const dec = decimals(step, digits);
  const fill = el('div', { class: 'spin-fill' });
  const input = el('input', { class: 'spin-input', type: 'text', inputmode: 'decimal', 'aria-label': label });
  const root = el('div', { class: 'spin', role: 'slider', 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max },
    fill, el('span', { class: 'spin-label' }, label), input, unit ? el('span', { class: 'spin-unit' }, unit) : null);
  let v = value;
  const toT = (x) => ((x - min) / (max - min)) ** (1 / gamma);
  const fromT = (t) => min + (max - min) * t ** gamma;
  const snap = (x) => {
    const s = Math.round(clamp(x, min, max) / step) * step;
    return +s.toFixed(Math.max(dec, 3));
  };
  const show = () => {
    fill.style.width = `${clamp(toT(v), 0, 1) * 100}%`;
    if (document.activeElement !== input) input.value = v.toFixed(dec);
    root.setAttribute('aria-valuenow', v);
  };
  const set = (x, fire) => {
    const nv = snap(x);
    if (nv === v && !fire) { show(); return; }
    v = nv;
    show();
    if (fire) onInput?.(v);
  };
  root.addEventListener('pointerdown', (e) => {
    if (e.target === input || e.button !== 0) return;
    e.preventDefault();
    input.blur();
    root.setPointerCapture(e.pointerId);
    root.classList.add('dragging');
    const r = root.getBoundingClientRect();
    const at = (ev) => set(fromT(clamp((ev.clientX - r.left) / r.width, 0, 1)), true);
    at(e);
    const mv = (ev) => at(ev);
    const up = () => {
      root.removeEventListener('pointermove', mv);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', up);
      root.classList.remove('dragging');
      onChange?.(v);
    };
    root.addEventListener('pointermove', mv);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  });
  const commitInput = () => {
    const n = parseFloat(input.value.replace(',', '.'));
    if (Number.isFinite(n)) { set(n, true); onChange?.(v); } else show();
  };
  input.addEventListener('change', commitInput);
  input.addEventListener('blur', show);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commitInput(); input.blur(); }
    else if (e.key === 'Escape') { show(); input.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      set(v + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), true);
      onChange?.(v);
      input.value = v.toFixed(dec);
    }
  });
  show();
  return { el: root, set: (x) => set(x, false), get: () => v };
}

export function select({ options, value, onChange, label }) {
  const s = el('select', { class: 'select', 'aria-label': label });
  for (const o of options) {
    if (o[0] === '-') { s.append(el('option', { disabled: true }, '──────────')); continue; }
    s.append(el('option', { value: o[0] }, o[1]));
  }
  s.value = String(value);
  s.addEventListener('change', () => {
    const raw = s.value;
    const match = options.find((o) => String(o[0]) === raw);
    onChange?.(match ? match[0] : raw);
  });
  return s;
}

export function check({ label, value, onChange }) {
  const input = el('input', { type: 'checkbox', checked: !!value });
  input.addEventListener('change', () => onChange?.(input.checked));
  return el('label', { class: 'check' }, input, el('span', {}, label));
}

/** Row of icon/text toggle buttons; options: [value, title, iconName?]. */
export function segmented({ options, value, onChange, label }) {
  const root = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const btns = options.map(([v, title, ic]) => {
    const b = el('button', { type: 'button', class: 'seg', title, 'aria-label': title, role: 'radio', html: ic ? icon(ic, 18) : '' });
    if (!ic) b.textContent = title;
    b.addEventListener('click', () => { setv(v); onChange?.(v); });
    root.append(b);
    return [v, b];
  });
  const setv = (val) => btns.forEach(([v, b]) => { b.classList.toggle('on', v === val); b.setAttribute('aria-checked', v === val); });
  setv(value);
  return root;
}

export function numberField({ label, value, min, max, step = 1, onChange, unit }) {
  const input = el('input', { type: 'number', class: 'num', value, min, max, step });
  input.addEventListener('change', () => {
    let n = parseFloat(input.value);
    if (!Number.isFinite(n)) n = value;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    input.value = n;
    onChange?.(n);
  });
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), input, unit ? el('span', { class: 'unit' }, unit) : null);
}

export function button(label, onClick, cls = '') {
  return el('button', { type: 'button', class: `btn ${cls}`, onclick: onClick }, label);
}

export function iconButton(name, title, onClick, cls = '') {
  return el('button', { type: 'button', class: `icon-btn ${cls}`, title, 'aria-label': title, html: icon(name, 18), onclick: onClick });
}

// ------------------------------------------------------------ color picker

/** HSV square + hue bar + numeric fields. onChange(hex) while editing. */
export function colorPicker(hex, onChange) {
  let hsv = rgbToHsv(hexToRgb(hex));
  const sv = el('canvas', { class: 'cp-sv', width: 256, height: 160 });
  const hue = el('canvas', { class: 'cp-hue', width: 256, height: 12 });
  const svDot = el('div', { class: 'cp-dot' });
  const hueDot = el('div', { class: 'cp-hdot' });
  const svWrap = el('div', { class: 'cp-svwrap' }, sv, svDot);
  const hueWrap = el('div', { class: 'cp-huewrap' }, hue, hueDot);
  const hexIn = el('input', { class: 'cp-hex', type: 'text', maxlength: 7, spellcheck: 'false', 'aria-label': 'Hex' });
  const fields = {};
  const mk = (k, max) => (fields[k] = el('input', { type: 'number', class: 'num cp-num', min: 0, max, 'aria-label': k.toUpperCase() }));
  const row = el('div', { class: 'cp-fields' },
    el('label', {}, 'H', mk('h', 360)), el('label', {}, 'S', mk('s', 100)), el('label', {}, 'B', mk('v', 100)),
    el('label', {}, 'R', mk('r', 255)), el('label', {}, 'G', mk('g', 255)), el('label', {}, 'B', mk('b', 255)),
    el('label', { class: 'cp-hexlabel' }, '#', hexIn));
  const root = el('div', { class: 'cp' }, svWrap, hueWrap, row);

  const hctx = hue.getContext('2d');
  const hg = hctx.createLinearGradient(0, 0, 256, 0);
  for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
  hctx.fillStyle = hg;
  hctx.fillRect(0, 0, 256, 12);

  const drawSV = () => {
    const c = sv.getContext('2d');
    const base = hsvToRgb({ h: hsv.h, s: 1, v: 1 });
    c.fillStyle = rgbToHex(base);
    c.fillRect(0, 0, 256, 160);
    const w = c.createLinearGradient(0, 0, 256, 0);
    w.addColorStop(0, '#fff'); w.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = w; c.fillRect(0, 0, 256, 160);
    const b = c.createLinearGradient(0, 0, 0, 160);
    b.addColorStop(0, 'rgba(0,0,0,0)'); b.addColorStop(1, '#000');
    c.fillStyle = b; c.fillRect(0, 0, 256, 160);
  };
  const current = () => rgbToHex(hsvToRgb(hsv));
  const show = (skip) => {
    drawSV();
    svDot.style.left = `${hsv.s * 100}%`;
    svDot.style.top = `${(1 - hsv.v) * 100}%`;
    hueDot.style.left = `${(hsv.h / 360) * 100}%`;
    const hx = current(), rgb = hexToRgb(hx);
    if (skip !== 'hex') hexIn.value = hx.slice(1);
    const vals = { h: Math.round(hsv.h), s: Math.round(hsv.s * 100), v: Math.round(hsv.v * 100), ...rgb };
    for (const k in fields) if (skip !== k) fields[k].value = vals[k];
  };
  const changed = (skip) => { show(skip); onChange?.(current()); };

  const drag = (target, fn) => target.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    target.setPointerCapture(e.pointerId);
    const r = target.getBoundingClientRect();
    const at = (ev) => { fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)); changed(); };
    at(e);
    const mv = (ev) => at(ev);
    const up = () => { target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', up); };
    target.addEventListener('pointermove', mv);
    target.addEventListener('pointerup', up);
  });
  drag(svWrap, (x, y) => { hsv = { ...hsv, s: x, v: 1 - y }; });
  drag(hueWrap, (x) => { hsv = { ...hsv, h: Math.min(359.9, x * 360) }; });

  hexIn.addEventListener('input', () => {
    const v = hexIn.value.replace('#', '');
    if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { hsv = rgbToHsv(hexToRgb(v)); changed('hex'); }
  });
  for (const k of ['h', 's', 'v']) fields[k].addEventListener('input', () => {
    const n = +fields[k].value || 0;
    hsv = { ...hsv, [k]: k === 'h' ? clamp(n, 0, 359.9) : clamp(n / 100, 0, 1) };
    changed(k);
  });
  for (const k of ['r', 'g', 'b']) fields[k].addEventListener('input', () => {
    const rgb = hexToRgb(current());
    rgb[k] = clamp(+fields[k].value || 0, 0, 255);
    hsv = rgbToHsv(rgb);
    changed(k);
  });
  show();
  return {
    el: root,
    get: current,
    set(h) { if (h.toLowerCase() === current()) return; hsv = rgbToHsv(hexToRgb(h)); show(); },
  };
}
