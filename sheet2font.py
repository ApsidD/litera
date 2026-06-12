#!/usr/bin/env python3
"""Litera: turn a specimen sheet image (black characters on white) into a TTF.

The sheet must contain the characters in reading order: row by row, left to right.
Adjacent characters must not touch. Multi-part characters (i, j, :, ;, !, ?, ", =, %)
are merged automatically.

Dependencies: numpy, scipy, Pillow, svgpathtools, fontTools, and the `potrace` binary.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from svgpathtools import parse_path, Line, CubicBezier, QuadraticBezier
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen

UPEM = 1000
CAP_TARGET = 700
X_TARGET = 480

NAMES = {".": "period", ",": "comma", ":": "colon", ";": "semicolon", "-": "hyphen",
         "—": "emdash", "'": "quoteright", '"': "quotedbl", "!": "exclam", "?": "question",
         "&": "ampersand", "(": "parenleft", ")": "parenright", "/": "slash",
         "[": "bracketleft", "]": "bracketright", "*": "asterisk", "+": "plus",
         "<": "less", "=": "equal", ">": "greater", "#": "numbersign", "$": "dollar",
         "%": "percent", "@": "at", "_": "underscore",
         "€": "Euro", "₽": "uni20BD", "№": "uni2116"}
for d in "0123456789":
    NAMES[d] = ["zero", "one", "two", "three", "four", "five",
                "six", "seven", "eight", "nine"][int(d)]
CMAP_EXTRA = {"'": [0x27, 0x2019], "—": [0x2014, 0x2013], '"': [0x22, 0x201D, 0x201C],
              "€": [0x20AC], "₽": [0x20BD], "№": [0x2116]}

# characters that sit on the baseline (used as per-row baseline anchors)
BASELINE_CHARS = set("ABCDEFGHIKLMNOPRSTUVWXYZ") | set("abcdehiklmnorstuvwxz") \
    | set("01234568") | set(".:!?&#$%€₽№")
# characters with a known descent below the baseline (fallback anchors)
ANCHOR_OFF = {"(": -160, ")": -160, "[": -150, "]": -150}
X_ANCHORS = set("acemnorsuvwxz")
CAP_ANCHORS = set("ABCDEFGHIKLMNOPRSTUVWXYZ")


def segment(path, threshold):
    arr = np.array(Image.open(path).convert("L"))
    W = arr.shape[1]
    F = W / 2880.0
    mask = arr < threshold
    lab, _ = ndimage.label(mask)
    objs = ndimage.find_objects(lab)
    comps = []
    for i, sl in enumerate(objs, 1):
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if h * w < 140 * F * F:
            continue
        comps.append({"ids": {i}, "y0": sl[0].start, "y1": sl[0].stop,
                      "x0": sl[1].start, "x1": sl[1].stop})
    if not comps:
        raise RuntimeError("no characters found: image too light or threshold too low")

    rowmask = mask.any(axis=1)
    bands, y, H = [], 0, len(rowmask)
    while y < H:
        if rowmask[y]:
            y0 = y
            while y < H and rowmask[y]:
                y += 1
            bands.append((y0, y))
        else:
            y += 1
    med_h = float(np.median([b1 - b0 for b0, b1 in bands]))
    mb = [bands[0]]
    for b0, b1 in bands[1:]:
        if (b1 - b0) < 0.45 * med_h and b0 - mb[-1][1] < 0.3 * med_h:
            mb[-1] = (mb[-1][0], b1)
        else:
            mb.append((b0, b1))
    bands = mb

    rows = [[] for _ in bands]
    for c in comps:
        cy = (c["y0"] + c["y1"]) / 2
        for ri, (b0, b1) in enumerate(bands):
            if b0 - 5 <= cy <= b1 + 5:
                rows[ri].append(c)
                break
        else:
            raise RuntimeError("component outside row bands")
    rows = [r for r in rows if r]

    ordered = []
    for r in rows:
        r.sort(key=lambda c: c["x0"])
        merged = [r[0]]
        for c in r[1:]:
            p = merged[-1]
            ov = min(p["x1"], c["x1"]) - max(p["x0"], c["x0"])
            yov = min(p["y1"], c["y1"]) - max(p["y0"], c["y0"])
            wmin = min(p["x1"] - p["x0"], c["x1"] - c["x0"])
            near = (-ov) < 38 * F and wmin < 48 * F \
                and yov > 0.5 * min(p["y1"] - p["y0"], c["y1"] - c["y0"])
            stack = abs((p["x0"] + p["x1"]) - (c["x0"] + c["x1"])) / 2 < 46 * F \
                and (-yov) < 170 * F
            if ov > 0.05 * wmin or near or stack:
                p["ids"] |= c["ids"]
                p["x0"] = min(p["x0"], c["x0"]); p["x1"] = max(p["x1"], c["x1"])
                p["y0"] = min(p["y0"], c["y0"]); p["y1"] = max(p["y1"], c["y1"])
            else:
                merged.append(c)
        ordered.append(merged)
    return lab, ordered


def trace(lab, c, tmpdir, pad=8):
    sub = lab[max(0, c["y0"] - pad):c["y1"] + pad, max(0, c["x0"] - pad):c["x1"] + pad]
    crop = np.isin(sub, list(c["ids"]))
    pbm = tmpdir / "_g.pbm"
    svgf = tmpdir / "_g.svg"
    Image.fromarray((~crop).astype(np.uint8) * 255).convert("1").save(pbm)
    subprocess.run(["potrace", str(pbm), "-s", "-o", str(svgf),
                    "-t", "6", "-O", "0.3", "-u", "50"], check=True)
    svg = svgf.read_text()
    m = re.search(r'transform="translate\(([-\d.]+),([-\d.]+)\) scale\(([-\d.]+),([-\d.]+)\)"', svg)
    tx, ty, sx, sy = map(float, m.groups())
    ox, oy = max(0, c["x0"] - pad), max(0, c["y0"] - pad)

    def tf(z):
        return complex(ox + tx + sx * z.real, oy + ty + sy * z.imag)

    out = []
    for d in re.findall(r'<path d="([^"]+)"', svg):
        for subp in parse_path(d).continuous_subpaths():
            segs = []
            for s in subp:
                if isinstance(s, Line):
                    segs.append(("L", tf(s.start), tf(s.end)))
                elif isinstance(s, CubicBezier):
                    segs.append(("C", tf(s.start), tf(s.control1), tf(s.control2), tf(s.end)))
                elif isinstance(s, QuadraticBezier):
                    segs.append(("Q", tf(s.start), tf(s.control), tf(s.end)))
            out.append(segs)
    return out


def build(image, out, name, chars, threshold, italic):
    lab, rows = segment(image, threshold)
    flat = [c for r in rows for c in r]
    counts = [len(r) for r in rows]
    if len(flat) != len(chars):
        raise RuntimeError(
            f"found {len(flat)} characters on the sheet (rows: {counts}), "
            f"but the character set has {len(chars)}. "
            "Check the sheet for touching or missing characters, or adjust the threshold.")
    for c, ch in zip(flat, chars):
        c["ch"] = ch

    charset = set(chars)
    use_x = len(X_ANCHORS & charset) >= 4
    scale_anchors = (X_ANCHORS if use_x else CAP_ANCHORS) & charset
    scale_target = X_TARGET if use_x else CAP_TARGET
    if not scale_anchors:
        scale_anchors = {chars[0]}
        scale_target = CAP_TARGET

    pre = []
    for r in rows:
        ab = [c["y1"] for c in r if c["ch"] in BASELINE_CHARS]
        a0 = [c for c in r if c["ch"] in scale_anchors and c["ch"] in BASELINE_CHARS]
        if ab:
            bl = float(np.median(ab))
            pre += [bl - c["y0"] for c in a0]
    if not pre:
        pre = [max(c["y1"] - c["y0"] for c in flat)]
    S = scale_target / float(np.median(pre))

    for r in rows:
        ab = [c["y1"] for c in r if c["ch"] in BASELINE_CHARS]
        if ab:
            bl = float(np.median(ab))
        else:
            est = [c["y1"] + ANCHOR_OFF[c["ch"]] / S for c in r if c["ch"] in ANCHOR_OFF]
            bl = float(np.median(est)) if est else float(np.median([c["y1"] for c in r]))
        for c in r:
            c["baseline"] = bl

    LSB = 42
    glyphs, advances, cmap, order = {}, {}, {0x20: "space"}, [".notdef", "space"]
    p = TTGlyphPen(None); glyphs[".notdef"] = p.glyph(); advances[".notdef"] = (500, 0)
    p = TTGlyphPen(None); glyphs["space"] = p.glyph(); advances["space"] = (330, 0)

    with tempfile.TemporaryDirectory() as td:
        tmpdir = Path(td)
        for c in flat:
            subs = trace(lab, c, tmpdir)
            tt = TTGlyphPen(None)
            pen = Cu2QuPen(tt, max_err=1.0)

            def fu(z, c=c):
                return (round((z.real - c["x0"]) * S + LSB),
                        round((c["baseline"] - z.imag) * S))

            for segs in subs:
                pen.moveTo(fu(segs[0][1]))
                for s in segs:
                    if s[0] == "L":
                        pen.lineTo(fu(s[2]))
                    elif s[0] == "C":
                        pen.curveTo(fu(s[2]), fu(s[3]), fu(s[4]))
                    elif s[0] == "Q":
                        pen.qCurveTo(fu(s[2]), fu(s[3]))
                pen.closePath()
            gname = NAMES.get(c["ch"], c["ch"])
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9._]*", gname):
                gname = "uni%04X" % ord(c["ch"])
            glyphs[gname] = tt.glyph()
            advances[gname] = (round((c["x1"] - c["x0"]) * S + 2 * LSB), LSB)
            order.append(gname)
            for cp in CMAP_EXTRA.get(c["ch"], [ord(c["ch"])]):
                cmap[cp] = gname

    # if the set has capitals but no lowercase, map lowercase keys to capitals
    if not (set("abcdefghijklmnopqrstuvwxyz") & charset):
        for ch in "abcdefghijklmnopqrstuvwxyz":
            if ch.upper() in charset:
                cmap[ord(ch)] = ch.upper()

    ps = re.sub(r"[^A-Za-z0-9]", "", name) or "Litera"
    fb = FontBuilder(UPEM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(advances)
    fb.setupHorizontalHeader(ascent=900, descent=-320)
    fb.setupOS2(sTypoAscender=900, sTypoDescender=-320, sCapHeight=CAP_TARGET,
                sxHeight=X_TARGET, usWinAscent=1000, usWinDescent=400)
    fb.setupNameTable({"familyName": name, "styleName": "Regular",
                       "fullName": name, "psName": f"{ps}-Regular",
                       "version": "Version 1.0"})
    fb.setupPost(italicAngle=float(italic))
    fb.save(out)

    # seat special characters at typographic norms
    from fontTools.ttLib import TTFont
    tt2 = TTFont(out)
    g = tt2["glyf"]

    def snap(gname, mode, target):
        if gname not in g or g[gname].numberOfContours <= 0:
            return
        gl = g[gname]
        if mode == "ymin":
            dy = target - gl.yMin
        elif mode == "ymax":
            dy = target - gl.yMax
        else:
            dy = target - (gl.yMin + gl.yMax) / 2
        if abs(dy) > 2:
            gl.coordinates.translate((0, round(dy)))
            gl.recalcBounds(g)

    mid = (X_TARGET // 2 + 15) if use_x else (CAP_TARGET // 2 - 50)
    for n in ["plus", "less", "equal", "greater"]:
        snap(n, "mid", mid)
    snap("hyphen", "mid", mid)
    snap("emdash", "mid", mid)
    snap("asterisk", "ymax", 690)
    snap("quoteright", "ymax", 690)
    snap("quotedbl", "ymax", 690)
    snap("underscore", "ymax", -60)
    snap("period", "ymin", 0)
    snap("colon", "ymin", 0)
    tt2.save(out)

    return {"glyphs": len(order), "rows": counts, "scale": round(S, 4),
            "metric": "x-height" if use_x else "cap-height"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--name", default="MyFont")
    ap.add_argument("--chars", required=True,
                    help="characters in sheet reading order, as one string")
    ap.add_argument("--threshold", type=int, default=140)
    ap.add_argument("--italic", type=float, default=0.0)
    args = ap.parse_args()
    try:
        info = build(args.image, args.out, args.name, list(args.chars),
                     args.threshold, args.italic)
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(2)
    print(json.dumps(info))


if __name__ == "__main__":
    main()
