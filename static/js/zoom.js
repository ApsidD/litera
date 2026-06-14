// Litera: large view of a glyph or a kerning pair (double click)
// Glyph: drag with the mouse (horizontal = left bearing, vertical = position). Pair: drag the kerning.
import { state, glyphEdit, emit, metric, cleanedEdits } from './state.js';
import { paramsFor, effAdvance, effKern, kernKey, fillGlyph, setupCanvas, unitBox } from './render.js';
import { makeScrub, refreshScrubs } from './scrub.js';
import * as H from './history.js';
import { t } from './i18n.js';

const $ = id => document.getElementById(id);
const C = {
  ink: '#1F1D1A',
  edge: '#9A917F',
  cap: '#3B5B8C',
  xh: '#2E7D6B',
  baseline: '#B3402A',
  pairFill: 'rgba(59,91,140,.16)',
  pairEdge: 'rgba(59,91,140,.8)',
};

let cv = null;
let lastS = 1;
let drag = null; // {x, y, e0} | {x, kern0}
let wprev = null;  // {glyph, key, img, meta} server-rendered weighted shape
let wprevBusy = false;

// colored band: green = air, red = overlap/negative
function band(ctx, xa, xb, top, h) {
  if (Math.abs(xb - xa) < 0.5) return;
  ctx.fillStyle = xb >= xa ? 'rgba(46,125,107,.22)' : 'rgba(179,64,42,.20)';
  ctx.fillRect(Math.min(xa, xb), top, Math.abs(xb - xa), h);
}

const isOpen = () => !$('zoom').hidden;
const selGlyph = () => (state.sel && state.sel.type === 'glyph' ? state.sel.name : null);
const selPair = () => (state.sel && state.sel.type === 'pair' ? state.sel : null);

function label(name) {
  const g = state.nameMap[name];
  const ch = g && g.unicode ? String.fromCodePoint(g.unicode) : '';
  return ch && ch !== name ? `${ch} · ${name}` : name;
}

// signature of the current glyph's edits, to know when a weight preview is stale
function glyphSig(name) {
  const e = state.edits.glyphs[name];
  return name + ':' + JSON.stringify(e || {});
}

const begin = () => H.capture();
const live = () => emit('edits');
const done = () => { H.commit(); emit('edits'); };

// current LSB/RSB of the selected glyph (in final units), mirrors the side panel
function curLsbZ() {
  const n = selGlyph(); const b = unitBox(n);
  if (!b) return 0;
  const p = paramsFor(n);
  return Math.round(b.x1 * p.kx) + p.dx;
}
function curRsbZ() {
  const n = selGlyph(); const b = unitBox(n);
  if (!b) return 0;
  const p = paramsFor(n);
  return effAdvance(state.nameMap[n]) - (Math.round(b.x2 * p.kx) + p.dx);
}

// a bearing scrub (left or right) built on the glyph's bounding box
function bearingScrub(parent, lbl, side) {
  const r = document.createElement('div');
  r.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = lbl;
  const val = document.createElement('span');
  r.appendChild(lab); r.appendChild(val);
  parent.appendChild(r);
  makeScrub(val, {
    get: () => (side === 'l' ? curLsbZ() : curRsbZ()),
    set: v => {
      const e = glyphEdit(selGlyph(), true);
      if (side === 'l') {
        const d = v - curLsbZ();
        e.dx = (e.dx | 0) + d;
        e.dadv = (e.dadv | 0) + d;
      } else {
        e.dadv = (e.dadv | 0) + (v - curRsbZ());
      }
    },
    step: 0.5, min: -1000, max: 1000, nudge: 1,
    enabled: () => isOpen() && !!selGlyph() && !!unitBox(selGlyph()),
    onBegin: begin, onLive: live, onCommit: done,
  });
}

function glyphScrub(parent, lbl, key) {
  const r = document.createElement('div');
  r.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = lbl;
  const val = document.createElement('span');
  r.appendChild(lab); r.appendChild(val);
  parent.appendChild(r);
  makeScrub(val, {
    get: () => {
      const e = glyphEdit(selGlyph());
      if (key === 'wh' || key === 'wv') return e[key] == null ? (e.w | 0) : (e[key] | 0);
      if (key === 'dy') return e.dy | 0;
      return (e[key] == null ? 1 : e[key]) * 100;
    },
    set: v => {
      const e = glyphEdit(selGlyph(), true);
      if (key === 'wh' || key === 'wv') {
        e[key] = v;
        if (e.w != null) {  // split legacy isotropic into both axes
          const other = key === 'wh' ? 'wv' : 'wh';
          if (e[other] == null) e[other] = e.w | 0;
          delete e.w;
        }
      } else if (key === 'dy') e.dy = v;
      else e[key] = v / 100;
    },
    step: (key === 'dy') ? 0.5 : ((key === 'wh' || key === 'wv') ? 0.3 : 0.2),
    min: (key === 'dy') ? -1000 : ((key === 'wh' || key === 'wv') ? -120 : 10),
    max: (key === 'dy') ? 1000 : ((key === 'wh' || key === 'wv') ? 120 : 400),
    decimals: (key === 'dy' || key === 'wh' || key === 'wv') ? 0 : 1,
    suffix: (key === 'dy' || key === 'wh' || key === 'wv') ? '' : ' %',
    nudge: (key === 'dy' || key === 'wh' || key === 'wv') ? 1 : 0.5,
    enabled: () => isOpen() && !!selGlyph(),
    onBegin: begin, onLive: live, onCommit: done,
  });
}

