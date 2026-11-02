// 20x20 line icons (stroke = currentColor).

const P = {
  move: '<path d="M10 2v16M2 10h16M10 2 7.5 4.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5"/>',
  'rect-select': '<rect x="3" y="4.5" width="14" height="11" stroke-dasharray="2.2 1.8"/>',
  'ellipse-select': '<ellipse cx="10" cy="10" rx="7.5" ry="5.5" stroke-dasharray="2.2 1.8"/>',
  lasso: '<path d="M10.5 3.5c3.9 0 6.5 1.9 6.5 4.2s-2.9 4.3-6.6 4.3S3.5 10.1 3.5 7.8 6.6 3.5 10.5 3.5z" stroke-dasharray="2.2 1.6"/><path d="M5.5 11.5c-1.3 1.6-.8 3.9 1.6 4.4M7 16l-1.5 2"/>',
  'poly-lasso': '<path d="M4 6.5 14.5 3 17 12l-9 3.5z" stroke-dasharray="2.2 1.6"/><path d="M8 15.5 6.5 18.5"/>',
  wand: '<path d="m3 17 9-9M11 6l3 3"/><path d="M14.5 1.8v2.4M14.5 8.8v2.4M10.8 6.5h-2M20 6.5h-2.6M17.4 3.6l-1.3 1.3M12.9 8.1l-1.1 1.1M17.4 9.4 16.1 8.1"/>',
  'color-select': '<circle cx="8" cy="8" r="5" /><path d="m11.5 11.5 6 6M6 6.5h.01M9.5 9h.01"/>',
  crop: '<path d="M5.5 1.5v13h13M1.5 5.5h13v13"/>',
  eyedropper: '<path d="m12.5 3.5 4 4M14.3 2.2a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L15.5 8 12 4.5zM12.5 6.5l-8 8-1 3 3-1 8-8"/>',
  clone: '<path d="M7.5 3.5h5v3.5l-1 2.5h4.5v3H4v-3h4.5l-1-2.5zM4 15.5h12M5.5 18h9"/>',
  brush: '<path d="M17.5 2.5c-3 1.8-6.3 4.8-8.5 7.6l2 2c2.8-2.2 5.8-5.5 7.6-8.5zM8.6 10.6c-2.4 0-3.9 1.3-3.9 3.3 0 1.4-.9 2.3-2.2 2.6 3.6 1.7 7.9.6 8.1-3.9"/>',
  pencil: '<path d="m3 17 1-4.2L13.6 3.2a1.6 1.6 0 0 1 2.3 0l.9.9a1.6 1.6 0 0 1 0 2.3L7.2 16zM12 5l3 3M4 12.8 7.2 16"/>',
  eraser: '<path d="M7.5 17.5h10M3.2 12.3l8-8a1.5 1.5 0 0 1 2.1 0l3.6 3.6a1.5 1.5 0 0 1 0 2.1l-7.4 7.5H7.4l-4.2-4.1a.8.8 0 0 1 0-1.1zM7 8.5l5.5 5.5"/>',
  gradient: '<rect x="3" y="3" width="14" height="14" rx="1"/><path d="M6.5 3v14M10 3v14" opacity=".7"/><path d="M13.5 3v14" opacity=".35"/>',
  bucket: '<path d="m3.5 9.5 6-6 7 7-6 6a1.5 1.5 0 0 1-2 0l-5-5a1.5 1.5 0 0 1 0-2zM3.5 10.5h12.8M17.5 13.5s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z"/>',
  blur: '<path d="M10 2.5c3.2 4 5 7 5 9.6a5 5 0 0 1-10 0c0-2.6 1.8-5.6 5-9.6z"/>',
  sharpen: '<path d="M10 2.5 16.5 17h-13z"/>',
  dodge: '<circle cx="12.5" cy="7" r="4.5"/><path d="M9.3 10.2 3 16.5"/>',
  burn: '<path d="M8 17V8.5a1.3 1.3 0 0 1 2.6 0V12M10.6 11V6.8a1.3 1.3 0 0 1 2.6 0V11M13.2 10V7.8a1.3 1.3 0 0 1 2.6 0V13c0 3-2 5-5 5H9.5c-1.8 0-3-1-3.8-2.5L4 12.4a1.2 1.2 0 0 1 2-1.3L8 13.5"/>',
  text: '<path d="M4 4.5h12M10 4.5v12M7.5 16.5h5M4 4.5v2M16 4.5v2"/>',
  shape: '<rect x="2.5" y="7.5" width="9" height="9" rx="1"/><circle cx="13" cy="7" r="4.5"/>',
  hand: '<path d="M7 11V5a1.2 1.2 0 0 1 2.4 0v4.5M9.4 9V3.4a1.2 1.2 0 0 1 2.4 0V9M11.8 9V4.6a1.2 1.2 0 0 1 2.4 0V10M14.2 10V7a1.2 1.2 0 0 1 2.4 0v5c0 3.5-2.4 6-5.8 6H10c-2 0-3.2-.8-4.3-2.6L3.4 11.6a1.2 1.2 0 0 1 2-1.3L7 12.3"/>',
  zoom: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="m12.5 12.5 5 5M6 8.5h5M8.5 6v5"/>',
  transform: '<rect x="4" y="4" width="12" height="12" stroke-dasharray="2 2"/><path d="M2.5 2.5h3v3h-3zM14.5 2.5h3v3h-3zM2.5 14.5h3v3h-3zM14.5 14.5h3v3h-3z"/>',
  // UI
  eye: '<path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10z"/><circle cx="10" cy="10" r="2.5"/>',
  lock: '<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  'new-layer': '<path d="M4.5 3.5h7l4 4v9h-11z"/><path d="M10 9v6M7 12h6"/>',
  trash: '<path d="M3.5 5.5h13M8 5.5V3.5h4v2M5.5 5.5l1 11h7l1-11M8.5 8.5v5M11.5 8.5v5"/>',
  duplicate: '<rect x="6.5" y="6.5" width="10" height="10" rx="1"/><path d="M13.5 6.5v-3h-10v10h3"/>',
  up: '<path d="m5 12 5-5 5 5"/>',
  down: '<path d="m5 8 5 5 5-5"/>',
  merge: '<path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 15.5h12"/>',
  close: '<path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/>',
  'chevron-down': '<path d="m6 8 4 4 4-4"/>',
  'chevron-right': '<path d="m8 6 4 4-4 4"/>',
  check: '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>',
  swap: '<path d="M6 3.5h7.5a3 3 0 0 1 3 3V14M14 11.5l2.5 2.5 2.5-2.5M6 3.5 8.5 1M6 3.5 8.5 6"/>',
  fx: '<path d="M8.5 4.5c-2 0-2.5 1-2.8 3L4.5 16M3.5 9h5M11 9l5 6M16 9l-5 6"/>',
  folder: '<path d="M2.5 5.5a1 1 0 0 1 1-1h4l1.5 2h7.5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/>',
  file: '<path d="M5 2.5h6.5L15.5 6.5v11h-10.5z"/><path d="M11.5 2.5v4h4"/>',
  image: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><circle cx="7" cy="8" r="1.5"/><path d="m17.5 13-4-4-8 7.5"/>',
  'sel-new': '<rect x="4" y="4" width="12" height="12" rx="1"/>',
  'sel-add': '<rect x="2.5" y="2.5" width="9" height="9" rx="1"/><rect x="8.5" y="8.5" width="9" height="9" rx="1" fill="currentColor" fill-opacity=".35"/>',
  'sel-sub': '<rect x="2.5" y="2.5" width="9" height="9" rx="1" fill="currentColor" fill-opacity=".35"/><rect x="8.5" y="8.5" width="9" height="9" rx="1" stroke-dasharray="2 1.5"/>',
  'sel-int': '<rect x="2.5" y="2.5" width="9" height="9" rx="1"/><rect x="8.5" y="8.5" width="9" height="9" rx="1"/><rect x="8.5" y="8.5" width="3" height="3" fill="currentColor"/>',
  'align-left': '<path d="M3 5h14M3 9h9M3 13h14M3 17h9"/>',
  'align-center': '<path d="M3 5h14M5.5 9h9M3 13h14M5.5 17h9"/>',
  'align-right': '<path d="M3 5h14M8 9h9M3 13h14M8 17h9"/>',
  'shape-rect': '<rect x="3.5" y="5" width="13" height="10"/>',
  'shape-rounded': '<rect x="3.5" y="5" width="13" height="10" rx="3"/>',
  'shape-ellipse': '<ellipse cx="10" cy="10" rx="6.5" ry="5"/>',
  'shape-line': '<path d="m4 16 12-12"/>',
  bold: '<path d="M6 4h5a3 3 0 0 1 0 6H6zM6 10h6a3 3 0 0 1 0 6H6z" stroke-width="2"/>',
  italic: '<path d="M9 4h6M5 16h6M12 4 8 16"/>',
  'reset-colors': '<rect x="2" y="2" width="8" height="8" fill="currentColor"/><rect x="6" y="6" width="8" height="8" fill="none"/>',
};

export function icon(name, size = 20) {
  const body = P[name] || '';
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** An icon as a DOM element. */
export function iconEl(name, size) {
  const t = document.createElement('template');
  t.innerHTML = icon(name, size);
  return t.content.firstChild;
}
