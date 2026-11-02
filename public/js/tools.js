// Tools. Each tool: {id, name, key, group, icon, cursor, options[], activate,
// deactivate, down, move, up, hover, key, drawOverlay, cursorAt}. Pointer
// handlers get ev = {x, y (doc), sx, sy (screen), shift, alt, ctrl, pressure}.

import { app } from './app.js';
import { Layer } from './model.js';
import { Stroke, ToneStroke } from './paint.js';
import { Selection, combine, feather, floodMask, maskFromArray, shapeMask, clipToSelection } from './selection.js';
import { TransformSession } from './transform.js';
import { TEXT_DEFAULTS, applyText, fontString, layoutText, textOrigin } from './text.js';
import { cropDoc, paintableLayer, setSelection } from './ops.js';
import { clamp, createCanvas, rectFromPoints, rgbToHex } from './util.js';

const T = (def) => { app.registerTool(def); return def; };
const PI2 = Math.PI * 2;

// ------------------------------------------------------------ shared bits

const selModeField = {
  id: 'mode', label: 'Mode', type: 'segmented', value: 'replace',
  options: [['replace', 'New', 'sel-new'], ['add', 'Add (Shift)', 'sel-add'], ['subtract', 'Subtract (Alt)', 'sel-sub'], ['intersect', 'Intersect (Shift+Alt)', 'sel-int']],
};
const featherField = { id: 'feather', label: 'Feather', type: 'range', min: 0, max: 250, value: 0, unit: 'px', gamma: 2 };

function selMode(tool, ev) {
  if (ev.shift && ev.alt) return 'intersect';
  if (ev.shift) return 'add';
  if (ev.alt) return 'subtract';
  return app.opts(tool).mode;
}

function commitMask(doc, mask, mode, label, featherPx = 0) {
  if (featherPx > 0) {
    const f = feather(new Selection(mask), featherPx);
    if (!f) return;
    mask = f.canvas;
  }
  setSelection(doc, combine(doc.selection, mask, mode), label);
}

/** Outline a path in screen space like marching ants (static). */
function antsStroke(ctx, path) {
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = '#000';
  ctx.stroke(path);
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = '#fff';
  ctx.stroke(path);
  ctx.setLineDash([]);
}

function screenRect(vp, r) {
  const a = vp.toScreen(r.x, r.y);
  return { x: a.x, y: a.y, w: r.w * vp.zoom, h: r.h * vp.zoom };
}

function brushCursor(ctx, vp, size) {
  const h = vp.hover;
  if (!h || vp.spaceDown) return;
  const r = (size * vp.zoom) / 2;
  ctx.lineWidth = 1;
  if (r > 3) {
    ctx.beginPath(); ctx.arc(h.sx, h.sy, r, 0, PI2);
    ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(h.sx, h.sy, r + 1, 0, PI2);
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.stroke();
  }
}

function constrain45(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

/** Modifier keys pressed when a drag started pick the selection mode; pressed
 *  again later they constrain (Shift) or draw from the center (Alt). */
function dragMods(st, ev) {
  if (!ev.shift) st.relShift = true;
  if (!ev.alt) st.relAlt = true;
  return {
    constrain: ev.shift && (!st.mods.shift || st.relShift),
    center: ev.alt && (!st.mods.alt || st.relAlt),
  };
}

// ------------------------------------------------------------ move

const move = T({
  id: 'move', name: 'Move Tool', key: 'V', icon: 'move', cursor: 'move',
  hint: 'Drag to move the layer or the selected pixels. Shift+click picks the layer under the cursor. Arrow keys nudge.',
  options: [
    { id: 'autoSelect', label: 'Auto-select layer', type: 'check', value: false },
    { id: 'proportional', label: 'Transform keeps proportions (Shift toggles)', type: 'check', value: true },
  ],
  down(ev) {
    const doc = app.doc;
    if (app.opts(this).autoSelect !== ev.shift) {
      const l = doc.layerAt(ev.x, ev.y);
      if (l && l !== doc.active) { doc.activeId = l.id; doc.notify(); }
    }
    const layer = doc.active;
    if (!layer) return;
    if (layer.locked) { app.toast('The layer is locked'); return; }
    if (doc.selection && !layer.text) {
      this.session = TransformSession.start(doc, { moveOnly: true });
      this.session?.beginDrag(ev);
      return;
    }
    this.drag = { layer, before: doc.snapshot(), x0: layer.x, y0: layer.y, sx: ev.x, sy: ev.y };
  },
  move(ev) {
    if (this.session) { this.session.dragTo(ev); return; }
    const d = this.drag;
    if (!d) return;
    d.layer.x = d.x0 + Math.round(ev.x - d.sx);
    d.layer.y = d.y0 + Math.round(ev.y - d.sy);
    app.doc.invalidate();
  },
  up() {
    if (this.session) { this.session.endDrag(); this.session.commit(); this.session = null; return; }
    const d = this.drag;
    this.drag = null;
    if (d && (d.layer.x !== d.x0 || d.layer.y !== d.y0)) app.doc.record('Move', d.before);
  },
  onKey(e, combo) {
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const k = combo.replace('Shift+', '');
    if (!dirs[k]) return false;
    const doc = app.doc, l = doc?.active;
    if (!l || l.locked) return true;
    const step = combo.startsWith('Shift+') ? 10 : 1;
    const [dx, dy] = dirs[k].map((v) => v * step);
    if (doc.selection && !l.text) {
      const s = TransformSession.start(doc, { moveOnly: true });
      if (s) { s.cx += dx; s.cy += dy; s.commit(); }
    } else doc.structural('Nudge', () => { l.x += dx; l.y += dy; });
    return true;
  },
});

// ------------------------------------------------------------ marquees

function marquee(id, name, key, ellipse) {
  return T({
    id, name, key, group: 'marquee', icon: id, cursor: 'crosshair',
    hint: 'Drag to select. Shift adds, Alt subtracts; during the drag Shift constrains and Alt draws from the center.',
    options: [
      selModeField, featherField,
      { id: 'style', label: 'Style', type: 'select', value: 'normal', options: [['normal', 'Normal'], ['ratio', 'Fixed Ratio'], ['size', 'Fixed Size']] },
      { id: 'fw', label: 'Width', type: 'number', value: 16, min: 1, showIf: (o) => o.style !== 'normal' },
      { id: 'fh', label: 'Height', type: 'number', value: 9, min: 1, showIf: (o) => o.style !== 'normal' },
    ],
    down(ev) {
      this.st = { mode: selMode(this, ev), start: { x: Math.round(ev.x), y: Math.round(ev.y) }, mods: { shift: ev.shift, alt: ev.alt } };
      this.rect = null;
    },
    move(ev) {
      const st = this.st;
      if (!st) return;
      const { constrain, center } = dragMods(st, ev);
      const o = app.opts(this), s = st.start;
      let w = Math.round(ev.x) - s.x, h = Math.round(ev.y) - s.y;
      if (o.style === 'size') { w = Math.sign(w || 1) * o.fw; h = Math.sign(h || 1) * o.fh; }
      else if (o.style === 'ratio' || constrain) {
        const ratio = o.style === 'ratio' ? o.fw / o.fh : 1;
        const m = Math.max(Math.abs(w), Math.abs(h) * ratio);
        w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * (m / ratio);
      }
      this.rect = center
        ? { x: s.x - Math.abs(w), y: s.y - Math.abs(h), w: Math.abs(w) * 2, h: Math.abs(h) * 2 }
        : rectFromPoints(s, { x: s.x + w, y: s.y + h });
    },
    up() {
      const doc = app.doc, r = this.rect, st = this.st;
      this.st = null; this.rect = null;
      if (!st) return;
      if (!r || r.w < 1 || r.h < 1) {
        if (st.mode === 'replace' && doc.selection) setSelection(doc, null, 'Deselect');
        return;
      }
      const mask = shapeMask(doc.width, doc.height, (ctx) => {
        ctx.beginPath();
        if (ellipse) ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, PI2);
        else ctx.rect(r.x, r.y, r.w, r.h);
        ctx.fill();
      });
      commitMask(doc, mask, st.mode, name.replace(' Tool', ''), app.opts(this).feather);
    },
    drawOverlay(ctx, vp) {
      if (!this.rect) return;
      const s = screenRect(vp, this.rect), p = new Path2D();
      if (ellipse) p.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, PI2);
      else p.rect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.round(s.w), Math.round(s.h));
      antsStroke(ctx, p);
    },
  });
}
marquee('rect-select', 'Rectangular Marquee Tool', 'M', false);
marquee('ellipse-select', 'Elliptical Marquee Tool', 'Shift+M', true);

