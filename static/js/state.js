// Litera: shared state and event bus
export const state = {
  fontPath: null,
  font: null,        // opentype.Font
  upm: 1000,
  base: { ascender: 800, descender: -200, lineGap: 0, capHeight: 700, xHeight: 480 },
  edits: emptyEdits(),
  sel: null,         // {type:'glyph', name} | {type:'pair', left, right}
  fonts: [],
  nameMap: {},       // glyphName -> opentype.Glyph
  lastExport: null,
};

export function emptyEdits() {
  return { version: 1, global: {}, glyphs: {}, kerning: {}, ui: {} };
}

export function glyphEdit(name, create) {
  if (create && !state.edits.glyphs[name]) state.edits.glyphs[name] = {};
  return state.edits.glyphs[name] || {};
}

export function gscale() {
  const v = state.edits.global.scale;
  return v == null ? 1 : v;
}

export function metric(key) {
  const o = state.edits.global[key];
  return o == null ? state.base[key] : o;
}

// Cleanup: drop empty records before saving
export function cleanedEdits() {
  const e = state.edits;
  const glyphs = {};
  for (const [n, g] of Object.entries(e.glyphs)) {
    const s = g.s == null ? 1 : g.s;
    const sx = g.sx == null ? 1 : g.sx;
    const sy = g.sy == null ? 1 : g.sy;
    if (s !== 1 || sx !== 1 || sy !== 1 || (g.dx | 0) || (g.dy | 0) || (g.dadv | 0)) {
      glyphs[n] = { s, sx, sy, dx: g.dx | 0, dy: g.dy | 0, dadv: g.dadv | 0 };
    }
  }
  const kerning = {};
  for (const [k, v] of Object.entries(e.kerning)) {
    if (Math.round(v) !== 0) kerning[k] = Math.round(v);
  }
  return { version: 1, global: { ...e.global }, glyphs, kerning, ui: { ...e.ui } };
}

const subs = [];
export function onChange(fn) { subs.push(fn); }
export function emit(kind) { for (const f of subs) f(kind); }
