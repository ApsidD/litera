// Litera: font loading, autosave, undo/redo, export, promote
import { state, cleanedEdits, onChange, emit } from './state.js';
import { resetCaches } from './render.js';
import * as preview from './preview.js';
import * as grid from './grid.js';
import { initInspector, refreshInspector } from './inspector.js';
import * as pairtest from './pairtest.js';
import { initZoom, zoomChanged } from './zoom.js';
import * as H from './history.js';
import { t, applyDom, toggleLang } from './i18n.js';
import { initImporter } from './importer.js';

const $ = id => document.getElementById(id);

// ---------- status & toasts ----------
function setStatus(t) { $('save-status').textContent = t; }

let toastTimer = 0;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isErr ? 7000 : 4200);
}

// ---------- autosave ----------
let saveTimer = 0;

function scheduleSave() {
  if (!state.fontPath) return;
  setStatus(t('changed…'));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 900);
}

async function doSave() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!state.fontPath) return;
  const body = JSON.stringify({ path: state.fontPath, edits: cleanedEdits() });
  setStatus(t('saving…'));
  try {
    const r = await fetch('api/edits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const now = new Date();
    setStatus(t('saved') + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'));
  } catch (e) {
    setStatus(t('save error'));
    toast(t('Could not save:') + ' ' + e.message, true);
  }
}

async function flushSave() {
  if (saveTimer) await doSave();
}

// ---------- font list ----------
async function loadFontList() {
  const r = await fetch('api/fonts');
  if (!r.ok) { toast(t('Could not load font list') + ' (HTTP ' + r.status + ')', true); return; }
  const data = await r.json();
  state.fonts = data.fonts || [];
  const sel = $('font-select');
  const keep = sel.value;
  sel.innerHTML = '';
  const byDir = {};
  for (const f of state.fonts) (byDir[f.dir] = byDir[f.dir] || []).push(f);
  for (const [dir, list] of Object.entries(byDir)) {
    const og = document.createElement('optgroup');
    og.label = dir;
    for (const f of list) {
      const o = document.createElement('option');
      o.value = f.path;
      o.textContent = f.name + (f.has_edits ? ' •' : '');
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  if (keep && state.fonts.some(f => f.path === keep)) sel.value = keep;
}

// ---------- font loading ----------
function topOf(font, ch) {
  try {
    const g = font.charToGlyph(ch);
    if (!g || !g.path || !g.path.commands.length) return 0;
    return Math.round(g.path.getBoundingBox().y2);
  } catch (e) { return 0; }
}

async function loadFont(path) {
  await flushSave();
  setStatus(t('loading…'));
  let font;
  try {
    const buf = await (await fetch('api/font?path=' + encodeURIComponent(path))).arrayBuffer();
    font = opentype.parse(buf);
  } catch (e) {
    toast(t('Could not parse the font:') + ' ' + e.message, true);
    setStatus(t('error'));
    return;
  }
  let edits = {};
  try {
    edits = await (await fetch('api/edits?path=' + encodeURIComponent(path))).json();
  } catch (e) { edits = {}; }

  state.font = font;
  state.fontPath = path;
  state.upm = font.unitsPerEm || 1000;
  state.nameMap = {};
  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs.get(i);
    if (g && g.name) state.nameMap[g.name] = g;
  }
  const os2 = font.tables.os2 || {};
  const hhea = font.tables.hhea || {};
  const asc = font.ascender || hhea.ascender || 800;
  state.base = {
    ascender: asc,
    descender: font.descender || hhea.descender || -200,
    lineGap: hhea.lineGap || 0,
    capHeight: os2.sCapHeight || topOf(font, 'H') || Math.round(asc * 0.85),
    xHeight: os2.sxHeight || topOf(font, 'x') || Math.round(asc * 0.6),
  };
  state.edits = {
    version: 1,
    global: edits.global || {},
    glyphs: edits.glyphs || {},
    kerning: edits.kerning || {},
    ui: edits.ui || {},
  };
  state.sel = null;
  state.lastExport = null;
  $('btn-promote').disabled = true;
  $('dl-link').hidden = true;

  resetCaches();
  H.resetHistory();
  localStorage.setItem('litera.font', path);
  syncGuidesBtn();
  preview.rebuildLines();
  grid.rebuildGrid();
  refreshInspector();
  pairtest.syncPairTest();
  setStatus(t('ready'));
}

// ---------- guides ----------
function guidesOn() { return state.edits.ui.guides !== false; }
function syncGuidesBtn() { $('btn-guides').classList.toggle('on', guidesOn()); }

// ---------- export & promote ----------
async function doExport() {
  if (!state.fontPath) return;
  await doSave();
  setStatus(t('exporting…'));
  $('btn-export').disabled = true;
  try {
    const r = await fetch('api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.fontPath }),
    });
    const data = await r.json();
    if (!r.ok || data.error) {
      throw new Error((data.error || 'HTTP ' + r.status) + (data.stderr ? ' · ' + data.stderr.slice(-300) : ''));
    }
    state.lastExport = data.file;
    const dl = $('dl-link');
    dl.href = 'api/download?file=' + encodeURIComponent(data.file);
    dl.textContent = data.file;
    dl.hidden = false;
    $('btn-promote').disabled = false;
    const i = data.info || {};
    toast(t('Export ready:') + ` ${data.file} · ` + t('glyphs rebuilt') + `: ${i.glyphs_rebuilt ?? '?'} · ` + t('kern pairs') + `: ${i.kern_pairs ?? '?'}`);
    setStatus(t('export ready'));
  } catch (e) {
    toast(t('Export failed:') + ' ' + e.message, true);
    setStatus(t('export error'));
  } finally {
    $('btn-export').disabled = false;
  }
}

async function doPromote() {
  if (!state.lastExport || !state.fontPath) return;
  const ok = confirm(
    t('Replace the working file') + '\n' + state.fontPath + '\n' + t('with export') + ' ' + state.lastExport +
    '?\n\n' + t('The current file will go to backups.')
  );
  if (!ok) return;
  try {
    const r = await fetch('api/promote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.fontPath, file: state.lastExport }),
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'HTTP ' + r.status);
    toast(t('Working file updated. Backup:') + ' ' + data.backup);
    await loadFontList();
    $('font-select').value = state.fontPath;
  } catch (e) {
    toast(t('Failed:') + ' ' + e.message, true);
  }
}

// ---------- wiring ----------
onChange(kind => {
  zoomChanged(kind);
  if (kind === 'edits') {
    preview.scheduleRender();
    grid.scheduleGridRefresh();
    refreshInspector();
  } else if (kind === 'selection') {
    refreshInspector();
    preview.scheduleRender();
    grid.updateGridSelection();
  } else if (kind === 'ui') {
    scheduleSave();
  } else if (kind === 'restore') {
    syncGuidesBtn();
    preview.rebuildLines();
    grid.scheduleGridRefresh();
    grid.updateGridSelection();
    refreshInspector();
  }
});

function wire() {
  $('font-select').addEventListener('change', e => loadFont(e.target.value));
  $('btn-guides').addEventListener('click', () => {
    state.edits.ui.guides = guidesOn() ? false : true;
    syncGuidesBtn();
    preview.scheduleRender();
    emit('ui');
  });
  $('btn-undo').addEventListener('click', () => H.undo());
  $('btn-redo').addEventListener('click', () => H.redo());
  $('btn-addline').addEventListener('click', () => preview.addLine());
  $('btn-export').addEventListener('click', doExport);
  $('btn-lang').addEventListener('click', () => { toggleLang(); preview.scheduleRender(); });
  $('btn-promote').addEventListener('click', doPromote);

  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) H.redo(); else H.undo();
    } else if (k === 'y') {
      e.preventDefault();
      H.redo();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (saveTimer && state.fontPath) {
      const body = JSON.stringify({ path: state.fontPath, edits: cleanedEdits() });
      navigator.sendBeacon && navigator.sendBeacon('api/edits', new Blob([body], { type: 'application/json' }));
    }
  });
}

// ---------- boot ----------
async function boot() {
  if (!window.opentype) {
    toast(t('opentype.js failed to load, refresh the page'), true);
    return;
  }
  preview.initPreview($('lines'));
  grid.initGrid($('grid'));
  initInspector();
  pairtest.initPairTest({ btn: $('btn-pairs'), nav: $('pairs-nav'), sizeEl: $('pairs-size'), list: $('pairs') });
  initZoom();
  applyDom();
  initImporter({ onImported: async path => { await loadFontList(); $('font-select').value = path; await loadFont(path); } });
  H.setSaveHook(scheduleSave);
  wire();
  await loadFontList();
  const saved = localStorage.getItem('litera.font');
  const first = state.fonts.some(f => f.path === saved) ? saved : (state.fonts[0] && state.fonts[0].path);
  if (first) {
    $('font-select').value = first;
    await loadFont(first);
  } else {
    setStatus(t('no fonts found'));
  }
}

boot();
