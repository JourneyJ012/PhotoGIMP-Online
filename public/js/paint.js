// Brush engine. A stroke is painted into a doc-sized stroke canvas with the
// brush's flow; the layer shows layer + stroke at the brush opacity while
// painting, and the stroke is merged into the layer once, on release. That
// gives Photoshop-like opacity (a single stroke never builds up past it).

import { createCanvas, hexToRgb, rectUnion, rectIntersect, getData } from './util.js';

const tipCache = new Map();

function cacheGet(key, make) {
  let v = tipCache.get(key);
  if (!v) {
    v = make();
    tipCache.set(key, v);
    if (tipCache.size > 48) tipCache.delete(tipCache.keys().next().value);
  }
  return v;
}

/** A brush tip canvas of the given diameter, hardness (0..1) and color. */
export function getTip(diam, hardness, color, aliased = false) {
  diam = Math.max(0.5, diam);
  const key = `${diam.toFixed(2)}|${hardness.toFixed(2)}|${color}|${aliased}`;
  return cacheGet(key, () => {
    if (aliased) {
      const s = Math.max(1, Math.round(diam));
      const c = createCanvas(s, s);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(s, s);
      const { r, g, b } = hexToRgb(color), rad = s / 2;
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        if (Math.hypot(x + 0.5 - rad, y + 0.5 - rad) <= rad || s <= 2) {
          const i = (y * s + x) * 4;
          img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return c;
    }
    const s = Math.ceil(diam) + 2;
    const c = createCanvas(s, s);
    const ctx = c.getContext('2d');
    const { r, g, b } = hexToRgb(color), rad = diam / 2;
    const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, rad);
    const col = (a) => `rgba(${r},${g},${b},${a})`;
    // Hard brushes still get about a pixel of antialiasing.
    const inner = Math.min(Math.max(hardness, 0), Math.max(0, 1 - 1.2 / rad));
    grad.addColorStop(0, col(1));
    if (inner > 0) grad.addColorStop(inner, col(1));
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      grad.addColorStop(inner + (1 - inner) * t, col(0.5 * (1 + Math.cos(Math.PI * t))));
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, rad, 0, Math.PI * 2);
    ctx.fill();
    return c;
  });
}

/** Tip alpha as floats 0..1 (for tools that edit pixels directly). */
function tipAlpha(diam, hardness) {
  const key = `alpha|${Math.round(diam)}|${hardness.toFixed(2)}`;
  return cacheGet(key, () => {
    const c = getTip(Math.max(1, Math.round(diam)), hardness, '#ffffff');
    const d = getData(c).data, a = new Float32Array(c.width * c.height);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
    return { s: c.width, a };
  });
}

class BaseStroke {
  constructor({ size, spacing = 0.15, pressureSize = true }) {
    this.size = size;
    this.spacing = spacing;
    this.pressureSize = pressureSize;
    this.last = null;
    this.rest = 0;
    this.dirty = null; // doc rect
  }

  sizeAt(p) { return this.pressureSize ? Math.max(1, this.size * p) : this.size; }

  start(x, y, p = 1) {
    this.last = { x, y, p };
    this.rest = 0;
    this.dab(x, y, p);
  }

  to(x, y, p = 1) {
    const l = this.last;
    if (!l) return this.start(x, y, p);
    const dx = x - l.x, dy = y - l.y, len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    let t = this.rest;
    while (t <= len) {
      const k = t / len, pp = l.p + (p - l.p) * k;
      if (t > 0) this.dab(l.x + dx * k, l.y + dy * k, pp);
      t += Math.max(0.5, this.sizeAt(pp) * this.spacing);
    }
    this.rest = t - len;
    this.last = { x, y, p };
  }
}

/**
 * mode: 'paint' | 'erase' | 'clone'.
 * For clone, cloneSource is a doc-sized canvas and cloneOffset {x,y} is the
 * source position minus the painted position.
 */
export class Stroke extends BaseStroke {
  constructor(opts) {
    super(opts);
    Object.assign(this, { hardness: 1, flow: 1, opacity: 1, color: '#000', aliased: false, mode: 'paint' }, opts);
    const { doc } = this;
    this.canvas = createCanvas(doc.width, doc.height);
    this.ctx = this.canvas.getContext('2d');
    this.dabCanvas = createCanvas(8, 8);
    this.previewCanvas = null;
    this.version = 0;
    this.selection = doc.selection;
  }