// ------------------------------------------------------------ lassos

T({
  id: 'lasso', name: 'Lasso Tool', key: 'L', group: 'lasso', icon: 'lasso', cursor: 'crosshair',
  hint: 'Drag to draw a freehand selection.',
  options: [selModeField, featherField],
  down(ev) { this.mode = selMode(this, ev); this.pts = [{ x: ev.x, y: ev.y }]; },
  move(ev) { this.pts?.push({ x: ev.x, y: ev.y }); },
  up() {
    const pts = this.pts, doc = app.doc;
    this.pts = null;
    if (!pts || pts.length < 3) { if (this.mode === 'replace' && doc.selection) setSelection(doc, null, 'Deselect'); return; }
    const mask = shapeMask(doc.width, doc.height, (ctx) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
    });
    commitMask(doc, mask, this.mode, 'Lasso', app.opts(this).feather);
  },
  drawOverlay(ctx, vp) {
    if (!this.pts) return;
    const p = new Path2D();
    this.pts.forEach((q, i) => { const s = vp.toScreen(q.x, q.y); if (i) p.lineTo(s.x, s.y); else p.moveTo(s.x, s.y); });
    antsStroke(ctx, p);
  },
});

T({
  id: 'poly-lasso', name: 'Polygonal Lasso Tool', key: 'Shift+L', group: 'lasso', icon: 'poly-lasso', cursor: 'crosshair',
  hint: 'Click to add points; click the first point, double-click or press Enter to close. Backspace removes a point, Esc cancels.',
  options: [selModeField, featherField],
  deactivate() { this.pts = null; },
  down(ev, vp) {
    let p = { x: ev.x, y: ev.y };
    if (!this.pts) { this.mode = selMode(this, ev); this.pts = [p]; return; }
    if (ev.shift) p = constrain45(this.pts.at(-1), p);
    const first = vp.toScreen(this.pts[0].x, this.pts[0].y);
    if (this.pts.length > 2 && Math.hypot(first.x - ev.sx, first.y - ev.sy) < 8) { this.finish(); return; }
    this.pts.push(p);
  },
  hover(ev) { this.hoverPt = { x: ev.x, y: ev.y, shift: ev.shift }; },
  move(ev) { this.hover(ev); },
  dblclick() { this.finish(); },
  finish() {
    const pts = this.pts, doc = app.doc;
    this.pts = null;
    if (!pts || pts.length < 3) return;
    const mask = shapeMask(doc.width, doc.height, (ctx) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
    });
    commitMask(doc, mask, this.mode, 'Polygonal Lasso', app.opts(this).feather);
    app.viewport.render();
  },
  onKey(e, combo) {
    if (!this.pts) return false;
    if (combo === 'Enter') this.finish();
    else if (combo === 'Escape') this.pts = null;
    else if (combo === 'Backspace' || combo === 'Delete') { this.pts.pop(); if (!this.pts.length) this.pts = null; }
    else return false;
    app.viewport.render();
    return true;
  },
  drawOverlay(ctx, vp) {
    if (!this.pts) return;
    const p = new Path2D();
    this.pts.forEach((q, i) => { const s = vp.toScreen(q.x, q.y); if (i) p.lineTo(s.x, s.y); else p.moveTo(s.x, s.y); });
    if (this.hoverPt) {
      const h = this.hoverPt.shift ? constrain45(this.pts.at(-1), this.hoverPt) : this.hoverPt;
      const s = vp.toScreen(h.x, h.y);
      p.lineTo(s.x, s.y);
    }
    antsStroke(ctx, p);
  },
});

// ------------------------------------------------------------ wand

