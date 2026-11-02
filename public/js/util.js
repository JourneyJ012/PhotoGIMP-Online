// Small shared helpers: DOM building, canvases, rectangles, colors, events.

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

let uidCounter = 0;
export const uid = () => `${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Create an element: el('div', {class: 'x', onclick: fn}, child, 'text'). */
export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'value' || k === 'checked' || k === 'selected') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : String(kid));
  }
  return e;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// ---------------------------------------------------------------- canvases

export function createCanvas(w, h, { readable = false } = {}) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  // The first getContext() call fixes the options for the canvas.
  c.getContext('2d', readable ? { willReadFrequently: true } : undefined);
  return c;
}

export function copyCanvas(src, opts) {
  const c = createCanvas(src.width, src.height, opts);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

/** Copy rect r ({x,y,w,h}) of src into a new canvas. */
export function cropCanvas(src, r, opts) {
  const c = createCanvas(r.w, r.h, opts);
  c.getContext('2d').drawImage(src, -r.x, -r.y);
  return c;
}

/** Replace rect r of dst with patch (a canvas of size r.w x r.h). */
export function putPatch(dst, r, patch) {
  const ctx = dst.getContext('2d');
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(r.x, r.y, r.w, r.h);
  ctx.drawImage(patch, r.x, r.y);
  ctx.restore();
}

export function getData(canvas, r = { x: 0, y: 0, w: canvas.width, h: canvas.height }) {
  return canvas.getContext('2d').getImageData(r.x, r.y, r.w, r.h);
}

export function canvasFromData(imageData, opts) {
  const c = createCanvas(imageData.width, imageData.height, opts);
  c.getContext('2d').putImageData(imageData, 0, 0);
  return c;
}

/** Bounding box of pixels with alpha > 0, or null when fully transparent. */
export function alphaBounds(canvas, threshold = 0) {
  const { width: w, height: h } = canvas;
  const d = getData(canvas).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    let row = y * w * 4 + 3;
    for (let x = 0; x < w; x++, row += 4) {
      if (d[row] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, quality));
}

// ---------------------------------------------------------------- rectangles

export const rect = (x, y, w, h) => ({ x, y, w, h });

export function rectUnion(a, b) {
  if (!a) return b && { ...b };
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rectIntersect(a, b) {
  if (!a || !b) return null;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

/** Expand a float rect to integer pixel bounds. */
export function rectInt(r, pad = 0) {
  const x = Math.floor(r.x - pad), y = Math.floor(r.y - pad);
  return { x, y, w: Math.ceil(r.x + r.w + pad) - x, h: Math.ceil(r.y + r.h + pad) - y };
}

export const rectFromPoints = (a, b) => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
});

// ---------------------------------------------------------------- colors

export function hexToRgb(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const rgbToHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

export function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// ---------------------------------------------------------------- misc

export class Emitter {
  constructor() { this._handlers = {}; }
  on(type, fn) { (this._handlers[type] ||= new Set()).add(fn); return () => this._handlers[type].delete(fn); }
  emit(type, arg) { for (const fn of this._handlers[type] || []) fn(arg); }
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Run fn at most once per animation frame with the latest arguments. */
export function rafThrottle(fn) {
  let pending = false, args;
  return (...a) => {
    args = a;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(...args); });
  };
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const baseName = (name) => name.replace(/\.[^.]+$/, '');

export const isEditable = (t) =>
  t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
