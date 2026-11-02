// Application state shared by every module.

import { Emitter, el } from './util.js';
import { Doc } from './model.js';

const SETTINGS_KEY = 'studio-web:settings';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}

class App extends Emitter {
  constructor() {
    super();
    this.docs = [];
    this.doc = null;
    this.tool = null;
    this.fg = '#000000';
    this.bg = '#ffffff';
    this.clipboard = null; // {canvas, x, y}
    this.settings = {
      theme: 'dark', rulers: true, grid: false, gridSize: 32, guides: true, swatches: null,
      toolOptions: {}, toolGroups: {}, dockSplit: 0.5, ...loadSettings(),
    };
    this.tools = new Map();
    this.viewport = null;
    Doc.listener = (doc, previewOnly) => {
      if (doc !== this.doc) { if (!previewOnly) this.emit('docs'); return; }
      this.emit(previewOnly ? 'preview' : 'change', doc);
    };
  }

  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* private mode */ }
  }

  // ------------------------------------------------------------ documents

  addDoc(doc) {
    this.docs.push(doc);
    this.setDoc(doc);
  }

  setDoc(doc) {
    if (this.doc === doc) return;
    this.tool?.deactivate?.();
    this.doc = doc;
    this.tool?.activate?.();
    this.emit('docs');
    this.emit('change', doc);
  }

  removeDoc(doc) {
    const i = this.docs.indexOf(doc);
    if (i < 0) return;
    if (doc === this.doc) this.tool?.deactivate?.();
    this.docs.splice(i, 1);
    if (doc === this.doc) {
      this.doc = null;
      this.setDoc(this.docs[Math.min(i, this.docs.length - 1)] || null);
      if (!this.doc) { this.emit('docs'); this.emit('change', null); }
    } else this.emit('docs');
  }

  // ------------------------------------------------------------ tools

  registerTool(tool) { this.tools.set(tool.id, tool); }

  setTool(id) {
    const tool = this.tools.get(id);
    if (!tool || tool === this.tool) return;
    this.tool?.deactivate?.();
    this.tool = tool;
    if (tool.group) this.settings.toolGroups[tool.group] = id;
    tool.activate?.();
    this.saveSettings();
    this.emit('tool', tool);
    this.viewport?.render();
  }

  /** Persistent options of a tool, with defaults from its schema. */
  opts(tool) {
    const all = this.settings.toolOptions;
    const o = (all[tool.id] ||= {});
    for (const f of tool.options || []) if (f.id && !(f.id in o)) o[f.id] = f.value;
    return o;
  }

  setOpt(tool, id, value) {
    this.opts(tool)[id] = value;
    this.saveSettings();
    this.emit('options', tool);
  }

  // ------------------------------------------------------------ colors

  setColor(which, hex) {
    this[which] = hex;
    this.emit('colors');
  }

  swapColors() { [this.fg, this.bg] = [this.bg, this.fg]; this.emit('colors'); }
  resetColors() { this.fg = '#000000'; this.bg = '#ffffff'; this.emit('colors'); }

  // ------------------------------------------------------------ feedback

  toast(msg, ms = 2600) {
    const root = document.getElementById('toasts');
    const t = el('div', { class: 'toast', role: 'status' }, msg);
    root.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  }
}

export const app = new App();
