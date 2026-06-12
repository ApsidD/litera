// Litera: geometry — glyph parameters, line layout, Path2D
import { state, glyphEdit, gscale } from './state.js';

const boxCache = new Map(); // name -> {x1,y1,x2,y2} | null (in units, without edits)

export function resetCaches() { boxCache.clear(); }

export function unitBox(name) {
  if (boxCache.has(name)) return boxCache.get(name);
  const g = state.nameMap[name];
  let box = null;
  if (g && g.path && g.path.commands.length) {
    const b = g.path.getBoundingBox();
    box = { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
  }
  boxCache.set(name, box);
  return box;
}

export function paramsFor(name) {
  const e = glyphEdit(name);
  const u = gscale() * (e.s == null ? 1 : e.s);
  return {
    kx: u * (e.sx == null ? 1 : e.sx),
    ky: u * (e.sy == null ? 1 : e.sy),
    dx: e.dx | 0,
    dy: e.dy | 0,
    dadv: e.dadv | 0,
    w: e.w | 0,
  };
}

export function effAdvance(glyph) {
  const p = paramsFor(glyph.name);
  const t = state.edits.global.tracking | 0;
  return Math.max(0, Math.round((glyph.advanceWidth || 0) * p.kx) + p.dadv + t + p.w);
}

export function kernKey(l, r) { return l + ' ' + r; }

export function baseKern(gl, gr) {
  try { return state.font.getKerningValue(gl, gr) || 0; } catch (e) { return 0; }
}

export function effKern(gl, gr) {
  const key = kernKey(gl.name, gr.name);
  if (key in state.edits.kerning) return state.edits.kerning[key];
  return baseKern(gl, gr);
}

// Line layout in units: [{glyph,name,ch,pen,adv,kern,k,dx,dy}]
export function layout(text) {
  const items = [];
  let pen = 0, prev = null;
  for (const ch of text) {
    const glyph = state.font.charToGlyph(ch);
    let kern = 0;
    if (prev) { kern = effKern(prev, glyph); pen += kern; }
    const p = paramsFor(glyph.name);
    const adv = effAdvance(glyph);
    items.push({ glyph, name: glyph.name, ch, pen, adv, kern, ...p });
    pen += adv;
    prev = glyph;
  }
  return { items, width: pen };
}

// Glyph Path2D in units with kx/ky scale and dx,dy shift (y up)
export function glyphPath2D(glyph, kx, ky, dx, dy) {
  const p = new Path2D();
  const X = v => v * kx + dx, Y = v => v * ky + dy;
  for (const c of glyph.path.commands) {
    if (c.type === 'M') p.moveTo(X(c.x), Y(c.y));
    else if (c.type === 'L') p.lineTo(X(c.x), Y(c.y));
    else if (c.type === 'C') p.bezierCurveTo(X(c.x1), Y(c.y1), X(c.x2), Y(c.y2), X(c.x), Y(c.y));
    else if (c.type === 'Q') p.quadraticCurveTo(X(c.x1), Y(c.y1), X(c.x), Y(c.y));
    else if (c.type === 'Z') p.closePath();
  }
  return p;
}

// Fill a glyph on ctx: ox,oy — screen position of the pen start on the baseline, s — px per unit
export function fillGlyph(ctx, item, ox, oy, s, color) {
  const { glyph, kx, ky, dx, dy, name, adv } = item;
  if (!glyph.path || !glyph.path.commands.length) {
    if (name === '.notdef' || !glyph.unicode) {
      // empty box for a missing character
      ctx.save();
      ctx.strokeStyle = 'rgba(179,64,42,.55)';
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(ox + 2, oy - 0.6 * adv * s, Math.max(4, adv * s - 4), 0.6 * adv * s);
      ctx.restore();
    }
    return;
  }
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, -s);
  ctx.fillStyle = color;
  const p2d = glyphPath2D(glyph, kx, ky, dx, dy);
  ctx.fill(p2d);
  // live weight preview: stroke the same path on top (real geometry is built on export)
  const w = item.w | 0;
  if (w) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (w > 0) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.stroke(p2d);
    } else {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = -w;
      ctx.stroke(p2d);
    }
  }
  ctx.restore();
}

