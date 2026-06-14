// Litera: client-side stroke weighting that matches the server engine, as a
// raster. We rebuild the weighted glyph the way export does — outline -> fill
// -> grow/shrink the ink with an elliptical Euclidean distance (rx from wh,
// ry from wv) — but stop at the raster and hand back an ImageBitmap-like canvas
// the callers blit to screen. No contour re-tracing: for a live *preview* the
// pixels are what we want, and this stays fast enough for per-frame dragging.
//
// The returned object places the raster in font-unit space so callers can blit
// it under the same transform as a filled glyph:
//   { canvas, minx, maxy, res }  -> screen: drawImage scaled by (s/res),
//   left = ox + minx*s, top = by - maxy*s   (y flips inside).

const cache = new Map();
const MAX_CACHE = 240;
const RES = 0.4;    // raster px per font unit
const PADU = 24;    // unit padding around the glyph for the grown ink

function sig(name, wh, wv, kx, ky, color) {
  return `${name}|${wh}|${wv}|${kx.toFixed(3)}|${ky.toFixed(3)}|${color}`;
}

function flatten(glyph, kx, ky) {
  const contours = [];
  let cur = null, lx = 0, ly = 0, sx = 0, sy = 0;
  const X = v => v * kx, Y = v => v * ky;
  const quad = (x0, y0, x1, y1, x2, y2) => {
    for (let i = 1; i <= 10; i++) {
      const t = i / 10, mt = 1 - t;
      cur.push([mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
                mt * mt * y0 + 2 * mt * t * y1 + t * t * y2]);
    }
  };
  const cubic = (x0, y0, x1, y1, x2, y2, x3, y3) => {
    for (let i = 1; i <= 14; i++) {
      const t = i / 14, mt = 1 - t;
      cur.push([mt ** 3 * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t ** 3 * x3,
                mt ** 3 * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t ** 3 * y3]);
    }
  };
  for (const cmd of glyph.path.commands) {
    if (cmd.type === 'M') {
      if (cur && cur.length >= 3) contours.push(cur);
      cur = [[X(cmd.x), Y(cmd.y)]]; lx = X(cmd.x); ly = Y(cmd.y); sx = lx; sy = ly;
    } else if (cmd.type === 'L') {
      cur.push([X(cmd.x), Y(cmd.y)]); lx = X(cmd.x); ly = Y(cmd.y);
    } else if (cmd.type === 'Q') {
      quad(lx, ly, X(cmd.x1), Y(cmd.y1), X(cmd.x), Y(cmd.y)); lx = X(cmd.x); ly = Y(cmd.y);
    } else if (cmd.type === 'C') {
      cubic(lx, ly, X(cmd.x1), Y(cmd.y1), X(cmd.x2), Y(cmd.y2), X(cmd.x), Y(cmd.y)); lx = X(cmd.x); ly = Y(cmd.y);
    } else if (cmd.type === 'Z') {
      lx = sx; ly = sy;
    }
  }
  if (cur && cur.length >= 3) contours.push(cur);
  return contours;
}

// Grow (or shrink) a binary field along ONE axis by r pixels, using a 1D
// distance pass. Rectangular per-axis morphology: horizontal weight grows the
// field left/right (thickening vertical stems), vertical weight grows it
// up/down (thickening horizontal bars). This is robust and fast and matches
// the intent of the server's per-axis growth.

// nearest-distance along a 1D array of 0/1 (returns distance in cells to the
// closest 1). Two-pass O(n).
function dist1d(line, n, out) {
  let prev = 1e9;
  for (let i = 0; i < n; i++) {
    if (line[i]) prev = 0; else prev = prev + 1;
    out[i] = prev;
  }
  prev = 1e9;
  for (let i = n - 1; i >= 0; i--) {
    if (line[i]) prev = 0; else prev = prev + 1;
    if (prev < out[i]) out[i] = prev;
  }
}

// Grow/shrink along rows (x axis) by r px.
function morphX(field, W, H, r, isGrow) {
  const line = new Uint8Array(W);
  const dist = new Float64Array(W);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const base = y * W;
    for (let x = 0; x < W; x++) line[x] = isGrow ? (field[base + x] ? 0 : 1) : (field[base + x] ? 1 : 0);
    // for grow: distance to nearest INK (line marks non-ink as 1? no) -> compute
    // distance to nearest ink directly:
    for (let x = 0; x < W; x++) line[x] = field[base + x] ? 1 : 0;
    dist1d(line, W, dist);
    for (let x = 0; x < W; x++) {
      if (isGrow) out[base + x] = (field[base + x] || dist[x] <= r) ? 1 : 0;
      else out[base + x] = (field[base + x] && distToEdgeX(field, W, base, x) > r) ? 1 : 0;
    }
  }
  return out;
}

