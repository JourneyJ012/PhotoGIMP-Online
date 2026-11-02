// Pixel operations on ImageData. Each function returns an ImageData (often the
// same object, modified in place). ADJUSTMENTS and FILTERS describe the dialogs.

import { clamp } from './util.js';

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function applyLUT(img, lr, lg = lr, lb = lr) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]];
  }
  return img;
}

const makeLUT = (fn) => {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = fn(i);
  return t;
};
const IDENTITY = makeLUT((v) => v);

// ------------------------------------------------------------ blur family

function boxPass(src, dst, w, h, r, horizontal) {
  const inv = 1 / (r + r + 1);
  const n = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w * 4 : line * 4;
    for (let c = 0; c < 4; c++) {
      const o = base + c;
      let val = 0;
      for (let k = -r; k <= r; k++) val += src[o + clamp(k, 0, n - 1) * step];
      for (let x = 0; x < n; x++) {
        dst[o + x * step] = val * inv;
        const add = x + r + 1 >= n ? n - 1 : x + r + 1;
        const sub = x - r < 0 ? 0 : x - r;
        val += src[o + add * step] - src[o + sub * step];
      }
    }
  }
}

function boxesForGauss(sigma, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
}

/** Gaussian blur (3 box passes), premultiplied so edges don't halo. */
export function gaussianBlur(img, radius) {
  if (radius < 0.3) return img;
  const { width: w, height: h, data: d } = img;
  let a = new Float32Array(d.length), b = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const al = d[i + 3] / 255;
    a[i] = d[i] * al; a[i + 1] = d[i + 1] * al; a[i + 2] = d[i + 2] * al; a[i + 3] = d[i + 3];
  }
  for (const r of boxesForGauss(radius)) {
    if (r < 1) continue;
    boxPass(a, b, w, h, r, true);
    boxPass(b, a, w, h, r, false);
  }
  const out = new ImageData(w, h);
  const o = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const al = a[i + 3];
    o[i + 3] = al;
    if (al > 0) {
      const k = 255 / al;
      o[i] = a[i] * k; o[i + 1] = a[i + 1] * k; o[i + 2] = a[i + 2] * k;
    }
  }
  return out;
}

function unsharp(img, { radius, amount, threshold }) {
  const blurred = gaussianBlur(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), radius).data;
  const d = img.data, k = amount / 100;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = d[i + c] - blurred[i + c];
      if (Math.abs(diff) >= threshold) d[i + c] = d[i + c] + diff * k;
    }
  }
  return img;
}

function motionBlur(img, { angle, distance }) {
  const { width: w, height: h, data: d } = img;
  const out = new ImageData(w, h), o = out.data;
  const rad = (angle * Math.PI) / 180, dx = Math.cos(rad), dy = -Math.sin(rad);
  const n = Math.max(1, Math.round(distance));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, cnt = 0;
      for (let s = -n; s <= n; s++) {
        const xx = Math.round(x + dx * s), yy = Math.round(y + dy * s);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const i = (yy * w + xx) * 4, al = d[i + 3];
        r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; cnt++;
      }
      const i = (y * w + x) * 4;
      if (a) { o[i] = r / a; o[i + 1] = g / a; o[i + 2] = b / a; }
      o[i + 3] = a / cnt;
    }
  }
  return out;
}

// ------------------------------------------------------------ other filters

function noise(img, { amount, mono }) {
  const d = img.data, k = (amount / 100) * 128;
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
  for (let i = 0; i < d.length; i += 4) {
    if (mono) {
      const n = gauss() * k;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    } else {
      d[i] += gauss() * k; d[i + 1] += gauss() * k; d[i + 2] += gauss() * k;
    }
  }
  return img;
}

function pixelate(img, { size }) {
  const { width: w, height: h, data: d } = img;
  size = Math.max(1, Math.round(size));
  for (let by = 0; by < h; by += size) {
    for (let bx = 0; bx < w; bx += size) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const ex = Math.min(bx + size, w), ey = Math.min(by + size, h);
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const i = (y * w + x) * 4, al = d[i + 3];
        r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; n++;
      }
      const cr = a ? r / a : 0, cg = a ? g / a : 0, cb = a ? b / a : 0, ca = a / n;
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const i = (y * w + x) * 4;
        d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = ca;
      }
    }
  }
  return img;
}