function wand(id, name, key, contiguous) {
  return T({
    id, name, key, group: 'wand', icon: id, cursor: 'crosshair',
    hint: contiguous ? 'Click to select similar, connected colors.' : 'Click to select all similar colors in the image.',
    options: [
      selModeField,
      { id: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 255, value: 32 },
      { id: 'merged', label: 'Sample all layers', type: 'check', value: false },
      featherField,
    ],
    down(ev) {
      const doc = app.doc, o = app.opts(this);
      if (!o.merged && !doc.active) return;
      const src = o.merged ? doc.getComposite() : doc.layerInDocSpace(doc.active);
      const img = src.getContext('2d').getImageData(0, 0, doc.width, doc.height);
      const m = floodMask(img, ev.x, ev.y, o.tolerance, contiguous);
      commitMask(doc, maskFromArray(doc.width, doc.height, m), selMode(this, ev), name.replace(' Tool', ''), o.feather);
    },
  });
}
wand('wand', 'Magic Wand Tool', 'W', true);
wand('color-select', 'Select by Color Tool', 'Shift+W', false);

// ------------------------------------------------------------ crop

const CROP_HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

const crop = T({
  id: 'crop', name: 'Crop Tool', key: 'C', icon: 'crop', cursor: 'crosshair', hideAnts: true,
  hint: 'Drag the edges or draw a new box, then press Enter to crop (Esc resets). Shift keeps the aspect ratio.',
  options: [
    { id: 'deletePixels', label: 'Delete cropped pixels', type: 'check', value: true },
    { type: 'buttons', buttons: [['Crop', () => crop.commit(), 'primary'], ['Reset', () => crop.reset()]] },
  ],
  activate() { this.reset(); },
  deactivate() { this.box = null; this.drag = null; },
  reset() { this.box = null; app.viewport?.render(); },
  getBox() { const d = app.doc; return this.box || (d ? { x: 0, y: 0, w: d.width, h: d.height } : null); },
  hit(ev, vp) {
    const b = this.getBox();
    for (const [hx, hy] of CROP_HANDLES) {
      const p = vp.toScreen(b.x + ((hx + 1) / 2) * b.w, b.y + ((hy + 1) / 2) * b.h);
      if (Math.abs(p.x - ev.sx) <= 7 && Math.abs(p.y - ev.sy) <= 7) return { type: 'handle', hx, hy };
    }
    if (ev.x >= b.x && ev.y >= b.y && ev.x <= b.x + b.w && ev.y <= b.y + b.h && this.box) return { type: 'move' };
    return { type: 'new' };
  },
  down(ev, vp) {
    this.drag = { ...this.hit(ev, vp), start: { x: ev.x, y: ev.y }, box: { ...this.getBox() } };
  },
  move(ev) {
    const d = this.drag;
    if (!d) return;
    const dx = Math.round(ev.x - d.start.x), dy = Math.round(ev.y - d.start.y);
    const b0 = d.box;
    if (d.type === 'new') {
      let e = { x: ev.x, y: ev.y };
      if (ev.shift) { const m = Math.max(Math.abs(e.x - d.start.x), Math.abs(e.y - d.start.y)); e = { x: d.start.x + Math.sign(e.x - d.start.x) * m, y: d.start.y + Math.sign(e.y - d.start.y) * m }; }
      const r = rectFromPoints(d.start, e);
      this.box = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
    } else if (d.type === 'move') {
      this.box = { ...b0, x: b0.x + dx, y: b0.y + dy };
    } else {
      let x0 = b0.x, y0 = b0.y, x1 = b0.x + b0.w, y1 = b0.y + b0.h;
      if (d.hx < 0) x0 += dx; if (d.hx > 0) x1 += dx;
      if (d.hy < 0) y0 += dy; if (d.hy > 0) y1 += dy;
      if (ev.shift && d.hx && d.hy) {
        const ratio = b0.w / b0.h, w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        if (w / h > ratio) { const nh = w / ratio; if (d.hy < 0) y0 = y1 - nh; else y1 = y0 + nh; }
        else { const nw = h * ratio; if (d.hx < 0) x0 = x1 - nw; else x1 = x0 + nw; }
      }
      this.box = rectFromPoints({ x: Math.round(x0), y: Math.round(y0) }, { x: Math.round(x1), y: Math.round(y1) });
    }
  },
  up() {
    this.drag = null;
    if (this.box && (this.box.w < 1 || this.box.h < 1)) this.box = null;
  },
  dblclick() { this.commit(); },
  onKey(e, combo) {
    if (combo === 'Enter') { this.commit(); return true; }
    if (combo === 'Escape' && this.box) { this.reset(); return true; }
    return false;
  },
  commit() {
    const doc = app.doc, b = this.box;
    if (!doc || !b) return;
    cropDoc(doc, b, app.opts(this).deletePixels);
    this.reset();
    app.viewport.fit(false);
  },
  cursorAt(ev, vp) {
    const h = this.hit(ev, vp);
    if (h.type === 'move') return 'move';
    if (h.type === 'handle') return h.hx && h.hy ? (h.hx === h.hy ? 'nwse-resize' : 'nesw-resize') : h.hx ? 'ew-resize' : 'ns-resize';
    return 'crosshair';
  },
  drawOverlay(ctx, vp) {
    const b = this.getBox();
    if (!b) return;
    const s = screenRect(vp, b);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.rect(0, 0, vp.w, vp.h);
    ctx.rect(s.x, s.y, s.w, s.h);
    ctx.fill('evenodd');
    ctx.lineWidth = 1;
    if (this.drag) {
      // Rule-of-thirds guides while adjusting the box.
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(s.x + (s.w * i) / 3, s.y); ctx.lineTo(s.x + (s.w * i) / 3, s.y + s.h);
        ctx.moveTo(s.x, s.y + (s.h * i) / 3); ctx.lineTo(s.x + s.w, s.y + (s.h * i) / 3);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.round(s.w), Math.round(s.h));
    ctx.fillStyle = '#fff';
    for (const [hx, hy] of CROP_HANDLES) {
      const x = s.x + ((hx + 1) / 2) * s.w, y = s.y + ((hy + 1) / 2) * s.h;
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(x - 4.5, y - 4.5, 9, 9);
    }
    if (this.drag) {
      ctx.font = '11px system-ui, sans-serif';
      const label = `${b.w} × ${b.h} px`;
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,.75)';
      ctx.fillRect(s.x + s.w + 8, s.y + s.h + 8, tw, 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, s.x + s.w + 13, s.y + s.h + 21);
    }
  },
});

