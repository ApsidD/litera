// Litera: preview lines with guides; click to select a glyph or a kerning pair
import { state, emit, metric } from './state.js';
import { layout, fillGlyph, setupCanvas, drawSelOverlay } from './render.js';
import { makeScrub } from './scrub.js';
import { openZoom } from './zoom.js';
import * as H from './history.js';
import { t } from './i18n.js';

const C = {
  ink: '#1F1D1A',
  baseline: '#B3402A',
  cap: '#3B5B8C',
  xh: '#2E7D6B',
  edge: '#9A917F',
  selFill: 'rgba(179,64,42,.10)',
  selEdge: 'rgba(179,64,42,.55)',
  pairFill: 'rgba(59,91,140,.16)',
  pairEdge: 'rgba(59,91,140,.7)',
  kern: '#3B5B8C',
};

let container = null;
let raf = 0;
let hover = null; // {idx, x}

export function defaultLines() {
  return [
    { text: 'Hamburgefonstiv', size: 110 },
    { text: 'The quick brown fox jumps over the lazy dog', size: 60 },
    { text: 'Hamburgefonstiv 0123456789', size: 60 },
  ];
}

function uiLines() {
  if (!Array.isArray(state.edits.ui.lines) || !state.edits.ui.lines.length) {
    state.edits.ui.lines = defaultLines();
  }
  return state.edits.ui.lines;
}

export function initPreview(el) {
  container = el;
  new ResizeObserver(() => scheduleRender()).observe(container);
}

export function rebuildLines() {
  container.innerHTML = '';
  for (let i = 0; i < uiLines().length; i++) {
    container.appendChild(makeLineEl(i));
  }
  scheduleRender();
}

export function addLine() {
  H.capture();
  uiLines().push({ text: 'AVA Tower LT', size: 72 });
  H.commit();
  rebuildLines();
}

function makeLineEl(idx) {
  const ln = uiLines()[idx];
  const el = document.createElement('div');
  el.className = 'line';

  const head = document.createElement('div');
  head.className = 'line-head';

  const input = document.createElement('input');
  input.className = 'line-text';
  input.value = ln.text;
  input.spellcheck = false;
  input.addEventListener('input', () => {
    ln.text = input.value;
    scheduleRender();
    emit('ui');
  });
  input.addEventListener('change', () => { H.capture(); H.commit(); });

  const sizeEl = document.createElement('span');
  makeScrub(sizeEl, {
    get: () => ln.size,
    set: v => { ln.size = v; },
    step: 0.5, min: 4, max: 3000, suffix: ' px', nudge: 2,
    onBegin: () => H.capture(),
    onLive: () => { scheduleRender(); },
    onCommit: () => { H.commit(); emit('ui'); },
  });

  const del = document.createElement('button');
  del.className = 'line-del';
  del.textContent = '×';
  del.title = t('remove line');
  del.addEventListener('click', () => {
    H.capture();
    uiLines().splice(idx, 1);
    H.commit();
    rebuildLines();
    emit('ui');
  });

  head.appendChild(input);
  head.appendChild(sizeEl);
  head.appendChild(del);

  const scroll = document.createElement('div');
  scroll.className = 'line-scroll';
  const cv = document.createElement('canvas');
  scroll.appendChild(cv);

  cv.addEventListener('pointerdown', e => onCanvasClick(idx, cv, e));
  cv.addEventListener('dblclick', () => openZoom());
  cv.addEventListener('pointermove', e => onCanvasHover(idx, cv, e));
  cv.addEventListener('pointerleave', () => {
    if (hover && hover.idx === idx) {
      hover = null;
      cv.style.cursor = '';
      scheduleRender();
    }
  });

  el.appendChild(head);
  el.appendChild(scroll);
  el._cv = cv;
  el._scroll = scroll;
  return el;
}

const hits = []; // per line: {boxes, gaps}

export function scheduleRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; renderAll(); });
}

export function renderAll() {
  if (!state.font || !container) return;
  const els = container.children;
  hits.length = 0;
  for (let i = 0; i < els.length; i++) renderLine(i, els[i]);
}

