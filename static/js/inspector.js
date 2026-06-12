// Litera: right panel — all scrub parameters for the font, the glyph and kerning
import { state, glyphEdit, gscale, metric, emit } from './state.js';
import { makeScrub, refreshScrubs } from './scrub.js';
import { paramsFor, effAdvance, unitBox, kernKey, baseKern, effKern } from './render.js';
import * as H from './history.js';
import { t } from './i18n.js';

const $ = id => document.getElementById(id);
let widthEl = null;

function row(parent, label) {
  const r = document.createElement('div');
  r.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const val = document.createElement('span');
  r.appendChild(lab);
  r.appendChild(val);
  parent.appendChild(r);
  return val;
}

const live = () => emit('edits');
const begin = () => H.capture();
const done = () => { H.commit(); emit('edits'); };

const selGlyph = () => (state.sel && state.sel.type === 'glyph' ? state.sel.name : null);
const selPair = () => (state.sel && state.sel.type === 'pair' ? state.sel : null);
const hasFont = () => !!state.font;

function glyphLabel(name) {
  const g = state.nameMap[name];
  const ch = g && g.unicode ? String.fromCodePoint(g.unicode) : '';
  return ch && ch !== name ? `${ch} · ${name}` : name;
}

export function initInspector() {
  const rf = $('rows-font');

  makeScrub(row(rf, t('scale')), {
    get: () => gscale() * 100,
    set: v => { state.edits.global.scale = v === 100 ? undefined : v / 100; },
    step: 0.15, min: 10, max: 400, decimals: 1, suffix: ' %', nudge: 0.5,
    enabled: hasFont, onBegin: begin, onLive: live, onCommit: done,
  });
  makeScrub(row(rf, t('tracking')), {
    get: () => state.edits.global.tracking | 0,
    set: v => { state.edits.global.tracking = v === 0 ? undefined : v; },
    step: 0.5, min: -300, max: 600, nudge: 1,
    enabled: hasFont, onBegin: begin, onLive: live, onCommit: done,
  });
  const metricScrub = (label, key, min, max, fix) => makeScrub(row(rf, label), {
    get: () => metric(key),
    set: v => {
      if (fix) v = fix(v);
      state.edits.global[key] = v === state.base[key] ? undefined : Math.round(v);
    },
    step: 1, min, max, nudge: 1,
    enabled: hasFont, onBegin: begin, onLive: live, onCommit: done,
  });
  metricScrub('ascender', 'ascender', 100, 2500);
  metricScrub('descender', 'descender', -2000, 0, v => (v > 0 ? -v : v));
  metricScrub(t('line gap'), 'lineGap', 0, 1500);
  metricScrub('cap height', 'capHeight', 50, 2000);
  metricScrub('x-height', 'xHeight', 50, 2000);

  $('reset-font').addEventListener('click', () => {
    H.capture();
    state.edits.global = {};
    done();
  });

  // --- glyph ---
  const rg = $('rows-glyph');

  makeScrub(row(rg, t('scale')), {
    get: () => { const e = glyphEdit(selGlyph()); return (e.s == null ? 1 : e.s) * 100; },
    set: v => { const e = glyphEdit(selGlyph(), true); e.s = v / 100; },
    step: 0.2, min: 10, max: 400, decimals: 1, suffix: ' %', nudge: 0.5,
    enabled: () => !!selGlyph(), onBegin: begin, onLive: live, onCommit: done,
  });
  makeScrub(row(rg, t('width')), {
    get: () => { const e = glyphEdit(selGlyph()); return (e.sx == null ? 1 : e.sx) * 100; },
    set: v => { const e = glyphEdit(selGlyph(), true); e.sx = v / 100; },
    step: 0.2, min: 10, max: 400, decimals: 1, suffix: ' %', nudge: 0.5,
    enabled: () => !!selGlyph(), onBegin: begin, onLive: live, onCommit: done,
  });
  makeScrub(row(rg, t('height')), {
    get: () => { const e = glyphEdit(selGlyph()); return (e.sy == null ? 1 : e.sy) * 100; },
    set: v => { const e = glyphEdit(selGlyph(), true); e.sy = v / 100; },
    step: 0.2, min: 10, max: 400, decimals: 1, suffix: ' %', nudge: 0.5,
    enabled: () => !!selGlyph(), onBegin: begin, onLive: live, onCommit: done,
  });
  makeScrub(row(rg, t('shift Y')), {
    get: () => glyphEdit(selGlyph()).dy | 0,
    set: v => { glyphEdit(selGlyph(), true).dy = v; },
    step: 0.5, min: -1000, max: 1000, nudge: 1,
    enabled: () => !!selGlyph(), onBegin: begin, onLive: live, onCommit: done,
  });

  const curLsb = () => {
    const n = selGlyph(); const b = unitBox(n);
    if (!b) return 0;
    const p = paramsFor(n);
    return Math.round(b.x1 * p.kx) + p.dx;
  };
  const curRsb = () => {
    const n = selGlyph(); const b = unitBox(n);
    if (!b) return 0;
    const p = paramsFor(n);
    return effAdvance(state.nameMap[n]) - (Math.round(b.x2 * p.kx) + p.dx);
  };
  makeScrub(row(rg, t('left bearing')), {
    get: curLsb,
    set: v => {
      const e = glyphEdit(selGlyph(), true);
      const d = v - curLsb();
      e.dx = (e.dx | 0) + d;
      e.dadv = (e.dadv | 0) + d;
    },
    step: 0.5, min: -1000, max: 1000, nudge: 1,
    enabled: () => !!selGlyph() && !!unitBox(selGlyph()), onBegin: begin, onLive: live, onCommit: done,
  });
  makeScrub(row(rg, t('right bearing')), {
    get: curRsb,
    set: v => {
      const e = glyphEdit(selGlyph(), true);
      e.dadv = (e.dadv | 0) + (v - curRsb());
    },
    step: 0.5, min: -1000, max: 1000, nudge: 1,
    enabled: () => !!selGlyph() && !!unitBox(selGlyph()), onBegin: begin, onLive: live, onCommit: done,
  });
  widthEl = row(rg, 'advance');
  widthEl.classList.add('mono', 'readonly');

  $('reset-glyph').addEventListener('click', () => {
    const n = selGlyph();
    if (!n) return;
    H.capture();
    delete state.edits.glyphs[n];
    done();
  });

  // --- kerning ---
  const rk = $('rows-kern');
  const pairGlyphs = () => {
    const p = selPair();
    return p ? [state.nameMap[p.left], state.nameMap[p.right]] : [null, null];
  };
  makeScrub(row(rk, t('pair')), {
    get: () => { const [l, r] = pairGlyphs(); return l && r ? effKern(l, r) : 0; },
    set: v => {
      const p = selPair();
      if (!p) return;
      state.edits.kerning[kernKey(p.left, p.right)] = v;
    },
    step: 0.5, min: -1000, max: 1000, nudge: 1,
    enabled: () => !!selPair(), onBegin: begin, onLive: live, onCommit: done,
  });

  $('kern-drop').addEventListener('click', () => {
    const p = selPair();
    if (!p) return;
    H.capture();
    delete state.edits.kerning[kernKey(p.left, p.right)];
    done();
  });
}

