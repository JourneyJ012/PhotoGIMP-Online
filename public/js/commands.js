// Menu actions, the menu bar layout and keyboard shortcuts.

import { app } from './app.js';
import { ADJUSTMENTS, FILTERS, histogram } from './filters.js';
import {
  addLayer, clearSelection, commitRegion, copyPixels, cropDoc, deleteLayer, docFromImage, fillSelection,
  filterRegion, filteredRegion, flattenImage, flipDoc, flipLayer, layerViaCopy, mergeDown, mergeVisible, moveLayer,
  newDocument, paintableLayer, pasteLayer, rasterizeLayer, regionPreview, resizeCanvas, resizeImage, rotateDoc,
  selectLayerAlpha, selectLayerRelative, setLayerProps, setSelection, stampVisible, trimDoc,
} from './ops.js';
import { feather, growShrink, invert, selectAll } from './selection.js';
import { EXPORT_TYPES, chooseFiles, decodeImage, exportBlob, exportDoc, openFile, saveProject } from './io.js';
import { TOOLBAR } from './tools.js';
import { baseName, canvasToBlob, el, formatBytes, isEditable } from './util.js';
import {
  canvasSizeDialog, confirmDialog, dialogOpen, imageSizeDialog, infoDialog, modal, newDocDialog, paramDialog,
  promptNumber, promptText,
} from './ui/dialogs.js';
import { closeMenus, menuOpen, prettyKey } from './ui/menu.js';
import { check, select, spinScale } from './ui/widgets.js';

export const actions = {};
const A = (id, def) => { actions[id] = def; };

const hasDoc = () => !!app.doc;
const hasLayer = () => !!app.doc?.active;
const hasSel = () => !!app.doc?.selection;
const vp = () => app.viewport;

// ------------------------------------------------------------ file

export async function newDoc(opts) {
  const v = opts || await newDocDialog();
  if (!v) return;
  app.addDoc(newDocument(v));
}

export async function closeDoc(doc = app.doc) {
  if (!doc) return true;
  if (doc.dirty) {
    let choice = 'cancel';
    await new Promise((res) => modal({
      title: 'Studio',
      body: el('p', { class: 'dlg-msg' }, `Save changes to “${doc.name}” before closing?`),
      buttons: [
        { label: 'Cancel', action: () => { choice = 'cancel'; } },
        { label: "Don't Save", action: () => { choice = 'discard'; } },
        { label: 'Save', primary: true, action: () => { choice = 'save'; } },
      ],
      onClose: res,
    }));
    if (choice === 'cancel') return false;
    if (choice === 'save' && !(await saveProject(doc))) return false;
  }
  app.removeDoc(doc);
  return true;
}

export async function openFiles(asLayers = false) {
  const files = await chooseFiles();
  for (const { file, handle } of files) {
    if (asLayers && app.doc) await placeFile(file);
    else await openFile(file, handle);
  }
}

export async function placeFile(file, at) {
  const doc = app.doc;
  try {
    const img = await decodeImage(file);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    img.close?.();
    const p = at || vp().center();
    addLayer(doc, { name: baseName(file.name), canvas: c, x: Math.round(p.x - c.width / 2), y: Math.round(p.y - c.height / 2), label: 'Place' });
  } catch (e) {
    app.toast(`Could not open ${file.name}`);
  }
}

async function exportDialog(doc) {
  const last = doc.lastExport || {};
  const v = { format: last.format || 'png', quality: last.quality ?? 0.9, scale: last.scale ?? 1, name: last.name || baseName(doc.name) };
  const info = el('div', { class: 'hint export-info' });
  let token = 0;
  const estimate = async () => {
    const t = ++token;
    info.textContent = `${Math.round(doc.width * v.scale)} × ${Math.round(doc.height * v.scale)} px · estimating size…`;
    const b = await exportBlob(doc, v);
    if (t === token) info.textContent = `${Math.round(doc.width * v.scale)} × ${Math.round(doc.height * v.scale)} px · ${formatBytes(b.size)}`;
  };
  let timer;
  const later = () => { clearTimeout(timer); timer = setTimeout(estimate, 250); };
  const q = spinScale({ label: 'Quality', min: 1, max: 100, value: Math.round(v.quality * 100), unit: '%', onInput: (x) => { v.quality = x / 100; later(); } });
  const showQ = () => { q.el.style.display = v.format === 'png' ? 'none' : ''; };
  const nameIn = el('input', { type: 'text', class: 'text-input', value: v.name });
  const body = el('div', { class: 'form' },
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'File name'), nameIn),
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Format'),
      select({ label: 'Format', value: v.format, options: Object.entries(EXPORT_TYPES).map(([k, t]) => [k, t.label]), onChange: (x) => { v.format = x; showQ(); later(); } })),
    q.el,
    spinScale({ label: 'Scale', min: 1, max: 400, value: Math.round(v.scale * 100), unit: '%', gamma: 1.5, onInput: (x) => { v.scale = x / 100; later(); } }).el,
    info);
  showQ();
  estimate();
  modal({
    title: 'Export As', body, width: 380,
    buttons: [{ label: 'Cancel' }, { label: 'Export', primary: true, action: () => { v.name = nameIn.value || 'image'; exportDoc(doc, v); } }],
  });
}