// ------------------------------------------------------------ eyedropper

export function sampleColor(doc, x, y, size = 1, merged = true) {
  const n = Math.max(1, size), r = Math.floor(n / 2);
  let src, ox = 0, oy = 0;
  if (merged) src = doc.getComposite();
  else { const l = doc.active; if (!l) return null; src = l.canvas; ox = l.x; oy = l.y; }
  const px = Math.floor(x - ox) - r, py = Math.floor(y - oy) - r;
  if (px + n <= 0 || py + n <= 0 || px >= src.width || py >= src.height) return null;
  const d = src.getContext('2d').getImageData(px, py, n, n).data;
  let R = 0, G = 0, B = 0, A = 0;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; R += d[i] * a; G += d[i + 1] * a; B += d[i + 2] * a; A += a; }
  if (!A) return null;
  return rgbToHex({ r: R / A, g: G / A, b: B / A });
}

T({
  id: 'eyedropper', name: 'Eyedropper Tool', key: 'I', icon: 'eyedropper', cursor: 'crosshair',
  hint: 'Click to pick the foreground color, Alt+click for the background color.',
  options: [
    { id: 'size', label: 'Sample size', type: 'select', value: 1, options: [[1, 'Point sample'], [3, '3 × 3 average'], [5, '5 × 5 average'], [11, '11 × 11 average'], [31, '31 × 31 average']] },
    { id: 'merged', label: 'Sample', type: 'select', value: 'all', options: [['all', 'All layers'], ['layer', 'Current layer']] },
  ],
  down(ev) { this.pick(ev); },
  move(ev) { this.pick(ev); },
  pick(ev) {
    const o = app.opts(this);
    const c = sampleColor(app.doc, ev.x, ev.y, +o.size, o.merged !== 'layer');
    if (c) app.setColor(ev.alt ? 'bg' : 'fg', c);
  },
});

// ------------------------------------------------------------ painting

function strokeLabel(tool) { return tool.name.replace(' Tool', ''); }

function paintTool({ id, name, key, group, icon, mode, aliased = false, hint }) {
  const options = [
    { id: 'size', label: 'Size', type: 'range', min: 1, max: 1000, value: aliased ? 1 : 30, unit: 'px', gamma: 2.5 },
    !aliased && { id: 'hardness', label: 'Hardness', type: 'range', min: 0, max: 100, value: mode === 'paint' ? 0 : 50, unit: '%' },
    { id: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, value: 100, unit: '%' },
    !aliased && { id: 'flow', label: 'Flow', type: 'range', min: 1, max: 100, value: 100, unit: '%' },
    mode === 'clone' && { id: 'sample', label: 'Sample', type: 'select', value: 'layer', options: [['layer', 'Current layer'], ['all', 'All layers']] },
    mode === 'clone' && { id: 'aligned', label: 'Aligned', type: 'check', value: true },
    { id: 'pressure', label: 'Pen pressure controls size', type: 'check', value: true },
    !aliased && { type: 'presets', label: 'Brush presets' },
  ].filter(Boolean);
  return T({
    id, name, key, group, icon, options, cursor: 'crosshair', brush: true, altPick: mode === 'paint', hint,
    down(ev) {
      const doc = app.doc;
      if (mode === 'clone' && ev.alt) {
        this.source = { x: ev.x, y: ev.y, docId: doc.id };
        this.offset = null;
        app.toast('Clone source set');
        return;
      }
      const layer = paintableLayer(doc);
      if (!layer) return;
      const o = app.opts(this);
      let cloneSource, cloneOffset;
      if (mode === 'clone') {
        if (!this.source || this.source.docId !== doc.id) { app.toast('Alt+click to set the clone source'); return; }
        cloneSource = o.sample === 'all' ? createCanvas(doc.width, doc.height) : doc.layerInDocSpace(layer);
        if (o.sample === 'all') cloneSource.getContext('2d').drawImage(doc.getComposite(), 0, 0);
        if (!o.aligned || !this.offset) this.offset = { x: this.source.x - ev.x, y: this.source.y - ev.y };
        cloneOffset = this.offset;
      }
      doc.history.begin(strokeLabel(this));
      doc.ensureCovers(layer);
      this.stroke = new Stroke({
        doc, layer, mode, aliased,
        size: o.size, hardness: aliased ? 1 : o.hardness / 100, flow: aliased ? 1 : o.flow / 100,
        opacity: o.opacity / 100, color: app.fg, pressureSize: o.pressure, spacing: aliased ? 0.1 : 0.12,
        cloneSource, cloneOffset,
      });
      layer.preview = () => this.stroke.preview();
      const last = this.lastEnd;
      if (ev.shift && last && last.docId === doc.id) { this.stroke.start(last.x, last.y, ev.pressure); this.stroke.to(ev.x, ev.y, ev.pressure); }
      else this.stroke.start(ev.x, ev.y, ev.pressure);
      doc.invalidate();
    },
    move(ev) {
      if (!this.stroke) return;
      this.stroke.to(ev.x, ev.y, ev.pressure);
      app.doc.invalidate();
    },
    up(ev) {
      const s = this.stroke;
      if (!s) return;
      this.stroke = null;
      const doc = app.doc;
      try {
        s.layer.preview = null;
        const r = s.layerRect();
        if (r) doc.pixelEdit(s.layer, strokeLabel(this), r, (ctx) => s.apply(ctx));
      } finally { doc.history.end(); }
      this.lastEnd = { x: ev.x, y: ev.y, docId: doc.id };
    },
    drawOverlay(ctx, vp) {
      brushCursor(ctx, vp, app.opts(this).size);
      if (mode === 'clone' && this.source && vp.hover && this.source.docId === app.doc.id) {
        const off = this.offset && app.opts(this).aligned ? this.offset : null;
        const p = this.stroke ? { x: vp.hover.x + this.stroke.cloneOffset.x, y: vp.hover.y + this.stroke.cloneOffset.y }
          : off ? { x: vp.hover.x + off.x, y: vp.hover.y + off.y } : this.source;
        const s = vp.toScreen(p.x, p.y);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(s.x - 7, s.y); ctx.lineTo(s.x + 7, s.y); ctx.moveTo(s.x, s.y - 7); ctx.lineTo(s.x, s.y + 7); ctx.stroke();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      }
    },
  });
}