export function initZoom() {
  cv = $('zoom-cv');

  const rg = $('zoom-rows-glyph');
  glyphScrub(rg, t('scale'), 's');
  glyphScrub(rg, t('width'), 'sx');
  glyphScrub(rg, t('height'), 'sy');
  glyphScrub(rg, t('shift Y'), 'dy');
  bearingScrub(rg, t('left bearing'), 'l');
  bearingScrub(rg, t('right bearing'), 'r');
  glyphScrub(rg, t('weight: horizontal'), 'wh');
  glyphScrub(rg, t('weight: vertical'), 'wv');

  const rk = $('zoom-rows-pair');
  const r = document.createElement('div');
  r.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = t('pair');
  const val = document.createElement('span');
  r.appendChild(lab); r.appendChild(val);
  rk.appendChild(r);
  makeScrub(val, {
    get: () => {
      const p = selPair();
      if (!p) return 0;
      return effKern(state.nameMap[p.left], state.nameMap[p.right]);
    },
    set: v => {
      const p = selPair();
      if (p) state.edits.kerning[kernKey(p.left, p.right)] = v;
    },
    step: 0.5, min: -1000, max: 1000, nudge: 1,
    enabled: () => isOpen() && !!selPair(),
    onBegin: begin, onLive: live, onCommit: done,
  });

  $('zoom-close').addEventListener('click', closeZoom);
  $('zoom').querySelector('.zoom-back').addEventListener('click', closeZoom);
  $('zoom-reset').addEventListener('click', () => {
    const g = selGlyph(), p = selPair();
    H.capture();
    if (g) delete state.edits.glyphs[g];
    else if (p) delete state.edits.kerning[kernKey(p.left, p.right)];
    done();
  });

  $('zoom-wprev').addEventListener('click', async () => {
    const g = selGlyph();
    if (!g || wprevBusy) return;
    // toggle off if we already show a fresh preview for this exact state
    if (wprev && wprev.key === glyphSig(g)) { wprev = null; paint(); return; }
    wprevBusy = true;
    const btn = $('zoom-wprev');
    const old = btn.textContent;
    btn.textContent = t('rendering…');
    try {
      const ppu = Math.max(0.15, Math.min(2, lastS || 0.6));
      const r = await fetch('api/glyph-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: state.fontPath, glyph: g, edits: cleanedEdits(), ppu }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'HTTP ' + r.status);
      const img = new Image();
      img.onload = () => { wprev = { key: glyphSig(g), img, meta: data }; paint(); };
      img.src = data.png;
    } catch (e) {
      btn.textContent = t('preview failed');
      setTimeout(() => { btn.textContent = old; }, 1500);
      wprevBusy = false;
      return;
    }
    btn.textContent = old;
    wprevBusy = false;
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen()) closeZoom();
  });
  window.addEventListener('resize', () => { if (isOpen()) paint(); });
  new ResizeObserver(() => { if (isOpen()) paint(); }).observe($('zoom').querySelector('.zoom-box'));
  // wheel over the backdrop must not scroll the page behind the modal
  $('zoom').addEventListener('wheel', e => {
    if (!e.target.closest('.zoom-box')) e.preventDefault();
  }, { passive: false });

  // dragging directly on the canvas
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const g = selGlyph(), p = selPair();
    if (!g && !p) return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    cv.classList.add('dragging');
    H.capture();
    if (g) {
      const ed = glyphEdit(g, true);
      drag = { x: e.clientX, y: e.clientY, e0: { dx: ed.dx | 0, dadv: ed.dadv | 0, dy: ed.dy | 0 } };
    } else {
      drag = { x: e.clientX, kern0: effKern(state.nameMap[p.left], state.nameMap[p.right]) };
    }
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const mod = e.altKey ? 0.25 : 1;
    const du = Math.round((e.clientX - drag.x) / lastS * mod);
    const g = selGlyph(), p = selPair();
    if (g && drag.e0) {
      const dv = Math.round(-(e.clientY - drag.y) / lastS * mod);
      const ed = glyphEdit(g, true);
      ed.dx = drag.e0.dx + du;
      ed.dadv = drag.e0.dadv + du;
      ed.dy = drag.e0.dy + dv;
      live();
    } else if (p && drag.kern0 != null) {
      state.edits.kerning[kernKey(p.left, p.right)] = Math.max(-1000, Math.min(1000, drag.kern0 + du));
      live();
    }
  });
  const endDrag = e => {
    if (!drag) return;
    drag = null;
    cv.classList.remove('dragging');
    try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
    done();
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
}