A('new', { label: 'New…', keys: ['Ctrl+Alt+N', 'Ctrl+N'], run: () => newDoc() });
A('new-clipboard', { label: 'New from Clipboard', run: () => pasteFromClipboard(true) });
A('open', { label: 'Open…', keys: ['Ctrl+O'], run: () => openFiles() });
A('open-layers', { label: 'Place / Open as Layers…', keys: ['Ctrl+Shift+O'], enabled: hasDoc, run: () => openFiles(true) });
A('save', { label: 'Save Project (.ora)', keys: ['Ctrl+S'], enabled: hasDoc, run: () => saveProject(app.doc) });
A('save-as', { label: 'Save Project As…', keys: ['Ctrl+Shift+S'], enabled: hasDoc, run: () => saveProject(app.doc, true) });
A('export', { label: () => (app.doc?.lastExport ? `Export to ${app.doc.lastExport.name}.${EXPORT_TYPES[app.doc.lastExport.format].ext}` : 'Export'), keys: ['Ctrl+Alt+S'], enabled: hasDoc,
  run: () => (app.doc.lastExport ? exportDoc(app.doc, app.doc.lastExport) : exportDialog(app.doc)) });
A('export-as', { label: 'Export As…', keys: ['Ctrl+Alt+Shift+W', 'Ctrl+Alt+Shift+S'], enabled: hasDoc, run: () => exportDialog(app.doc) });
A('quick-png', { label: 'Quick Export as PNG', enabled: hasDoc, run: () => exportDoc(app.doc, { format: 'png', name: baseName(app.doc.name) }) });
A('close', { label: 'Close', keys: ['Ctrl+Alt+W', 'Ctrl+W'], enabled: hasDoc, run: () => closeDoc() });
A('close-all', { label: 'Close All', enabled: hasDoc, run: async () => { for (const d of [...app.docs]) if (!(await closeDoc(d))) break; } });

// ------------------------------------------------------------ edit

const editTool = () => app.tool?.id === 'text' && app.tool.editing;

A('undo', { label: () => `Undo ${app.doc?.history.undoLabel || ''}`.trim(), keys: ['Ctrl+Z'], enabled: () => app.doc?.history.canUndo,
  run: () => { finishTransient(); app.doc.history.undo(); } });
A('redo', { label: () => `Redo ${app.doc?.history.redoLabel || ''}`.trim(), keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], enabled: () => app.doc?.history.canRedo,
  run: () => app.doc.history.redo() });
A('step-back', { label: 'Step Backward', keys: ['Ctrl+Alt+Z'], enabled: () => app.doc?.history.canUndo, run: () => { finishTransient(); app.doc.history.undo(); } });
A('step-forward', { label: 'Step Forward', keys: ['Ctrl+Shift+Alt+Z'], enabled: () => app.doc?.history.canRedo, run: () => app.doc.history.redo() });
A('cut', { label: 'Cut', keys: ['Ctrl+X'], enabled: hasLayer, run: () => { if (copy(false)) clearSelection(app.doc); } });
A('copy', { label: 'Copy', keys: ['Ctrl+C'], enabled: hasLayer, run: () => copy(false) });
A('copy-merged', { label: 'Copy Merged', keys: ['Ctrl+Shift+C'], enabled: hasDoc, run: () => copy(true) });
A('paste', { label: 'Paste', keys: ['Ctrl+V'], run: () => pasteFromClipboard(false) });
A('clear', { label: 'Clear', keys: ['Delete', 'Backspace'], enabled: hasLayer, run: () => clearSelection(app.doc) });
A('fill-fg', { label: 'Fill with Foreground Color', keys: ['Alt+Backspace', 'Alt+Delete'], enabled: hasLayer, run: () => fillSelection(app.doc, app.fg, 'Fill') });
A('fill-bg', { label: 'Fill with Background Color', keys: ['Ctrl+Backspace', 'Ctrl+Delete'], enabled: hasLayer, run: () => fillSelection(app.doc, app.bg, 'Fill') });
A('free-transform', { label: 'Free Transform', keys: ['Ctrl+Alt+T', 'Ctrl+T'], enabled: hasLayer, run: () => app.tools.get('transform').begin() });
A('flip-layer-h', { label: 'Flip Layer Horizontal', enabled: hasLayer, run: () => flipLayer(app.doc, 'h') });
A('flip-layer-v', { label: 'Flip Layer Vertical', enabled: hasLayer, run: () => flipLayer(app.doc, 'v') });
A('preferences', { label: 'Preferences…', keys: ['Ctrl+K'], run: () => preferencesDialog() });
A('shortcuts', { label: 'Keyboard Shortcuts…', keys: ['Ctrl+Alt+Shift+K', 'F1'], run: () => shortcutsDialog() });

