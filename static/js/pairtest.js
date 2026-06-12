// Litera: spacing test feed (built-in or from a custom pair-test file)
// ~1400 lines; only visible rows are painted (IntersectionObserver), off-screen canvases are freed
import { state, emit, metric, onChange } from './state.js';
import { layout, fillGlyph, setupCanvas, drawSelOverlay } from './render.js';
import { makeScrub } from './scrub.js';
import { openZoom } from './zoom.js';
import * as H from './history.js';
import { t } from './i18n.js';

const C = {
  ink: '#1F1D1A',
  base: 'rgba(179,64,42,.35)',
  kern: '#3B5B8C',
  selFill: 'rgba(179,64,42,.10)',
  selEdge: 'rgba(179,64,42,.55)',
  pairFill: 'rgba(59,91,140,.16)',
  pairEdge: 'rgba(59,91,140,.7)',
};

let els = null;          // {btn, head, nav, sizeEl, list}
let groups = null;       // data from the api
let rows = [];           // [{el, scrollEl, cv, text, hits, painted}]
let io = null;
let loading = false;
let repaintTimer = 0;
let hover = null;   // {row, x}
let hoverRaf = 0;

const isOpen = () => state.edits.ui.pairtest === true;
const pairSize = () => state.edits.ui.pairSize || 46;

