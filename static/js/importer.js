// Litera: import a specimen sheet image and build a TTF on the server
import { t } from './i18n.js';

const $ = id => document.getElementById(id);

const PRESETS = {
  caps: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  full: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;-—\'"!?&()/[]*+<=>#$%@_',
};

let onImported = null;

export function initImporter(opts) {
  onImported = opts.onImported;
  $('btn-import').addEventListener('click', open);
  $('imp-close').addEventListener('click', close);
  $('import').querySelector('.zoom-back').addEventListener('click', close);
  $('imp-charset').addEventListener('change', syncCustom);
  $('imp-go').addEventListener('click', run);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('import').hidden) close();
  });
  syncCustom();
}

function open() { $('import').hidden = false; $('imp-status').textContent = ''; }
function close() { $('import').hidden = true; }

function syncCustom() {
  const isCustom = $('imp-charset').value === 'custom';
  $('imp-custom-row').style.display = isCustom ? '' : 'none';
}

async function run() {
  const file = $('imp-file').files[0];
  if (!file) { $('imp-status').textContent = t('Image') + '?'; return; }
  const fd = new FormData();
  fd.append('image', file);
  fd.append('name', $('imp-name').value || 'MyFont');
  fd.append('charset', $('imp-charset').value);
  fd.append('custom_chars', $('imp-custom').value || '');
  fd.append('threshold', $('imp-threshold').value || '140');
  fd.append('italic', $('imp-italic').value || '0');

  $('imp-go').disabled = true;
  $('imp-status').textContent = t('importing… this takes up to a minute');
  try {
    const r = await fetch('api/import', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok || data.error) {
      throw new Error((data.error || 'HTTP ' + r.status) + (data.detail ? ' · ' + data.detail.slice(-400) : ''));
    }
    $('imp-status').textContent = t('Imported:') + ' ' + data.path;
    close();
    onImported && onImported(data.path);
  } catch (e) {
    $('imp-status').textContent = t('Import failed:') + ' ' + e.message;
  } finally {
    $('imp-go').disabled = false;
  }
}