/** Commit or cancel things that live outside history before undoing. */
function finishTransient() {
  if (editTool()) app.tool.commit();
  if (app.tool?.id === 'transform') app.tool.finish(false);
}

function copy(merged) {
  const doc = app.doc;
  const clip = copyPixels(doc, merged);
  if (!clip) return false;
  app.clipboard = clip;
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasToBlob(clip.canvas) })]).catch(() => {});
    }
  } catch { /* the internal clipboard still works */ }
  return true;
}

async function pasteImageBlob(blob, asNewDoc) {
  const img = await decodeImage(blob);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  img.close?.();
  if (asNewDoc || !app.doc) app.addDoc(docFromImage(c, 'Clipboard'));
  else pasteLayer(app.doc, { canvas: c }, vp());
}

function pasteInternal(asNewDoc) {
  const clip = app.clipboard;
  if (!clip) { app.toast('The clipboard has no image'); return; }
  const c = document.createElement('canvas');
  c.width = clip.canvas.width; c.height = clip.canvas.height;
  c.getContext('2d').drawImage(clip.canvas, 0, 0);
  if (asNewDoc || !app.doc) app.addDoc(docFromImage(c, 'Clipboard'));
  else pasteLayer(app.doc, { ...clip, canvas: c }, vp());
}

/** Menu Paste: read the system clipboard (asks for permission), else ours. */
async function pasteFromClipboard(asNewDoc) {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (type) { await pasteImageBlob(await it.getType(type), asNewDoc); return; }
      }
    }
  } catch { /* fall back to the internal clipboard */ }
  pasteInternal(asNewDoc);
}

/** Ctrl+V comes through the paste event, which needs no permission. */
export function bindPaste() {
  document.addEventListener('paste', async (e) => {
    if (isEditable(e.target) || dialogOpen()) return;
    const file = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
    e.preventDefault();
    if (file) await pasteImageBlob(file, false);
    else pasteInternal(false);
  });
}

// ------------------------------------------------------------ image

async function runPixelOp(id, def, kind) {
  const doc = app.doc;
  const layer = paintableLayer(doc);
  if (!layer) return;
  const margin = (v) => (def.margin ? def.margin(v) : 0);
  const compute = (v) => filteredRegion(doc, layer, (img) => def.apply(img, v), margin(v));
  if (def.instant) {
    const res = compute({});
    if (res) commitRegion(doc, layer, def.title, res);
    if (kind === 'filter') app.lastFilter = { id, values: {} };
    return;
  }
  let histCache = null;
  const hist = (ch) => {
    histCache ||= {};
    if (!histCache[ch]) {
      const r = filterRegion(doc, layer);
      histCache[ch] = r ? histogram(layer.canvas.getContext('2d').getImageData(r.x, r.y, r.w, r.h), ch) : new Uint32Array(256);
    }
    return histCache[ch];
  };
  let last = null;
  const stored = kind === 'filter' ? app.settings.filterValues?.[id] : null;
  await paramDialog({
    title: def.title, fields: def.fields, values: stored || {}, histogram: hist,
    onPreview: (v) => {
      if (!v) { layer.preview = null; doc.invalidate(); return; }
      const key = JSON.stringify(v);
      const res = compute(v);
      last = { key, res };
      layer.preview = res ? regionPreview(layer, res) : null;
      doc.invalidate();
    },
    onApply: (v) => {
      layer.preview = null;
      const key = JSON.stringify(v);
      const res = last?.key === key ? last.res : compute(v);
      if (res) commitRegion(doc, layer, def.title, res);
      if (kind === 'filter') {
        app.lastFilter = { id, values: structuredClone(v) };
        (app.settings.filterValues ||= {})[id] = v;
        app.saveSettings();
      }
    },
    onCancel: () => { layer.preview = null; doc.invalidate(); },
  });
}

const ADJ_KEYS = {
  levels: ['Ctrl+L'], curves: ['Ctrl+M'], 'hue-saturation': ['Ctrl+U'], 'color-balance': ['Ctrl+B'],
  'black-white': ['Ctrl+Alt+Shift+B'], invert: ['Ctrl+I'], desaturate: ['Ctrl+Shift+U'], 'auto-tone': ['Ctrl+Shift+L'],
};
for (const [id, def] of Object.entries(ADJUSTMENTS)) {
  A(`adj-${id}`, { label: def.instant ? def.title : `${def.title}…`, keys: ADJ_KEYS[id], enabled: hasLayer, run: () => runPixelOp(id, def, 'adjustment') });
}
for (const [id, def] of Object.entries(FILTERS)) {
  A(`filter-${id}`, { label: def.instant ? def.title : `${def.title}…`, enabled: hasLayer, run: () => runPixelOp(id, def, 'filter') });
}
A('filter-repeat', {
  label: () => (app.lastFilter ? `Last Filter (${FILTERS[app.lastFilter.id].title})` : 'Last Filter'), keys: ['Ctrl+F'],
  enabled: () => hasLayer() && !!app.lastFilter,
  run: () => {
    const { id, values } = app.lastFilter, def = FILTERS[id], doc = app.doc, layer = paintableLayer(doc);
    if (!layer) return;
    const res = filteredRegion(doc, layer, (img) => def.apply(img, values), def.margin ? def.margin(values) : 0);
    if (res) commitRegion(doc, layer, def.title, res);
  },
});