// distance from an ink pixel to the nearest non-ink along the row (for erosion)
function distToEdgeX(field, W, base, x) {
  let l = 0; for (let i = x; i >= 0 && field[base + i]; i--) l++;
  let rr = 0; for (let i = x; i < W && field[base + i]; i++) rr++;
  return Math.min(l, rr);
}

function morphY(field, W, H, r, isGrow) {
  const line = new Uint8Array(H);
  const dist = new Float64Array(H);
  const out = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) line[y] = field[y * W + x] ? 1 : 0;
    dist1d(line, H, dist);
    for (let y = 0; y < H; y++) {
      const i = y * W + x;
      if (isGrow) out[i] = (field[i] || dist[y] <= r) ? 1 : 0;
      else out[i] = (field[i] && distToEdgeY(field, W, H, x, y) > r) ? 1 : 0;
    }
  }
  return out;
}

function distToEdgeY(field, W, H, x, y) {
  let u = 0; for (let i = y; i >= 0 && field[i * W + x]; i--) u++;
  let d = 0; for (let i = y; i < H && field[i * W + x]; i++) d++;
  return Math.min(u, d);
}

// Returns { canvas, minx, maxy, res } or null. color is an 'rgb'/'#hex' string.
export function weightedRaster(glyph, kx, ky, wh, wv, name, color) {
  const key = sig(name, wh, wv, kx, ky, color);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const contours = flatten(glyph, kx, ky);
  if (!contours.length) { cache.set(key, null); return null; }

  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const c of contours) for (const p of c) {
    if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
  }
  const pad = Math.max(Math.abs(wh), Math.abs(wv)) / 2 + PADU;
  minx -= pad; miny -= pad; maxx += pad; maxy += pad;

  const W = Math.ceil((maxx - minx) * RES);
  const H = Math.ceil((maxy - miny) * RES);
  if (W < 4 || H < 4 || W > 1600 || H > 1600) { cache.set(key, null); return null; }

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff';
  c.beginPath();
  for (const poly of contours) {
    c.moveTo((poly[0][0] - minx) * RES, (maxy - poly[0][1]) * RES);
    for (let i = 1; i < poly.length; i++) c.lineTo((poly[i][0] - minx) * RES, (maxy - poly[i][1]) * RES);
    c.closePath();
  }
  c.fill('evenodd');

  const base = c.getImageData(0, 0, W, H).data;
  let ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) ink[i] = base[i * 4 + 3] > 100 ? 1 : 0;

  // per-axis growth/shrink. horizontal weight -> grow along X (stems),
  // vertical weight -> grow along Y (bars). Done independently per axis.
  const rxP = wh > 0 ? wh / 2 * RES : 0, ryP = wv > 0 ? wv / 2 * RES : 0;
  const rxN = wh < 0 ? -wh / 2 * RES : 0, ryN = wv < 0 ? -wv / 2 * RES : 0;
  if (rxP >= 0.5) ink = morphX(ink, W, H, rxP, true);
  if (ryP >= 0.5) ink = morphY(ink, W, H, ryP, true);
  if (rxN >= 0.5) ink = morphX(ink, W, H, rxN, false);
  if (ryN >= 0.5) ink = morphY(ink, W, H, ryN, false);

  // paint ink into an RGBA canvas with a 1px-ish antialiased edge from coverage
  const out = new ImageData(W, H);
  const od = out.data;
  const [cr, cg, cb] = parseColor(color);
  for (let i = 0; i < W * H; i++) {
    if (ink[i]) {
      od[i * 4] = cr; od[i * 4 + 1] = cg; od[i * 4 + 2] = cb; od[i * 4 + 3] = 255;
    }
  }
  const oc = document.createElement('canvas');
  oc.width = W; oc.height = H;
  oc.getContext('2d').putImageData(out, 0, 0);

  const res = { canvas: oc, minx, maxy, res: RES };
  if (cache.size > MAX_CACHE) cache.clear();
  cache.set(key, res);
  return res;
}

function parseColor(col) {
  if (col[0] === '#') {
    const h = col.slice(1);
    const n = h.length === 3
      ? [h[0] + h[0], h[1] + h[1], h[2] + h[2]]
      : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
    return n.map(x => parseInt(x, 16));
  }
  const m = col.match(/\d+/g);
  return m ? [+m[0], +m[1], +m[2]] : [31, 29, 26];
}

export function clearWeightCache() { cache.clear(); }
