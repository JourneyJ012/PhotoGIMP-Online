// Selections are doc-sized alpha masks (white pixels, alpha = selected amount).
// Selection objects are immutable: every change makes a new one.

import { createCanvas, copyCanvas, getData } from './util.js';
import { gaussianBlur } from './filters.js';

export class Selection {
  constructor(canvas) {
    this.canvas = canvas;
    const { width: w, height: h } = canvas;
    const d = getData(canvas).data;
    this.data = d;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4) {
        if (d[i]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    this.bounds = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    this._ants = null;
  }

  get empty() { return !this.bounds; }

  alphaAt(x, y) {
    const { width: w, height: h } = this.canvas;
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return this.data[(y * w + x) * 4 + 3];
  }

  /** Outline of the selection (alpha >= 50%) as a Path2D in doc coordinates. */
  get ants() {
    if (this._ants) return this._ants;
    const p = new Path2D();
    const b = this.bounds;
    if (!b) return (this._ants = p);
    const W = this.canvas.width, d = this.data;
    // Inside map with a one pixel border around the bounds.
    const mw = b.w + 2, mh = b.h + 2, m = new Uint8Array(mw * mh);
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        m[(y + 1) * mw + x + 1] = d[((b.y + y) * W + b.x + x) * 4 + 3] >= 128 ? 1 : 0;
      }
    }
    // Horizontal edges: between rows y-1 and y.
    for (let y = 1; y < mh; y++) {
      let run = -1;
      for (let x = 1; x < mw; x++) {
        const e = m[y * mw + x] !== m[(y - 1) * mw + x];
        if (e && run < 0) run = x;
        else if (!e && run >= 0) { p.moveTo(b.x + run - 1, b.y + y - 1); p.lineTo(b.x + x - 1, b.y + y - 1); run = -1; }
      }
    }
    // Vertical edges: between columns x-1 and x.
    for (let x = 1; x < mw; x++) {
      let run = -1;
      for (let y = 1; y < mh; y++) {
        const e = m[y * mw + x] !== m[y * mw + x - 1];
        if (e && run < 0) run = y;
        else if (!e && run >= 0) { p.moveTo(b.x + x - 1, b.y + run - 1); p.lineTo(b.x + x - 1, b.y + y - 1); run = -1; }
      }
    }
    return (this._ants = p);
  }
}

export const maskCanvas = (w, h) => createCanvas(w, h, { readable: true });

/** A mask filled by draw(ctx), which should build a path and fill it. */
export function shapeMask(w, h, draw) {
  const c = maskCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  draw(ctx);
  return c;
}

/** A mask from a Uint8Array of 0..255 values (one per doc pixel). */
export function maskFromArray(w, h, arr) {
  const c = maskCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0, j = 0; i < arr.length; i++, j += 4) {
    if (arr[i]) { d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = arr[i]; }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const OPS = { add: 'source-over', subtract: 'destination-out', intersect: 'destination-in' };

/** Combine the current selection with a new mask. Returns a Selection or null. */
export function combine(current, mask, mode = 'replace') {
  let c;
  if (mode === 'replace' || !current) {
    // Subtracting from or intersecting with nothing leaves nothing.
    if (mode === 'subtract' || mode === 'intersect') return null;
    c = mask;
  } else {
    c = copyCanvas(current.canvas, { readable: true });
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = OPS[mode];
    ctx.drawImage(mask, 0, 0);
  }
  const sel = new Selection(c);
  return sel.empty ? null : sel;
}

export function selectAll(w, h) {
  return new Selection(shapeMask(w, h, (ctx) => ctx.fillRect(0, 0, w, h)));
}

export function invert(sel, w, h) {
  const c = shapeMask(w, h, (ctx) => ctx.fillRect(0, 0, w, h));
  if (sel) {
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(sel.canvas, 0, 0);
  }
  const s = new Selection(c);
  return s.empty ? null : s;
}

export function feather(sel, radius) {
  const c = sel.canvas;
  const img = getData(c);
  const out = gaussianBlur(img, radius);
  const m = maskCanvas(c.width, c.height);
  m.getContext('2d').putImageData(out, 0, 0);
  const s = new Selection(m);
  return s.empty ? null : s;
}

/** Grow (r > 0) or shrink (r < 0) by blurring and re-thresholding. */
export function growShrink(sel, r) {
  const c = sel.canvas;
  const img = gaussianBlur(getData(c), Math.abs(r) / 2);
  const d = img.data;
  const t = r > 0 ? 8 : 247;
  for (let i = 3; i < d.length; i += 4) {
    d[i] = d[i] > t ? 255 : 0;
    d[i - 3] = d[i - 2] = d[i - 1] = 255;
  }
  const m = maskCanvas(c.width, c.height);
  m.getContext('2d').putImageData(img, 0, 0);
  const s = new Selection(m);
  return s.empty ? null : s;
}

/**
 * Pixels similar to the one at (sx, sy) in an ImageData: Uint8Array mask.
 * tolerance is 0..255 (max channel difference, like GIMP's threshold).
 */
export function floodMask(img, sx, sy, tolerance, contiguous = true) {
  const { width: w, height: h, data: d } = img;
  const mask = new Uint8Array(w * h);
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask;
  const i0 = (sy * w + sx) * 4;
  const r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3];
  const match = (p) => {
    const i = p * 4;
    const a = d[i + 3];
    // Fully transparent pixels match each other whatever their RGB.
    if (a0 === 0 && a === 0) return true;
    return Math.max(Math.abs(d[i] - r0), Math.abs(d[i + 1] - g0), Math.abs(d[i + 2] - b0), Math.abs(a - a0)) <= tolerance;
  };
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (match(p)) mask[p] = 255;
    return mask;
  }
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(), x0 = stack.pop();
    let x = x0;
    const row = y * w;
    if (mask[row + x] || !match(row + x)) continue;
    while (x > 0 && !mask[row + x - 1] && match(row + x - 1)) x--;
    let upOpen = false, downOpen = false;
    for (; x < w && !mask[row + x] && match(row + x); x++) {
      mask[row + x] = 255;
      if (y > 0) {
        const m = !mask[row - w + x] && match(row - w + x);
        if (m && !upOpen) stack.push(x, y - 1);
        upOpen = m;
      }
      if (y < h - 1) {
        const m = !mask[row + w + x] && match(row + w + x);
        if (m && !downOpen) stack.push(x, y + 1);
        downOpen = m;
      }
    }
  }
  return mask;
}

/** Clip a canvas drawn in doc space to the selection (in place). */
export function clipToSelection(canvas, sel, offX = 0, offY = 0) {
  if (!sel) return canvas;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(sel.canvas, -offX, -offY);
  ctx.restore();
  return canvas;
}