A('image-size', { label: 'Image Size…', keys: ['Ctrl+Alt+I'], enabled: hasDoc, run: async () => {
  const v = await imageSizeDialog(app.doc);
  if (v && (v.width !== app.doc.width || v.height !== app.doc.height)) { resizeImage(app.doc, v.width, v.height); vp().fit(false); }
} });
A('canvas-size', { label: 'Canvas Size…', keys: ['Ctrl+Alt+C'], enabled: hasDoc, run: async () => {
  const v = await canvasSizeDialog(app.doc);
  if (v && (v.width !== app.doc.width || v.height !== app.doc.height)) { resizeCanvas(app.doc, v.width, v.height, v.anchor); vp().fit(false); }
} });
A('rotate-180', { label: '180°', enabled: hasDoc, run: () => rotateDoc(app.doc, 180) });
A('rotate-cw', { label: '90° Clockwise', enabled: hasDoc, run: () => { rotateDoc(app.doc, 90); vp().fit(false); } });
A('rotate-ccw', { label: '90° Counter Clockwise', enabled: hasDoc, run: () => { rotateDoc(app.doc, 270); vp().fit(false); } });
A('flip-canvas-h', { label: 'Flip Canvas Horizontal', enabled: hasDoc, run: () => flipDoc(app.doc, 'h') });
A('flip-canvas-v', { label: 'Flip Canvas Vertical', enabled: hasDoc, run: () => flipDoc(app.doc, 'v') });
A('crop-selection', { label: 'Crop to Selection', enabled: hasSel, run: () => { cropDoc(app.doc, app.doc.selection.bounds, true, 'Crop'); vp().fit(false); } });
A('trim', { label: 'Trim Transparent Pixels', enabled: hasDoc, run: () => { trimDoc(app.doc); vp().fit(false); } });

// ------------------------------------------------------------ layer

const activeIdx = () => app.doc.indexOf(app.doc.active);
A('new-layer', { label: 'New Layer', keys: ['Ctrl+Alt+Shift+N', 'Ctrl+Shift+N'], enabled: hasDoc, run: () => addLayer(app.doc) });
A('layer-via-copy', { label: () => (hasSel() ? 'Layer via Copy' : 'Duplicate Layer'), keys: ['Ctrl+J'], enabled: hasLayer, run: () => layerViaCopy(app.doc) });
A('layer-via-cut', { label: 'Layer via Cut', keys: ['Ctrl+Shift+J'], enabled: () => hasLayer() && hasSel(), run: () => layerViaCopy(app.doc, true) });
A('delete-layer', { label: 'Delete Layer', enabled: hasLayer, run: () => deleteLayer(app.doc) });
A('layer-props', { label: 'Rename Layer…', enabled: hasLayer, run: async () => {
  const l = app.doc.active;
  const name = await promptText({ title: 'Layer Properties', label: 'Name', value: l.name });
  if (name?.trim()) setLayerProps(app.doc, l, { name: name.trim() }, 'Rename Layer');
} });
A('lock-layer', { label: 'Lock Layer', keys: ['Ctrl+/'], enabled: hasLayer, checked: () => !!app.doc?.active?.locked,
  run: () => { const l = app.doc.active; setLayerProps(app.doc, l, { locked: !l.locked }, l.locked ? 'Unlock Layer' : 'Lock Layer'); } });
A('rasterize', { label: 'Rasterize Type', enabled: () => !!app.doc?.active?.text, run: () => rasterizeLayer(app.doc) });
A('layer-alpha', { label: 'Select Layer Pixels', enabled: hasLayer, run: () => selectLayerAlpha(app.doc, app.doc.active) });
A('raise', { label: 'Bring Forward', keys: ['Ctrl+]'], enabled: hasLayer, run: () => moveLayer(app.doc, app.doc.active, activeIdx() + 1, 'Bring Forward') });
A('lower', { label: 'Send Backward', keys: ['Ctrl+['], enabled: hasLayer, run: () => moveLayer(app.doc, app.doc.active, activeIdx() - 1, 'Send Backward') });
A('to-top', { label: 'Bring to Front', keys: ['Ctrl+Shift+]'], enabled: hasLayer, run: () => moveLayer(app.doc, app.doc.active, app.doc.layers.length - 1, 'Bring to Front') });
A('to-bottom', { label: 'Send to Back', keys: ['Ctrl+Shift+['], enabled: hasLayer, run: () => moveLayer(app.doc, app.doc.active, 0, 'Send to Back') });
A('select-above', { label: 'Select Layer Above', keys: ['Alt+]'], enabled: hasLayer, run: () => selectLayerRelative(app.doc, 1) });
A('select-below', { label: 'Select Layer Below', keys: ['Alt+['], enabled: hasLayer, run: () => selectLayerRelative(app.doc, -1) });
A('merge-down', { label: 'Merge Down', keys: ['Ctrl+E'], enabled: () => hasLayer() && activeIdx() > 0, run: () => mergeDown(app.doc) });
A('merge-visible', { label: 'Merge Visible', keys: ['Ctrl+Shift+E'], enabled: hasDoc, run: () => mergeVisible(app.doc) });
A('stamp-visible', { label: 'New Layer from Visible', keys: ['Ctrl+Alt+Shift+E'], enabled: hasDoc, run: () => stampVisible(app.doc) });
A('flatten', { label: 'Flatten Image', enabled: hasDoc, run: () => flattenImage(app.doc) });

