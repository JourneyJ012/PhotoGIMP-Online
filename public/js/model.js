// Document and layer model.
//
// Rules that keep undo simple and cheap:
//  * Structural changes (add/remove/reorder layers, properties, crop, resize,
//    merges, selection) never draw into an existing canvas: they replace
//    canvases. doc.structural() then records before/after snapshots that only
//    hold references.
//  * In-place pixel edits go through doc.pixelEdit() / beginPixels(), which
//    store before/after patches of the touched rectangle only.

import { createCanvas, copyCanvas, cropCanvas, putPatch, rectIntersect, rectUnion, uid } from './util.js';
import { History } from './history.js';

export const BLEND_MODES = [
  ['source-over', 'Normal'],
  ['-'],
  ['darken', 'Darken'], ['multiply', 'Multiply'], ['color-burn', 'Color Burn'],
  ['-'],
  ['lighten', 'Lighten'], ['screen', 'Screen'], ['color-dodge', 'Color Dodge'], ['lighter', 'Linear Dodge (Add)'],
  ['-'],
  ['overlay', 'Overlay'], ['soft-light', 'Soft Light'], ['hard-light', 'Hard Light'],
  ['-'],
  ['difference', 'Difference'], ['exclusion', 'Exclusion'],
  ['-'],
  ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
];

export class Layer {
  constructor({ name = 'Layer', width, height, canvas, x = 0, y = 0, opacity = 1, blend = 'source-over',
                visible = true, locked = false, text = null } = {}) {
    this.id = uid();
    this.name = name;
    this.canvas = canvas || createCanvas(width, height);
    this.x = x;
    this.y = y;
    this.opacity = opacity;
    this.blend = blend;
    this.visible = visible;
    this.locked = locked;
    this.text = text;       // text layer settings, see text.js
    this.preview = null;    // () => {canvas, x, y}: shown instead of canvas while a tool works
    this.version = 0;       // bumped whenever pixels or properties change (thumbnails)
  }

  get bounds() { return { x: this.x, y: this.y, w: this.canvas.width, h: this.canvas.height }; }

  state() {
    const { canvas, x, y, name, opacity, blend, visible, locked, text } = this;
    return { canvas, x, y, name, opacity, blend, visible, locked, text };
  }

  setState(s) { Object.assign(this, s); this.version++; }

  duplicate(name = `${this.name} copy`) {
    const l = new Layer({ ...this.state(), canvas: copyCanvas(this.canvas), name });
    return l;
  }
}

export class Doc {
  static listener = null; // set by the app: (doc) => void

  constructor({ width, height, name = 'Untitled', baseLabel = 'New Document' }) {
    this.id = uid();
    this.name = name;
    this.width = width;
    this.height = height;
    this.layers = []; // bottom first
    this.activeId = null;
    this.selection = null;
    this.guides = [];
    this.view = { zoom: 1, panX: 0, panY: 0, ready: false };
    this.fileHandle = null;
    this.savedIndex = 0;
    this.lastFilter = null;
    this.comp = createCanvas(width, height);
    this.compDirty = true;
    this.history = new History(this, baseLabel);
  }

  get active() { return this.layers.find((l) => l.id === this.activeId) || null; }
  set active(l) { this.activeId = l ? l.id : null; }
  get dirty() { return this.history.index !== this.savedIndex; }
  get bounds() { return { x: 0, y: 0, w: this.width, h: this.height }; }

  markSaved() { this.savedIndex = this.history.index; this.notify(); }

  notify() {
    this.compDirty = true;
    Doc.listener?.(this);
  }

  /** Re-render the composite after a tool changed a preview. */
  invalidate() { this.compDirty = true; Doc.listener?.(this, true); }

  getComposite() {
    if (this.compDirty) {
      if (this.comp.width !== this.width || this.comp.height !== this.height) {
        this.comp = createCanvas(this.width, this.height);
      }
      composite(this, this.comp.getContext('2d'));
      this.compDirty = false;
    }
    return this.comp;
  }

  // ------------------------------------------------------------ snapshots

  snapshot() {
    return {
      width: this.width,
      height: this.height,
      layers: this.layers.map((layer) => ({ layer, state: layer.state() })),
      activeId: this.activeId,
      selection: this.selection,
      guides: this.guides.slice(),
    };
  }

  restore(s) {
    this.width = s.width;
    this.height = s.height;
    this.layers = s.layers.map(({ layer, state }) => { layer.setState(state); return layer; });
    this.activeId = s.activeId;
    this.selection = s.selection;
    this.guides = s.guides.slice();
  }

