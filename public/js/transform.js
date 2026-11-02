// Free Transform: scale / rotate / move a layer, or the selected part of it.
// While active, the layer shows a live preview; commit() replaces the layer
// canvas (one undo step), cancel() restores it.

import { app } from './app.js';
import { alphaBounds, createCanvas, cropCanvas, rectIntersect, rectInt, rectUnion } from './util.js';
import { Selection, clipToSelection, maskCanvas } from './selection.js';

const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

export class TransformSession {
  /** Returns null (after a toast) when there is nothing to transform. */
  static start(doc, { moveOnly = false } = {}) {
    const layer = doc.active;
    if (!layer || !layer.visible) { app.toast('Select a visible layer first'); return null; }
    if (layer.locked) { app.toast('The layer is locked'); return null; }
    const sel = doc.selection;
    let src, rest = null, srcX, srcY;
    if (sel) {
      // Lift the selected pixels off the layer.
      const r = rectIntersect(sel.bounds, layer.bounds);
      if (!r) { app.toast('The selected area is empty'); return null; }
      const piece = createCanvas(r.w, r.h);
      const pc = piece.getContext('2d');
      pc.drawImage(layer.canvas, layer.x - r.x, layer.y - r.y);
      clipToSelection(piece, sel, r.x, r.y);
      const b = alphaBounds(piece);
      if (!b) { app.toast('The selected area is empty'); return null; }
      src = cropCanvas(piece, b);
      srcX = r.x + b.x; srcY = r.y + b.y;
      rest = createCanvas(layer.canvas.width, layer.canvas.height);
      const rc = rest.getContext('2d');
      rc.drawImage(layer.canvas, 0, 0);
      rc.globalCompositeOperation = 'destination-out';
      rc.drawImage(sel.canvas, -layer.x, -layer.y);
    } else {
      const b = alphaBounds(layer.canvas);
      if (!b) { app.toast('The layer is empty'); return null; }
      src = cropCanvas(layer.canvas, b);
      srcX = layer.x + b.x; srcY = layer.y + b.y;
    }
    return new TransformSession(doc, layer, src, srcX, srcY, rest, moveOnly);
  }

  constructor(doc, layer, src, srcX, srcY, rest, moveOnly) {
    Object.assign(this, { doc, layer, src, rest, moveOnly });
    this.w = src.width;
    this.h = src.height;
    this.cx = srcX + this.w / 2;
    this.cy = srcY + this.h / 2;
    this.sx = 1; this.sy = 1; this.rot = 0;
    this.origin = { cx: this.cx, cy: this.cy };
    this.selMask = doc.selection
      ? cropCanvas(doc.selection.canvas, { x: srcX, y: srcY, w: this.w, h: this.h }) : null;
    this.preview = null;
    this.version = 0;
    layer.preview = () => this.previewFor();
    this.prevSelection = doc.selection;
    doc.invalidate();
  }

  get changed() {
    return this.sx !== 1 || this.sy !== 1 || this.rot !== 0 || this.cx !== this.origin.cx || this.cy !== this.origin.cy;
  }

  /** Doc-space matrix mapping source pixels to their transformed position. */
  matrix() {
    const m = new DOMMatrix();
    return m.translate(this.cx, this.cy).rotate((this.rot * 180) / Math.PI).scale(this.sx, this.sy)
      .translate(-this.w / 2, -this.h / 2);
  }

  corners() {
    const m = this.matrix();
    return [[0, 0], [this.w, 0], [this.w, this.h], [0, this.h]].map(([x, y]) => m.transformPoint({ x, y }));
  }

  bbox() {
    const c = this.corners();
    const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  /** Render (base layer pixels) + (transformed piece) into a canvas. */
  render() {
    const l = this.layer;
    const base = this.rest ? { x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height } : null;
    const u = rectInt(rectUnion(base, this.bbox()), 1);
    const c = createCanvas(u.w, u.h);
    const ctx = c.getContext('2d');
    if (this.rest) ctx.drawImage(this.rest, l.x - u.x, l.y - u.y);
    const m = this.matrix();
    ctx.setTransform(new DOMMatrix().translate(-u.x, -u.y).multiply(m));
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.src, 0, 0);
    return { canvas: c, x: u.x, y: u.y };
  }

  previewFor() {
    if (!this.preview || this.preview.v !== this.version) this.preview = { ...this.render(), v: this.version };
    return this.preview;
  }

  update() { this.version++; this.doc.invalidate(); app.emit('transform', this); }

  commit() {
    const { doc, layer } = this;
    layer.preview = null;
    if (!this.changed) { doc.invalidate(); return false; }
    const out = this.render();
    doc.structural(this.moveOnly ? 'Move' : 'Free Transform', () => {
      layer.canvas = out.canvas;
      layer.x = out.x;
      layer.y = out.y;
      if (layer.text) { layer.text = null; app.toast('The text layer was rasterized'); }
      if (this.selMask) {
        const m = maskCanvas(doc.width, doc.height);
        const ctx = m.getContext('2d');
        ctx.setTransform(this.matrix());
        ctx.drawImage(this.selMask, 0, 0);
        const s = new Selection(m);
        doc.selection = s.empty ? null : s;
      }
    });
    return true;
  }

