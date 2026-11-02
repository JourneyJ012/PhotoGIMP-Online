// The canvas view: renders the active document with zoom/pan, rulers, grid,
// guides, marching ants and tool overlays, and routes pointer input to tools.

import { app } from './app.js';
import { clamp, rafThrottle } from './util.js';

export const ZOOM_STEPS = [0.01, 0.02, 0.03, 0.05, 1 / 15, 1 / 12, 0.125, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3,
  1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 24, 32, 64];
const RULER = 20;

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class Viewport {
  constructor() {
    this.host = document.getElementById('viewport');
    this.canvas = document.getElementById('view');
    this.ctx = this.canvas.getContext('2d');
    this.rulerH = document.getElementById('ruler-h');
    this.rulerV = document.getElementById('ruler-v');
    this.w = 1; this.h = 1; this.dpr = 1;
    this.hover = null;          // last pointer position over the view
    this.drag = null;           // {tool} while a pointer is down
    this.spaceDown = false;
    this.antsOffset = 0;
    this.showExtras = true;     // selection outline & guides
    this.colors = {};
    this.emitView = rafThrottle(() => app.emit('view'));

    new ResizeObserver(() => this.resize()).observe(this.host);
    this.resize();
    this.readTheme();
    this.bindPointer();
    this.bindRulers();
    setInterval(() => {
      if (app.doc?.selection && this.showExtras && !document.hidden) {
        this.antsOffset = (this.antsOffset + 1) % 8;
        this.render();
      }
    }, 110);
  }

  readTheme() {
    for (const k of ['canvas', 'ruler', 'fg', 'dim', 'border', 'accent']) this.colors[k] = cssVar(`--${k}`);
    const p = document.createElement('canvas');
    p.width = p.height = 16;
    const c = p.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 16, 16);
    c.fillStyle = '#cccccc'; c.fillRect(0, 0, 8, 8); c.fillRect(8, 8, 8, 8);
    this.checker = this.ctx.createPattern(p, 'repeat');
    this.render();
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    for (const [c, horiz] of [[this.rulerH, true], [this.rulerV, false]]) {
      const rr = c.getBoundingClientRect();
      c.width = Math.max(1, Math.round((horiz ? rr.width : RULER) * this.dpr));
      c.height = Math.max(1, Math.round((horiz ? RULER : rr.height) * this.dpr));
    }
    const doc = app.doc;
    if (doc && !doc.view.ready) this.fit(false);
    this.render(true);
  }

  // ------------------------------------------------------------ coordinates

  get view() { return app.doc?.view; }
  get zoom() { return app.doc?.view.zoom ?? 1; }

  toDoc(sx, sy) {
    const v = this.view;
    return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
  }

  toScreen(x, y) {
    const v = this.view;
    return { x: x * v.zoom + v.panX, y: y * v.zoom + v.panY };
  }

  visibleDocRect() {
    const a = this.toDoc(0, 0), b = this.toDoc(this.w, this.h);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  center() { return this.toDoc(this.w / 2, this.h / 2); }

  setZoom(z, sx = this.w / 2, sy = this.h / 2) {
    const v = this.view;
    if (!v) return;
    z = clamp(z, 0.01, 64);
    const p = this.toDoc(sx, sy);
    v.zoom = z;
    v.panX = sx - p.x * z;
    v.panY = sy - p.y * z;
    this.viewChanged();
  }

  zoomStep(dir, sx, sy) {
    const z = this.zoom;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z * 1.001) : [...ZOOM_STEPS].reverse().find((s) => s < z / 1.001);
    if (next) this.setZoom(next, sx, sy);
  }

  /** Fit the document in the view. allowUpscale: Ctrl+0 behaviour. */
  fit(allowUpscale = true) {
    const doc = app.doc;
    if (!doc) return;
    const v = doc.view, m = 32;
    let z = Math.min((this.w - m) / doc.width, (this.h - m) / doc.height);
    if (!allowUpscale) z = Math.min(z, 1);
    v.zoom = clamp(z, 0.01, 64);
    v.panX = Math.round((this.w - doc.width * v.zoom) / 2);
    v.panY = Math.round((this.h - doc.height * v.zoom) / 2);
    v.ready = this.w > 50;
    this.viewChanged();
  }

  actualPixels() {
    const doc = app.doc;
    if (!doc) return;
    const c = this.center();
    this.setZoom(1);
    const v = doc.view;
    v.panX = Math.round(this.w / 2 - c.x);
    v.panY = Math.round(this.h / 2 - c.y);
    this.viewChanged();
  }

  panBy(dx, dy) {
    const v = this.view;
    if (!v) return;
    v.panX += dx;
    v.panY += dy;
    this.viewChanged();
  }

  /** Center the view on a doc point. */
  centerOn(x, y) {
    const v = this.view;
    v.panX = this.w / 2 - x * v.zoom;
    v.panY = this.h / 2 - y * v.zoom;
    this.viewChanged();
  }

  viewChanged() {
    this.render(true);
    this.emitView();
  }

  // ------------------------------------------------------------ rendering

  render(rulers = false) {
    if (rulers) this._rulers = true;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.draw();
      if (this._rulers || this.hover) this.drawRulers();
      this._rulers = false;
    });
  }

  draw() {
    const { ctx, dpr, w: W, h: H } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.colors.canvas;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const doc = app.doc;
    if (!doc) return;
    const { zoom: z, panX, panY } = doc.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const v = { x0: Math.max(0, -panX / z), y0: Math.max(0, -panY / z),
      x1: Math.min(doc.width, (W - panX) / z), y1: Math.min(doc.height, (H - panY) / z) };
    if (v.x1 > v.x0 && v.y1 > v.y0) {
      const sx = Math.floor(v.x0), sy = Math.floor(v.y0);
      const sw = Math.ceil(v.x1) - sx, sh = Math.ceil(v.y1) - sy;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(panX + 2, panY + 2, doc.width * z, doc.height * z);
      ctx.fillStyle = this.checker;
      ctx.fillRect(panX + sx * z, panY + sy * z, sw * z, sh * z);
      const comp = doc.getComposite();
      ctx.imageSmoothingEnabled = z < 1;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(comp, sx, sy, sw, sh, panX + sx * z, panY + sy * z, sw * z, sh * z);
      ctx.imageSmoothingEnabled = true;
    }

    if (app.settings.grid) this.drawGrid(doc, v);
    if (z >= 8 && app.settings.pixelGrid !== false) this.drawPixelGrid(doc, v);

    if (doc.selection && this.showExtras && !app.tool?.hideAnts) {
      ctx.save();
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * panX, dpr * panY);
      ctx.lineWidth = 1 / z;
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.lineDashOffset = -this.antsOffset / z;
      ctx.strokeStyle = '#000';
      ctx.stroke(doc.selection.ants);
      ctx.lineDashOffset = (4 - this.antsOffset) / z;
      ctx.strokeStyle = '#fff';
      ctx.stroke(doc.selection.ants);
      ctx.restore();
    }

    if (this.showExtras && app.settings.guides) {
      ctx.save();
      ctx.lineWidth = 1;
      for (const g of doc.guides) {
        ctx.strokeStyle = g === this.activeGuide ? '#ff4d6a' : '#33c8ff';
        ctx.beginPath();
        if (g.axis === 'h') { const y = Math.round(panY + g.pos * z) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
        else { const x = Math.round(panX + g.pos * z) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        ctx.stroke();
      }
      ctx.restore();
    }

    const tool = this.drag?.tool || app.tool;
    if (tool?.drawOverlay) {
      ctx.save();
      tool.drawOverlay(ctx, this);
      ctx.restore();
    }
  }

  drawGrid(doc, v) {
    const { ctx } = this, { zoom: z, panX, panY } = doc.view, gs = app.settings.gridSize || 32;
    if (gs * z < 4) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(128,128,128,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = Math.ceil(v.x0 / gs) * gs; gx <= v.x1; gx += gs) {
      const x = Math.round(panX + gx * z) + 0.5;
      ctx.moveTo(x, panY + v.y0 * z); ctx.lineTo(x, panY + v.y1 * z);
    }
    for (let gy = Math.ceil(v.y0 / gs) * gs; gy <= v.y1; gy += gs) {
      const y = Math.round(panY + gy * z) + 0.5;
      ctx.moveTo(panX + v.x0 * z, y); ctx.lineTo(panX + v.x1 * z, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawPixelGrid(doc, v) {
    const { ctx } = this, { zoom: z, panX, panY } = doc.view;
    ctx.save();
    ctx.strokeStyle = 'rgba(127,127,127,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = Math.ceil(v.x0); gx <= v.x1; gx++) {
      const x = Math.round(panX + gx * z) + 0.5;
      ctx.moveTo(x, panY + v.y0 * z); ctx.lineTo(x, panY + v.y1 * z);
    }
    for (let gy = Math.ceil(v.y0); gy <= v.y1; gy++) {
      const y = Math.round(panY + gy * z) + 0.5;
      ctx.moveTo(panX + v.x0 * z, y); ctx.lineTo(panX + v.x1 * z, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawRulers() {
    if (!app.settings.rulers) return;
    for (const [c, horiz] of [[this.rulerH, true], [this.rulerV, false]]) {
      const ctx = c.getContext('2d'), dpr = this.dpr;
      const len = (horiz ? c.width : c.height) / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = this.colors.ruler;
      ctx.fillRect(0, 0, horiz ? len : RULER, horiz ? RULER : len);
      ctx.fillStyle = this.colors.border;
      if (horiz) ctx.fillRect(0, RULER - 1, len, 1); else ctx.fillRect(RULER - 1, 0, 1, len);
      const doc = app.doc;
      if (!doc) continue;
      const z = doc.view.zoom, off = horiz ? doc.view.panX : doc.view.panY;
      let step = 1;
      for (const base of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]) {
        step = base;
        if (base * z >= 64) break;
      }
      const minor = String(step)[0] === '2' ? 4 : 10;
      const minorPx = (step * z) / minor;
      ctx.strokeStyle = this.colors.dim;
      ctx.fillStyle = this.colors.dim;
      ctx.font = '9px system-ui, sans-serif';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const u0 = Math.floor(-off / z / step) * step, u1 = (len - off) / z;
      for (let u = u0; u <= u1; u += step) {
        const p = Math.round(off + u * z) + 0.5;
        if (horiz) { ctx.moveTo(p, 0); ctx.lineTo(p, RULER); } else { ctx.moveTo(0, p); ctx.lineTo(RULER, p); }
        if (minorPx >= 4) {
          for (let i = 1; i < minor; i++) {
            const q = Math.round(off + (u + (i * step) / minor) * z) + 0.5;
            const t = i === minor / 2 ? 7 : 4;
            if (horiz) { ctx.moveTo(q, RULER - t); ctx.lineTo(q, RULER); } else { ctx.moveTo(RULER - t, q); ctx.lineTo(RULER, q); }
          }
        }
        if (horiz) ctx.fillText(String(u), p + 2, 9);
        else {
          ctx.save();
          ctx.translate(9, p + 2);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'right';
          ctx.fillText(String(u), 0, 0);
          ctx.restore();
        }
      }
      ctx.stroke();
      if (this.hover) {
        ctx.strokeStyle = this.colors.accent;
        ctx.beginPath();
        const p = Math.round(horiz ? this.hover.sx : this.hover.sy) + 0.5;
        if (horiz) { ctx.moveTo(p, 0); ctx.lineTo(p, RULER); } else { ctx.moveTo(0, p); ctx.lineTo(RULER, p); }
        ctx.stroke();
      }
    }
  }

  // ------------------------------------------------------------ guides

  hitGuide(sx, sy) {
    const doc = app.doc;
    if (!doc || !app.settings.guides) return null;
    for (const g of doc.guides) {
      const s = this.toScreen(g.pos, g.pos);
      if (g.axis === 'h' ? Math.abs(s.y - sy) <= 3 : Math.abs(s.x - sx) <= 3) return g;
    }
    return null;
  }

  /** Drag a guide (new or existing); removes it when released off the canvas. */
  dragGuide(guide, e0) {
    const doc = app.doc;
    this.activeGuide = guide;
    const r = this.host.getBoundingClientRect();
    const move = (e) => {
      const p = this.toDoc(e.clientX - r.left, e.clientY - r.top);
      guide.pos = Math.round(guide.axis === 'h' ? p.y : p.x);
      this.hover = { sx: e.clientX - r.left, sy: e.clientY - r.top, ...p };
      app.emit('pointer', this.hover);
      this.render(true);
    };
    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
      if (!inside) doc.guides = doc.guides.filter((g) => g !== guide);
      this.activeGuide = null;
      this.render(true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    move(e0);
  }

  bindRulers() {
    for (const [c, axis] of [[this.rulerH, 'h'], [this.rulerV, 'v']]) {
      c.addEventListener('pointerdown', (e) => {
        const doc = app.doc;
        if (!doc || e.button !== 0) return;
        e.preventDefault();
        app.settings.guides = true;
        const g = { axis, pos: 0 };
        doc.guides.push(g);
        this.dragGuide(g, e);
      });
    }
  }

  // ------------------------------------------------------------ input

  event(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const p = app.doc ? this.toDoc(sx, sy) : { x: 0, y: 0 };
    return {
      e, sx, sy, x: p.x, y: p.y,
      shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
      pressure: e.pointerType === 'pen' ? (e.pressure || 0.5) : 1,
      pen: e.pointerType === 'pen',
    };
  }

  bindPointer() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      const doc = app.doc;
      if (!doc || this.drag) return;
      if (e.button === 2) return;
      document.activeElement?.blur?.();
      cv.focus({ preventScroll: true });
      e.preventDefault();
      const ev = this.event(e);
      let tool = app.tool;
      if (this.spaceDown || e.button === 1) tool = app.tools.get('hand');
      else if (ev.alt && tool?.altPick) { tool = app.tools.get('eyedropper'); ev.alt = false; }
      else if (tool?.id === 'move') {
        const g = this.hitGuide(ev.sx, ev.sy);
        if (g) { this.dragGuide(g, e); return; }
      }
      if (!tool?.down) return;
      cv.setPointerCapture(e.pointerId);
      this.drag = { tool, id: e.pointerId };
      tool.down(ev, this);
      this.render();
    });

    cv.addEventListener('pointermove', (e) => {
      const events = this.drag && e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ce of events.length ? events : [e]) {
        const ev = this.event(ce);
        this.hover = ev;
        if (this.drag) { if (this.drag.id === e.pointerId) this.drag.tool.move?.(ev, this); }
        else app.tool?.hover?.(ev, this);
      }
      this.updateCursor();
      app.emit('pointer', this.hover);
      this.render(true);
    });

    const end = (e) => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      const { tool } = this.drag;
      this.drag = null;
      tool.up?.(this.event(e), this);
      this.updateCursor();
      this.render();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => {
      if (this.drag) return;
      this.hover = null;
      app.emit('pointer', null);
      this.render(true);
    });
    cv.addEventListener('dblclick', (e) => app.tool?.dblclick?.(this.event(e), this));
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keep focus where tools put it (e.g. the text editor) instead of the canvas.
    cv.addEventListener('mousedown', (e) => e.preventDefault());

    cv.addEventListener('wheel', (e) => {
      if (!app.doc) return;
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.h : 1;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const f = Math.exp(-e.deltaY * unit * (e.ctrlKey && !e.deltaMode ? 0.01 : 0.002));
        this.setZoom(this.zoom * f, sx, sy);
      } else if (e.shiftKey) this.panBy(-(e.deltaY || e.deltaX) * unit, 0);
      else this.panBy(-e.deltaX * unit, -e.deltaY * unit);
    }, { passive: false });
  }

  updateCursor() {
    let c = 'default';
    const tool = this.drag?.tool || app.tool;
    if (this.spaceDown) c = this.drag ? 'grabbing' : 'grab';
    else if (!this.drag && app.tool?.id === 'move' && this.hover && this.hitGuide(this.hover.sx, this.hover.sy)) {
      const g = this.hitGuide(this.hover.sx, this.hover.sy);
      c = g.axis === 'h' ? 'ns-resize' : 'ew-resize';
    } else if (tool) c = (tool.cursorAt && this.hover ? tool.cursorAt(this.hover, this) : tool.cursor) || 'default';
    if (this.canvas.style.cursor !== c) this.canvas.style.cursor = c;
  }
}