export function initPairTest(refs) {
  els = refs;
  els.btn.addEventListener('click', () => {
    H.capture();
    state.edits.ui.pairtest = !isOpen();
    H.commit();
    emit('ui');
    sync();
  });
  makeScrub(els.sizeEl, {
    get: pairSize,
    set: v => { state.edits.ui.pairSize = v; },
    step: 0.4, min: 18, max: 160, suffix: ' px', nudge: 2,
    enabled: isOpen,
    onBegin: () => H.capture(),
    onLive: () => { applyHeights(); schedulePaint(); },
    onCommit: () => { H.commit(); emit('ui'); },
  });
  els.nav.addEventListener('change', () => {
    const i = parseInt(els.nav.value, 10);
    const r = rows[i];
    if (r) r.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  onChange(kind => {
    if (kind === 'restore') { sync(); return; }
    if (!isOpen()) return;
    if (kind === 'edits' || kind === 'selection') schedulePaint();
  });
}

// called from app on font load/switch
export function syncPairTest() { sync(); }

function sync() {
  const open = isOpen();
  els.btn.classList.toggle('on', open);
  els.nav.hidden = !open;
  els.sizeEl.parentElement.hidden = !open;
  els.list.hidden = !open;
  els.sizeEl.classList.toggle('off', !open);
  if (!open) return;
  if (!groups) { fetchData(); return; }
  if (!rows.length) buildDom();
  applyHeights();
  schedulePaint();
}

async function fetchData() {
  if (loading) return;
  loading = true;
  try {
    const r = await fetch('api/pairtest');
    const data = await r.json();
    groups = data.groups || [];
  } catch (e) {
    groups = [];
  }
  loading = false;
  if (isOpen()) { buildDom(); applyHeights(); schedulePaint(); }
}

function buildDom() {
  els.list.innerHTML = '';
  els.nav.innerHTML = '';
  rows = [];
  if (io) io.disconnect();
  io = new IntersectionObserver(onIntersect, { rootMargin: '400px 0px' });

  if (!groups || !groups.length) {
    els.list.textContent = t('pair test is empty');
    return;
  }
  for (const g of groups) {
    const h = document.createElement('div');
    h.className = 'pgroup';
    h.textContent = g.title;
    els.list.appendChild(h);

    const opt = document.createElement('option');
    opt.value = String(rows.length);
    opt.textContent = g.title;
    els.nav.appendChild(opt);

    for (const text of g.lines) {
      const el = document.createElement('div');
      el.className = 'prow';
      const scrollEl = document.createElement('div');
      scrollEl.className = 'prow-scroll';
      el.appendChild(scrollEl);
      els.list.appendChild(el);
      const row = { el, scrollEl, cv: null, text, hits: null, painted: false };
      el.addEventListener('pointerdown', e => onRowClick(row, e));
      el.addEventListener('dblclick', () => openZoom());
      el.addEventListener('pointermove', e => onRowHover(row, e));
      el.addEventListener('pointerleave', () => {
        if (hover && hover.row === row) {
          hover = null;
          if (row.cv) { row.cv.style.cursor = ''; paintRow(row); }
        }
      });
      rows.push(row);
      io.observe(el);
    }
  }
}

function rowHeight() {
  const s = pairSize() / state.upm;
  return Math.round(8 + (metric('ascender') - metric('descender')) * s + 16);
}

function applyHeights() {
  const h = rowHeight() + 'px';
  for (const r of rows) r.el.style.height = h;
}

function onIntersect(entries) {
  for (const en of entries) {
    const row = rows.find(r => r.el === en.target);
    if (!row) continue;
    if (en.isIntersecting) {
      paintRow(row);
    } else if (row.cv) {
      row.cv.remove();
      row.cv = null;
      row.hits = null;
      row.painted = false;
    }
  }
}

export function schedulePaint() {
  clearTimeout(repaintTimer);
  repaintTimer = setTimeout(() => {
    if (!isOpen()) return;
    for (const r of rows) if (r.cv) paintRow(r);
  }, 30);
}

function paintRow(row) {
  if (!state.font) return;
  const size = pairSize();
  const s = size / state.upm;
  const asc = metric('ascender'), desc = metric('descender');
  const L = layout(row.text);
  const ox = 14, padTop = 4, padBot = 12;
  const cssW = Math.max(60, ox * 2 + L.width * s);
  const cssH = padTop + (asc - desc) * s + padBot;

  if (!row.cv) {
    row.cv = document.createElement('canvas');
    row.scrollEl.appendChild(row.cv);
  }
  const ctx = setupCanvas(row.cv, cssW, cssH);
  const by = padTop + asc * s;
  ctx.clearRect(0, 0, cssW, cssH);

  // full guides as in the preview (no labels); baseline only when guides are off
  if (state.edits.ui.guides !== false) {
    const cap = metric('capHeight'), xh = metric('xHeight');
    const glines = [
      [asc, 'rgba(154,145,127,.5)', true],
      [cap, 'rgba(59,91,140,.55)', false],
      [xh, 'rgba(46,125,107,.55)', false],
      [0, 'rgba(179,64,42,.6)', false],
      [desc, 'rgba(154,145,127,.5)', true],
    ];
    for (const [v, color, dashed] of glines) {
      const y = Math.round(by - v * s) + 0.5;
      ctx.strokeStyle = color;
      ctx.setLineDash(dashed ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cssW, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = C.base;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(by) + 0.5);
    ctx.lineTo(cssW, Math.round(by) + 0.5);
    ctx.stroke();
  }

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

  // gap markers on hover
  let hovGap = null;
  if (hover && hover.row === row && gaps.length) {
    ctx.strokeStyle = 'rgba(59,91,140,.18)';
    for (const g of gaps) {
      ctx.beginPath();
      ctx.moveTo(Math.round(g.x) + 0.5, by - asc * s);
      ctx.lineTo(Math.round(g.x) + 0.5, by - desc * s);
      ctx.stroke();
      if (!hovGap || Math.abs(hover.x - g.x) < Math.abs(hover.x - hovGap.x)) hovGap = g;
    }
    if (hovGap && Math.abs(hover.x - hovGap.x) > Math.max(5, size * 0.055)) hovGap = null;
  }

  // kerning values
  ctx.font = '600 9px "JetBrains Mono", monospace';
  ctx.fillStyle = C.kern;
  ctx.textAlign = 'center';
  for (const g of gaps) {
    if (g.kern) ctx.fillText(String(g.kern), g.x, by - desc * s + 10);
  }
  ctx.textAlign = 'left';

  for (const it of L.items) fillGlyph(ctx, it, ox + it.pen * s, by, s, C.ink);

  if (hovGap) {
    ctx.strokeStyle = C.pairEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hovGap.x, by - asc * s);
    ctx.lineTo(hovGap.x, by - desc * s);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  row.hits = { boxes, gaps, size };
  row.painted = true;
}

function onRowHover(row, e) {
  if (!row.cv || !row.hits) return;
  const rect = row.cv.getBoundingClientRect();
  const x = e.clientX - rect.left;
  hover = { row, x };
  const tol = Math.max(5, row.hits.size * 0.055);
  let near = false;
  for (const g of row.hits.gaps) {
    if (Math.abs(x - g.x) <= tol) { near = true; break; }
  }
  row.cv.style.cursor = near ? 'col-resize' : '';
  if (!hoverRaf) {
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      if (hover && hover.row.cv) paintRow(hover.row);
    });
  }
}

function onRowClick(row, e) {
  if (!row.hits || !row.cv) return;
  const rect = row.cv.getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (x < 0 || x > rect.width) return;
  const h = row.hits;
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
}