function emboss(img, { angle, height, amount }) {
  const { width: w, height: h, data: d } = img;
  const out = new ImageData(w, h), o = out.data;
  const rad = (angle * Math.PI) / 180;
  const dx = Math.round(Math.cos(rad) * height), dy = Math.round(-Math.sin(rad) * height);
  const L = (x, y) => {
    const i = (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4;
    return lum(d[i], d[i + 1], d[i + 2]);
  };
  const k = amount / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 128 + (L(x - dx, y - dy) - L(x + dx, y + dy)) * k;
    const i = (y * w + x) * 4;
    o[i] = o[i + 1] = o[i + 2] = v;
    o[i + 3] = d[i + 3];
  }
  return out;
}

function findEdges(img) {
  const { width: w, height: h, data: d } = img;
  const out = new ImageData(w, h), o = out.data;
  const P = (x, y, c) => d[(clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4 + c];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      const gx = -P(x - 1, y - 1, c) - 2 * P(x - 1, y, c) - P(x - 1, y + 1, c)
        + P(x + 1, y - 1, c) + 2 * P(x + 1, y, c) + P(x + 1, y + 1, c);
      const gy = -P(x - 1, y - 1, c) - 2 * P(x, y - 1, c) - P(x + 1, y - 1, c)
        + P(x - 1, y + 1, c) + 2 * P(x, y + 1, c) + P(x + 1, y + 1, c);
      o[i + c] = 255 - Math.min(255, Math.hypot(gx, gy) / 2);
    }
    o[i + 3] = d[i + 3];
  }
  return out;
}

function vignette(img, { amount, size }) {
  const { width: w, height: h, data: d } = img;
  const cx = w / 2, cy = h / 2, maxR = Math.hypot(cx, cy);
  const inner = (size / 100) * maxR, k = amount / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = Math.hypot(x - cx, y - cy);
    if (r <= inner) continue;
    let t = (r - inner) / (maxR - inner);
    t = t * t * (3 - 2 * t);
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      d[i + c] = k >= 0 ? d[i + c] * (1 - t * k) : d[i + c] + (255 - d[i + c]) * t * -k;
    }
  }
  return img;
}

// ------------------------------------------------------------ adjustments

function brightnessContrast(img, { brightness, contrast }) {
  const c = contrast * 1.27;
  const f = (259 * (c + 255)) / (255 * (259 - c));
  return applyLUT(img, makeLUT((v) => f * (v - 128) + 128 + brightness));
}

export function levelsLUT({ inBlack, inWhite, gamma, outBlack, outWhite }) {
  const span = Math.max(1, inWhite - inBlack);
  return makeLUT((v) => {
    const t = clamp((v - inBlack) / span, 0, 1) ** (1 / gamma);
    return outBlack + t * (outWhite - outBlack);
  });
}

function levels(img, v) {
  const t = levelsLUT(v);
  if (v.channel === 'r') return applyLUT(img, t, IDENTITY, IDENTITY);
  if (v.channel === 'g') return applyLUT(img, IDENTITY, t, IDENTITY);
  if (v.channel === 'b') return applyLUT(img, IDENTITY, IDENTITY, t);
  return applyLUT(img, t);
}

/** Monotone cubic interpolation through points [[x,y],...] (0..255). */
export function curveLUT(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0]);
  const n = p.length;
  if (n < 2) return IDENTITY;
  const dx = [], m = [], s = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = Math.max(1e-6, p[i + 1][0] - p[i][0]);
    s[i] = (p[i + 1][1] - p[i][1]) / dx[i];
  }
  m[0] = s[0]; m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / s[i], b = m[i + 1] / s[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * s[i]; m[i + 1] = t * b * s[i]; }
  }
  return makeLUT((x) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0;
    while (x > p[i + 1][0]) i++;
    const h = dx[i], t = (x - p[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i]
      + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
  });
}