  cancel() {
    this.layer.preview = null;
    this.doc.invalidate();
  }

  // ------------------------------------------------------------ interaction

  /** Which part of the box is at screen point (sx, sy). */
  hit(sx, sy, vp) {
    const m = this.matrix();
    for (const [hx, hy] of HANDLES) {
      const d = m.transformPoint({ x: ((hx + 1) / 2) * this.w, y: ((hy + 1) / 2) * this.h });
      const p = vp.toScreen(d.x, d.y);
      if (Math.abs(p.x - sx) <= 6 && Math.abs(p.y - sy) <= 6) return { type: 'scale', hx, hy };
    }
    const local = m.inverse().transformPoint(vp.toDoc(sx, sy));
    const inside = local.x >= 0 && local.y >= 0 && local.x <= this.w && local.y <= this.h;
    // Like Photoshop: drag inside to move, outside to rotate.
    return { type: inside ? 'move' : 'rotate' };
  }

  beginDrag(ev, vp) {
    const h = this.moveOnly ? { type: 'move' } : this.hit(ev.sx, ev.sy, vp);
    this.drag = { ...h, start: { x: ev.x, y: ev.y }, cx: this.cx, cy: this.cy, sx: this.sx, sy: this.sy, rot: this.rot };
    if (h.type === 'scale') {
      const R = new DOMMatrix().rotate((this.rot * 180) / Math.PI);
      const W = this.w * this.sx, H = this.h * this.sy;
      const a = R.transformPoint({ x: (-h.hx * W) / 2, y: (-h.hy * H) / 2 });
      this.drag.anchor = { x: this.cx + a.x, y: this.cy + a.y };
    }
  }

  dragTo(ev) {
    const d = this.drag;
    if (!d) return;
    if (d.type === 'move') {
      let dx = ev.x - d.start.x, dy = ev.y - d.start.y;
      if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      this.cx = d.cx + Math.round(dx);
      this.cy = d.cy + Math.round(dy);
    } else if (d.type === 'rotate') {
      const a0 = Math.atan2(d.start.y - d.cy, d.start.x - d.cx);
      const a1 = Math.atan2(ev.y - d.cy, ev.x - d.cx);
      let r = d.rot + a1 - a0;
      if (ev.shift) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
      this.rot = r;
    } else if (d.type === 'scale') {
      const { hx, hy } = d;
      const fromCenter = ev.alt;
      const anchor = fromCenter ? { x: d.cx, y: d.cy } : d.anchor;
      const Rinv = new DOMMatrix().rotate((-d.rot * 180) / Math.PI);
      const loc = Rinv.transformPoint({ x: ev.x - anchor.x, y: ev.y - anchor.y });
      const k = fromCenter ? 2 : 1;
      const W0 = this.w * d.sx, H0 = this.h * d.sy;
      let W = hx ? Math.max(1, hx * loc.x * k) : W0;
      let H = hy ? Math.max(1, hy * loc.y * k) : H0;
      const proportional = hx && hy ? ev.shift !== !!app.opts(app.tools.get('move')).proportional : false;
      if (proportional) {
        const s = Math.max(W / W0, H / H0);
        W = W0 * s; H = H0 * s;
      }
      this.sx = W / this.w;
      this.sy = H / this.h;
      if (fromCenter) { this.cx = d.cx; this.cy = d.cy; } else {
        const R = new DOMMatrix().rotate((d.rot * 180) / Math.PI);
        const c = R.transformPoint({ x: (hx * W) / 2, y: (hy * H) / 2 });
        this.cx = anchor.x + c.x;
        this.cy = anchor.y + c.y;
      }
    }
    this.update();
  }

  endDrag() { this.drag = null; }

  cursorAt(ev, vp) {
    if (this.moveOnly) return 'move';
    const h = this.hit(ev.sx, ev.sy, vp);
    if (h.type === 'move') return 'move';
    if (h.type === 'rotate') return 'alias';
    const ang = Math.atan2(h.hy, h.hx) + this.rot;
    const dirs = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
    return dirs[((Math.round(ang / (Math.PI / 4)) % 4) + 4) % 4];
  }

  draw(ctx, vp) {
    if (this.moveOnly) return;
    const pts = this.corners().map((p) => vp.toScreen(p.x, p.y));
    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2680eb';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    const m = this.matrix();
    ctx.fillStyle = '#fff';
    for (const [hx, hy] of HANDLES) {
      const d = m.transformPoint({ x: ((hx + 1) / 2) * this.w, y: ((hy + 1) / 2) * this.h });
      const p = vp.toScreen(d.x, d.y);
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      ctx.strokeRect(p.x - 4.5, p.y - 4.5, 9, 9);
    }
    const c = vp.toScreen(this.cx, this.cy);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}