// ------------------------------------------------------------ select

A('select-all', { label: 'All', keys: ['Ctrl+A'], enabled: hasDoc, run: () => setSelection(app.doc, selectAll(app.doc.width, app.doc.height), 'Select All') });
A('deselect', { label: 'Deselect', keys: ['Ctrl+D'], enabled: hasSel, run: () => { app.doc.lastSelection = app.doc.selection; setSelection(app.doc, null, 'Deselect'); } });
A('reselect', { label: 'Reselect', keys: ['Ctrl+Shift+D'], enabled: () => !!app.doc?.lastSelection && !app.doc.selection, run: () => setSelection(app.doc, app.doc.lastSelection, 'Reselect') });
A('select-invert', { label: 'Inverse', keys: ['Ctrl+Shift+I'], enabled: hasDoc, run: () => setSelection(app.doc, invert(app.doc.selection, app.doc.width, app.doc.height), 'Select Inverse') });
A('feather', { label: 'Feather…', keys: ['Shift+F6'], enabled: hasSel, run: async () => {
  const r = await promptNumber({ title: 'Feather Selection', label: 'Feather radius', value: 5, min: 0.1, max: 250, unit: 'px' });
  if (r) setSelection(app.doc, feather(app.doc.selection, r), 'Feather');
} });
A('grow', { label: 'Expand…', enabled: hasSel, run: async () => {
  const r = await promptNumber({ title: 'Expand Selection', label: 'Expand by', value: 5, min: 1, max: 500, unit: 'px' });
  if (r) setSelection(app.doc, growShrink(app.doc.selection, r), 'Expand');
} });
A('shrink', { label: 'Contract…', enabled: hasSel, run: async () => {
  const r = await promptNumber({ title: 'Contract Selection', label: 'Contract by', value: 5, min: 1, max: 500, unit: 'px' });
  if (r) setSelection(app.doc, growShrink(app.doc.selection, -r), 'Contract');
} });

// ------------------------------------------------------------ view

const toggleSetting = (key, after) => () => { app.settings[key] = !app.settings[key]; app.saveSettings(); after?.(); vp().render(true); app.emit('settings'); };

A('zoom-in', { label: 'Zoom In', keys: ['Ctrl+=', 'Ctrl+Shift+=', 'Ctrl+Plus'], enabled: hasDoc, run: () => vp().zoomStep(1) });
A('zoom-out', { label: 'Zoom Out', keys: ['Ctrl+-'], enabled: hasDoc, run: () => vp().zoomStep(-1) });
A('fit', { label: 'Fit on Screen', keys: ['Ctrl+0'], enabled: hasDoc, run: () => vp().fit() });
A('actual', { label: '100%', keys: ['Ctrl+1', 'Ctrl+Alt+0'], enabled: hasDoc, run: () => vp().actualPixels() });
A('rulers', { label: 'Rulers', keys: ['Ctrl+R'], checked: () => app.settings.rulers, run: toggleSetting('rulers', () => {
  document.getElementById('workspace').classList.toggle('no-rulers', !app.settings.rulers);
}) });
A('grid', { label: 'Grid', keys: ["Ctrl+'"], checked: () => app.settings.grid, run: toggleSetting('grid') });
A('pixel-grid', { label: 'Pixel Grid', checked: () => app.settings.pixelGrid !== false, run: () => { app.settings.pixelGrid = app.settings.pixelGrid === false; app.saveSettings(); vp().render(); } });
A('guides', { label: 'Guides', keys: ['Ctrl+;'], checked: () => app.settings.guides, run: toggleSetting('guides') });
A('extras', { label: 'Selection Edges & Guides', keys: ['Ctrl+H', 'Ctrl+Shift+H'], checked: () => vp()?.showExtras, run: () => { vp().showExtras = !vp().showExtras; vp().render(); } });
A('grid-size', { label: 'Grid Size…', run: async () => {
  const n = await promptNumber({ title: 'Grid', label: 'Grid spacing', value: app.settings.gridSize, min: 2, max: 2000, unit: 'px' });
  if (n) { app.settings.gridSize = Math.round(n); app.settings.grid = true; app.saveSettings(); vp().render(); }
} });
A('clear-guides', { label: 'Clear Guides', enabled: () => !!app.doc?.guides.length, run: () => { app.doc.guides = []; vp().render(); } });
A('new-guide', { label: 'New Guide…', enabled: hasDoc, run: async () => {
  const n = await promptNumber({ title: 'New Guide', label: 'Vertical guide at x =', value: Math.round(app.doc.width / 2), min: 0, max: app.doc.width, unit: 'px' });
  if (n != null) { app.doc.guides.push({ axis: 'v', pos: Math.round(n) }); app.settings.guides = true; vp().render(); }
} });
A('fullscreen', { label: 'Full Screen', keys: ['F'], checked: () => !!document.fullscreenElement, run: () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().then(() => navigator.keyboard?.lock?.()).catch(() => {});
} });
for (const t of ['dark', 'gray', 'light']) {
  A(`theme-${t}`, { label: { dark: 'Dark', gray: 'Medium Gray', light: 'Light' }[t], checked: () => app.settings.theme === t, run: () => setTheme(t) });
}