function curves(img, { curves: c }) {
  const all = curveLUT(c.rgb);
  const compose = (ch) => { const l = curveLUT(c[ch]); return makeLUT((v) => all[l[v]]); };
  return applyLUT(img, compose('r'), compose('g'), compose('b'));
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

function hueSaturation(img, { hue, saturation, lightness, colorize }) {
  const d = img.data, dh = hue / 360, ds = saturation / 100, dl = lightness / 100;
  for (let i = 0; i < d.length; i += 4) {
    let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (colorize) {
      h = ((hue + 360) % 360) / 360;
      s = clamp(0.25 + ds * 0.75, 0, 1);
    } else {
      h = (h + dh + 1) % 1;
      s = ds > 0 ? s + (1 - s) * ds * s : s * (1 + ds);
    }
    l = dl > 0 ? l + (1 - l) * dl : l * (1 + dl);
    const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return img;
}

function colorBalance(img, v) {
  const d = img.data;
  const sh = [v.sCR, v.sMG, v.sYB], mi = [v.mCR, v.mMG, v.mYB], hi = [v.hCR, v.hMG, v.hYB];
  const band = (x, c) => clamp((x - c) / 0.25 + 0.5, 0, 1);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const L = lum(r, g, b) / 255;
    const ws = (1 - band(L, 0.333)) * 0.7;
    const wh = band(L, 0.666) * 0.7;
    const wm = band(L, 0.333) * (1 - band(L, 0.666)) * 0.7;
    const out = [r, g, b];
    for (let c = 0; c < 3; c++) out[c] += ((sh[c] * ws + mi[c] * wm + hi[c] * wh) / 100) * 128;
    if (v.preserve) {
      const [h, s] = rgbToHsl(clamp(out[0], 0, 255), clamp(out[1], 0, 255), clamp(out[2], 0, 255));
      const [, , l] = rgbToHsl(r, g, b);
      [out[0], out[1], out[2]] = hslToRgb(h, s, l);
    }
    d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
  }
  return img;
}

function exposure(img, { exposure: ev, offset, gamma }) {
  const k = 2 ** ev;
  return applyLUT(img, makeLUT((v) => clamp(((v / 255) * k + offset), 0, 1) ** (1 / gamma) * 255));
}

function vibrance(img, { vibrance: vb, saturation }) {
  const d = img.data, kv = vb / 100, ks = saturation / 100;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), avg = (r + g + b) / 3;
    const amt = ks + kv * (1 - (max - Math.min(r, g, b)) / 255) * 1.5;
    d[i] = r + (r - avg) * amt; d[i + 1] = g + (g - avg) * amt; d[i + 2] = b + (b - avg) * amt;
  }
  return img;
}

function invert(img) { return applyLUT(img, makeLUT((v) => 255 - v)); }

function desaturate(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lum(d[i], d[i + 1], d[i + 2]);
  return img;
}

function blackWhite(img, { red, green, blue, tint, tintColor }) {
  const d = img.data, wr = red / 100, wg = green / 100, wb = blue / 100;
  const t = tint ? [parseInt(tintColor.slice(1, 3), 16), parseInt(tintColor.slice(3, 5), 16), parseInt(tintColor.slice(5, 7), 16)] : null;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] * wr + d[i + 1] * wg + d[i + 2] * wb;
    if (t) { d[i] = (v * t[0]) / 255 * 1.4; d[i + 1] = (v * t[1]) / 255 * 1.4; d[i + 2] = (v * t[2]) / 255 * 1.4; }
    else d[i] = d[i + 1] = d[i + 2] = v;
  }
  return img;
}

function threshold(img, { level }) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lum(d[i], d[i + 1], d[i + 2]) >= level ? 255 : 0;
  return img;
}

function posterize(img, { levels: n }) {
  const k = 255 / (n - 1);
  return applyLUT(img, makeLUT((v) => Math.round(Math.round(v / k) * k)));
}

