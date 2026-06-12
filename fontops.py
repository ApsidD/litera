#!/usr/bin/env python3
"""Litera: applies a JSON layer of edits to a TTF and builds a new file.

Edits:
  global: scale, tracking, ascender, descender, lineGap, capHeight, xHeight
  glyphs: { name: {s, dx, dy, dadv} }   (s = scale, dx/dy = shift in units, dadv = advance delta)
  kerning: { "left right": value }      (units of the final font, GPOS kern)
"""
import argparse
import json
import sys

from fontTools.ttLib import TTFont
from fontTools.misc.roundTools import otRound
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString


def transform_record(value, kx, ky, dx, dy):
    """Transforms recorded pen commands: per-axis scale around (0,0), then shift. Rounds."""
    out = []
    for op, pts in value:
        npts = []
        for p in pts:
            if p is None:
                npts.append(None)
            elif isinstance(p, tuple):
                npts.append((otRound(p[0] * kx + dx), otRound(p[1] * ky + dy)))
            else:
                npts.append(p)
        out.append((op, tuple(npts)))
    return out




def otf_to_ttf(font, max_err=1.0):
    """Convert CFF/OTF outlines to quadratic glyf in place (port of the fontTools otf2ttf snippet)."""
    from fontTools.ttLib import newTable
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen as _TTGlyphPen

    glyph_order = font.getGlyphOrder()
    glyph_set = font.getGlyphSet()
    glyphs = {}
    for name in glyph_order:
        pen = _TTGlyphPen(glyph_set)
        cu2qu = Cu2QuPen(pen, max_err=max_err, reverse_direction=True)
        glyph_set[name].draw(cu2qu)
        glyphs[name] = pen.glyph()

    glyf = newTable("glyf")
    glyf.glyphOrder = glyph_order
    glyf.glyphs = glyphs
    font["loca"] = newTable("loca")
    font["glyf"] = glyf

    maxp = font["maxp"]
    maxp.tableVersion = 0x00010000
    for attr in ("maxPoints", "maxContours", "maxCompositePoints", "maxCompositeContours",
                 "maxComponentElements", "maxSizeOfInstructions"):
        setattr(maxp, attr, 0)
    maxp.maxZones = 1
    maxp.maxTwilightPoints = 0
    maxp.maxStorage = 0
    maxp.maxFunctionDefs = 0
    maxp.maxInstructionDefs = 0
    maxp.maxStackElements = 0
    maxp.maxComponentDepth = 0

    post = font["post"]
    post.formatType = 2.0
    post.extraNames = []
    post.mapping = {}
    post.glyphOrder = glyph_order

    for tag in ("CFF ", "CFF2", "VORG"):
        if tag in font:
            del font[tag]
    font["head"].glyphDataFormat = 0
    font.sfntVersion = "\x00\x01\x00\x00"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", required=True)
    ap.add_argument("--edits", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--format", default="ttf", choices=["ttf", "woff", "woff2"])
    args = ap.parse_args()

    edits = json.loads(open(args.edits, encoding="utf-8").read())
    g_all = edits.get("global", {}) or {}
    per_glyph = edits.get("glyphs", {}) or {}
    kerning = edits.get("kerning", {}) or {}

    S = float(g_all.get("scale", 1.0) or 1.0)
    T = int(g_all.get("tracking", 0) or 0)

    font = TTFont(args.font)
    if "glyf" not in font:
        if "CFF " in font or "CFF2" in font:
            otf_to_ttf(font)
        else:
            print("unsupported font: no glyf and no CFF outlines", file=sys.stderr)
            sys.exit(2)

    glyf = font["glyf"]
    hmtx = font["hmtx"]
    glyph_set = font.getGlyphSet()
    names = font.getGlyphOrder()

    rebuilt = 0
    adv_changed = 0
    y_max_all, y_min_all = -10**9, 10**9

    for name in names:
        e = per_glyph.get(name, {}) or {}
        u = S * float(e.get("s", 1.0) or 1.0)
        kx = u * float(e.get("sx", 1.0) or 1.0)
        ky = u * float(e.get("sy", 1.0) or 1.0)
        dx = int(e.get("dx", 0) or 0)
        dy = int(e.get("dy", 0) or 0)
        dadv = int(e.get("dadv", 0) or 0)
        w = int(e.get("w", 0) or 0)

        base_adv, base_lsb = hmtx[name]
        new_adv = max(0, otRound(base_adv * kx) + dadv + T + w)

        glyph = glyf[name]
        has_outline = glyph.numberOfContours != 0

        if has_outline and (kx != 1.0 or ky != 1.0 or dx != 0 or dy != 0 or w != 0):
            rec = DecomposingRecordingPen(glyph_set)
            glyph_set[name].draw(rec)
            rec_value = rec.value
            if w != 0:
                from reweight import reweight_record
                rec_value = reweight_record(rec_value, w)
            if w != 0:
                # re-traced outlines are cubic; convert to quadratic for glyf
                from fontTools.pens.cu2quPen import Cu2QuPen
                tt = TTGlyphPen(None)
                pen = Cu2QuPen(tt, max_err=1.0)
                out_pen = tt
            else:
                pen = TTGlyphPen(None)
                out_pen = pen
            for op, pts in transform_record(rec_value, kx, ky, dx, dy):
                getattr(pen, op)(*pts)
            new_glyph = out_pen.glyph()
            glyf[name] = new_glyph
            glyph = new_glyph
            rebuilt += 1

        if glyph.numberOfContours != 0:
            glyph.recalcBounds(glyf)
            lsb = glyph.xMin
            y_max_all = max(y_max_all, glyph.yMax)
            y_min_all = min(y_min_all, glyph.yMin)
        else:
            lsb = 0

        if (new_adv, lsb) != (base_adv, base_lsb):
            adv_changed += 1
        hmtx[name] = (new_adv, lsb)

    # --- vertical metrics ---
    hhea = font["hhea"]
    os2 = font["OS/2"]
    asc = int(g_all.get("ascender") or hhea.ascent)
    desc = int(g_all.get("descender") if g_all.get("descender") is not None else hhea.descent)
    if desc > 0:
        desc = -desc
    gap = int(g_all.get("lineGap") if g_all.get("lineGap") is not None else hhea.lineGap)
    hhea.ascent, hhea.descent, hhea.lineGap = asc, desc, gap
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = asc, desc, gap
    if y_max_all > -10**9:
        os2.usWinAscent = max(asc, y_max_all, 0)
        os2.usWinDescent = max(-desc, -y_min_all, 0)
    else:
        os2.usWinAscent, os2.usWinDescent = max(asc, 0), max(-desc, 0)
    if g_all.get("capHeight") is not None and hasattr(os2, "sCapHeight"):
        os2.sCapHeight = int(g_all["capHeight"])
    if g_all.get("xHeight") is not None and hasattr(os2, "sxHeight"):
        os2.sxHeight = int(g_all["xHeight"])

    # --- kerning via GPOS ---
    pairs = []
    name_set = set(names)
    for key, val in kerning.items():
        v = otRound(val)
        if not v:
            continue
        parts = key.split()
        if len(parts) != 2:
            continue
        left, right = parts
        if left in name_set and right in name_set:
            pairs.append((left, right, v))
    if pairs:
        lines = "\n".join(f"    pos {l} {r} {v};" for l, r, v in sorted(pairs))
        fea = (
            "languagesystem DFLT dflt;\n"
            "languagesystem latn dflt;\n\n"
            "feature kern {\n" + lines + "\n} kern;\n"
        )
        addOpenTypeFeaturesFromString(font, fea)

    if args.format in ("woff", "woff2"):
        font.flavor = args.format
    font.save(args.out)

    print(json.dumps({
        "glyphs_total": len(names),
        "glyphs_rebuilt": rebuilt,
        "advances_changed": adv_changed,
        "kern_pairs": len(pairs),
        "ascender": asc, "descender": desc, "lineGap": gap,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
