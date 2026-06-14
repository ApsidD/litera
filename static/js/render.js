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
    wh: e.wh == null ? (e.w | 0) : (e.wh | 0),
    wv: e.wv == null ? (e.w | 0) : (e.wv | 0),
  };
}

export function effAdvance(glyph) {
  const p = paramsFor(glyph.name);
  const t = state.edits.global.tracking | 0;
  return Math.max(0, Math.round((glyph.advanceWidth || 0) * p.kx) + p.dadv + t + p.wh);
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
  const p2d = glyphPath2D(glyph, kx, ky, dx, dy);
  const wh = item.wh | 0, wv = item.wv | 0;

  // No weight change: straight fill, the common fast path.
  if (!wh && !wv) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, -s);
    ctx.fillStyle = color;
    ctx.fill(p2d);
    ctx.restore();
    return;
  }

  // Weight preview. Thickening (positive) just fills + strokes in the same
  // colour, which is clean. Thinning (negative) must erase part of the edge;
  // a destination-out stroke drawn straight onto the main canvas leaves an
  // antialiased halo (the translucent outline bug). To avoid it we render the
  // glyph on an opaque offscreen buffer and snap its alpha to 0/255 before
  // compositing, so no partial-alpha fringe survives. The buffer is reused.
  const hasNeg = wh < 0 || wv < 0;
  if (!hasNeg) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, -s);
    ctx.fillStyle = color;
    ctx.fill(p2d);
    strokeWeight(ctx, p2d, wh, wv, color);
    ctx.restore();
    return;
  }

  const b = glyph.path.getBoundingBox();
  const pad = Math.max(Math.abs(wh), Math.abs(wv)) * s + 4;
  const xa = ox + b.x1 * kx * s, xb = ox + b.x2 * kx * s;
  const ya = oy - b.y2 * ky * s, yb = oy - b.y1 * ky * s;
  const left = Math.floor(Math.min(xa, xb) - pad);
  const top = Math.floor(Math.min(ya, yb) - pad);
  const bw = Math.ceil(Math.max(xa, xb) + pad) - left;
  const bh = Math.ceil(Math.max(ya, yb) + pad) - top;
  if (bw <= 0 || bh <= 0 || bw > 3000 || bh > 3000) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, -s);
    ctx.fillStyle = color;
    ctx.fill(p2d);
    ctx.restore();
    return;
  }

  const c = weightCtx(bw, bh);
  c.save();
  c.translate(ox - left, oy - top);
  c.scale(s, -s);
  c.fillStyle = color;
  c.fill(p2d);
  strokeWeight(c, p2d, wh, wv, color);
  c.restore();

  const cn = c.canvas;
  const img = c.getImageData(0, 0, cn.width, cn.height);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 150 ? 255 : 0;
  c.putImageData(img, 0, 0);
  ctx.drawImage(cn, left, top);
}

// Stroke a glyph path to add/remove weight. Positive = same-colour stroke
// (thicker), negative = destination-out (thinner). Anisotropy is approximated
// by stroking each axis with a pen squashed on the perpendicular axis.
function strokeWeight(c, p2d, wh, wv, color) {
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const oneStroke = (amount, sxScale, syScale) => {
    if (!amount) return;
    c.save();
    if (amount < 0) c.globalCompositeOperation = 'destination-out';
    else c.strokeStyle = color;
    c.scale(sxScale, syScale);
    c.lineWidth = Math.abs(amount) / Math.max(sxScale, syScale);
    c.stroke(p2d);
    c.restore();
  };
  if (wh === wv) {
    oneStroke(wh, 1, 1);                 // isotropic round pen
  } else {
    if (wh) oneStroke(wh, 1, 0.2);       // grow stems: wide, short pen
    if (wv) oneStroke(wv, 0.2, 1);       // grow bars: narrow, tall pen
  }
}

let _wc = null;
function weightCtx(w, h) {
  if (!_wc) _wc = document.createElement('canvas').getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  _wc.canvas.width = Math.round(w * dpr);
  _wc.canvas.height = Math.round(h * dpr);
  _wc.setTransform(dpr, 0, 0, dpr, 0, 0);
  _wc.clearRect(0, 0, w, h);
  return _wc;
}

// Estimated stroke thickness in units: 2 * |net area| / outline length.
// Net area under nonzero winding subtracts the counters, so the ratio
// approximates the average stroke width of a letterform.
export function strokeWeightEst(name, axis) {
  // axis: undefined = overall; 'h' = horizontal weight (stem thickness,
  // estimated from vertical edge travel); 'v' = vertical weight (bar
  // thickness, from horizontal edge travel).
  const g = state.nameMap[name];
  if (!g || !g.path || !g.path.commands.length) return null;
  const p = paramsFor(name);
  let area = 0, len = 0, lenH = 0, lenV = 0;
  let sx = 0, sy = 0, lx = 0, ly = 0, has = false;
  const seg = (x, y) => {
    area += (lx * y - x * ly) / 2;
    const dx = x - lx, dy = y - ly;
    len += Math.hypot(dx, dy);
    lenH += Math.abs(dx);  // horizontal travel ~ tops/bottoms of bars
    lenV += Math.abs(dy);  // vertical travel ~ sides of stems
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
  const A = Math.abs(area);
  // stem thickness ~ area / vertical edge length; bar thickness ~ area /
  // horizontal edge length. The /2 keeps these comparable to the overall est.
  if (axis === 'h') return lenV > 1 ? A / lenV : null;
  if (axis === 'v') return lenH > 1 ? A / lenH : null;
  return A * 2 / len;
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
