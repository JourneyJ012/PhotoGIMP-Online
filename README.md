# Studio Web

A browser version of the Studio UI from the GIMP fork in `../gimp` (see
`../gimp/STUDIO_UI.md`), in the style of Photopea: a Photoshop-like editor that
runs entirely client-side and is served by a Cloudflare Worker.

It is a **new, smaller editor written for the web**, not GIMP compiled to
WebAssembly. It keeps the Studio look and workflow: the dark/gray/light
palettes from `themes/Studio`, a one-column toolbar in Photoshop order, text-tabbed
panels on the right, `name @ zoom%` document tabs, and the same shortcuts.

## Features

- **Documents:** multiple tabs, New (presets), Open (PNG/JPEG/WebP/GIF/BMP/SVG/AVIF,
  drag & drop, paste), Place as layer, Save/Open **OpenRaster `.ora`** (layers, opacity,
  blend modes, visibility; GIMP, Krita and MyPaint open it, and type layers stay
  editable here), Export PNG/JPEG/WebP with quality, scale and a size estimate.
- **Layers:** raster and type layers, 17 blend modes, opacity, lock, show/hide (Alt+click
  to solo), drag to reorder, rename, duplicate, layer via copy/cut, merge down/visible,
  stamp visible, flatten, select layer pixels (Ctrl+click the thumbnail).
- **Selections:** rectangle, ellipse, lasso, polygonal lasso, magic wand, select by color;
  new/add/subtract/intersect (Shift/Alt), feather, expand/contract, invert, reselect,
  marching ants.
- **Tools:** move (moves selected pixels when there is a selection), crop, eyedropper,
  brush (soft/hard, flow, pen pressure), pencil, clone stamp, eraser, gradient
  (linear/radial/reflected/angle), paint bucket, blur/sharpen, dodge/burn, type, shapes,
  hand, zoom, and Free Transform (scale/rotate/move with handles).
- **Adjustments:** Brightness/Contrast, Levels (with histogram), Curves, Exposure,
  Vibrance, Hue/Saturation, Color Balance, Black & White, Invert, Posterize, Threshold,
  Desaturate, Auto Tone. All have live previews and respect the selection.
- **Filters:** Gaussian Blur, Motion Blur, Unsharp Mask, Add Noise, Mosaic, Emboss,
  Find Edges, Vignette, plus Last Filter (Ctrl+F).
- **Image:** Image Size, Canvas Size (anchor), rotate/flip canvas, crop to selection, trim.
- **View:** zoom/pan (wheel, pinch, Space, Navigator), rulers, guides dragged from the
  rulers, grid, pixel grid, full screen, 3 themes. Undo history panel (60 steps by default).
- **Offline:** a service worker caches the app, so it keeps working without a connection.
  It installs as an app (PWA) and can be the "Open with" handler for images.

Nothing is uploaded: the Worker only serves static files.

## Shortcuts

These are the Studio desktop shortcuts. Browsers reserve **Ctrl+N, Ctrl+T and Ctrl+W** in a
normal tab, so each also has an Alt variant (the same approach Photopea uses), or you can
install the app to get the plain shortcuts back:

| Action | Shortcut |
| --- | --- |
| New | Ctrl+Alt+N (Ctrl+N when installed) |
| Free Transform | Ctrl+Alt+T (Ctrl+T when installed) |
| Close | Ctrl+Alt+W (Ctrl+W when installed) |

Help › Keyboard Shortcuts (F1) lists them all.

## Project layout

```
public/            static app, served as Workers Static Assets (no build step)
  index.html, css/studio.css, sw.js, manifest.webmanifest, icon.svg
  js/main.js       boot & wiring
  js/model.js      Doc/Layer, compositing, undo snapshots and pixel patches
  js/history.js    undo stack with grouping
  js/viewport.js   rendering, zoom/pan, rulers, guides, pointer routing
  js/tools.js      all tools        js/paint.js     brush engine
  js/transform.js  free transform   js/selection.js masks, flood fill, ants
  js/filters.js    adjustments & filters
  js/ops.js        document operations (crop, resize, merge, fill, clipboard…)
  js/io.js         zip, OpenRaster, open/save/export
  js/commands.js   menu actions, menu layout, keyboard map
  js/ui/*          menus, panels, dialogs, widgets, toolbar/tabs/status bar
src/worker.js      Worker: security headers, stamps sw.js with the deploy version, /healthz
scripts/check.mjs  syntax, import/export and service-worker precache checks
```

## Develop and deploy

```sh
npm install
npm run check        # static checks, no browser needed
npm run dev          # wrangler dev on http://localhost:8787
npm run deploy       # wrangler deploy (needs `npx wrangler login` once)
```

The service worker is off on localhost so edits show up right away. Add `?sw=1` to
test offline mode locally. When you add a module under `public/js`, add it to the
`ASSETS` list in `public/sw.js` (`npm run check` will flag it if you forget).

To use a custom domain, add a `routes` entry to `wrangler.jsonc`
(`"routes": [{ "pattern": "studio.example.com", "custom_domain": true }]`).

## Not ported (yet)

Compared with the desktop Studio build: layer groups and masks, layer styles (fx),
the pen/paths tool, healing brush, warp transform, channels panel, CMYK and 16-bit
color, and PSD files. GIMP's plug-ins and GEGL filters don't run here.
