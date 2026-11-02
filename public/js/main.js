// Entry point: build the interface and wire everything together.

import { app } from './app.js';
import './tools.js';
import { Viewport } from './viewport.js';
import { MENUS, actions, bindKeys, bindPaste, placeFile, setTheme } from './commands.js';
import { openFile } from './io.js';
import { buildMenubar, setActionResolver } from './ui/menu.js';
import { buildDock, fontDatalist } from './ui/panels.js';
import { buildStatusBar, buildTabs, buildToolbar, buildWelcome } from './ui/chrome.js';
import { $, el } from './util.js';

function boot() {
  setTheme(app.settings.theme || 'dark');
  document.getElementById('workspace').classList.toggle('no-rulers', !app.settings.rulers);
  document.body.append(fontDatalist());

  setActionResolver((id) => actions[id]);
  buildMenubar($('#menubar'), MENUS);
  buildToolbar($('#toolbar'));
  buildTabs($('#tabs'));
  buildStatusBar($('#statusbar'));
  buildWelcome($('#welcome'));

  app.viewport = new Viewport();
  app.dock = buildDock($('#dock'));
  app.setTool(app.settings.lastTool && app.tools.has(app.settings.lastTool) && !app.tools.get(app.settings.lastTool).hidden
    ? app.settings.lastTool : 'brush');
  app.on('tool', (t) => { if (!t.hidden) { app.settings.lastTool = t.id; app.saveSettings(); } });

  const vp = app.viewport;
  app.on('change', () => vp.render());
  app.on('preview', () => vp.render());
  app.on('docs', () => {
    const doc = app.doc;
    document.getElementById('viewport').classList.toggle('empty', !doc);
    if (doc && !doc.view.ready) vp.fit(false);
    vp.render(true);
    document.title = doc ? `${doc.name}${doc.dirty ? ' *' : ''} — Studio` : 'Studio — online image editor';
  });
  app.on('change', (doc) => { document.title = doc ? `${doc.name}${doc.dirty ? ' *' : ''} — Studio` : 'Studio — online image editor'; });

  bindKeys();
  bindPaste();
  bindDrop();

  window.addEventListener('beforeunload', (e) => {
    if (app.docs.some((d) => d.dirty)) { e.preventDefault(); e.returnValue = ''; }
  });

  // Files opened with the installed app ("Open with Studio").
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      for (const h of params.files || []) await openFile(await h.getFile(), h);
    });
  }

  // Offline support. Skipped on localhost (so edits show up) unless ?sw=1.
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  if ('serviceWorker' in navigator && (!local || location.search.includes('sw=1'))) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

function bindDrop() {
  const overlay = el('div', { class: 'drop-overlay', hidden: true }, el('div', {}, 'Drop to open', el('small', {}, 'Drop on the image to add it as a layer')));
  document.body.append(overlay);
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; overlay.hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; overlay.hidden = true; } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const files = [...e.dataTransfer.files];
    const view = document.getElementById('viewport').getBoundingClientRect();
    const onCanvas = app.doc && e.clientX >= view.left && e.clientX <= view.right && e.clientY >= view.top && e.clientY <= view.bottom;
    for (const f of files) {
      if (onCanvas && !/\.ora$/i.test(f.name)) {
        const p = app.viewport.toDoc(e.clientX - view.left, e.clientY - view.top);
        await placeFile(f, p);
      } else await openFile(f);
    }
  });
}

boot();