/** Per-channel stretch with 0.1% clipping (Photoshop's Auto Tone). */
export function autoTone(img) {
  const d = img.data, hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++; n++;
  }
  if (!n) return img;
  const clip = n * 0.001;
  const luts = hist.map((hh) => {
    let lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += hh[lo]) <= clip) lo++;
    acc = 0;
    while (hi > 0 && (acc += hh[hi]) <= clip) hi--;
    if (hi <= lo) return IDENTITY;
    return makeLUT((v) => ((v - lo) * 255) / (hi - lo));
  });
  return applyLUT(img, ...luts);
}

/** Luminance histogram (or one channel) as 256 counts. */
export function histogram(img, channel = 'rgb') {
  const d = img.data, h = new Uint32Array(256);
  const ci = { r: 0, g: 1, b: 2 }[channel];
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    h[ci === undefined ? Math.round(lum(d[i], d[i + 1], d[i + 2])) : d[i + ci]]++;
  }
  return h;
}

// ------------------------------------------------------------ registry

const ch = { id: 'channel', label: 'Channel', type: 'select', value: 'rgb', options: [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']] };

export const ADJUSTMENTS = {
  'brightness-contrast': {
    title: 'Brightness/Contrast', apply: brightnessContrast,
    fields: [
      { id: 'brightness', label: 'Brightness', type: 'range', min: -150, max: 150, value: 0 },
      { id: 'contrast', label: 'Contrast', type: 'range', min: -50, max: 100, value: 0 },
    ],
  },
  levels: {
    title: 'Levels', apply: levels, histogram: true,
    fields: [
      ch,
      { id: 'inBlack', label: 'Input black', type: 'range', min: 0, max: 253, value: 0 },
      { id: 'gamma', label: 'Gamma', type: 'range', min: 0.1, max: 9.99, step: 0.01, value: 1, digits: 2 },
      { id: 'inWhite', label: 'Input white', type: 'range', min: 2, max: 255, value: 255 },
      { id: 'outBlack', label: 'Output black', type: 'range', min: 0, max: 255, value: 0 },
      { id: 'outWhite', label: 'Output white', type: 'range', min: 0, max: 255, value: 255 },
    ],
  },
  curves: {
    title: 'Curves', apply: curves,
    fields: [{ id: 'curves', type: 'curves', value: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] } }],
  },
  exposure: {
    title: 'Exposure', apply: exposure,
    fields: [
      { id: 'exposure', label: 'Exposure', type: 'range', min: -5, max: 5, step: 0.01, value: 0, digits: 2 },
      { id: 'offset', label: 'Offset', type: 'range', min: -0.5, max: 0.5, step: 0.001, value: 0, digits: 3 },
      { id: 'gamma', label: 'Gamma', type: 'range', min: 0.1, max: 9.99, step: 0.01, value: 1, digits: 2 },
    ],
  },
  vibrance: {
    title: 'Vibrance', apply: vibrance,
    fields: [
      { id: 'vibrance', label: 'Vibrance', type: 'range', min: -100, max: 100, value: 0 },
      { id: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100, value: 0 },
    ],
  },
  'hue-saturation': {
    title: 'Hue/Saturation', apply: hueSaturation,
    fields: [
      { id: 'hue', label: 'Hue', type: 'range', min: -180, max: 180, value: 0 },
      { id: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100, value: 0 },
      { id: 'lightness', label: 'Lightness', type: 'range', min: -100, max: 100, value: 0 },
      { id: 'colorize', label: 'Colorize', type: 'check', value: false },
    ],
  },
  'color-balance': {
    title: 'Color Balance', apply: colorBalance,
    fields: [
      ...['Shadows', 'Midtones', 'Highlights'].flatMap((name) => {
        const p = name[0].toLowerCase();
        return [
          { type: 'heading', label: name },
          { id: `${p}CR`, label: 'Cyan – Red', type: 'range', min: -100, max: 100, value: 0 },
          { id: `${p}MG`, label: 'Magenta – Green', type: 'range', min: -100, max: 100, value: 0 },
          { id: `${p}YB`, label: 'Yellow – Blue', type: 'range', min: -100, max: 100, value: 0 },
        ];
      }),
      { id: 'preserve', label: 'Preserve luminosity', type: 'check', value: true },
    ],
  },
  'black-white': {
    title: 'Black & White', apply: blackWhite,
    fields: [
      { id: 'red', label: 'Reds', type: 'range', min: -200, max: 300, value: 30 },
      { id: 'green', label: 'Greens', type: 'range', min: -200, max: 300, value: 59 },
      { id: 'blue', label: 'Blues', type: 'range', min: -200, max: 300, value: 11 },
      { id: 'tint', label: 'Tint', type: 'check', value: false },
      { id: 'tintColor', label: 'Tint color', type: 'color', value: '#e1d3b3' },
    ],
  },
  threshold: {
    title: 'Threshold', apply: threshold,
    fields: [{ id: 'level', label: 'Threshold level', type: 'range', min: 1, max: 255, value: 128 }],
  },
  posterize: {
    title: 'Posterize', apply: posterize,
    fields: [{ id: 'levels', label: 'Levels', type: 'range', min: 2, max: 255, value: 4 }],
  },
  invert: { title: 'Invert', apply: invert, instant: true },
  desaturate: { title: 'Desaturate', apply: desaturate, instant: true },
  'auto-tone': { title: 'Auto Tone', apply: autoTone, instant: true },
};

