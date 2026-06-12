// Litera: grid of all glyphs; ascenders/descenders visible at a glance
import { state, emit, metric } from './state.js';
import { paramsFor, effAdvance, fillGlyph, setupCanvas } from './render.js';
import { openZoom } from './zoom.js';

let container = null;
let cells = [];
let timer = 0;

export function initGrid(el) { container = el; }

export function rebuildGrid() {
  container.innerHTML = '';
  cells = [];
  if (!state.font) return;
  const n = state.font.glyphs.length;
  for (let i = 0; i < n; i++) {
    const g = state.font.glyphs.get(i);
    if (!g || !g.name || g.name === '.notdef') continue;
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.name = g.name;
    const cv = document.createElement('canvas');
    const lab = document.createElement('div');
    lab.className = 'cell-lab';
    lab.textContent = g.unicode ? String.fromCodePoint(g.unicode) : g.name;
    cell.appendChild(cv);
    cell.appendChild(lab);
    cell.addEventListener('click', () => {
      state.sel = { type: 'glyph', name: g.name };
      emit('selection');
    });
    cell.addEventListener('dblclick', () => openZoom());
    container.appendChild(cell);
    cells.push({ cell, cv, glyph: g, name: g.name });
  }
  refreshGrid();
  updateGridSelection();
}

export function scheduleGridRefresh() {
  clearTimeout(timer);
  timer = setTimeout(refreshGrid, 120);
}

export function refreshGrid() {
  if (!state.font) return;
  const asc = metric('ascender'), desc = metric('descender');
  const cap = metric('capHeight'), xh = metric('xHeight');
  const span = Math.max(1, asc - desc);
  for (const c of cells) renderCell(c, asc, desc, cap, xh, span);
}

function renderCell(c, asc, desc, cap, xh, span) {
  const W = 84, Hh = 84;
  const ctx = setupCanvas(c.cv, W, Hh);
  ctx.clearRect(0, 0, W, Hh);
  const s = 62 / span;
  const by = 8 + asc * s;
  const p = paramsFor(c.name);
  const adv = effAdvance(c.glyph);
  const x0 = Math.max(2, (W - adv * s) / 2);

  // full guides: ascender/cap/x-height/base/descender
  const glines = [
    [asc, 'rgba(154,145,127,.45)', true],
    [cap, 'rgba(59,91,140,.4)', false],
    [xh, 'rgba(46,125,107,.4)', false],
    [0, 'rgba(179,64,42,.5)', false],
    [desc, 'rgba(154,145,127,.45)', true],
  ];
  for (const [v, color, dashed] of glines) {
    const y = Math.round(by - v * s) + 0.5;
    ctx.strokeStyle = color;
    ctx.setLineDash(dashed ? [3, 3] : []);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // advance bounds on the baseline: where the letter starts and where the next one lands
  ctx.strokeStyle = 'rgba(31,29,26,.5)';
  for (const x of [x0, x0 + adv * s]) {
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, by - 3); ctx.lineTo(Math.round(x) + 0.5, by + 3); ctx.stroke();
  }

  fillGlyph(ctx, { glyph: c.glyph, name: c.name, adv, ...p }, x0, by, s, '#1F1D1A');

  // edited marker
  const e = state.edits.glyphs[c.name];
  const edited = e && ((e.s != null && e.s !== 1) || (e.dx | 0) || (e.dy | 0) || (e.dadv | 0));
  c.cell.classList.toggle('edited', !!edited);
}

export function updateGridSelection() {
  const sel = state.sel && state.sel.type === 'glyph' ? state.sel.name : null;
  for (const c of cells) c.cell.classList.toggle('sel', c.name === sel);
}
