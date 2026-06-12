// Litera: undo/redo over the JSON edits layer + autosave hook
import { state, cleanedEdits, emit } from './state.js';

let undoStack = [];
let redoStack = [];
let pending = null;
let saveHook = null;

export function setSaveHook(fn) { saveHook = fn; }
export function resetHistory() { undoStack = []; redoStack = []; pending = null; }

function snap() { return JSON.stringify(cleanedEdits()); }

function applySnap(s) {
  const o = JSON.parse(s);
  state.edits = {
    version: 1,
    global: o.global || {},
    glyphs: o.glyphs || {},
    kerning: o.kerning || {},
    ui: o.ui || {},
  };
  emit('edits');
  emit('ui');
  emit('selection');
  emit('restore');
  saveHook && saveHook();
}

// capture() BEFORE the mutation, commit() after — if anything changed, it goes to undo
export function capture() { if (pending == null) pending = snap(); }

export function commit() {
  if (pending == null) return;
  const now = snap();
  if (now !== pending) {
    undoStack.push(pending);
    if (undoStack.length > 120) undoStack.shift();
    redoStack = [];
    saveHook && saveHook();
  }
  pending = null;
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snap());
  applySnap(undoStack.pop());
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snap());
  applySnap(redoStack.pop());
}