  /** Run fn (which must not draw into existing canvases) as one undo step. */
  structural(label, fn) {
    const before = this.snapshot();
    const result = fn();
    this.record(label, before);
    return result;
  }

  /** Record an undo step from a snapshot taken earlier. */
  record(label, before) {
    const after = this.snapshot();
    for (const { layer } of after.layers) layer.version++;
    this.history.push({ label, undo: () => this.restore(before), redo: () => this.restore(after) });
  }

  /** Draw into layer.canvas in place. r is the rect (layer coords) fn may touch. */
  pixelEdit(layer, label, r, fn) {
    const c = layer.canvas;
    r = rectIntersect(r || { x: 0, y: 0, w: c.width, h: c.height }, { x: 0, y: 0, w: c.width, h: c.height });
    if (!r) return false;
    const before = cropCanvas(c, r);
    const ctx = c.getContext('2d');
    ctx.save();
    fn(ctx);
    ctx.restore();
    this._pushPatch(layer, c, r, before, label);
    return true;
  }

  /** For tools that edit pixels gradually: keep a copy to diff against. */
  beginPixels(layer) { return { layer, canvas: layer.canvas, snap: copyCanvas(layer.canvas) }; }

  commitPixels(tok, label, r) {
    const c = tok.canvas;
    r = rectIntersect(r, { x: 0, y: 0, w: c.width, h: c.height });
    if (!r) return false;
    this._pushPatch(tok.layer, c, r, cropCanvas(tok.snap, r), label);
    return true;
  }

  _pushPatch(layer, c, r, before, label) {
    const after = cropCanvas(c, r);
    layer.version++;
    this.history.push({
      label,
      undo: () => { putPatch(c, r, before); layer.version++; },
      redo: () => { putPatch(c, r, after); layer.version++; },
    });
  }

  /** Grow a layer's canvas so it covers the whole document (before painting). */
  ensureCovers(layer) {
    const u = rectUnion(layer.bounds, this.bounds);
    if (u.x === layer.x && u.y === layer.y && u.w === layer.canvas.width && u.h === layer.canvas.height) return;
    this.structural('Expand Layer', () => {
      const c = createCanvas(u.w, u.h);
      c.getContext('2d').drawImage(layer.canvas, layer.x - u.x, layer.y - u.y);
      layer.canvas = c;
      layer.x = u.x;
      layer.y = u.y;
    });
  }

  // ------------------------------------------------------------ layers

  indexOf(layer) { return this.layers.indexOf(layer); }

  insertLayer(layer, index = this.active ? this.indexOf(this.active) + 1 : this.layers.length) {
    this.layers.splice(index, 0, layer);
    this.activeId = layer.id;
  }

  nextLayerName(prefix = 'Layer') {
    let n = 1;
    const names = new Set(this.layers.map((l) => l.name));
    while (names.has(`${prefix} ${n}`)) n++;
    return `${prefix} ${n}`;
  }

  /** The layer under doc point (x, y): topmost visible layer with alpha there. */
  layerAt(x, y) {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i];
      if (!l.visible) continue;
      const lx = Math.floor(x - l.x), ly = Math.floor(y - l.y);
      if (lx < 0 || ly < 0 || lx >= l.canvas.width || ly >= l.canvas.height) continue;
      if (l.canvas.getContext('2d').getImageData(lx, ly, 1, 1).data[3] > 8) return l;
    }
    return null;
  }

  /** A doc-sized canvas with one layer's pixels at their position. */
  layerInDocSpace(layer) {
    const c = createCanvas(this.width, this.height, { readable: true });
    c.getContext('2d').drawImage(layer.canvas, layer.x, layer.y);
    return c;
  }
}

/** Draw all visible layers of doc into ctx (doc-sized), honoring previews. */
export function composite(doc, ctx, { layers = doc.layers } = {}) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const l of layers) {
    if (!l.visible || l.opacity <= 0) continue;
    const src = l.preview ? l.preview() : l;
    if (!src) continue;
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend;
    ctx.drawImage(src.canvas, src.x, src.y);
  }
  ctx.restore();
}

/** Flatten a list of layers into a new doc-sized canvas. */
export function flatten(doc, layers = doc.layers, background = null) {
  const c = createCanvas(doc.width, doc.height);
  const ctx = c.getContext('2d');
  composite(doc, ctx, { layers });
  if (background) {
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}