export function setTheme(t) {
  app.settings.theme = t;
  app.saveSettings();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', { dark: '#323232', gray: '#535353', light: '#e8e8e8' }[t]);
  vp()?.readTheme();
  app.emit('settings');
}

// ------------------------------------------------------------ window & help

A('toggle-panels', { label: 'Show/Hide Panels', keys: ['Tab'], run: () => {
  // On phones the dock starts hidden and slides over the canvas.
  const small = matchMedia('(max-width: 640px)').matches;
  document.getElementById('app').classList.toggle(small ? 'panels-shown' : 'panels-hidden');
  requestAnimationFrame(() => vp().resize());
} });
A('show-options', { label: 'Tool Options', keys: ['F5'], run: () => app.dock.show('options') });
A('show-color', { label: 'Color', keys: ['F6'], run: () => app.dock.show('color') });
A('show-layers', { label: 'Layers', keys: ['F7'], run: () => app.dock.show('layers') });
A('show-history', { label: 'History', run: () => app.dock.show('history') });
A('show-navigator', { label: 'Navigator', run: () => app.dock.show('navigator') });
A('next-doc', { label: 'Next Document', keys: ['Ctrl+Tab', 'Ctrl+PageDown'], enabled: () => app.docs.length > 1,
  run: () => app.setDoc(app.docs[(app.docs.indexOf(app.doc) + 1) % app.docs.length]) });
A('prev-doc', { label: 'Previous Document', keys: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'], enabled: () => app.docs.length > 1,
  run: () => app.setDoc(app.docs[(app.docs.indexOf(app.doc) - 1 + app.docs.length) % app.docs.length]) });
A('about', { label: 'About Studio Web', run: () => aboutDialog() });

// ------------------------------------------------------------ menus

const adjust = (ids) => ids.map((i) => (i === '-' ? '-' : `adj-${i}`));
const filt = (ids) => ids.map((i) => `filter-${i}`);

export const MENUS = [
  { label: 'File', items: ['new', 'new-clipboard', 'open', 'open-layers', '-', 'save', 'save-as', '-', 'export', 'export-as', 'quick-png', '-', 'close', 'close-all'] },
  { label: 'Edit', items: ['undo', 'redo', 'step-back', 'step-forward', '-', 'cut', 'copy', 'copy-merged', 'paste', 'clear', '-', 'fill-fg', 'fill-bg', '-', 'free-transform',
    { label: 'Transform', items: ['flip-layer-h', 'flip-layer-v'] }, '-', 'shortcuts', 'preferences'] },
  { label: 'Image', items: [
    { label: 'Adjustments', items: adjust(['brightness-contrast', 'levels', 'curves', 'exposure', '-', 'vibrance', 'hue-saturation', 'color-balance', 'black-white', '-', 'invert', 'posterize', 'threshold', '-', 'desaturate']) },
    'adj-auto-tone', '-', 'image-size', 'canvas-size',
    { label: 'Image Rotation', items: ['rotate-180', 'rotate-cw', 'rotate-ccw', '-', 'flip-canvas-h', 'flip-canvas-v'] },
    'crop-selection', 'trim'] },
  { label: 'Layer', items: ['new-layer', 'layer-via-copy', 'layer-via-cut', 'delete-layer', '-', 'layer-props', 'lock-layer', 'rasterize', 'layer-alpha', '-',
    { label: 'Arrange', items: ['to-top', 'raise', 'lower', 'to-bottom'] }, 'select-above', 'select-below', '-', 'merge-down', 'merge-visible', 'stamp-visible', 'flatten'] },
  { label: 'Select', items: ['select-all', 'deselect', 'reselect', 'select-invert', '-', 'layer-alpha', '-',
    { label: 'Modify', items: ['feather', 'grow', 'shrink'] }] },
  { label: 'Filters', items: ['filter-repeat', '-',
    { label: 'Blur', items: filt(['gaussian-blur', 'motion-blur']) },
    { label: 'Sharpen', items: filt(['unsharp-mask']) },
    { label: 'Noise', items: filt(['noise']) },
    { label: 'Pixelate', items: filt(['pixelate']) },
    { label: 'Stylize', items: filt(['emboss', 'find-edges']) },
    { label: 'Light and Shadow', items: filt(['vignette']) }] },
  { label: 'View', items: ['zoom-in', 'zoom-out', 'fit', 'actual', '-', 'rulers', 'grid', 'pixel-grid', 'guides', 'extras', '-', 'grid-size', 'new-guide', 'clear-guides', '-',
    { label: 'Theme', items: ['theme-dark', 'theme-gray', 'theme-light'] }, 'fullscreen'] },
  { label: 'Windows', items: ['toggle-panels', '-', 'show-options', 'show-color', 'show-history', 'show-layers', 'show-navigator', '-', 'next-doc', 'prev-doc'] },
  { label: 'Help', items: ['shortcuts', 'about'] },
];

