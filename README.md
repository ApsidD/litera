# Litera

A touch-friendly **font finishing studio** that runs in your browser. Load a TTF, drag numbers and letters with your mouse (or your finger on an iPad), and export a fixed font — metrics, per-glyph sizes and positions, sidebearings, and kerning.

Litera was born from a real workflow: generating a typeface with AI image models, converting the specimen sheet into a TTF, and then finishing it by hand. The whole pipeline lives in this app:

**generate a sheet → import → finish by eye → export TTF**

See [GUIDE.md](GUIDE.md) for the full playbook, including ready-to-use prompts for GPT Image / Nano Banana style models and a path for digitizing your own handwriting.

## Features

- **Preview lines** with live guides (baseline, x-height, cap height, ascender/descender). Click a letter to select it, click the gap between letters to select a kerning pair.
- **Scrub controls**: every number is draggable. Shift = 10× coarser, Alt = finer, click to type, wheel and arrow keys work too.
- **Zoom view** (double click): drag the letter itself — horizontal movement edits the left bearing, vertical movement edits the position; for a pair, dragging edits the kerning.
- **Glyph grid** with edit markers and full vertical guides per cell.
- **Stroke weight**, with independent **horizontal** and **vertical** control: thicken the vertical stems without touching the horizontal bars (or the reverse), so you can dial a font's stroke contrast. True geometric growth via an anisotropic raster round-trip on export. In the glyph zoom view a **preview weight** button renders the exact weighted shape on the server (same engine as export), so you see the real result, not a canvas approximation. One-click weight equalization too — even out stem weight or bar weight across capitals, lowercase or all glyphs.
- **Pair test**: a built-in feed of systematic spacing tests (every letter between every neighbor), virtualized so thousands of lines stay fast.
- **Non-destructive edits**: everything is stored as a JSON layer next to the original font, with undo/redo and autosave. Export builds a new versioned TTF; "make working" swaps it in with an automatic backup.
- **Specimen sheet import**: upload a PNG of characters (drawn, generated, or scanned), and Litera segments it, traces it with potrace, and builds a TTF you can immediately start finishing.
- **English / Russian** interface (English by default, toggle in the top bar).
- Works great on iPad — all controls are pointer-based.

## Quick start

### Docker (recommended)

```bash
docker build -t litera .
docker run -p 8108:8108 -v $(pwd)/fonts:/app/fonts -v $(pwd)/data:/app/data litera
```

Open http://localhost:8108 and drop your `.ttf` files into the `fonts/` folder (or use **import sheet**).

### Bare Python

Requires Python 3.11+ and the `potrace` binary (`apt install potrace` / `brew install potrace`) for sheet import.

```bash
pip install -r requirements.txt
python app.py
```

## Configuration

Everything is optional; the defaults run a local, open instance with `./fonts` and `./data`.

| Variable | Default | Meaning |
|---|---|---|
| `LITERA_FONT_DIRS` | `./fonts` | colon-separated folders with `.ttf`/`.otf` files |
| `LITERA_DATA_DIR` | `./data` | edits, exports and backups |
| `LITERA_PASSWORD` | *(empty)* | if set, the app asks for this password |
| `LITERA_PAIRTEST` | *(built-in)* | path to a custom pair-test text file |
| `LITERA_PORT` | `8108` | port |
| `SECRET_KEY` | random | session secret (set it if you use a password) |
| `LITERA_PYTHON` | auto | Python interpreter for the font-building subprocesses; auto-detected (one that has fontTools/numpy/Pillow) if unset |
| `LITERA_SSO_SESSION` | *(off)* | set to `1` to trust a `session[\"user\"]` cookie issued by another app sharing the same `SECRET_KEY` (single sign-on behind one domain) |
| `LITERA_LOGIN_URL` | `/` | where to send unauthenticated users in SSO mode |

If you expose Litera to the internet, set `LITERA_PASSWORD` and `SECRET_KEY`, and put it behind HTTPS (a reverse proxy such as Caddy or nginx).

## How edits work

Litera never touches your original font while you work. Edits live in `data/edits/<font>.json`:

```json
{
  "global":  { "scale": 1.0, "tracking": 0, "ascender": 900, "capHeight": 700 },
  "glyphs":  { "T": { "s": 1, "sx": 1, "sy": 1, "dx": 0, "dy": 0, "dadv": -40 } },
  "kerning": { "A V": -85 }
}
```

**Export TTF** applies this layer with fontTools (outlines are rebuilt only for glyphs that changed; kerning is compiled into GPOS) and writes a versioned file into `data/exports/`. **Make working** copies the export over the source font, backing the original up into `data/backups/`.

Litera loads **.ttf, .otf, .woff and .woff2** (web formats are unpacked on upload). Exports come out as **TTF, WOFF or WOFF2** — pick the format next to the export button. OTF (CFF) outlines are converted to TrueType automatically on export.

## Importing a specimen sheet

The **import sheet** button accepts a PNG with black characters on a white background, arranged in reading order (rows, left to right). Requirements:

- characters must not touch each other;
- multi-part characters (i, j, :, ;, !, ?, ", =, %) are merged automatically;
- pick the character set that matches the sheet, or type a custom one in exact sheet order;
- the threshold slider controls binarization (raise it for light, hairline strokes).

Litera segments the sheet, traces every character with potrace, normalizes baselines and heights, seats punctuation at typographic norms, and saves a ready TTF into your fonts folder. From there, finish it like any other font.

For how to *get* a good sheet in the first place — prompts, reference tricks, fixing single letters, digitizing handwriting — read [GUIDE.md](GUIDE.md).

## License

[MIT](LICENSE)