paintTool({ id: 'brush', name: 'Brush Tool', key: 'B', group: 'brush', icon: 'brush', mode: 'paint', hint: 'Paint with the foreground color. Shift+click draws a straight line, Alt picks a color, [ ] change the size.' });
paintTool({ id: 'pencil', name: 'Pencil Tool', key: 'Shift+B', group: 'brush', icon: 'pencil', mode: 'paint', aliased: true, hint: 'Paint hard-edged pixels. Shift+click draws a straight line.' });
paintTool({ id: 'clone', name: 'Clone Stamp Tool', key: 'S', icon: 'clone', mode: 'clone', hint: 'Alt+click to set the source, then paint to copy from it.' });
paintTool({ id: 'eraser', name: 'Eraser Tool', key: 'E', icon: 'eraser', mode: 'erase', hint: 'Erase to transparency. Shift+click erases a straight line.' });

function toneTool({ id, name, key, group, icon, kind, hint }) {
  const options = [
    { id: 'size', label: 'Size', type: 'range', min: 1, max: 1000, value: 50, unit: 'px', gamma: 2.5 },
    { id: 'hardness', label: 'Hardness', type: 'range', min: 0, max: 100, value: 0, unit: '%' },
    { id: 'strength', label: kind === 'dodge' || kind === 'burn' ? 'Exposure' : 'Strength', type: 'range', min: 1, max: 100, value: 50, unit: '%' },
    (kind === 'dodge' || kind === 'burn') && { id: 'range', label: 'Range', type: 'select', value: 'midtones', options: [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']] },
    { id: 'pressure', label: 'Pen pressure controls size', type: 'check', value: true },
  ].filter(Boolean);
  return T({
    id, name, key, group, icon, options, cursor: 'crosshair', brush: true, hint,
    down(ev) {
      const doc = app.doc, layer = paintableLayer(doc);
      if (!layer) return;
      const o = app.opts(this);
      doc.history.begin(strokeLabel(this));
      doc.ensureCovers(layer);
      this.tok = doc.beginPixels(layer);
      this.stroke = new ToneStroke({ doc, layer, kind, size: o.size, hardness: o.hardness / 100, strength: o.strength / 100, range: o.range, pressureSize: o.pressure });
      this.stroke.start(ev.x, ev.y, ev.pressure);
      doc.invalidate();
    },
    move(ev) {
      if (!this.stroke) return;
      this.stroke.to(ev.x, ev.y, ev.pressure);
      app.doc.invalidate();
    },
    up() {
      const s = this.stroke, doc = app.doc;
      if (!s) return;
      this.stroke = null;
      try { if (s.dirty) doc.commitPixels(this.tok, strokeLabel(this), s.dirty); } finally { doc.history.end(); }
    },
    drawOverlay(ctx, vp) { brushCursor(ctx, vp, app.opts(this).size); },
  });
}

toneTool({ id: 'blur', name: 'Blur Tool', key: 'R', group: 'blur', icon: 'blur', kind: 'blur', hint: 'Paint to soften details.' });
toneTool({ id: 'sharpen', name: 'Sharpen Tool', key: 'Shift+R', group: 'blur', icon: 'sharpen', kind: 'sharpen', hint: 'Paint to sharpen details.' });
toneTool({ id: 'dodge', name: 'Dodge Tool', key: 'O', group: 'dodge', icon: 'dodge', kind: 'dodge', hint: 'Paint to lighten.' });
toneTool({ id: 'burn', name: 'Burn Tool', key: 'Shift+O', group: 'dodge', icon: 'burn', kind: 'burn', hint: 'Paint to darken.' });

// ------------------------------------------------------------ gradient & fill

T({
  id: 'gradient', name: 'Gradient Tool', key: 'G', group: 'fill', icon: 'gradient', cursor: 'crosshair', altPick: true,
  hint: 'Drag to draw a gradient. Shift constrains the angle to 45° steps.',
  options: [
    { id: 'type', label: 'Shape', type: 'select', value: 'linear', options: [['linear', 'Linear'], ['radial', 'Radial'], ['reflected', 'Reflected'], ['conic', 'Angle']] },
    { id: 'colors', label: 'Colors', type: 'select', value: 'fg-bg', options: [['fg-bg', 'Foreground to background'], ['fg-transparent', 'Foreground to transparent'], ['bg-fg', 'Background to foreground']] },
    { id: 'reverse', label: 'Reverse', type: 'check', value: false },
    { id: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, value: 100, unit: '%' },
  ],
  down(ev) { this.line = { a: { x: ev.x, y: ev.y }, b: { x: ev.x, y: ev.y } }; },
  move(ev) { if (this.line) this.line.b = ev.shift ? constrain45(this.line.a, ev) : { x: ev.x, y: ev.y }; },
  up() {
    const line = this.line, doc = app.doc;
    this.line = null;
    if (!line || Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) < 1) return;
    const layer = paintableLayer(doc);
    if (!layer) return;
    const o = app.opts(this);
    const g = createCanvas(doc.width, doc.height);
    const ctx = g.getContext('2d');
    const { a, b } = line, len = Math.hypot(b.x - a.x, b.y - a.y);
    let c0 = o.colors === 'bg-fg' ? app.bg : app.fg;
    let c1 = o.colors === 'fg-bg' ? app.bg : o.colors === 'bg-fg' ? app.fg : `${app.fg}00`;
    if (o.reverse) [c0, c1] = [c1, c0];
    let grad;
    if (o.type === 'radial') grad = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, len);
    else if (o.type === 'conic') grad = ctx.createConicGradient(Math.atan2(b.y - a.y, b.x - a.x), a.x, a.y);
    else if (o.type === 'reflected') grad = ctx.createLinearGradient(2 * a.x - b.x, 2 * a.y - b.y, b.x, b.y);
    else grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    if (o.type === 'reflected') { grad.addColorStop(0, c1); grad.addColorStop(0.5, c0); grad.addColorStop(1, c1); }
    else { grad.addColorStop(0, c0); grad.addColorStop(1, c1); }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, doc.width, doc.height);
    clipToSelection(g, doc.selection);
    doc.history.begin('Gradient');
    try {
      doc.ensureCovers(layer);
      const sb = doc.selection?.bounds;
      const r = sb ? { ...sb, x: sb.x - layer.x, y: sb.y - layer.y } : { x: -layer.x, y: -layer.y, w: doc.width, h: doc.height };
      doc.pixelEdit(layer, 'Gradient', r, (c) => { c.globalAlpha = o.opacity / 100; c.drawImage(g, -layer.x, -layer.y); });
    } finally { doc.history.end(); }
  },
  drawOverlay(ctx, vp) {
    if (!this.line) return;
    const a = vp.toScreen(this.line.a.x, this.line.a.y), b = vp.toScreen(this.line.b.x, this.line.b.y);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
    for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, PI2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
  },
});

