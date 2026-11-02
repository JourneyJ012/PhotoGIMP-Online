// Opening and saving: images (PNG/JPEG/WebP/GIF/BMP/SVG/AVIF via the browser),
// OpenRaster (.ora) projects that GIMP, Krita and MyPaint open with layers,
// and exports.

import { app } from './app.js';
import { Doc, Layer, flatten } from './model.js';
import { docFromImage } from './ops.js';
import { applyText } from './text.js';
import { baseName, canvasToBlob, createCanvas, downloadBlob } from './util.js';

// ------------------------------------------------------------ zip

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build an uncompressed zip from [{name, data: Uint8Array}]. */
export function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);      // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'image/openraster' });
}

/** Read a zip: returns Map(name -> async () => Uint8Array). */
export function unzip(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    const dataStart = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
    const raw = u8.subarray(dataStart, dataStart + csize);
    out.set(name, async () => {
      if (method === 0) return raw;
      if (method !== 8) throw new Error(`Unsupported zip compression (${method})`);
      const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(ds).arrayBuffer());
    });
  }
  return out;
}

// ------------------------------------------------------------ OpenRaster

const ORA_OPS = {
  'source-over': 'svg:src-over', multiply: 'svg:multiply', screen: 'svg:screen', overlay: 'svg:overlay',
  darken: 'svg:darken', lighten: 'svg:lighten', 'color-dodge': 'svg:color-dodge', 'color-burn': 'svg:color-burn',
  'hard-light': 'svg:hard-light', 'soft-light': 'svg:soft-light', difference: 'svg:difference', exclusion: 'svg:exclusion',
  hue: 'svg:hue', saturation: 'svg:saturation', color: 'svg:color', luminosity: 'svg:luminosity', lighter: 'svg:plus',
};
const ORA_OPS_IN = Object.fromEntries(Object.entries(ORA_OPS).map(([k, v]) => [v, k]));

const xmlEsc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

async function canvasBytes(c) {
  return new Uint8Array(await (await canvasToBlob(c)).arrayBuffer());
}

export async function writeORA(doc) {
  const files = [{ name: 'mimetype', data: new TextEncoder().encode('image/openraster') }];
  const entries = [];
  const top = [...doc.layers].reverse();
  for (let i = 0; i < top.length; i++) {
    const l = top[i];
    const src = `data/layer${i}.png`;
    files.push({ name: src, data: await canvasBytes(l.canvas) });
    const text = l.text ? ` studio-text="${xmlEsc(JSON.stringify(l.text))}"` : '';
    entries.push(`  <layer name="${xmlEsc(l.name)}" src="${src}" x="${l.x}" y="${l.y}" opacity="${l.opacity.toFixed(3)}"`
      + ` visibility="${l.visible ? 'visible' : 'hidden'}" composite-op="${ORA_OPS[l.blend] || 'svg:src-over'}"`
      + `${l.locked ? ' edit-locked="true"' : ''}${l.id === doc.activeId ? ' selected="true"' : ''}${text}/>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.5" w="${doc.width}" h="${doc.height}" xres="72" yres="72">\n <stack>\n${entries.join('\n')}\n </stack>\n</image>\n`;
  files.push({ name: 'stack.xml', data: new TextEncoder().encode(xml) });
  const merged = flatten(doc);
  files.push({ name: 'mergedimage.png', data: await canvasBytes(merged) });
  const k = Math.min(1, 256 / Math.max(doc.width, doc.height));
  const th = createCanvas(Math.max(1, Math.round(doc.width * k)), Math.max(1, Math.round(doc.height * k)));
  th.getContext('2d').drawImage(merged, 0, 0, th.width, th.height);
  files.push({ name: 'Thumbnails/thumbnail.png', data: await canvasBytes(th) });
  return zipStore(files);
}

async function bytesToImage(bytes) {
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

export async function readORA(buf, name) {
  const zip = unzip(buf);
  const stackFile = zip.get('stack.xml');
  if (!stackFile) throw new Error('stack.xml is missing');
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(await stackFile()), 'application/xml');
  const img = xml.querySelector('image');
  if (!img) throw new Error('Invalid stack.xml');
  const doc = new Doc({ width: +img.getAttribute('w'), height: +img.getAttribute('h'), name, baseLabel: 'Open' });
  const layers = [];
  let active = null;
  // Walk the stack (top first), flattening nested stacks into plain layers.
  const walk = async (stack, ox, oy, hidden, depth) => {
    for (const node of stack.children) {
      const x = ox + (+node.getAttribute('x') || 0), y = oy + (+node.getAttribute('y') || 0);
      const vis = node.getAttribute('visibility') !== 'hidden';
      if (node.tagName === 'stack') { await walk(node, x, y, hidden || !vis, depth + 1); continue; }
      if (node.tagName !== 'layer') continue;
      const src = node.getAttribute('src');
      const get = src && zip.get(src);
      if (!get) continue;
      const bmp = await bytesToImage(await get());
      const c = createCanvas(bmp.width, bmp.height);
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close?.();
      const l = new Layer({
        name: node.getAttribute('name') || 'Layer', canvas: c, x, y,
        opacity: node.hasAttribute('opacity') ? +node.getAttribute('opacity') : 1,
        visible: vis && !hidden,
        blend: ORA_OPS_IN[node.getAttribute('composite-op')] || 'source-over',
        locked: node.getAttribute('edit-locked') === 'true',
      });
      const t = node.getAttribute('studio-text');
      if (t) {
        try {
          const text = JSON.parse(t);
          l.text = text;
          applyText(l, text, { x: x + (text.pad || 0), y: y + (text.pad || 0) });
        } catch { /* keep the raster */ }
      }
      if (node.getAttribute('selected') === 'true') active = l;
      layers.push(l);
    }
  };
  await walk(xml.querySelector('image > stack'), 0, 0, false, 0);
  doc.layers = layers.reverse();
  doc.activeId = (active || doc.layers.at(-1))?.id ?? null;
  if (!doc.layers.length) doc.insertLayer(new Layer({ name: 'Layer 1', width: doc.width, height: doc.height }), 0);
  return doc;
}

// ------------------------------------------------------------ opening

export const IMAGE_ACCEPT = 'image/*,.ora,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.avif,.ico';

/** Decode an image file into something drawable. */
export async function decodeImage(file) {
  if (/svg/.test(file.type) || /\.svg$/i.test(file.name)) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
      const c = createCanvas(w, h);
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return c;
    } finally { URL.revokeObjectURL(url); }
  }
  return createImageBitmap(file);
}