// ------------------------------------------------------------ keyboard

const CODE_KEYS = {
  BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', Semicolon: ';', Quote: "'", Slash: '/', Backslash: '\\',
  Comma: ',', Period: '.', Backquote: '`', NumpadAdd: 'Plus', NumpadSubtract: '-', Space: 'Space',
};

export function comboFromEvent(e) {
  let k;
  if (/^Key[A-Z]$/.test(e.code) && !(e.key.length === 1 && /[a-z]/i.test(e.key))) k = e.code.slice(3);
  else if (e.key.length === 1 && /[a-z]/i.test(e.key)) k = e.key.toUpperCase();
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) k = e.code.slice(6);
  else if (CODE_KEYS[e.code]) k = CODE_KEYS[e.code];
  else k = e.key;
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return null;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(k);
  return parts.join('+');
}

const norm = (combo) => {
  const p = combo.split('+');
  const key = p.pop();
  return [['Ctrl', 'Alt', 'Shift'].filter((m) => p.includes(m)), key].flat().join('+');
};

const keymap = new Map();
function buildKeymap() {
  for (const [id, a] of Object.entries(actions)) for (const k of a.keys || []) keymap.set(norm(k), id);
}

const OPACITY_KEYS = { 1: 10, 2: 20, 3: 30, 4: 40, 5: 50, 6: 60, 7: 70, 8: 80, 9: 90, 0: 100 };

export function bindKeys() {
  buildKeymap();
  const toolKeys = new Map();
  for (const t of app.tools.values()) if (t.key) toolKeys.set(norm(t.key), t);

  window.addEventListener('keydown', (e) => {
    if (dialogOpen()) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    if (menuOpen()) { if (combo === 'Escape') { closeMenus(); e.preventDefault(); } return; }
    if (isEditable(e.target)) {
      if (combo === 'Escape') e.target.blur();
      return;
    }
    const v = app.viewport;
    if (combo === 'Space' || combo.endsWith('+Space')) {
      e.preventDefault();
      if (!v.spaceDown) { v.spaceDown = true; v.updateCursor(); }
      return;
    }
    // Ctrl+V: let the browser fire the paste event.
    if (combo === 'Ctrl+V') return;
    if (app.doc && app.tool?.onKey?.(e, combo)) { e.preventDefault(); return; }
    const id = keymap.get(combo);
    if (id) {
      const a = actions[id];
      e.preventDefault();
      if (!a.enabled || a.enabled()) a.run();
      return;
    }
    const tool = toolKeys.get(combo);
    if (tool) {
      e.preventDefault();
      finishTransient();
      app.setTool(tool.id);
      return;
    }
    if (handleToolTweaks(combo)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && app.viewport.spaceDown) { app.viewport.spaceDown = false; app.viewport.updateCursor(); }
  });
  window.addEventListener('blur', () => { if (app.viewport) app.viewport.spaceDown = false; });
}

/** X / D for colors, [ ] for size, Shift+[ ] hardness, digits for opacity. */
function handleToolTweaks(combo) {
  const t = app.tool;
  if (combo === 'X') { app.swapColors(); return true; }
  if (combo === 'D') { app.resetColors(); return true; }
  if (!t) return false;
  const o = app.opts(t);
  if ((combo === '[' || combo === ']') && 'size' in o) {
    const f = t.options.find((x) => x.id === 'size');
    const s = o.size, step = s < 10 ? 1 : s < 50 ? 5 : s < 100 ? 10 : s < 300 ? 25 : 50;
    app.setOpt(t, 'size', Math.max(f.min, Math.min(f.max, combo === ']' ? s + step : s - step)));
    app.viewport.render();
    return true;
  }
  if ((combo === 'Shift+[' || combo === 'Shift+]') && 'hardness' in o) {
    app.setOpt(t, 'hardness', Math.max(0, Math.min(100, o.hardness + (combo === 'Shift+]' ? 25 : -25))));
    return true;
  }
  if (combo in OPACITY_KEYS && 'opacity' in o && t.brush !== false && t.options.some((x) => x.id === 'opacity')) {
    app.setOpt(t, 'opacity', OPACITY_KEYS[combo]);
    app.toast(`Opacity ${OPACITY_KEYS[combo]}%`, 900);
    return true;
  }
  return false;
}