export function refreshInspector() {
  // section titles and availability
  const n = selGlyph();
  $('glyph-title').textContent = n ? glyphLabel(n) : '';
  $('sec-glyph').classList.toggle('disabled', !n);
  $('glyph-hint').style.display = n ? 'none' : '';

  const p = selPair();
  $('kern-title').textContent = p ? `${glyphLabel(p.left)}  ×  ${glyphLabel(p.right)}` : '';
  $('sec-kern').classList.toggle('disabled', !p);
  $('kern-drop').style.display = p && (kernKey(p.left, p.right) in state.edits.kerning) ? '' : 'none';

  if (widthEl) {
    widthEl.textContent = n && state.nameMap[n] ? String(effAdvance(state.nameMap[n])) : '·';
  }

  // pair list
  const list = $('kern-list');
  list.innerHTML = '';
  const keys = Object.keys(state.edits.kerning).sort();
  for (const key of keys) {
    const [l, r] = key.split(' ');
    const item = document.createElement('div');
    item.className = 'kern-item' + (p && p.left === l && p.right === r ? ' sel' : '');
    const lab = document.createElement('span');
    lab.textContent = `${shortLabel(l)} ${shortLabel(r)}`;
    const val = document.createElement('span');
    val.className = 'mono';
    val.textContent = String(Math.round(state.edits.kerning[key]));
    const x = document.createElement('button');
    x.textContent = '×';
    x.title = t('remove pair');
    x.addEventListener('click', ev => {
      ev.stopPropagation();
      H.capture();
      delete state.edits.kerning[key];
      done();
    });
    item.appendChild(lab); item.appendChild(val); item.appendChild(x);
    item.addEventListener('click', () => {
      state.sel = { type: 'pair', left: l, right: r };
      emit('selection');
    });
    list.appendChild(item);
  }
  refreshScrubs();
}

function shortLabel(name) {
  const g = state.nameMap[name];
  return g && g.unicode ? String.fromCodePoint(g.unicode) : name;
}
