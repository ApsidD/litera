// Litera: scrub control — a number you drag with the mouse
// makeScrub(el, {get, set, step=1, min, max, decimals=0, suffix, nudge, enabled, onBegin, onLive, onCommit})
const registry = [];

export function refreshScrubs() { for (const r of registry) r(); }

export function makeScrub(el, opts) {
  const o = Object.assign({ step: 1, min: -Infinity, max: Infinity, decimals: 0, suffix: '', nudge: 1 }, opts);
  el.classList.add('scrub');
  el.tabIndex = 0;

  const enabled = () => (o.enabled ? !!o.enabled() : true);
  const clamp = v => Math.min(o.max, Math.max(o.min, v));
  const round = v => {
    const m = Math.pow(10, o.decimals);
    return Math.round(v * m) / m;
  };
  const fmt = v => (o.decimals ? v.toFixed(o.decimals) : String(Math.round(v))) + o.suffix;

  function refresh() {
    if (!enabled()) { el.textContent = '·'; el.classList.add('off'); return; }
    el.classList.remove('off');
    el.textContent = fmt(o.get());
  }
  registry.push(refresh);

  let startY = 0, startV = 0, moved = false, dragging = false;

  el.addEventListener('pointerdown', e => {
    if (!enabled() || e.button !== 0) return;
    e.preventDefault();
    dragging = true; moved = false;
    startY = e.clientY; startV = o.get();
    el.setPointerCapture(e.pointerId);
    document.body.classList.add('scrubbing');
    o.onBegin && o.onBegin();
  });

  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = startY - e.clientY; // up = more
    if (Math.abs(dy) > 2) moved = true;
    if (!moved) return;
    const mod = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
    const v = clamp(round(startV + dy * o.step * mod));
    if (v !== o.get()) { o.set(v); refresh(); o.onLive && o.onLive(); }
  });

  function finish(e) {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('scrubbing');
    try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    if (moved) { o.onCommit && o.onCommit(); }
    else { openInput(); }
  }
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', e => {
    dragging = false;
    document.body.classList.remove('scrubbing');
    if (moved) { o.onCommit && o.onCommit(); }
  });

  function openInput() {
    if (!enabled()) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'scrub-input';
    input.value = o.decimals ? o.get().toFixed(o.decimals) : String(Math.round(o.get()));
    el.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const close = (commit) => {
      if (done) return; done = true;
      input.replaceWith(el);
      if (commit) {
        const v = parseFloat(input.value.replace(',', '.'));
        if (!isNaN(v) && clamp(round(v)) !== o.get()) {
          o.onBegin && o.onBegin();
          o.set(clamp(round(v)));
          o.onLive && o.onLive();
          o.onCommit && o.onCommit();
        }
      }
      refresh();
    };
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') close(true);
      else if (ev.key === 'Escape') close(false);
    });
    input.addEventListener('blur', () => close(true));
  }

  let wheelTimer = null, wheelActive = false;
  el.addEventListener('wheel', e => {
    if (!enabled()) return;
    e.preventDefault();
    if (!wheelActive) { wheelActive = true; o.onBegin && o.onBegin(); }
    const dir = e.deltaY < 0 ? 1 : -1;
    const v = clamp(round(o.get() + dir * o.nudge * (e.shiftKey ? 10 : 1)));
    if (v !== o.get()) { o.set(v); refresh(); o.onLive && o.onLive(); }
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelActive = false; o.onCommit && o.onCommit(); }, 400);
  }, { passive: false });

  el.addEventListener('keydown', e => {
    if (!enabled()) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    o.onBegin && o.onBegin();
    const dir = e.key === 'ArrowUp' ? 1 : -1;
    const v = clamp(round(o.get() + dir * o.nudge * (e.shiftKey ? 10 : 1)));
    if (v !== o.get()) { o.set(v); refresh(); o.onLive && o.onLive(); o.onCommit && o.onCommit(); }
  });

  refresh();
  return { refresh };
}