function renderLine(idx, el) {
  const ln = uiLines()[idx];
  if (!ln) return;
  const cv = el._cv, scroll = el._scroll;
  const s = ln.size / state.upm;
  const asc = metric('ascender'), desc = metric('descender');
  const cap = metric('capHeight'), xh = metric('xHeight');

  const L = layout(ln.text || '');
  const ox = 28, padTop = 24, padBot = 18;
  const cssW = Math.max(scroll.clientWidth || 600, ox * 2 + L.width * s);
  const cssH = padTop + (asc - desc) * s + padBot;
  const ctx = setupCanvas(cv, cssW, cssH);
  const by = padTop + asc * s;

  ctx.clearRect(0, 0, cssW, cssH);

  // guides
  if (state.edits.ui.guides !== false) {
    const rows = [
      ['ascender', asc, C.edge, true],
      ['cap', cap, C.cap, false],
      ['x-height', xh, C.xh, false],
      ['base', 0, C.baseline, false],
      ['descender', desc, C.edge, true],
    ];
    ctx.save();
    ctx.font = '600 9px "JetBrains Mono", monospace';
    for (const [label, v, color, dashed] of rows) {
      const y = Math.round(by - v * s) + 0.5;
      ctx.strokeStyle = color;
      ctx.globalAlpha = dashed ? 0.55 : 0.8;
      ctx.setLineDash(dashed ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cssW, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = color;
      ctx.fillText(label, 4, y - 3);
    }
    ctx.restore();
  }

  // selection highlight (under the glyphs): frame, bearings, kerning
  const sel = state.sel;
  const boxes = [], gaps = [];
  for (let j = 0; j < L.items.length; j++) {
    const it = L.items[j];
    const x0 = ox + it.pen * s;
    boxes.push({ x0, x1: x0 + it.adv * s, name: it.name });
    if (j > 0) {
      const prev = L.items[j - 1];
      gaps.push({ x: ox + (it.pen - it.kern / 2) * s, left: prev.name, right: it.name, kern: it.kern, j });
    }
  }
  drawSelOverlay(ctx, L.items, gaps, sel, ox, s, by, asc, desc);

  // gap markers on hover: all faint, the nearest one bright
  let hovGap = null;
  if (hover && hover.idx === idx && gaps.length) {
    ctx.strokeStyle = 'rgba(59,91,140,.18)';
    for (const g of gaps) {
      ctx.beginPath();
      ctx.moveTo(Math.round(g.x) + 0.5, by - asc * s);
      ctx.lineTo(Math.round(g.x) + 0.5, by - desc * s);
      ctx.stroke();
      if (!hovGap || Math.abs(hover.x - g.x) < Math.abs(hover.x - hovGap.x)) hovGap = g;
    }
    if (hovGap && Math.abs(hover.x - hovGap.x) > Math.max(5, ln.size * 0.055)) hovGap = null;
  }

  // kerning values next to pairs (when guides are on)
  if (state.edits.ui.guides !== false) {
    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.fillStyle = C.kern;
    ctx.textAlign = 'center';
    for (const g of gaps) {
      if (g.kern) ctx.fillText(String(g.kern), g.x, by - desc * s + 12);
    }
    ctx.textAlign = 'left';
  }

  // glyphs
  for (const it of L.items) {
    fillGlyph(ctx, it, ox + it.pen * s, by, s, C.ink);
  }

  if (hovGap) {
    ctx.strokeStyle = C.pairEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hovGap.x, by - asc * s);
    ctx.lineTo(hovGap.x, by - desc * s);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  hits[idx] = { boxes, gaps, size: ln.size };
}

function onCanvasHover(idx, cv, e) {
  const h = hits[idx];
  if (!h) return;
  const rect = cv.getBoundingClientRect();
  const x = e.clientX - rect.left;
  hover = { idx, x };
  const tol = Math.max(5, h.size * 0.055);
  let near = false;
  for (const g of h.gaps) {
    if (Math.abs(x - g.x) <= tol) { near = true; break; }
  }
  cv.style.cursor = near ? 'col-resize' : '';
  scheduleRender();
}

function onCanvasClick(idx, cv, e) {
  const h = hits[idx];
  if (!h) return;
  const rect = cv.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const tol = Math.max(5, h.size * 0.055);
  let best = null, bestD = tol + 1;
  for (const g of h.gaps) {
    const d = Math.abs(x - g.x);
    if (d < bestD) { bestD = d; best = g; }
  }
  if (best && bestD <= tol) {
    state.sel = { type: 'pair', left: best.left, right: best.right };
  } else {
    const box = h.boxes.find(b => x >= b.x0 && x <= b.x1);
    state.sel = box ? { type: 'glyph', name: box.name } : null;
  }
  emit('selection');
  scheduleRender();
}
