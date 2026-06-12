"""Litera — a touch-friendly font finishing studio: metrics, sizes, spacing, kerning.

Configuration (environment variables):
  LITERA_FONT_DIRS  colon-separated directories with .ttf/.otf files (default: ./fonts)
  LITERA_DATA_DIR   where edits/exports/backups live (default: ./data)
  LITERA_PASSWORD   if set, the app asks for this password; otherwise it is open
  LITERA_PAIRTEST   optional path to a custom pair-test text file
  LITERA_PORT       port (default: 8108)
  SECRET_KEY        session secret (random per start if not set)
"""
import json
import os
import re
import secrets
import shutil
import string
import subprocess
import sys
import time
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

BASE_DIR = Path(__file__).parent

def _env_path(name, default):
    return Path(os.environ.get(name, default)).expanduser().resolve()

DATA_DIR = _env_path("LITERA_DATA_DIR", BASE_DIR / "data")
EDITS_DIR = DATA_DIR / "edits"
EXPORTS_DIR = DATA_DIR / "exports"
BACKUP_DIR = DATA_DIR / "backups"
for d in (EDITS_DIR, EXPORTS_DIR, BACKUP_DIR):
    d.mkdir(parents=True, exist_ok=True)

FONT_DIRS = [Path(p).expanduser().resolve()
             for p in os.environ.get("LITERA_FONT_DIRS", str(BASE_DIR / "fonts")).split(":") if p]
FONT_DIRS[0].mkdir(parents=True, exist_ok=True)

PASSWORD = os.environ.get("LITERA_PASSWORD", "")
# Advanced: trust a session["user"] set by another app sharing the same SECRET_KEY
# (single sign-on behind one domain). Unauthenticated users are sent to LITERA_LOGIN_URL.
SSO_SESSION = os.environ.get("LITERA_SSO_SESSION", "") == "1"
LOGIN_URL = os.environ.get("LITERA_LOGIN_URL", "/")
PAIRTEST_FILE = os.environ.get("LITERA_PAIRTEST", "")
SECRET_KEY = os.environ.get("SECRET_KEY", secrets.token_hex(32))
PORT = int(os.environ.get("LITERA_PORT", 8108))
PYTHON = sys.executable

app = FastAPI(title="Litera")
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY)


class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path == "/":
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        elif request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"
        return response


app.add_middleware(NoCacheMiddleware)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


def _authed(request: Request) -> bool:
    if not PASSWORD and not SSO_SESSION:
        return True
    return bool(request.session.get("user"))


def _deny():
    return JSONResponse({"error": "not authorized"}, status_code=401)