export const FILTERS = {
  'gaussian-blur': {
    title: 'Gaussian Blur', apply: (img, v) => gaussianBlur(img, v.radius), margin: (v) => Math.ceil(v.radius * 3),
    fields: [{ id: 'radius', label: 'Radius', type: 'range', min: 0.1, max: 250, step: 0.1, value: 4, digits: 1, unit: 'px', gamma: 2 }],
  },
  'motion-blur': {
    title: 'Motion Blur', apply: motionBlur, margin: (v) => Math.ceil(v.distance),
    fields: [
      { id: 'angle', label: 'Angle', type: 'range', min: -180, max: 180, value: 0, unit: '°' },
      { id: 'distance', label: 'Distance', type: 'range', min: 1, max: 200, value: 10, unit: 'px', gamma: 1.5 },
    ],
  },
  'unsharp-mask': {
    title: 'Unsharp Mask', apply: unsharp, margin: (v) => Math.ceil(v.radius * 3),
    fields: [
      { id: 'amount', label: 'Amount', type: 'range', min: 1, max: 500, value: 100, unit: '%' },
      { id: 'radius', label: 'Radius', type: 'range', min: 0.1, max: 100, step: 0.1, value: 1.5, digits: 1, unit: 'px', gamma: 2 },
      { id: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 255, value: 0 },
    ],
  },
  noise: {
    title: 'Add Noise', apply: noise,
    fields: [
      { id: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 0.1, value: 10, digits: 1, unit: '%' },
      { id: 'mono', label: 'Monochromatic', type: 'check', value: false },
    ],
  },
  pixelate: {
    title: 'Mosaic', apply: pixelate,
    fields: [{ id: 'size', label: 'Cell size', type: 'range', min: 2, max: 200, value: 10, unit: 'px', gamma: 1.5 }],
  },
  emboss: {
    title: 'Emboss', apply: emboss, margin: (v) => v.height + 1,
    fields: [
      { id: 'angle', label: 'Angle', type: 'range', min: -180, max: 180, value: 135, unit: '°' },
      { id: 'height', label: 'Height', type: 'range', min: 1, max: 10, value: 3, unit: 'px' },
      { id: 'amount', label: 'Amount', type: 'range', min: 1, max: 500, value: 100, unit: '%' },
    ],
  },
  'find-edges': { title: 'Find Edges', apply: findEdges, instant: true, margin: () => 1 },
  vignette: {
    title: 'Vignette', apply: vignette,
    fields: [
      { id: 'amount', label: 'Amount', type: 'range', min: -100, max: 100, value: 60 },
      { id: 'size', label: 'Midpoint', type: 'range', min: 0, max: 95, value: 40, unit: '%' },
    ],
  },
};