export async function openFile(file, handle = null) {
  try {
    let doc;
    if (/\.ora$/i.test(file.name)) {
      doc = await readORA(await file.arrayBuffer(), file.name);
      doc.fileHandle = handle;
    } else {
      const img = await decodeImage(file);
      doc = docFromImage(img, file.name);
      img.close?.();
    }
    app.addDoc(doc);
    return doc;
  } catch (err) {
    console.error(err);
    app.toast(`Could not open ${file.name}: ${err.message || err}`, 5000);
    return null;
  }
}

/** Show the file chooser. Uses the File System Access API when available. */
export async function chooseFiles({ multiple = true } = {}) {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple,
        types: [{ description: 'Images and projects', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif'], 'image/openraster': ['.ora'] } }],
      });
      return Promise.all(handles.map(async (h) => ({ file: await h.getFile(), handle: h })));
    } catch (e) {
      if (e.name === 'AbortError') return [];
    }
  }
  return new Promise((res) => {
    const input = document.getElementById('file-input');
    input.multiple = multiple;
    input.value = '';
    input.onchange = () => res([...input.files].map((file) => ({ file, handle: null })));
    input.click();
  });
}

// ------------------------------------------------------------ saving

async function saveBlob(blob, suggestedName, types, handle) {
  if (handle?.createWritable) {
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    return handle;
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName, types });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return h;
    } catch (e) {
      if (e.name === 'AbortError') return undefined;
    }
  }
  downloadBlob(blob, suggestedName);
  return null;
}

/** Save the project as .ora (Ctrl+S). saveAs forces a new location. */
export async function saveProject(doc, saveAs = false) {
  const name = `${baseName(doc.name)}.ora`;
  try {
    const blob = await writeORA(doc);
    const h = await saveBlob(blob, name, [{ description: 'OpenRaster project', accept: { 'image/openraster': ['.ora'] } }],
      saveAs ? null : doc.fileHandle);
    if (h === undefined) return false;
    if (h) { doc.fileHandle = h; doc.name = h.name; }
    else doc.name = name;
    doc.markSaved();
    app.emit('docs');
    app.toast(`Saved ${doc.name}`);
    return true;
  } catch (err) {
    console.error(err);
    app.toast(`Could not save: ${err.message || err}`, 5000);
    return false;
  }
}

export const EXPORT_TYPES = {
  png: { mime: 'image/png', ext: 'png', label: 'PNG' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG' },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP' },
};

export async function exportBlob(doc, { format = 'png', quality = 0.92, scale = 1 }) {
  const t = EXPORT_TYPES[format];
  let c = flatten(doc, doc.layers, format === 'jpeg' ? '#ffffff' : null);
  if (scale !== 1) {
    const s = createCanvas(Math.max(1, Math.round(c.width * scale)), Math.max(1, Math.round(c.height * scale)));
    const ctx = s.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, s.width, s.height);
    c = s;
  }
  return canvasToBlob(c, t.mime, format === 'png' ? undefined : quality);
}

export async function exportDoc(doc, opts) {
  const t = EXPORT_TYPES[opts.format];
  const blob = await exportBlob(doc, opts);
  const name = `${opts.name || baseName(doc.name)}.${t.ext}`;
  await saveBlob(blob, name, [{ description: t.label, accept: { [t.mime]: [`.${t.ext}`] } }], null);
  doc.lastExport = opts;
}