LOGIN_HTML = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Litera</title>
<style>body{font-family:Georgia,serif;background:#F4EFE6;color:#1F1D1A;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
form{display:flex;gap:8px;flex-direction:column;width:260px}h1{font-style:italic;font-weight:400;text-align:center}
input,button{font-size:16px;padding:10px;border:1px solid #9A917F;border-radius:6px;background:#fff}
button{background:#1F1D1A;color:#F4EFE6;cursor:pointer}.err{color:#B3402A;text-align:center;min-height:1.2em}</style>
</head><body><form method="post" action="login"><h1>Litera</h1>
<input type="password" name="password" placeholder="password" autofocus>
<button>Enter</button><div class="err">{err}</div></form></body></html>"""


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    if not _authed(request):
        if SSO_SESSION:
            return RedirectResponse(LOGIN_URL, status_code=302)
        return HTMLResponse(LOGIN_HTML.replace("{err}", ""))
    html = (BASE_DIR / "templates" / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


@app.post("/login")
async def login(request: Request, password: str = Form("")):
    if PASSWORD and secrets.compare_digest(password, PASSWORD):
        request.session["user"] = "litera"
        return RedirectResponse("/", status_code=302)
    return HTMLResponse(LOGIN_HTML.replace("{err}", "wrong password"), status_code=401)


@app.get("/healthz")
async def healthz():
    return JSONResponse({"ok": True, "app": "litera"})


def _safe_font_path(rel: str) -> Path | None:
    """Resolve a path relative to one of FONT_DIRS; only .ttf/.otf inside allowed dirs."""
    if not rel or ".." in rel:
        return None
    for d in FONT_DIRS:
        p = (d / rel).resolve()
        if p.suffix.lower() in (".ttf", ".otf") and p.is_relative_to(d) and p.is_file():
            return p
    return None


def _edits_file(rel: str) -> Path:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "__", rel)
    return EDITS_DIR / f"{slug}.json"


@app.get("/api/fonts")
async def list_fonts(request: Request):
    if not _authed(request):
        return _deny()
    fonts = []
    for d in FONT_DIRS:
        if not d.is_dir():
            continue
        label = d.name or str(d)
        for f in sorted(d.iterdir()):
            if f.suffix.lower() in (".ttf", ".otf") and f.is_file():
                rel = f.name
                st = f.stat()
                fonts.append({
                    "path": rel,
                    "name": f.name,
                    "dir": label,
                    "size": st.st_size,
                    "mtime": int(st.st_mtime),
                    "has_edits": _edits_file(rel).exists(),
                })
    return JSONResponse({"fonts": fonts})


@app.get("/api/font")
async def get_font(request: Request, path: str):
    if not _authed(request):
        return _deny()
    p = _safe_font_path(path)
    if not p:
        return JSONResponse({"error": "path outside allowed folders"}, status_code=400)
    return FileResponse(p, media_type="font/ttf", filename=p.name)


@app.get("/api/edits")
async def get_edits(request: Request, path: str):
    if not _authed(request):
        return _deny()
    if not _safe_font_path(path):
        return JSONResponse({"error": "path outside allowed folders"}, status_code=400)
    ef = _edits_file(path)
    if ef.exists():
        return JSONResponse(json.loads(ef.read_text(encoding="utf-8")))
    return JSONResponse({"version": 1, "global": {}, "glyphs": {}, "kerning": {}, "ui": {}})


@app.post("/api/edits")
async def save_edits(request: Request):
    if not _authed(request):
        return _deny()
    body = await request.json()
    rel = body.get("path", "")
    if not _safe_font_path(rel):
        return JSONResponse({"error": "path outside allowed folders"}, status_code=400)
    edits = body.get("edits")
    if not isinstance(edits, dict):
        return JSONResponse({"error": "no edits"}, status_code=400)
    ef = _edits_file(rel)
    tmp = ef.with_suffix(".tmp")
    tmp.write_text(json.dumps(edits, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(ef)
    return JSONResponse({"ok": True, "saved_at": int(time.time())})


@app.post("/api/export")
async def export_font(request: Request):
    if not _authed(request):
        return _deny()
    body = await request.json()
    rel = body.get("path", "")
    src = _safe_font_path(rel)
    if not src:
        return JSONResponse({"error": "path outside allowed folders"}, status_code=400)
    ef = _edits_file(rel)
    if not ef.exists():
        return JSONResponse({"error": "no saved edits for this font"}, status_code=400)
    fmt = body.get("format", "ttf")
    if fmt not in ("ttf", "woff", "woff2"):
        return JSONResponse({"error": "format must be ttf, woff or woff2"}, status_code=400)
    stem = src.stem
    existing = sorted(EXPORTS_DIR.glob(f"{stem}_litera_v*"))
    nums = [int(m.group(1)) for f in existing if (m := re.search(r"_v(\d+)\.(ttf|woff2?)$", f.name))]
    ver = (max(nums) + 1) if nums else 1
    out = EXPORTS_DIR / f"{stem}_litera_v{ver:02d}.{fmt}"
    proc = subprocess.run(
        [PYTHON, str(BASE_DIR / "fontops.py"),
         "--font", str(src), "--edits", str(ef), "--out", str(out), "--format", fmt],
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0 or not out.exists():
        return JSONResponse({
            "error": "fontops failed",
            "stdout": proc.stdout[-2000:],
            "stderr": proc.stderr[-2000:],
        }, status_code=500)
    info = json.loads(proc.stdout.strip().splitlines()[-1])
    return JSONResponse({"ok": True, "file": out.name, "info": info})


@app.get("/api/download")
async def download(request: Request, file: str):
    if not _authed(request):
        return _deny()
    if "/" in file or ".." in file:
        return JSONResponse({"error": "bad name"}, status_code=400)
    p = EXPORTS_DIR / file
    if not p.is_file():
        return JSONResponse({"error": "no such export"}, status_code=404)
    media = {".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2"}.get(p.suffix.lower(), "application/octet-stream")
    return FileResponse(p, media_type=media, filename=p.name)


@app.post("/api/promote")
async def promote(request: Request):
    """Replace the working font file with a fresh export; the original goes to backups."""
    if not _authed(request):
        return _deny()
    body = await request.json()
    file = body.get("file", "")
    rel = body.get("path", "")
    target = _safe_font_path(rel)
    if "/" in file or ".." in file or not target:
        return JSONResponse({"error": "bad parameters"}, status_code=400)
    exp = EXPORTS_DIR / file
    if not exp.is_file():
        return JSONResponse({"error": "no such export"}, status_code=404)
    ts = time.strftime("%Y%m%d_%H%M%S")
    backup = BACKUP_DIR / f"{target.stem}_pre-litera_{ts}{target.suffix}"
    shutil.copy2(target, backup)
    shutil.copy2(exp, target)
    return JSONResponse({"ok": True, "backup": backup.name, "target": rel})


@app.post("/api/upload-font")
async def upload_font(request: Request, font: UploadFile = File(...)):
    if not _authed(request):
        return _deny()
    fname = Path(font.filename or "font.ttf").name
    suffix = Path(fname).suffix.lower()
    if suffix not in (".ttf", ".otf", ".woff", ".woff2"):
        return JSONResponse({"error": "supported: .ttf, .otf, .woff, .woff2"}, status_code=400)
    fname = re.sub(r"[^A-Za-z0-9._-]+", "_", fname)
    data = await font.read()
    if len(data) > 50 * 1024 * 1024:
        return JSONResponse({"error": "file too large"}, status_code=400)

    stem = Path(fname).stem
    if suffix in (".woff", ".woff2"):
        # unpack web formats so the editor and fontops work with plain sfnt
        import io
        from fontTools.ttLib import TTFont as _TTFont
        try:
            f = _TTFont(io.BytesIO(data))
            f.flavor = None
            suffix = ".otf" if ("CFF " in f or "CFF2" in f) else ".ttf"
            buf = io.BytesIO()
            f.save(buf)
            data = buf.getvalue()
        except Exception as e:
            return JSONResponse({"error": f"could not unpack {fname}: {e}"}, status_code=400)

    dest = FONT_DIRS[0] / f"{stem}{suffix}"
    n = 2
    while dest.exists():
        dest = FONT_DIRS[0] / f"{stem}-{n}{suffix}"
        n += 1
    dest.write_bytes(data)
    return JSONResponse({"ok": True, "path": dest.name})


# ---------------- pair test ----------------

def _builtin_pairtest():
    low = string.ascii_lowercase
    up = string.ascii_uppercase
    groups = []
    for target in low:
        groups.append({"title": f"lowercase · {target}",
                       "lines": [f" {c}{target}{c}" for c in low]})
    for target in up:
        groups.append({"title": f"capitals · {target}",
                       "lines": [f" {c}{target}{c}" for c in up]})
    for T in up:
        groups.append({"title": f"word starts · {T}x",
                       "lines": [" " + " ".join(T + c for c in low)]})
    digs = "0123456789"
    groups.append({"title": "digits",
                   "lines": [" " + " ".join(c + t + c for c in digs) for t in digs]})
    groups.append({"title": "punctuation",
                   "lines": [f" no{p}no  NO{p}NO  0{p}0" for p in ".,:;-!?&()/"]})
    return groups


def _parse_pairtest(path: Path):
    groups, cur, big = [], None, ""
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("====="):
            big = line.strip("= ").split(":")[0].strip()
            cur = None
            continue
        if line.startswith("---"):
            sub = line.strip("- ").strip()
            cur = {"title": (big + " · " + sub) if big else sub, "lines": []}
            groups.append(cur)
            continue
        if cur is None:
            cur = {"title": big or "lines", "lines": []}
            groups.append(cur)
        cur["lines"].append(line.replace("_", " "))
    return groups


@app.get("/api/pairtest")
async def pairtest(request: Request):
    """Spacing/kerning test lines, grouped into sections."""
    if not _authed(request):
        return _deny()
    if PAIRTEST_FILE:
        p = Path(PAIRTEST_FILE).expanduser()
        if p.is_file():
            return JSONResponse({"groups": _parse_pairtest(p)})
    return JSONResponse({"groups": _builtin_pairtest()})


# ---------------- specimen sheet import ----------------

CHARSET_PRESETS = {
    "caps": list(string.ascii_uppercase),
    "lower": list(string.ascii_lowercase),
    "latin": list(string.ascii_uppercase) + list(string.ascii_lowercase) + list("0123456789"),
    "full": (list(string.ascii_uppercase) + list(string.ascii_lowercase)
             + list("0123456789") + list(".,:;-—'\"!?&()/") + list("[]*+<=>#$%@_")),
}


@app.post("/api/import")
async def import_sheet(
    request: Request,
    image: UploadFile = File(...),
    name: str = Form("MyFont"),
    charset: str = Form("latin"),
    custom_chars: str = Form(""),
    threshold: int = Form(140),
    italic: float = Form(0.0),
):
    if not _authed(request):
        return _deny()
    name = re.sub(r"[^A-Za-z0-9 _-]+", "", name).strip() or "MyFont"
    if charset == "custom":
        chars = [c for c in custom_chars if not c.isspace()]
    else:
        chars = CHARSET_PRESETS.get(charset)
    if not chars or len(chars) < 2:
        return JSONResponse({"error": "empty character set"}, status_code=400)

    tmp_png = EXPORTS_DIR / f"_import_{secrets.token_hex(4)}.png"
    tmp_png.write_bytes(await image.read())
    out = FONT_DIRS[0] / (name.replace(" ", "") + ".ttf")
    try:
        proc = subprocess.run(
            [PYTHON, str(BASE_DIR / "sheet2font.py"),
             "--image", str(tmp_png), "--out", str(out), "--name", name,
             "--chars", "".join(chars), "--threshold", str(threshold),
             "--italic", str(italic)],
            capture_output=True, text=True, timeout=300,
        )
    finally:
        tmp_png.unlink(missing_ok=True)
    if proc.returncode != 0 or not out.exists():
        return JSONResponse({
            "error": "import failed",
            "detail": (proc.stderr or proc.stdout)[-2000:],
        }, status_code=500)
    info = {}
    try:
        info = json.loads(proc.stdout.strip().splitlines()[-1])
    except Exception:
        pass
    return JSONResponse({"ok": True, "path": out.name, "info": info})


# ---------------- PWA ----------------

@app.get("/manifest.json")
async def manifest():
    return JSONResponse({
        "name": "Litera",
        "short_name": "Litera",
        "description": "Font finishing studio: metrics, sizes, spacing, kerning.",
        "start_url": "./",
        "scope": "./",
        "display": "standalone",
        "background_color": "#F4EFE6",
        "theme_color": "#F4EFE6",
        "icons": [
            {"src": "./icon-192.svg", "sizes": "192x192", "type": "image/svg+xml", "purpose": "any maskable"},
            {"src": "./icon-512.svg", "sizes": "512x512", "type": "image/svg+xml", "purpose": "any maskable"},
        ],
    })


def _icon_svg(size: int) -> str:
    s = size
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s}">
<rect width="{s}" height="{s}" rx="{s // 5}" fill="#F4EFE6"/>
<line x1="{s * .12:.0f}" y1="{s * .30:.0f}" x2="{s * .88:.0f}" y2="{s * .30:.0f}" stroke="#3B5B8C" stroke-width="{max(1, s // 64)}" opacity="0.7"/>
<line x1="{s * .12:.0f}" y1="{s * .74:.0f}" x2="{s * .88:.0f}" y2="{s * .74:.0f}" stroke="#B3402A" stroke-width="{max(1, s // 64)}" opacity="0.85"/>
<text x="{s * .5:.0f}" y="{s * .74:.0f}" font-family="Georgia, 'Times New Roman', serif" font-size="{s * .58:.0f}" font-style="italic" text-anchor="middle" fill="#1F1D1A">L</text>
</svg>'''


@app.get("/icon.svg")
async def icon():
    return Response(content=_icon_svg(64), media_type="image/svg+xml")


@app.get("/icon-192.svg")
async def icon_192():
    return Response(content=_icon_svg(192), media_type="image/svg+xml")


@app.get("/icon-512.svg")
async def icon_512():
    return Response(content=_icon_svg(512), media_type="image/svg+xml")


if __name__ == "__main__":
    print(f"Litera: http://0.0.0.0:{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