T({
  id: 'bucket', name: 'Paint Bucket Tool', key: 'Shift+G', group: 'fill', icon: 'bucket', cursor: 'crosshair', altPick: true,
  hint: 'Click to fill similar colors with the foreground color.',
  options: [
    { id: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 255, value: 32 },
    { id: 'contiguous', label: 'Contiguous', type: 'check', value: true },
    { id: 'merged', label: 'Sample all layers', type: 'check', value: false },
    { id: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, value: 100, unit: '%' },
  ],
  down(ev) {
    const doc = app.doc, layer = paintableLayer(doc);
    if (!layer) return;
    const o = app.opts(this);
    if (doc.selection && doc.selection.alphaAt(ev.x, ev.y) === 0) return;
    if (ev.x < 0 || ev.y < 0 || ev.x >= doc.width || ev.y >= doc.height) return;
    const src = o.merged ? doc.getComposite() : doc.layerInDocSpace(layer);
    const img = src.getContext('2d').getImageData(0, 0, doc.width, doc.height);
    const m = floodMask(img, ev.x, ev.y, o.tolerance, o.contiguous);
    let x0 = doc.width, y0 = doc.height, x1 = -1, y1 = -1;
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
      if (m[y * doc.width + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    }
    if (x1 < 0) return;
    const fill = maskFromArray(doc.width, doc.height, m);
    const fc = fill.getContext('2d');
    fc.globalCompositeOperation = 'source-in';
    fc.fillStyle = app.fg;
    fc.fillRect(0, 0, doc.width, doc.height);
    clipToSelection(fill, doc.selection);
    doc.history.begin('Paint Bucket');
    try {
      doc.ensureCovers(layer);
      doc.pixelEdit(layer, 'Paint Bucket', { x: x0 - layer.x, y: y0 - layer.y, w: x1 - x0 + 1, h: y1 - y0 + 1 },
        (c) => { c.globalAlpha = o.opacity / 100; c.drawImage(fill, -layer.x, -layer.y); });
    } finally { doc.history.end(); }
  },
});

// ------------------------------------------------------------ type

const textTool = T({
  id: 'text', name: 'Type Tool', key: 'T', icon: 'text', cursor: 'text', altPick: false,
  hint: 'Click to add text, or click a type layer to edit it. Ctrl+Enter or clicking outside commits, Esc cancels.',
  options: [
    { id: 'font', label: 'Font', type: 'font', value: 'Arial' },
    { id: 'size', label: 'Size', type: 'range', min: 4, max: 800, value: 48, unit: 'px', gamma: 2 },
    { id: 'color', label: 'Color', type: 'textcolor', value: '#000000' },
    { id: 'style', type: 'textstyle' },
    { id: 'align', label: 'Align', type: 'segmented', value: 'left', options: [['left', 'Left', 'align-left'], ['center', 'Center', 'align-center'], ['right', 'Right', 'align-right']] },
    { id: 'leading', label: 'Line spacing', type: 'range', min: 0.5, max: 3, step: 0.05, value: 1.2, digits: 2 },
  ],
  activate() {
    this.offView ||= app.on('view', () => this.place());
  },
  deactivate() { this.commit(); },

  /** Settings for a new text from the tool options. */
  settings() {
    const o = app.opts(this);
    return { ...TEXT_DEFAULTS, font: o.font, size: o.size, color: app.fg, bold: !!o.bold, italic: !!o.italic, align: o.align, leading: o.leading };
  },

  /** Tool option changed: apply it to the type layer being edited or selected. */
  optionChanged(id, value) {
    const doc = app.doc, l = this.editing?.layer || (doc?.active?.text ? doc.active : null);
    if (!l) return;
    const map = { font: 'font', size: 'size', color: 'color', bold: 'bold', italic: 'italic', align: 'align', leading: 'leading' };
    if (!(id in map)) return;
    const text = { ...l.text, [map[id]]: value };
    if (this.editing) { applyText(l, text); this.place(); doc.invalidate(); }
    else doc.structural('Edit Type', () => applyText(l, text));
  },

  down(ev) {
    const doc = app.doc;
    if (this.editing) {
      const l = this.editing.layer;
      const inside = ev.x >= l.x && ev.y >= l.y && ev.x <= l.x + l.canvas.width && ev.y <= l.y + l.canvas.height;
      if (!inside) this.commit();
      return;
    }
    const hit = [...doc.layers].reverse().find((l) => l.text && l.visible &&
      ev.x >= l.x && ev.y >= l.y && ev.x <= l.x + l.canvas.width && ev.y <= l.y + l.canvas.height);
    const before = doc.snapshot();
    if (hit) { doc.activeId = hit.id; this.edit(hit, false, before); return; }
    const t = this.settings();
    const L = layoutText({ ...t, content: 'M' });
    const layer = new Layer({ name: 'Text', width: 1, height: 1 });
    applyText(layer, t, { x: ev.x, y: ev.y - L.baseline });
    doc.insertLayer(layer);
    this.edit(layer, true, before);
    doc.notify();
  },

  edit(layer, isNew, before) {
    const ta = document.getElementById('text-editor');
    this.editing = { layer, isNew, before, original: layer.text };
    ta.hidden = false;
    ta.value = layer.text.content;
    this.place();
    ta.oninput = () => {
      applyText(layer, { ...layer.text, content: ta.value });
      this.place();
      app.doc.invalidate();
    };
    ta.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.cancel(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commit(); }
    };
    // Show the layer's settings in the options.
    const o = app.opts(this);
    Object.assign(o, { font: layer.text.font, size: layer.text.size, bold: layer.text.bold, italic: layer.text.italic, align: layer.text.align, leading: layer.text.leading });
    app.emit('options', this);
    const focus = () => { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); };
    focus();
    requestAnimationFrame(() => { if (this.editing && document.activeElement !== ta) focus(); });
  },

  place() {
    const ed = this.editing, vp = app.viewport;
    if (!ed || !vp) return;
    const ta = document.getElementById('text-editor'), t = ed.layer.text, z = vp.zoom;
    const L = layoutText(t), o = textOrigin(ed.layer), s = vp.toScreen(o.x, o.y);
    const slack = 24;
    const left = t.align === 'center' ? s.x - slack / 2 : t.align === 'right' ? s.x - slack : s.x;
    Object.assign(ta.style, {
      left: `${left}px`, top: `${s.y}px`, width: `${L.width * z + slack}px`, height: `${L.height * z + 4}px`,
      font: fontString(t, z), lineHeight: `${L.lineH * z}px`, textAlign: t.align,
    });
  },

  finish() {
    const ta = document.getElementById('text-editor');
    ta.hidden = true;
    ta.oninput = ta.onkeydown = null;
    ta.blur();
    const ed = this.editing;
    this.editing = null;
    return ed;
  },

  commit() {
    const ed = this.editing && this.finish();
    if (!ed) return;
    const doc = app.doc, l = ed.layer;
    if (!l.text.content.trim()) {
      doc.layers = doc.layers.filter((x) => x !== l);
      doc.activeId = doc.layers.at(-1)?.id ?? null;
      if (ed.isNew) { doc.restore(ed.before); doc.notify(); } else doc.record('Delete Layer', ed.before);
      return;
    }
    if (ed.isNew) {
      l.name = l.text.content.split('\n')[0].slice(0, 40);
      doc.record('Type Layer', ed.before);
    } else if (l.text !== ed.original) {
      if (ed.original && l.name === ed.original.content.split('\n')[0].slice(0, 40)) l.name = l.text.content.split('\n')[0].slice(0, 40);
      doc.record('Edit Type', ed.before);
    }
    doc.notify();
  },

  cancel() {
    const ed = this.editing && this.finish();
    if (!ed) return;
    app.doc.restore(ed.before);
    app.doc.notify();
  },

  onKey(e, combo) {
    if (combo === 'Enter' && app.doc?.active?.text && !this.editing) {
      this.edit(app.doc.active, false, app.doc.snapshot());
      return true;
    }
    return false;
  },

  drawOverlay(ctx, vp) {
    const l = this.editing?.layer;
    if (!l) return;
    const o = textOrigin(l), L = layoutText(l.text), s = vp.toScreen(o.x, o.y);
    ctx.strokeStyle = '#2680eb';
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, L.width * vp.zoom + 7, L.height * vp.zoom + 7);
  },
});
export { textTool };