export function openZoom() {
  const g = selGlyph(), p = selPair();
  if (!g && !p) return;
  $('zoom').hidden = false;
  document.body.classList.add('modal-open');
  $('zoom-rows-glyph').style.display = g ? '' : 'none';
  $('zoom-rows-pair').style.display = p ? '' : 'none';
  $('zoom-hint').textContent = g
    ? t('drag the letter: horizontal = left bearing, vertical = vertical position · Alt = finer')
    : t('drag the right letter horizontally — that is kerning · Alt = finer');
  refreshScrubs();
  paint();
}

export function closeZoom() {
  $('zoom').hidden = true;
  document.body.classList.remove('modal-open');
}

export function zoomChanged(kind) {
  if (!isOpen()) return;
  if (state.sel == null) { closeZoom(); return; }
  if (kind === 'edits' || kind === 'selection' || kind === 'restore') {
    // drop a weight preview that no longer matches the glyph or its edits
    const g = selGlyph();
    if (wprev && (!g || wprev.key !== glyphSig(g))) wprev = null;
    $('zoom-rows-glyph').style.display = g ? '' : 'none';
    $('zoom-rows-pair').style.display = selPair() ? '' : 'none';
    paint();
  }
}

function drawGuides(ctx, cssW, by, s, asc, desc, cap, xh) {
  const rows = [
    ['ascender', asc, C.edge, true],
    ['cap', cap, C.cap, false],
    ['x-height', xh, C.xh, false],
    ['base', 0, C.baseline, false],
    ['descender', desc, C.edge, true],
  ];
  ctx.font = '600 10px "JetBrains Mono", monospace';
  for (const [lbl, v, color, dashed] of rows) {
    const y = Math.round(by - v * s) + 0.5;
    ctx.strokeStyle = color;
    ctx.globalAlpha = dashed ? 0.55 : 0.8;
    ctx.setLineDash(dashed ? [5, 5] : []);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cssW, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = color;
    ctx.fillText(lbl, 6, y - 4);
  }
  ctx.globalAlpha = 1;
}

