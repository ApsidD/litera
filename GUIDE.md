# From an idea to your own font

This is the playbook we used to build a three-font brand family with AI image models and Litera. The whole path is:

1. **Generate** a specimen sheet (or draw one by hand) →
2. **Import** it in Litera (`import sheet`) →
3. **Finish** spacing, sizes and kerning by eye →
4. **Export** the TTF.

The hard-won lessons are in the prompts below. Models used: *GPT Image* (best at following "same author, better craft" instructions) and *Nano Banana / Gemini image* class models (great at consistent full sheets). Any strong image model with reference-image support will do.

## 1. The golden rule: one generation = one pen

If you generate capitals today and lowercase tomorrow, the stroke weight and slant **will** drift. Generate the complete character set in a single image whenever possible. If a sheet must be split, generate the additions with the first sheet attached as a style reference — and expect to retouch.

## 2. Full specimen sheet prompt (from scratch)

```
Complete type specimen sheet of a <describe your typeface: e.g. "classical Roman serif
display typeface" / "light cursive italic typeface">, ALL characters drawn with ONE
consistent pen: identical stroke weight throughout, <style notes: serifs, slant,
contrast, mood>.

Layout: arrange ALL characters yourself in the most space-efficient grid possible.
Make every character as LARGE as the canvas allows, with a clear clean gap between
neighboring characters (no touching, no overlapping — each character must be cleanly
separable). Strict reading order must be preserved: row by row, left to right,
in this exact sequence:
A B C D E F G H I J K L M N O P Q R S T U V W X Y Z
a b c d e f g h i j k l m n o p q r s t u v w x y z
0 1 2 3 4 5 6 7 8 9
. , : ; - — ' " ! ? & ( ) /
[ ] * + < = > # $ % @ _

Rules: every character same stroke weight — symbols must NOT be thinner than letters;
aligned baselines in every row, consistent sizing, generous even spacing.
Pure black on plain white background, no labels, no decorations, flat vector quality,
high resolution.
```

Tips:
- Generate at the highest resolution available (4K if you can): thin strokes survive tracing better.
- **Check before saving**: is the row order exactly as requested? Did the model lose a semicolon? Models love losing semicolons.
- If 2–3 characters came out wrong, do **not** regenerate the whole sheet (you'll lose the consistency of the other 88) — fix them individually (see §4).

## 3. Extending an existing style (reference workflow)

When you already have letters you like (an earlier generation, a logo lettering, an installed font screenshot), attach it and anchor the model hard:

```
Complete type specimen sheet extending this exact typeface (reference attached).
The reference shows the established style: reproduce its letters faithfully and design
all remaining characters in the IDENTICAL style — same stroke weight, same stroke
contrast, same proportions. Do not deviate stylistically from the reference.
<then the layout + character list + rules from §2>
```

## 4. Fixing a single letter

Crop 2–3 good letters from your sheet (e.g. `a`, `o`, and the offender) into a small reference strip, then:

```
Redraw the lowercase letter "g" from this reference image. The reference shows three
letters from the same typeface: "a", "o", and the current "g".
Task: design a new "g" where <exact fix: "the upper bowl is EXACTLY the same size and
shape as the bowl of 'a' and 'o', sitting ON the baseline, with an OPEN tail that exits
to the RIGHT — not a closed loop">.
Same pen as the reference: identical stroke weight, identical slant.
Output: ONE large letter only, centered, pure black on plain white, high resolution.
```

Be brutally specific about construction ("must NOT close on itself", "exit stroke pointing right and slightly up"). Then re-import, or splice the glyph in your font editor.

If the model keeps replacing your design with generic letterforms, split the roles across two references: *"Reference 1 (style): take the pen. Reference 2 (construction): take ONLY the structure."*

## 5. Digitizing your handwriting

The most personal path — your hand, elevated:

1. Draw the characters on a guideline template (Procreate or paper). Keep characters separated, parts of one character close together. Export/photograph as a clean PNG.
2. Threshold-clean it (Litera's import threshold handles light guidelines automatically — they simply disappear below the ink threshold).
3. Run it through an image model to "promote" your hand. The framing that works:

```
Three reference images show one person's handwriting drawn with a plain pen.
Task: re-execute ALL these characters with a professional pointed calligraphy nib,
keeping the author's letterform DESIGNS — the same constructions, line trajectories,
hooks, loops, slant — but completely replacing the pen and the craft level.
The new execution: strong stroke contrast — thick downstrokes swelling under pressure,
delicate hairline upstrokes, elegant tapered entries and exits. Master precision:
nothing careless, nothing shaky, no uniform-width ballpoint lines anywhere.
<layout + character order + rules from §2>
```

The key insight: asking for "mastery" alone makes the model master *your pen*. You must explicitly **swap the instrument** ("no ballpoint lines", "flexible calligraphy nib", "strong thick/thin contrast") while pinning *your letterforms*.

4. Import the result in Litera. For script fonts, expect to pull capitals' right bearings inward so lowercase tucks under the swashes — that's normal copperplate logic.

## 6. Import settings that matter

- **Character set** must match the sheet *exactly and in order* — Litera assigns characters by reading order. Use "custom" for non-standard sets.
- **Threshold** (default 140): raise to ~180 for hairline calligraphy so thin strokes don't break apart; lower if the background isn't clean white.
- **Italic angle**: set it for slanted designs (e.g. −9) so editors and apps know the font is italic.
- If import reports a character count mismatch, the sheet has touching letters (merged into one) or lost parts — check the offending row and regenerate or retouch it.

## 7. Finishing checklist in Litera

1. **Font section**: set ascender/descender so nothing clips; confirm cap height and x-height.
2. **Glyph sizes**: scan the grid for letters that are visibly too big/small; fix with per-glyph scale.
3. **Vertical seats**: select each punctuation mark; dragging in zoom view fixes floaters fast.
4. **Sidebearings**: walk the pair test feed; if a letter is bad against *everything*, fix its bearings, not kerning.
5. **Stroke contrast**: if some letters look too thin or too heavy after scaling, use the weight controls — horizontal weight thickens vertical stems, vertical weight thickens horizontal bars. The "sync weight" buttons even out a whole group (caps / lowercase / all) to its median. Sweet spot is small values; large ones flatten the thick/thin contrast.
6. **Kerning**: only after bearings. Classic suspects: AV AT AW LT LY TA VA WA Yo To Te P. F. r. 
7. **Export**, install, look at it in a real document, repeat.
