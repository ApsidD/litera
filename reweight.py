"""Litera: change the stroke weight of a glyph outline.

Approach: rasterize the outline, grow/shrink the ink morphologically
(true Euclidean distance, so strokes thicken evenly in all directions),
then re-trace with potrace back into cubic curves.

Requires numpy, scipy, Pillow, svgpathtools and the `potrace` binary —
the same dependencies as the specimen sheet importer.
"""
import re
import subprocess
import tempfile
from pathlib import Path

SCL = 1.5          # raster pixels per font unit
MAX_SIDE = 4200    # raster safety cap


def _flatten(value):
    """Recorded pen commands -> list of closed contours as point lists (font units)."""
    contours, cur, start = [], [], None
    last = None

    def sample_quad(p0, p1, p2, n=8):
        pts = []
        for i in range(1, n + 1):
            t = i / n
            mt = 1 - t
            pts.append((mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
                        mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]))
        return pts

    def sample_cubic(p0, p1, p2, p3, n=12):
        pts = []
        for i in range(1, n + 1):
            t = i / n
            mt = 1 - t
            pts.append((mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0],
                        mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1]))
        return pts

    for op, pts in value:
        if op == "moveTo":
            if cur:
                contours.append(cur)
            cur = [pts[0]]
            start = pts[0]
            last = pts[0]
        elif op == "lineTo":
            cur.append(pts[0])
            last = pts[0]
        elif op == "curveTo":
            cur += sample_cubic(last, pts[0], pts[1], pts[2])
            last = pts[2]
        elif op == "qCurveTo":
            # TrueType: a run of off-curve points with implied on-curve midpoints;
            # the final point is on-curve (or None for a fully off-curve contour)
            seq = list(pts)
            if seq[-1] is None:
                seq[-1] = ((seq[0][0] + last[0]) / 2, (seq[0][1] + last[1]) / 2)
            p0 = last
            offs = seq[:-1]
            end = seq[-1]
            for i, off in enumerate(offs):
                if i < len(offs) - 1:
                    nxt = offs[i + 1]
                    mid = ((off[0] + nxt[0]) / 2, (off[1] + nxt[1]) / 2)
                else:
                    mid = end
                cur += sample_quad(p0, off, mid)
                p0 = mid
            last = end
        elif op == "closePath" or op == "endPath":
            if cur:
                if start and (cur[-1] != start):
                    cur.append(start)
                contours.append(cur)
                cur = []
    if cur:
        contours.append(cur)
    return [c for c in contours if len(c) >= 3]


def _signed_area(c):
    s = 0.0
    for i in range(len(c)):
        x0, y0 = c[i]
        x1, y1 = c[(i + 1) % len(c)]
        s += x0 * y1 - x1 * y0
    return s / 2


def reweight_record(value, w_units):
    """Take recorded (decomposed) pen commands, return new CUBIC commands
    with the stroke weight changed by w_units (positive = bolder)."""
    import numpy as np
    from PIL import Image, ImageDraw
    from scipy import ndimage
    from svgpathtools import parse_path, Line, CubicBezier, QuadraticBezier

    contours = _flatten(value)
    if not contours:
        return value

    xs = [p[0] for c in contours for p in c]
    ys = [p[1] for c in contours for p in c]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    pad_u = abs(w_units) / 2 + 24
    W = int((maxx - minx + 2 * pad_u) * SCL) + 2
    H = int((maxy - miny + 2 * pad_u) * SCL) + 2
    if max(W, H) > MAX_SIDE:
        raise RuntimeError("glyph too large to reweight")

    def to_px(p):
        return ((p[0] - minx + pad_u) * SCL, (maxy - p[1] + pad_u) * SCL)

    # fill with nonzero-ish winding: positive contours add ink, negative cut holes
    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    ordered = sorted(contours, key=lambda c: -abs(_signed_area(c)))
    base_sign = 1 if _signed_area(ordered[0]) > 0 else -1
    for c in ordered:
        fill = 255 if (_signed_area(c) > 0) == (base_sign > 0) else 0
        d.polygon([to_px(p) for p in c], fill=fill)
    ink = np.array(img) > 127

    r = abs(w_units) / 2 * SCL
    if r >= 0.5:
        if w_units > 0:
            dt = ndimage.distance_transform_edt(~ink)
            ink = ink | (dt <= r)
        else:
            dt = ndimage.distance_transform_edt(ink)
            ink = dt > r
    if not ink.any():
        return value  # thinned to nothing: keep the original

    with tempfile.TemporaryDirectory() as td:
        pbm = Path(td) / "g.pbm"
        svgf = Path(td) / "g.svg"
        Image.fromarray((~ink).astype("uint8") * 255).convert("1").save(pbm)
        subprocess.run(["potrace", str(pbm), "-s", "-o", str(svgf),
                        "-t", "6", "-O", "0.3", "-u", "50"], check=True)
        svg = svgf.read_text()

    m = re.search(r'transform="translate\(([-\d.]+),([-\d.]+)\) scale\(([-\d.]+),([-\d.]+)\)"', svg)
    tx, ty, sx, sy = map(float, m.groups())

    def to_units(z):
        px = tx + sx * z.real
        py = ty + sy * z.imag
        return (px / SCL + minx - pad_u, maxy + pad_u - py / SCL)

    out = []
    for dstr in re.findall(r'<path d="([^"]+)"', svg):
        for subp in parse_path(dstr).continuous_subpaths():
            first = True
            for s in subp:
                if first:
                    out.append(("moveTo", (to_units(s.start),)))
                    first = False
                if isinstance(s, Line):
                    out.append(("lineTo", (to_units(s.end),)))
                elif isinstance(s, CubicBezier):
                    out.append(("curveTo", (to_units(s.control1), to_units(s.control2), to_units(s.end))))
                elif isinstance(s, QuadraticBezier):
                    out.append(("qCurveTo", (to_units(s.control), to_units(s.end))))
            out.append(("closePath", ()))
    return out