// ------------------------------------------------------------ shapes

T({
  id: 'shape', name: 'Shape Tool', key: 'U', icon: 'shape', cursor: 'crosshair',
  hint: 'Drag to draw a shape on a new layer. Shift constrains, Alt draws from the center.',
  options: [
    { id: 'shape', label: 'Shape', type: 'segmented', value: 'rect', options: [['rect', 'Rectangle', 'shape-rect'], ['rounded', 'Rounded rectangle', 'shape-rounded'], ['ellipse', 'Ellipse', 'shape-ellipse'], ['line', 'Line', 'shape-line']] },
    { id: 'fill', label: 'Fill', type: 'check', value: true },
    { id: 'fillColor', label: 'Fill color', type: 'color', value: '#2680eb' },
    { id: 'stroke', label: 'Stroke', type: 'check', value: false },
    { id: 'strokeColor', label: 'Stroke color', type: 'color', value: '#000000' },
    { id: 'strokeWidth', label: 'Stroke width', type: 'range', min: 1, max: 200, value: 4, unit: 'px', gamma: 1.6 },
    { id: 'radius', label: 'Corner radius', type: 'range', min: 0, max: 500, value: 24, unit: 'px', gamma: 1.6, showIf: (o) => o.shape === 'rounded' },
  ],
  down(ev) { this.st = { a: { x: ev.x, y: ev.y }, b: { x: ev.x, y: ev.y }, mods: { shift: ev.shift, alt: ev.alt }, relShift: true, relAlt: true }; },
  move(ev) {
    const st = this.st;
    if (!st) return;
    const o = app.opts(this);
    let b = { x: ev.x, y: ev.y };
    if (ev.shift) {
      if (o.shape === 'line') b = constrain45(st.a, b);
      else { const m = Math.max(Math.abs(b.x - st.a.x), Math.abs(b.y - st.a.y)); b = { x: st.a.x + Math.sign(b.x - st.a.x || 1) * m, y: st.a.y + Math.sign(b.y - st.a.y || 1) * m }; }
    }
    st.b = b;
    st.center = ev.alt;
  },
  geometry() {
    const { a, b, center } = this.st;
    if (center) return { x: a.x - Math.abs(b.x - a.x), y: a.y - Math.abs(b.y - a.y), w: Math.abs(b.x - a.x) * 2, h: Math.abs(b.y - a.y) * 2 };
    return rectFromPoints(a, b);
  },
  path(ctx, o, r, line) {
    ctx.beginPath();
    if (o.shape === 'line') { ctx.moveTo(line.a.x, line.a.y); ctx.lineTo(line.b.x, line.b.y); }
    else if (o.shape === 'ellipse') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, PI2);
    else if (o.shape === 'rounded') ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(o.radius, r.w / 2, r.h / 2));
    else ctx.rect(r.x, r.y, r.w, r.h);
  },
  up() {
    const st = this.st, doc = app.doc;
    if (!st) return;
    const r = this.geometry();
    this.st = null;
    const o = app.opts(this);
    if (o.shape === 'line' ? Math.hypot(st.b.x - st.a.x, st.b.y - st.a.y) < 1 : r.w < 1 || r.h < 1) return;
    const c = createCanvas(doc.width, doc.height);
    const ctx = c.getContext('2d');
    this.path(ctx, o, r, st);
    if (o.shape === 'line') { ctx.lineWidth = o.strokeWidth; ctx.lineCap = 'round'; ctx.strokeStyle = o.fill ? o.fillColor : o.strokeColor; ctx.stroke(); }
    else {
      if (o.fill) { ctx.fillStyle = o.fillColor; ctx.fill(); }
      if (o.stroke) { ctx.lineWidth = o.strokeWidth; ctx.strokeStyle = o.strokeColor; ctx.lineJoin = 'round'; ctx.stroke(); }
    }
    const names = { rect: 'Rectangle', rounded: 'Rounded Rectangle', ellipse: 'Ellipse', line: 'Line' };
    doc.structural('Shape', () => doc.insertLayer(new Layer({ name: doc.nextLayerName(names[o.shape]), canvas: c })));
  },
  drawOverlay(ctx, vp) {
    if (!this.st) return;
    const o = app.opts(this), r = this.geometry();
    ctx.save();
    ctx.setTransform(vp.dpr * vp.zoom, 0, 0, vp.dpr * vp.zoom, vp.dpr * vp.view.panX, vp.dpr * vp.view.panY);
    this.path(ctx, o, r, this.st);
    ctx.globalAlpha = 0.6;
    if (o.shape === 'line') { ctx.lineWidth = o.strokeWidth; ctx.lineCap = 'round'; ctx.strokeStyle = o.fill ? o.fillColor : o.strokeColor; ctx.stroke(); }
    else {
      if (o.fill) { ctx.fillStyle = o.fillColor; ctx.fill(); }
      if (o.stroke) { ctx.lineWidth = o.strokeWidth; ctx.strokeStyle = o.strokeColor; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1 / vp.zoom;
    ctx.strokeStyle = '#2680eb';
    ctx.stroke();
    ctx.restore();
  },
});

