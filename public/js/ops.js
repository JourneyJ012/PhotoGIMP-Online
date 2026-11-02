// Document operations used by menus, panels and tools. Each one is a single
// undo step.

import { app } from './app.js';
import { Doc, Layer, flatten } from './model.js';
import { Selection, clipToSelection, maskCanvas } from './selection.js';
import { applyText, textOrigin } from './text.js';
import { canvasFromData, createCanvas, cropCanvas, rectIntersect, rectInt } from './util.js';

// ------------------------------------------------------------ guards

/** The active layer if it can be painted on, else null (with a hint). */
export function paintableLayer(doc, { allowText = false } = {}) {
  const l = doc?.active;
  if (!l) { app.toast('Create or select a layer first'); return null; }
  if (!l.visible) { app.toast('The layer is hidden'); return null; }
  if (l.locked) { app.toast('The layer is locked'); return null; }
  if (l.text && !allowText) { app.toast('This is a type layer. Use Layer › Rasterize Type to paint on it.'); return null; }
  return l;
}

// ------------------------------------------------------------ documents

export function newDocument({ width, height, name = 'Untitled', background = '#ffffff' }) {
  const doc = new Doc({ width, height, name });
  const layer = new Layer({ name: background ? 'Background' : 'Layer 1', width, height });
  if (background) {
    const ctx = layer.canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  doc.insertLayer(layer, 0);
  return doc;
}

export function docFromImage(img, name) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const doc = new Doc({ width: w, height: h, name, baseLabel: 'Open' });
  const layer = new Layer({ name: name.replace(/\.[^.]+$/, ''), width: w, height: h });
  layer.canvas.getContext('2d').drawImage(img, 0, 0);
  doc.insertLayer(layer, 0);
  return doc;
}

const shiftGuides = (doc, dx, dy) => doc.guides.map((g) => ({ ...g, pos: g.pos + (g.axis === 'h' ? dy : dx) }));

export function cropDoc(doc, r, deletePixels = true, label = 'Crop') {
  r = rectInt(r);
  if (r.w < 1 || r.h < 1) return;
  doc.structural(label, () => {
    for (const l of doc.layers) {
      if (deletePixels && !l.text) {
        const nb = rectIntersect(l.bounds, r);
        if (nb) {
          l.canvas = cropCanvas(l.canvas, { x: nb.x - l.x, y: nb.y - l.y, w: nb.w, h: nb.h });
          l.x = nb.x - r.x; l.y = nb.y - r.y;
        } else { l.canvas = createCanvas(1, 1); l.x = 0; l.y = 0; }
      } else { l.x -= r.x; l.y -= r.y; }
    }
    doc.guides = shiftGuides(doc, -r.x, -r.y);
    doc.width = r.w;
    doc.height = r.h;
    doc.selection = null;
  });
}

export function resizeImage(doc, w, h) {
  const kx = w / doc.width, ky = h / doc.height;
  doc.structural('Image Size', () => {
    for (const l of doc.layers) {
      if (l.text) {
        const o = textOrigin(l);
        applyText(l, { ...l.text, size: Math.max(1, l.text.size * Math.min(kx, ky)) }, { x: o.x * kx, y: o.y * ky });
        continue;
      }
      const nw = Math.max(1, Math.round(l.canvas.width * kx)), nh = Math.max(1, Math.round(l.canvas.height * ky));
      const c = createCanvas(nw, nh);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      stepDownDraw(ctx, l.canvas, nw, nh);
      l.canvas = c;
      l.x = Math.round(l.x * kx); l.y = Math.round(l.y * ky);
    }
    doc.guides = doc.guides.map((g) => ({ ...g, pos: Math.round(g.pos * (g.axis === 'h' ? ky : kx)) }));
    doc.width = w; doc.height = h;
    doc.selection = null;
  });
}