// Estimated stroke thickness in units: 2 * |net area| / outline length.
// Net area under nonzero winding subtracts the counters, so the ratio
// approximates the average stroke width of a letterform.
export function strokeWeightEst(name) {
  const g = state.nameMap[name];
  if (!g || !g.path || !g.path.commands.length) return null;
  const p = paramsFor(name);
  let area = 0, len = 0;
  let sx = 0, sy = 0, lx = 0, ly = 0, has = false;
  const seg = (x, y) => {
    area += (lx * y - x * ly) / 2;
    len += Math.hypot(x - lx, y - ly);
    lx = x; ly = y;
  };
  const tx = c => c * p.kx, ty = c => c * p.ky;
  for (const c of g.path.commands) {
    if (c.type === 'M') {
      if (has) seg(sx, sy);
      lx = sx = tx(c.x); ly = sy = ty(c.y); has = true;
    } else if (c.type === 'L') {
      seg(tx(c.x), ty(c.y));
    } else if (c.type === 'Q') {
      const x0 = lx, y0 = ly;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, mt = 1 - t;
        seg(mt * mt * x0 + 2 * mt * t * tx(c.x1) + t * t * tx(c.x),
            mt * mt * y0 + 2 * mt * t * ty(c.y1) + t * t * ty(c.y));
      }
    } else if (c.type === 'C') {
      const x0 = lx, y0 = ly;
      for (let i = 1; i <= 12; i++) {
        const t = i / 12, mt = 1 - t;
        seg(mt ** 3 * x0 + 3 * mt * mt * t * tx(c.x1) + 3 * mt * t * t * tx(c.x2) + t ** 3 * tx(c.x),
            mt ** 3 * y0 + 3 * mt * mt * t * ty(c.y1) + 3 * mt * t * t * ty(c.y2) + t ** 3 * ty(c.y));
      }
    } else if (c.type === 'Z') {
      seg(sx, sy);
    }
  }
  if (has) seg(sx, sy);
  if (len < 1) return null;
  return Math.abs(area) * 2 / len;
}

// Selection highlight: advance frame, glyph bearings (green = air,
// red = overlap/negative) and kerning bands (blue = plus, red = minus)
export function drawSelOverlay(ctx, items, gaps, sel, ox, s, by, asc, desc) {
  if (!sel) return;
  const top = by - asc * s;
  const h = (asc - desc) * s;
  const TEAL = 'rgba(46,125,107,.22)';
  const RED = 'rgba(179,64,42,.20)';
  const BLUE = 'rgba(59,91,140,.22)';
  const band = (xa, xb, pos, neg) => {
    if (Math.abs(xb - xa) < 0.5) return;
    ctx.fillStyle = xb >= xa ? pos : neg;
    ctx.fillRect(Math.min(xa, xb), top, Math.abs(xb - xa), h);
  };

  if (sel.type === 'glyph') {
    for (const it of items) {
      if (it.name !== sel.name) continue;
      const x0 = ox + it.pen * s;
      const x1 = x0 + it.adv * s;
      ctx.fillStyle = 'rgba(179,64,42,.07)';
      ctx.fillRect(x0, top, Math.max(1, x1 - x0), h);
      const b = unitBox(it.name);
      if (b) {
        const lsb = Math.round(b.x1 * it.kx) + it.dx;
        const rsb = it.adv - (Math.round(b.x2 * it.kx) + it.dx);
        band(x0, x0 + lsb * s, TEAL, RED);
        band(x1 - rsb * s, x1, TEAL, RED);
      }
      ctx.strokeStyle = 'rgba(179,64,42,.55)';
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(top) + 0.5, Math.max(1, x1 - x0) - 1, h - 1);
    }
    for (const g of gaps) {
      if (g.kern && (g.left === sel.name || g.right === sel.name)) {
        band(g.x - g.kern * s / 2, g.x + g.kern * s / 2, BLUE, RED);
      }
    }
  } else if (sel.type === 'pair') {
    for (const g of gaps) {
      if (g.left !== sel.left || g.right !== sel.right) continue;
      const li = items[g.j - 1];
      const ri = items[g.j];
      if (li) {
        const b = unitBox(li.name);
        if (b) {
          const rsb = li.adv - (Math.round(b.x2 * li.kx) + li.dx);
          const xe = ox + (li.pen + li.adv) * s;
          band(xe - rsb * s, xe, TEAL, RED);
        }
      }
      if (ri) {
        const b = unitBox(ri.name);
        if (b) {
          const lsb = Math.round(b.x1 * ri.kx) + ri.dx;
          const xp = ox + ri.pen * s;
          band(xp, xp + lsb * s, TEAL, RED);
        }
      }
      band(g.x - g.kern * s / 2, g.x + g.kern * s / 2, BLUE, RED);
      ctx.strokeStyle = 'rgba(59,91,140,.7)';
      ctx.beginPath();
      ctx.moveTo(Math.round(g.x) + 0.5, top);
      ctx.lineTo(Math.round(g.x) + 0.5, by - desc * s);
      ctx.stroke();
    }
  }
}

export function setupCanvas(cv, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  // canvas limit in physical pixels: browsers break above ~16384
  const MAX = 16000;
  cssW = Math.min(cssW, Math.floor(MAX / dpr));
  cssH = Math.min(cssH, Math.floor(MAX / dpr));
  cv.width = Math.round(cssW * dpr);
  cv.height = Math.round(cssH * dpr);
  cv.style.width = cssW + 'px';
  cv.style.height = cssH + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