// ------------------------------------------------------------ navigation

T({
  id: 'hand', name: 'Hand Tool', key: 'H', icon: 'hand', cursor: 'grab',
  hint: 'Drag to scroll the view (or hold Space with any tool). Double-click fits the image.',
  options: [{ type: 'buttons', buttons: [['Fit Screen', () => app.viewport.fit()], ['100%', () => app.viewport.actualPixels()]] }],
  down(ev) { this.last = { x: ev.sx, y: ev.sy }; },
  move(ev, vp) {
    if (!this.last) return;
    vp.panBy(ev.sx - this.last.x, ev.sy - this.last.y);
    this.last = { x: ev.sx, y: ev.sy };
  },
  up() { this.last = null; },
  dblclick(ev, vp) { vp.fit(); },
  cursorAt() { return this.last ? 'grabbing' : 'grab'; },
});

T({
  id: 'zoom', name: 'Zoom Tool', key: 'Z', icon: 'zoom', cursor: 'zoom-in',
  hint: 'Click to zoom in, Alt+click to zoom out, drag left/right to zoom smoothly.',
  options: [{ type: 'buttons', buttons: [['Fit Screen', () => app.viewport.fit()], ['100%', () => app.viewport.actualPixels()]] }],
  down(ev, vp) { this.st = { sx: ev.sx, sy: ev.sy, z: vp.zoom, moved: false }; },
  move(ev, vp) {
    const st = this.st;
    if (!st) return;
    const dx = ev.sx - st.sx;
    if (Math.abs(dx) > 3) st.moved = true;
    if (st.moved) vp.setZoom(clamp(st.z * Math.exp(dx * 0.01), 0.01, 64), st.sx, st.sy);
  },
  up(ev, vp) {
    const st = this.st;
    this.st = null;
    if (st && !st.moved) vp.zoomStep(ev.alt ? -1 : 1, ev.sx, ev.sy);
  },
  cursorAt(ev) { return ev.alt ? 'zoom-out' : 'zoom-in'; },
});

// ------------------------------------------------------------ free transform

const transform = T({
  id: 'transform', name: 'Free Transform', hidden: true, icon: 'transform', cursor: 'move', hideAnts: true,
  hint: 'Drag a handle to scale (Shift toggles proportions, Alt from center), outside to rotate (Shift: 15° steps), inside to move. Enter applies, Esc cancels.',
  options: [
    { type: 'transform' },
    { type: 'buttons', buttons: [['Apply', () => transform.finish(true), 'primary'], ['Cancel', () => transform.finish(false)]] },
  ],
  begin() {
    if (this.session) return;
    const s = TransformSession.start(app.doc);
    if (!s) return;
    this.prev = app.tool?.id !== 'transform' ? app.tool?.id : this.prev;
    this.session = s;
    app.setTool('transform');
  },
  activate() {
    if (!this.session) queueMicrotask(() => app.setTool(this.prev || 'move'));
  },
  deactivate() {
    const s = this.session;
    this.session = null;
    s?.commit();
  },
  finish(ok) {
    const s = this.session;
    this.session = null;
    if (s) { if (ok) s.commit(); else s.cancel(); }
    app.setTool(this.prev || 'move');
  },
  down(ev, vp) { this.session?.beginDrag(ev, vp); },
  move(ev) { this.session?.dragTo(ev); },
  up() { this.session?.endDrag(); },
  dblclick() { this.finish(true); },
  onKey(e, combo) {
    if (combo === 'Enter') { this.finish(true); return true; }
    if (combo === 'Escape') { this.finish(false); return true; }
    return false;
  },
  cursorAt(ev, vp) { return this.session?.cursorAt(ev, vp) || 'default'; },
  drawOverlay(ctx, vp) { this.session?.draw(ctx, vp); },
});
export { transform };

/** Toolbar layout: groups of tool ids in Photoshop order. */
export const TOOLBAR = [
  ['move'], ['rect-select', 'ellipse-select'], ['lasso', 'poly-lasso'], ['wand', 'color-select'], ['crop'],
  ['eyedropper'], ['brush', 'pencil'], ['clone'], ['eraser'], ['gradient', 'bucket'], ['blur', 'sharpen'],
  ['dodge', 'burn'], ['text'], ['shape'], ['hand'], ['zoom'],
];