// ------------------------------------------------------------ dialogs

function shortcutsDialog() {
  const rows = [];
  const section = (title) => rows.push(el('tr', {}, el('th', { colspan: 2 }, title)));
  section('Tools');
  for (const group of TOOLBAR) for (const id of group) {
    const t = app.tools.get(id);
    rows.push(el('tr', {}, el('td', {}, t.name), el('td', {}, el('kbd', {}, prettyKey(t.key) || '—'))));
  }
  rows.push(el('tr', {}, el('td', {}, 'Temporary Hand tool'), el('td', {}, el('kbd', {}, 'Space'))));
  rows.push(el('tr', {}, el('td', {}, 'Swap / default colors'), el('td', {}, el('kbd', {}, 'X'), ' ', el('kbd', {}, 'D'))));
  rows.push(el('tr', {}, el('td', {}, 'Brush size / hardness'), el('td', {}, el('kbd', {}, '['), ' ', el('kbd', {}, ']'), ' · ', el('kbd', {}, prettyKey('Shift+[')), ' ', el('kbd', {}, prettyKey('Shift+]')))));
  rows.push(el('tr', {}, el('td', {}, 'Tool opacity 10–100%'), el('td', {}, el('kbd', {}, '1'), ' … ', el('kbd', {}, '0'))));
  for (const m of MENUS) {
    const items = [];
    const walk = (list) => list.forEach((i) => { if (typeof i === 'string' && actions[i]?.keys) items.push(i); else if (i.items) walk(i.items); });
    walk(m.items);
    if (!items.length) continue;
    section(m.label);
    for (const id of [...new Set(items)]) {
      const a = actions[id];
      const label = typeof a.label === 'function' ? a.label() : a.label;
      rows.push(el('tr', {}, el('td', {}, label.replace(/…$/, '')), el('td', {}, a.keys.map((k, i) => [i ? ' or ' : '', el('kbd', {}, prettyKey(k))]))));
    }
  }
  infoDialog('Keyboard Shortcuts', el('div', { class: 'shortcuts' },
    el('p', { class: 'hint' }, 'Browsers reserve a few keys in a normal tab (Ctrl+N, Ctrl+T, Ctrl+W). Use the alternatives shown, or install Studio as an app (browser menu › Install) to get them all.'),
    el('table', {}, rows)), 620);
}

function preferencesDialog() {
  const s = app.settings;
  const body = el('div', { class: 'form' },
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Theme'),
      select({ label: 'Theme', value: s.theme, options: [['dark', 'Dark'], ['gray', 'Medium Gray'], ['light', 'Light']], onChange: setTheme })),
    check({ label: 'Show rulers', value: s.rulers, onChange: (v) => { if (v !== app.settings.rulers) actions.rulers.run(); } }),
    check({ label: 'Show pixel grid above 800%', value: s.pixelGrid !== false, onChange: (v) => { s.pixelGrid = v; app.saveSettings(); vp().render(); } }),
    spinScale({ label: 'Grid spacing', min: 2, max: 500, value: s.gridSize, unit: 'px', gamma: 2, onInput: (v) => { s.gridSize = v; app.saveSettings(); vp().render(); } }).el,
    spinScale({ label: 'History states', min: 5, max: 200, value: s.historyLimit || 60, onInput: (v) => {
      s.historyLimit = v; app.saveSettings();
      for (const d of app.docs) d.history.limit = v;
    } }).el,
    el('div', { class: 'form-sep' }),
    el('button', { type: 'button', class: 'btn', onclick: async () => {
      if (await confirmDialog('Reset all preferences, tool options and swatches?', 'Reset')) {
        localStorage.removeItem('studio-web:settings');
        location.reload();
      }
    } }, 'Reset All Preferences…'));
  modal({ title: 'Preferences', body, width: 380, buttons: [{ label: 'Close', primary: true }] });
}

function aboutDialog() {
  infoDialog('About Studio Web', el('div', { class: 'about' },
    el('h2', {}, 'Studio Web'),
    el('p', {}, 'A browser version of the Studio interface from the GIMP fork: the same dark panels, one-column toolbar, document tabs and Photoshop-style shortcuts.'),
    el('p', {}, 'Everything runs in your browser. Images are never uploaded: opening, editing and saving all happen on this device, and the editor keeps working offline once loaded.'),
    el('p', {}, 'Save projects as OpenRaster (.ora) to keep layers. GIMP, Krita and MyPaint open them, including the Studio desktop build.'),
    el('p', { class: 'hint' }, 'This is a separate, smaller editor written for the web, not GIMP compiled for the browser.')), 440);
}