function paint() {
  if (!state.font) return;
  const g = selGlyph(), p = selPair();
  if (!g && !p) return;

  // measure width from 100%, otherwise border-box eats 2px on every repaint
  cv.style.width = '100%';
  cv.style.height = '';  // let flex compute the available height
  const cssW = cv.clientWidth || 800;
  const cssH = Math.max(200, cv.clientHeight || Math.min(Math.round(window.innerHeight * 0.5), 480));
  const ctx = setupCanvas(cv, cssW, cssH);
  ctx.clearRect(0, 0, cssW, cssH);

  const asc = metric('ascender'), desc = metric('descender');
  const cap = metric('capHeight'), xh = metric('xHeight');
  const padT = 26, padB = 34;

  if (g) {
    $('zoom-title').textContent = label(g);
    const glyph = state.nameMap[g];
    if (!glyph) return;
    const pr = paramsFor(g);
    const adv = effAdvance(glyph);
    let s = (cssH - padT - padB) / (asc - desc);
    s = Math.min(s, (cssW - 140) / Math.max(adv, 1));
    lastS = s;
    const by = padT + asc * s;
    const ox = Math.max(70, (cssW - adv * s) / 2);

    drawGuides(ctx, cssW, by, s, asc, desc, cap, xh);

    // glyph bearings
    const bb = glyph.path && glyph.path.commands.length ? glyph.path.getBoundingBox() : null;
    if (bb) {
      const lsbB = Math.round(bb.x1 * pr.kx) + pr.dx;
      const rsbB = adv - (Math.round(bb.x2 * pr.kx) + pr.dx);
      band(ctx, ox, ox + lsbB * s, by - asc * s, (asc - desc) * s);
      band(ctx, ox + (adv - rsbB) * s, ox + adv * s, by - asc * s, (asc - desc) * s);
    }

    // advance frame: where the letter starts and where the next one lands
    ctx.strokeStyle = 'rgba(31,29,26,.35)';
    ctx.setLineDash([4, 4]);
    for (const x of [ox, ox + adv * s]) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, by - asc * s);
      ctx.lineTo(Math.round(x) + 0.5, by - desc * s);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(31,29,26,.8)';
    for (const x of [ox, ox + adv * s]) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, by - 6);
      ctx.lineTo(Math.round(x) + 0.5, by + 6);
      ctx.stroke();
    }

    if (wprev && wprev.key === glyphSig(g) && wprev.meta && wprev.meta.ok) {
      // overlay the real server-rendered weighted shape, aligned by metrics
      const m = wprev.meta;
      const scale = s / (m.px_per_unit * (window.devicePixelRatio || 1));
      const dispW = wprev.img.width * scale;
      const dispH = wprev.img.height * scale;
      // PNG left edge = m.x_units (font units from pen), top = m.y_top_units
      const px = ox + (m.x_units - m.pad_px / m.px_per_unit) * s;
      const py = by - (m.y_top_units + m.pad_px / m.px_per_unit) * s;
      ctx.drawImage(wprev.img, px, py, dispW, dispH);
    } else {
      fillGlyph(ctx, { glyph, name: g, adv, ...pr }, ox, by, s, C.ink);
    }

    // numbers: bearings and advance
    const b = glyph.path && glyph.path.commands.length ? glyph.path.getBoundingBox() : null;
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(31,29,26,.75)';
    if (b) {
      const lsb = Math.round(b.x1 * pr.kx) + pr.dx;
      const rsb = adv - (Math.round(b.x2 * pr.kx) + pr.dx);
      ctx.fillText('lsb ' + lsb, ox + 4, by + 20);
      const t = 'rsb ' + rsb;
      ctx.fillText(t, ox + adv * s - ctx.measureText(t).width - 4, by + 20);
    }
    const ta = 'advance ' + adv;
    ctx.fillText(ta, (cssW - ctx.measureText(ta).width) / 2, cssH - 8);
  } else if (p) {
    const gl = state.nameMap[p.left], gr = state.nameMap[p.right];
    if (!gl || !gr) return;
    $('zoom-title').textContent = label(p.left) + '  ×  ' + label(p.right);
    const pl = paramsFor(p.left), prr = paramsFor(p.right);
    const advL = effAdvance(gl), advR = effAdvance(gr);
    const kern = effKern(gl, gr);
    const width = advL + kern + advR;
    let s = (cssH - padT - padB) / (asc - desc);
    s = Math.min(s, (cssW - 120) / Math.max(width, 1));
    lastS = s;
    const by = padT + asc * s;
    const ox = Math.max(60, (cssW - width * s) / 2);

    drawGuides(ctx, cssW, by, s, asc, desc, cap, xh);

    // neighbor bearings: left glyph's rsb and right glyph's lsb
    const blb = gl.path && gl.path.commands.length ? gl.path.getBoundingBox() : null;
    const brb = gr.path && gr.path.commands.length ? gr.path.getBoundingBox() : null;
    let rsbL = null, lsbR = null;
    if (blb) {
      rsbL = advL - (Math.round(blb.x2 * pl.kx) + pl.dx);
      band(ctx, ox + (advL - rsbL) * s, ox + advL * s, by - asc * s, (asc - desc) * s);
    }
    if (brb) {
      lsbR = Math.round(brb.x1 * prr.kx) + prr.dx;
      const xp = ox + (advL + kern) * s;
      band(ctx, xp, xp + lsbR * s, by - asc * s, (asc - desc) * s);
    }

    // kerning band: from the left glyph's advance end to the right glyph's pen
    const xa = ox + advL * s;
    const xb = ox + (advL + kern) * s;
    if (kern) {
      ctx.fillStyle = kern < 0 ? 'rgba(179,64,42,.15)' : C.pairFill;
      ctx.fillRect(Math.min(xa, xb), by - asc * s, Math.abs(xb - xa), (asc - desc) * s);
    }
    ctx.strokeStyle = C.pairEdge;
    ctx.beginPath();
    ctx.moveTo(Math.round(xa + (xb - xa) / 2) + 0.5, by - asc * s);
    ctx.lineTo(Math.round(xa + (xb - xa) / 2) + 0.5, by - desc * s);
    ctx.stroke();

    fillGlyph(ctx, { glyph: gl, name: p.left, adv: advL, ...pl }, ox, by, s, C.ink);
    fillGlyph(ctx, { glyph: gr, name: p.right, adv: advR, ...prr }, ox + (advL + kern) * s, by, s, C.ink);

    ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.fillStyle = C.pairEdge;
    const parts = [];
    if (rsbL != null) parts.push('rsb ' + rsbL);
    parts.push('kern ' + kern);
    if (lsbR != null) parts.push('lsb ' + lsbR);
    const tk = parts.join('  ·  ');
    ctx.fillText(tk, (cssW - ctx.measureText(tk).width) / 2, cssH - 8);
  }
}
