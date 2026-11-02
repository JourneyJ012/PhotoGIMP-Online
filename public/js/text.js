// Text layers: the layer keeps its settings in layer.text and its canvas is
// re-rendered (as a new canvas) whenever they change.

import { createCanvas } from './util.js';

export const FONTS = [
  'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Roboto', 'Open Sans', 'Noto Sans',
  'Cantarell', 'DejaVu Sans', 'Georgia', 'Times New Roman', 'Garamond', 'Courier New', 'DejaVu Sans Mono',
  'Impact', 'Comic Sans MS', 'system-ui', 'sans-serif', 'serif', 'monospace', 'cursive',
];

export const TEXT_DEFAULTS = {
  content: '', font: 'Arial', size: 48, color: '#000000', bold: false, italic: false, align: 'left', leading: 1.2,
};

const quote = (f) => (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(f) ? f : `"${f.replace(/"/g, '')}"`);

export const fontString = (t, scale = 1) =>
  `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size * scale}px ${quote(t.font)}`;

const measureCtx = createCanvas(1, 1).getContext('2d');

export function layoutText(t) {
  measureCtx.font = fontString(t);
  const lines = t.content.split('\n');
  const widths = lines.map((l) => measureCtx.measureText(l).width);
  const m = measureCtx.measureText('Mg');
  const ascent = m.fontBoundingBoxAscent ?? t.size * 0.8;
  const descent = m.fontBoundingBoxDescent ?? t.size * 0.2;
  const lineH = t.size * t.leading;
  return {
    lines, widths, ascent, descent, lineH,
    width: Math.max(1, ...widths),
    height: lineH * lines.length,
    // Same baseline as CSS puts in a line box of height lineH.
    baseline: (lineH - (ascent + descent)) / 2 + ascent,
  };
}

export function renderText(t) {
  const L = layoutText(t);
  const pad = Math.ceil(t.size * 0.3) + 2;
  const c = createCanvas(Math.ceil(L.width) + pad * 2, Math.ceil(L.height) + pad * 2);
  const ctx = c.getContext('2d');
  ctx.font = fontString(t);
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'alphabetic';
  L.lines.forEach((line, i) => {
    let x = pad;
    if (t.align === 'center') x += (L.width - L.widths[i]) / 2;
    else if (t.align === 'right') x += L.width - L.widths[i];
    ctx.fillText(line, x, pad + i * L.lineH + L.baseline);
  });
  return { canvas: c, pad };
}

/** Text box origin (top-left of the first line) in doc coordinates. */
export const textOrigin = (layer) => ({ x: layer.x + (layer.text?.pad ?? 0), y: layer.y + (layer.text?.pad ?? 0) });

/** Set a text layer's settings and re-render it, keeping its origin fixed. */
export function applyText(layer, text, origin = textOrigin(layer)) {
  const { canvas, pad } = renderText(text);
  layer.canvas = canvas;
  layer.text = { ...text, pad };
  layer.x = Math.round(origin.x - pad);
  layer.y = Math.round(origin.y - pad);
  layer.version++;
}