/** Downscale in halving steps for smoother results than one big drawImage. */
function stepDownDraw(ctx, src, w, h) {
  let cur = src;
  while (cur.width / 2 > w && cur.height / 2 > h) {
    const c = createCanvas(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2));
    const cc = c.getContext('2d');
    cc.imageSmoothingQuality = 'high';
    cc.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  ctx.drawImage(cur, 0, 0, w, h);
}

/** anchor: {x, y} in 0..1 (0 = left/top). */
export function resizeCanvas(doc, w, h, anchor = { x: 0.5, y: 0.5 }) {
  const dx = Math.round((w - doc.width) * anchor.x), dy = Math.round((h - doc.height) * anchor.y);
  doc.structural('Canvas Size', () => {
    for (const l of doc.layers) { l.x += dx; l.y += dy; }
    doc.guides = shiftGuides(doc, dx, dy);
    doc.width = w; doc.height = h;
    doc.selection = null;
  });
}

function transformLayerCanvas(l, W, H, setup) {
  // Rotate/flip a layer around the document: returns new canvas + position.
  const c = l.canvas;
  const corners = [[l.x, l.y], [l.x + c.width, l.y], [l.x, l.y + c.height], [l.x + c.width, l.y + c.height]]
    .map(([x, y]) => setup.transformPoint({ x, y }));
  const x = Math.round(Math.min(...corners.map((p) => p.x))), y = Math.round(Math.min(...corners.map((p) => p.y)));
  const w = Math.round(Math.max(...corners.map((p) => p.x))) - x, h = Math.round(Math.max(...corners.map((p) => p.y))) - y;
  const out = createCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.setTransform(new DOMMatrix().translate(-x, -y).multiply(setup).translate(l.x, l.y));
  ctx.drawImage(c, 0, 0);
  return { canvas: out, x, y };
}

export function rotateDoc(doc, deg) {
  const W = doc.width, H = doc.height;
  const m = deg === 90 ? new DOMMatrix([0, 1, -1, 0, H, 0])
    : deg === 270 ? new DOMMatrix([0, -1, 1, 0, 0, W])
      : new DOMMatrix([-1, 0, 0, -1, W, H]);
  const label = deg === 180 ? 'Rotate 180°' : deg === 90 ? 'Rotate 90° Clockwise' : 'Rotate 90° Counter Clockwise';
  doc.structural(label, () => {
    for (const l of doc.layers) { Object.assign(l, transformLayerCanvas(l, W, H, m)); l.text = null; }
    if (deg !== 180) { doc.width = H; doc.height = W; }
    doc.guides = [];
    doc.selection = null;
  });
}

export function flipDoc(doc, axis) {
  const m = axis === 'h' ? new DOMMatrix([-1, 0, 0, 1, doc.width, 0]) : new DOMMatrix([1, 0, 0, -1, 0, doc.height]);
  doc.structural(axis === 'h' ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical', () => {
    for (const l of doc.layers) { Object.assign(l, transformLayerCanvas(l, doc.width, doc.height, m)); l.text = null; }
    doc.selection = null;
  });
}

export function flipLayer(doc, axis) {
  const l = paintableLayer(doc, { allowText: true });
  if (!l) return;
  const c = l.canvas;
  const m = axis === 'h' ? new DOMMatrix([-1, 0, 0, 1, 2 * l.x + c.width, 0]) : new DOMMatrix([1, 0, 0, -1, 0, 2 * l.y + c.height]);
  doc.structural(axis === 'h' ? 'Flip Horizontal' : 'Flip Vertical', () => {
    Object.assign(l, transformLayerCanvas(l, doc.width, doc.height, m));
    l.text = null;
  });
}