  dab(x, y, p) {
    const d = this.sizeAt(p);
    const tip = getTip(d, this.hardness, this.mode === 'erase' || this.mode === 'clone' ? '#000000' : this.color, this.aliased);
    const s = tip.width;
    let dx = x - s / 2, dy = y - s / 2;
    if (this.aliased) { dx = Math.round(dx); dy = Math.round(dy); }
    let src = tip;
    if (this.mode === 'clone' || this.selection) {
      const dc = this.dabCanvas;
      if (dc.width < s || dc.height < s) { dc.width = s; dc.height = s; }
      const c = dc.getContext('2d');
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, dc.width, dc.height);
      c.drawImage(tip, 0, 0);
      if (this.mode === 'clone') {
        c.globalCompositeOperation = 'source-in';
        c.drawImage(this.cloneSource, -(dx + this.cloneOffset.x), -(dy + this.cloneOffset.y));
      }
      if (this.selection) {
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(this.selection.canvas, -dx, -dy);
      }
      src = dc;
    }
    this.ctx.globalAlpha = this.flow;
    this.ctx.drawImage(src, 0, 0, s, s, dx, dy, s, s);
    this.dirty = rectUnion(this.dirty, { x: Math.floor(dx), y: Math.floor(dy), w: s + 2, h: s + 2 });
    this.version++;
  }

  /** The layer as it looks with the stroke applied (for layer.preview). */
  preview() {
    const l = this.layer;
    let pc = this.previewCanvas;
    if (!pc || pc.width !== l.canvas.width || pc.height !== l.canvas.height) {
      pc = this.previewCanvas = createCanvas(l.canvas.width, l.canvas.height);
      this._pv = -1;
    }
    if (this._pv !== this.version) {
      const c = pc.getContext('2d');
      c.globalCompositeOperation = 'copy';
      c.globalAlpha = 1;
      c.drawImage(l.canvas, 0, 0);
      this.apply(c);
      this._pv = this.version;
    }
    return { canvas: pc, x: l.x, y: l.y };
  }

  /** Draw the stroke into a layer context (layer coordinates). */
  apply(ctx) {
    const l = this.layer;
    ctx.globalCompositeOperation = this.mode === 'erase' ? 'destination-out'
      : this.lockAlpha ? 'source-atop' : 'source-over';
    ctx.globalAlpha = this.opacity;
    ctx.drawImage(this.canvas, -l.x, -l.y);
  }

  /** Dirty rect in layer coordinates. */
  layerRect() {
    if (!this.dirty) return null;
    const l = this.layer;
    return rectIntersect({ ...this.dirty, x: this.dirty.x - l.x, y: this.dirty.y - l.y },
      { x: 0, y: 0, w: l.canvas.width, h: l.canvas.height });
  }
}

/**
 * Dodge / burn / blur / sharpen: edit the layer's pixels dab by dab.
 * kind: 'dodge' | 'burn' | 'blur' | 'sharpen'; range: 'shadows'|'midtones'|'highlights'.
 */
export class ToneStroke extends BaseStroke {
  constructor(opts) {
    super({ spacing: 0.25, ...opts });
    Object.assign(this, { hardness: 0.5, strength: 0.5, range: 'midtones' }, opts);
    this.selection = this.doc.selection;
  }

  dab(x, y, p) {
    const { layer } = this;
    const d = this.sizeAt(p);
    const { s, a: tip } = tipAlpha(d, this.hardness);
    const lx = Math.round(x - layer.x - s / 2), ly = Math.round(y - layer.y - s / 2);
    const pad = this.kind === 'blur' || this.kind === 'sharpen' ? 1 : 0;
    const r = rectIntersect({ x: lx - pad, y: ly - pad, w: s + pad * 2, h: s + pad * 2 },
      { x: 0, y: 0, w: layer.canvas.width, h: layer.canvas.height });
    if (!r) return;
    const ctx = layer.canvas.getContext('2d');
    const img = ctx.getImageData(r.x, r.y, r.w, r.h);
    const src = new Uint8ClampedArray(img.data), out = img.data;
    const sel = this.selection;
    const k = this.strength;
    for (let yy = 0; yy < r.h; yy++) {
      for (let xx = 0; xx < r.w; xx++) {
        const tx = r.x + xx - lx, ty = r.y + yy - ly;
        if (tx < 0 || ty < 0 || tx >= s || ty >= s) continue;
        let w = tip[ty * s + tx] * k;
        if (sel) w *= sel.alphaAt(r.x + xx + layer.x, r.y + yy + layer.y) / 255;
        if (w <= 0.001) continue;
        const i = (yy * r.w + xx) * 4;
        if (this.kind === 'dodge' || this.kind === 'burn') {
          const L = (0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) / 255;
          const tone = this.range === 'shadows' ? (1 - L) ** 2 : this.range === 'highlights' ? L * L : 4 * L * (1 - L);
          const f = w * tone * 0.35;
          for (let c = 0; c < 3; c++) {
            out[i + c] = this.kind === 'dodge' ? src[i + c] + (255 - src[i + c]) * f : src[i + c] * (1 - f);
          }
        } else {
          for (let c = 0; c < 4; c++) {
            let sum = 0, n = 0;
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
              const X = xx + ox, Y = yy + oy;
              if (X < 0 || Y < 0 || X >= r.w || Y >= r.h) continue;
              sum += src[(Y * r.w + X) * 4 + c]; n++;
            }
            const avg = sum / n, v = src[i + c];
            out[i + c] = this.kind === 'blur' ? v + (avg - v) * w : v + (v - avg) * w * 0.8;
          }
        }
      }
    }
    ctx.putImageData(img, r.x, r.y);
    this.dirty = rectUnion(this.dirty, r);
    layer.version++;
  }
}
