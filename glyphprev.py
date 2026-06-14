#!/usr/bin/env python3
"""Litera: render a single glyph to a transparent PNG with edits applied,
using the exact same geometry path as export (including true anisotropic
reweighting). Used by the zoom view to show a faithful weight preview.

Output: writes a PNG to --out and prints one JSON line with the placement
metrics the client needs to overlay it on the guides:
  {"ok":1,"px_per_unit":P,"x_units":X,"adv":A,"box":[x1,y1,x2,y2]}
where the PNG's left edge maps to x_units (in font units, may be negative,
i.e. left of the pen origin) and its top maps to the glyph's yMax.
"""
import argparse
import json
import sys

from fontTools.ttLib import TTFont
from fontTools.misc.roundTools import otRound
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen


def transform_record(value, kx, ky, dx, dy):
    out = []
    for op, pts in value:
        npts = []
        for p in pts:
            if p is None:
                npts.append(None)
            elif isinstance(p, tuple):
                npts.append((p[0] * kx + dx, p[1] * ky + dy))
            else:
                npts.append(p)
        out.append((op, tuple(npts)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", required=True)
    ap.add_argument("--glyph", required=True, help="glyph name")
    ap.add_argument("--edits", required=True, help="JSON file with the edit layer")
    ap.add_argument("--out", required=True)
    ap.add_argument("--ppu", type=float, default=0.6, help="pixels per font unit")
    args = ap.parse_args()

    import numpy as np
    from PIL import Image
    from fontTools.pens.basePen import BasePen

    edits = json.loads(open(args.edits, encoding="utf-8").read())
    g_all = edits.get("global", {}) or {}
    per = (edits.get("glyphs", {}) or {}).get(args.glyph, {}) or {}

    S = float(g_all.get("scale", 1.0) or 1.0)
    u = S * float(per.get("s", 1.0) or 1.0)
    kx = u * float(per.get("sx", 1.0) or 1.0)
    ky = u * float(per.get("sy", 1.0) or 1.0)
    dx = int(per.get("dx", 0) or 0)
    dy = int(per.get("dy", 0) or 0)
    w_legacy = int(per.get("w", 0) or 0)
    wh = int(per.get("wh", w_legacy) or 0)
    wv = int(per.get("wv", w_legacy) or 0)

    font = TTFont(args.font)
    if "glyf" not in font and ("CFF " in font or "CFF2" in font):
        from fontops import otf_to_ttf
        otf_to_ttf(font)
    glyph_set = font.getGlyphSet()
    if args.glyph not in font.getGlyphOrder():
        print(json.dumps({"ok": 0, "error": "no such glyph"}))
        sys.exit(1)

    rec = DecomposingRecordingPen(glyph_set)
    glyph_set[args.glyph].draw(rec)
    value = rec.value
    if wh or wv:
        from reweight import reweight_record
        value = reweight_record(value, wh, wv)
    value = transform_record(value, kx, ky, dx, dy)

    # flatten to polygons and rasterize via PIL
    from PIL import ImageDraw

    def flatten(value):
        contours, cur, last, start = [], [], None, None

        def quad(p0, p1, p2, n=10):
            return [(((1-t)**2)*p0[0] + 2*(1-t)*t*p1[0] + t*t*p2[0],
                     ((1-t)**2)*p0[1] + 2*(1-t)*t*p1[1] + t*t*p2[1])
                    for t in [i/n for i in range(1, n+1)]]

        def cubic(p0, p1, p2, p3, n=14):
            return [(((1-t)**3)*p0[0] + 3*((1-t)**2)*t*p1[0] + 3*(1-t)*t*t*p2[0] + t**3*p3[0],
                     ((1-t)**3)*p0[1] + 3*((1-t)**2)*t*p1[1] + 3*(1-t)*t*t*p2[1] + t**3*p3[1])
                    for t in [i/n for i in range(1, n+1)]]

        for op, pts in value:
            if op == "moveTo":
                if cur:
                    contours.append(cur)
                cur = [pts[0]]; last = pts[0]; start = pts[0]
            elif op == "lineTo":
                cur.append(pts[0]); last = pts[0]
            elif op == "curveTo":
                cur += cubic(last, pts[0], pts[1], pts[2]); last = pts[2]
            elif op == "qCurveTo":
                seq = list(pts)
                if seq[-1] is None:
                    seq[-1] = ((seq[0][0]+last[0])/2, (seq[0][1]+last[1])/2)
                p0 = last
                offs, end = seq[:-1], seq[-1]
                for i, off in enumerate(offs):
                    mid = end if i == len(offs)-1 else ((off[0]+offs[i+1][0])/2, (off[1]+offs[i+1][1])/2)
                    cur += quad(p0, off, mid); p0 = mid
                last = end
            elif op in ("closePath", "endPath"):
                if cur:
                    contours.append(cur); cur = []
        if cur:
            contours.append(cur)
        return [c for c in contours if len(c) >= 3]

    contours = flatten(value)
    if not contours:
        print(json.dumps({"ok": 0, "error": "empty glyph"}))
        sys.exit(1)

    xs = [p[0] for c in contours for p in c]
    ys = [p[1] for c in contours for p in c]
    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)

    P = args.ppu
    pad = 2
    W = int((x2 - x1) * P) + 2 * pad
    H = int((y2 - y1) * P) + 2 * pad
    if W <= 0 or H <= 0 or W > 4000 or H > 4000:
        print(json.dumps({"ok": 0, "error": "bad size"}))
        sys.exit(1)

    # supersample for clean edges
    SS = 3
    img = Image.new("L", (W * SS, H * SS), 0)
    d = ImageDraw.Draw(img)

    def to_px(p):
        return ((p[0] - x1) * P * SS + pad * SS, (y2 - p[1]) * P * SS + pad * SS)

    # Even-odd fill done correctly: paint each contour onto its own mask and
    # XOR them together, so nested contours carve holes regardless of winding.
    acc = None
    for c in contours:
        layer = Image.new("L", (W * SS, H * SS), 0)
        ImageDraw.Draw(layer).polygon([to_px(p) for p in c], fill=255)
        if acc is None:
            acc = layer
        else:
            acc = Image.fromarray((np.array(acc) ^ np.array(layer)).astype(np.uint8))
    img = acc if acc is not None else img

    img = img.resize((W, H), Image.LANCZOS)
    arr = np.array(img)
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    rgba[..., 0] = 0x1F
    rgba[..., 1] = 0x1D
    rgba[..., 2] = 0x1A
    rgba[..., 3] = arr
    Image.fromarray(rgba, "RGBA").save(args.out)

    print(json.dumps({
        "ok": 1,
        "px_per_unit": P,
        "x_units": x1,
        "y_top_units": y2,
        "pad_px": pad,
        "adv": max(0, otRound(font["hmtx"][args.glyph][0] * kx) + dx
                   + int(g_all.get("tracking", 0) or 0) + wh),
        "box": [x1, y1, x2, y2],
    }))


if __name__ == "__main__":
    main()