export function trimDoc(doc) {
  const comp = flatten(doc);
  const ctx = comp.getContext('2d');
  const d = ctx.getImageData(0, 0, comp.width, comp.height).data;
  let x0 = comp.width, y0 = comp.height, x1 = -1, y1 = -1;
  for (let y = 0; y < comp.height; y++) for (let x = 0; x < comp.width; x++) {
    if (d[(y * comp.width + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = y; }
  }
  if (x1 < 0) { app.toast('The image is empty'); return; }
  cropDoc(doc, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, true, 'Trim');
}

// ------------------------------------------------------------ layers

export function addLayer(doc, { name = doc.nextLayerName(), canvas, x = 0, y = 0, label = 'New Layer', index, ...rest } = {}) {
  return doc.structural(label, () => {
    const l = new Layer({ name, canvas: canvas || createCanvas(doc.width, doc.height), x, y, ...rest });
    doc.insertLayer(l, index);
    return l;
  });
}

export function duplicateLayer(doc) {
  const l = doc.active;
  if (!l) return;
  doc.structural('Duplicate Layer', () => {
    const d = l.duplicate();
    doc.insertLayer(d, doc.indexOf(l) + 1);
  });
}

export function deleteLayer(doc, layer = doc.active) {
  if (!layer) return;
  doc.structural('Delete Layer', () => {
    const i = doc.indexOf(layer);
    doc.layers.splice(i, 1);
    doc.activeId = doc.layers[Math.max(0, i - 1)]?.id ?? null;
  });
}

export function moveLayer(doc, layer, to, label = 'Layer Order') {
  const from = doc.indexOf(layer);
  to = Math.max(0, Math.min(doc.layers.length - 1, to));
  if (from < 0 || from === to) return;
  doc.structural(label, () => {
    doc.layers.splice(from, 1);
    doc.layers.splice(to, 0, layer);
  });
}

export function setLayerProps(doc, layer, props, label = 'Layer Properties') {
  if (Object.entries(props).every(([k, v]) => layer[k] === v)) return;
  doc.structural(label, () => Object.assign(layer, props));
}

export function selectLayerRelative(doc, dir) {
  const i = doc.indexOf(doc.active) + dir;
  if (i >= 0 && i < doc.layers.length) { doc.activeId = doc.layers[i].id; doc.notify(); }
}

export function mergeDown(doc) {
  const upper = doc.active, i = doc.indexOf(upper);
  if (!upper || i <= 0) { app.toast('There is no layer below to merge with'); return; }
  const lower = doc.layers[i - 1];
  doc.structural('Merge Down', () => {
    const u = rectInt({ x: Math.min(upper.x, lower.x), y: Math.min(upper.y, lower.y),
      w: Math.max(upper.x + upper.canvas.width, lower.x + lower.canvas.width) - Math.min(upper.x, lower.x),
      h: Math.max(upper.y + upper.canvas.height, lower.y + lower.canvas.height) - Math.min(upper.y, lower.y) });
    const c = createCanvas(u.w, u.h);
    const ctx = c.getContext('2d');
    if (lower.visible) ctx.drawImage(lower.canvas, lower.x - u.x, lower.y - u.y);
    if (upper.visible) {
      ctx.globalAlpha = upper.opacity;
      ctx.globalCompositeOperation = upper.blend;
      ctx.drawImage(upper.canvas, upper.x - u.x, upper.y - u.y);
    }
    Object.assign(lower, { canvas: c, x: u.x, y: u.y, text: null, visible: true });
    doc.layers.splice(i, 1);
    doc.activeId = lower.id;
  });
}

export function mergeVisible(doc) {
  const visible = doc.layers.filter((l) => l.visible);
  if (visible.length < 2) { app.toast('There are fewer than two visible layers'); return; }
  doc.structural('Merge Visible', () => {
    const target = visible[0];
    const c = flatten(doc, visible);
    Object.assign(target, { canvas: c, x: 0, y: 0, opacity: 1, blend: 'source-over', text: null });
    doc.layers = doc.layers.filter((l) => !l.visible || l === target);
    doc.activeId = target.id;
  });
}

export function flattenImage(doc) {
  doc.structural('Flatten Image', () => {
    const l = new Layer({ name: 'Background', canvas: flatten(doc, doc.layers.filter((x) => x.visible), '#ffffff') });
    doc.layers = [l];
    doc.activeId = l.id;
  });
}

export function stampVisible(doc) {
  addLayer(doc, { name: doc.nextLayerName(), canvas: flatten(doc), label: 'Stamp Visible' });
}

export function rasterizeLayer(doc, layer = doc.active) {
  if (!layer?.text) return;
  doc.structural('Rasterize Type', () => { layer.text = null; });
}

// ------------------------------------------------------------ pixels

/** Fill the selection (or the whole layer) with a color. */
export function fillSelection(doc, color, label = 'Fill') {
  const l = paintableLayer(doc);
  if (!l) return;
  doc.history.begin(label);
  try {
    doc.ensureCovers(l);
    const sel = doc.selection;
    const r = sel ? { ...sel.bounds, x: sel.bounds.x - l.x, y: sel.bounds.y - l.y } : null;
    doc.pixelEdit(l, label, r, (ctx) => {
      if (!sel) { ctx.fillStyle = color; ctx.fillRect(0, 0, l.canvas.width, l.canvas.height); return; }
      const c = createCanvas(doc.width, doc.height);
      const cc = c.getContext('2d');
      cc.fillStyle = color;
      cc.fillRect(0, 0, doc.width, doc.height);
      clipToSelection(c, sel);
      ctx.drawImage(c, -l.x, -l.y);
    });
  } finally { doc.history.end(); }
}

/** Delete selected pixels; without a selection, delete the layer. */
export function clearSelection(doc) {
  const sel = doc.selection;
  if (!sel) { if (doc.active && !doc.active.locked) deleteLayer(doc); return; }
  const l = paintableLayer(doc);
  if (!l) return;
  const r = { ...sel.bounds, x: sel.bounds.x - l.x, y: sel.bounds.y - l.y };
  doc.pixelEdit(l, 'Clear', r, (ctx) => {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(sel.canvas, -l.x, -l.y);
  });
}

/** Copy the selected part of the active layer (or of the image, merged). */
export function copyPixels(doc, merged = false) {
  const sel = doc.selection;
  let src, sx, sy;
  if (merged) { src = flatten(doc); sx = 0; sy = 0; }
  else {
    const l = doc.active;
    if (!l) return null;
    src = l.canvas; sx = l.x; sy = l.y;
  }
  const area = rectIntersect(sel ? sel.bounds : { x: sx, y: sy, w: src.width, h: src.height },
    { x: sx, y: sy, w: src.width, h: src.height });
  if (!area) { app.toast('The selected area is empty'); return null; }
  const c = createCanvas(area.w, area.h);
  c.getContext('2d').drawImage(src, sx - area.x, sy - area.y);
  if (sel) clipToSelection(c, sel, area.x, area.y);
  return { canvas: c, x: area.x, y: area.y, docId: doc.id };
}

export function pasteLayer(doc, clip, vp) {
  let x, y;
  const c = clip.canvas;
  if (doc.selection) {
    const b = doc.selection.bounds;
    x = b.x + (b.w - c.width) / 2; y = b.y + (b.h - c.height) / 2;
  } else if (clip.docId === doc.id && clip.x != null) { x = clip.x; y = clip.y; }
  else {
    const ctr = vp ? vp.center() : { x: doc.width / 2, y: doc.height / 2 };
    const inside = ctr.x >= 0 && ctr.y >= 0 && ctr.x <= doc.width && ctr.y <= doc.height;
    const p = inside ? ctr : { x: doc.width / 2, y: doc.height / 2 };
    x = p.x - c.width / 2; y = p.y - c.height / 2;
  }
  return addLayer(doc, { name: doc.nextLayerName(), canvas: c, x: Math.round(x), y: Math.round(y), label: 'Paste' });
}

/** Ctrl+J: new layer from the selection, or a duplicate without one. */
export function layerViaCopy(doc, cut = false) {
  if (!doc.selection) { duplicateLayer(doc); return; }
  const clip = copyPixels(doc);
  if (!clip) return;
  doc.history.begin(cut ? 'Layer via Cut' : 'Layer via Copy');
  try {
    if (cut) clearSelection(doc);
    addLayer(doc, { name: doc.nextLayerName(), canvas: clip.canvas, x: clip.x, y: clip.y, index: doc.indexOf(doc.active) + 1 });
  } finally { doc.history.end(); }
}

export function setSelection(doc, sel, label) {
  if (sel === doc.selection) return;
  doc.structural(label, () => { doc.selection = sel; });
}

/** Selection from a layer's alpha (Ctrl+click on a layer thumbnail). */
export function selectLayerAlpha(doc, layer) {
  const m = maskCanvas(doc.width, doc.height);
  m.getContext('2d').drawImage(layer.canvas, layer.x, layer.y);
  const s = new Selection(m);
  setSelection(doc, s.empty ? null : s, 'Load Selection');
}

/** The rect of a layer an adjustment applies to (layer coordinates). */
export function filterRegion(doc, layer) {
  const lr = { x: 0, y: 0, w: layer.canvas.width, h: layer.canvas.height };
  if (!doc.selection) return lr;
  const b = doc.selection.bounds;
  return rectIntersect({ x: b.x - layer.x, y: b.y - layer.y, w: b.w, h: b.h }, lr);
}

/**
 * Run fn(imageData) over the layer region (expanded by margin for filters
 * that look at neighbours) and blend the result through the selection.
 * Returns {canvas, rect} with the new pixels of rect (layer coords).
 */
export function filteredRegion(doc, layer, fn, margin = 0) {
  const r = filterRegion(doc, layer);
  if (!r) return null;
  const R = rectIntersect({ x: r.x - margin, y: r.y - margin, w: r.w + margin * 2, h: r.h + margin * 2 },
    { x: 0, y: 0, w: layer.canvas.width, h: layer.canvas.height });
  const img = layer.canvas.getContext('2d').getImageData(R.x, R.y, R.w, R.h);
  const fc = canvasFromData(fn(img));
  const res = createCanvas(r.w, r.h);
  const ctx = res.getContext('2d');
  const sel = doc.selection;
  if (!sel) { ctx.drawImage(fc, R.x - r.x, R.y - r.y); return { canvas: res, rect: r }; }
  const m = createCanvas(r.w, r.h);
  m.getContext('2d').drawImage(sel.canvas, -(r.x + layer.x), -(r.y + layer.y));
  const base = cropCanvas(layer.canvas, r);
  const bc = base.getContext('2d');
  bc.globalCompositeOperation = 'destination-out';
  bc.drawImage(m, 0, 0);
  const f = createCanvas(r.w, r.h);
  const fctx = f.getContext('2d');
  fctx.drawImage(fc, R.x - r.x, R.y - r.y);
  fctx.globalCompositeOperation = 'destination-in';
  fctx.drawImage(m, 0, 0);
  ctx.drawImage(base, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(f, 0, 0);
  return { canvas: res, rect: r };
}

export function commitRegion(doc, layer, label, res) {
  const r = res.rect;
  doc.pixelEdit(layer, label, r, (ctx) => {
    ctx.clearRect(r.x, r.y, r.w, r.h);
    ctx.drawImage(res.canvas, r.x, r.y);
  });
}

/** A layer.preview function that shows res over the layer. */
export function regionPreview(layer, res) {
  const c = createCanvas(layer.canvas.width, layer.canvas.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(layer.canvas, 0, 0);
  const r = res.rect;
  ctx.clearRect(r.x, r.y, r.w, r.h);
  ctx.drawImage(res.canvas, r.x, r.y);
  return () => ({ canvas: c, x: layer.x, y: layer.y });
}
