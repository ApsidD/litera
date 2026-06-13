// Litera: tiny i18n layer. English is the source language; keys are English strings.
const RU = {
  'changed…': 'изменено…',
  'saving…': 'сохраняю…',
  'saved': 'сохранено',
  'save error': 'ошибка сохранения',
  'Could not save:': 'Не сохранилось:',
  'Could not load font list': 'Не получил список шрифтов',
  'loading…': 'загружаю…',
  'Could not parse the font:': 'Не смог разобрать шрифт:',
  'error': 'ошибка',
  'ready': 'готово',
  'exporting…': 'экспортирую…',
  'export ready': 'экспорт готов',
  'Export ready:': 'Экспорт готов:',
  'glyphs rebuilt': 'пересобрано глифов',
  'kern pairs': 'кернинг-пар',
  'Export failed:': 'Экспорт упал:',
  'export error': 'ошибка экспорта',
  'Replace the working file': 'Заменить рабочий файл',
  'with export': 'экспортом',
  'The current file will go to backups.': 'Текущий файл уйдёт в backups.',
  'Working file updated. Backup:': 'Рабочий файл обновлён. Бэкап:',
  'Failed:': 'Не получилось:',
  'opentype.js failed to load, refresh the page': 'opentype.js не загрузился, обнови страницу',
  'no fonts found': 'шрифты не найдены',
  'scale': 'масштаб',
  'tracking': 'трекинг',
  'line gap': 'межстрочный',
  'width': 'ширина',
  'height': 'высота',
  'shift Y': 'сдвиг Y',
  'left bearing': 'отступ слева',
  'right bearing': 'отступ справа',
  'pair': 'пара',
  'weight: horizontal': 'жирность: горизонтальная',
  'weight: vertical': 'жирность: вертикальная',
  'sync weight: horizontal': 'выровнять горизонтальную жирность',
  'sync weight: vertical': 'выровнять вертикальную жирность',
  'caps': 'заглавные',
  'lowercase': 'строчные',
  'all glyphs': 'все глифы',
  'remove pair': 'убрать пару',
  'remove line': 'убрать строку',
  'pair test is empty': 'тест пар не найден или пуст',
  'drag the letter: horizontal = left bearing, vertical = vertical position · Alt = finer':
    'тяни букву мышью: по горизонтали отступ слева, по вертикали посадка · Alt точнее',
  'drag the right letter horizontally — that is kerning · Alt = finer':
    'тяни правую букву по горизонтали, это кернинг · Alt точнее',
  // static page
  'font finishing': 'доводка шрифта',
  'guides': 'направляющие',
  'guides on/off': 'направляющие вкл/выкл',
  'undo · Ctrl+Z': 'отменить · Ctrl+Z',
  'redo · Ctrl+Shift+Z': 'вернуть · Ctrl+Shift+Z',
  'export': 'экспорт',
  'make working': 'сделать рабочим',
  'replace the working font file with the fresh export': 'заменить рабочий файл шрифта свежим экспортом',
  'download': 'скачать',
  '+ line': '+ строка',
  'pair test': 'тест пар',
  'size': 'размер',
  'Glyphs': 'Глифы',
  'Font': 'Шрифт',
  'Glyph': 'Глиф',
  'Kerning': 'Кернинг',
  'How to drag': 'Как тянуть',
  'reset': 'сброс',
  'reset font-level edits': 'сбросить правки уровня шрифта',
  'reset glyph edits': 'сбросить правки глифа',
  'remove': 'убрать',
  'close': 'закрыть',
  'click a letter in the preview or the grid': 'кликни букву в превью или в сетке',
  'click the gap between letters in the preview': 'кликни в зазор между буквами в превью',
  'numbers are dragged with the mouse up and down · Shift is 10× coarser, Alt finer · click a number to type · wheel and arrow keys work too':
    'числа тянутся мышью вверх-вниз · Shift в 10 раз грубее, Alt тоньше · клик по числу открывает ввод · колесо и стрелки тоже работают',
  'with a letter or pair selected: green = the letter\u2019s own bearings, blue = kerning, red = overlap or negative':
    'при выборе буквы или пары: зелёное = собственные отступы буквы, синее = кернинг, красное = заступ или минус',
  'upload font': 'загрузить шрифт',
  'uploading…': 'загружаю файл…',
  'Upload failed:': 'Загрузка упала:',
  // import dialog
  'import sheet': 'импорт листа',
  'Import a specimen sheet': 'Импорт листа-спесимена',
  'A PNG with black characters on white, in reading order (rows, left to right). Characters must not touch.':
    'PNG с чёрными знаками на белом, в порядке чтения (строки, слева направо). Знаки не должны касаться друг друга.',
  'Image': 'Картинка',
  'Font name': 'Имя шрифта',
  'Character set': 'Набор символов',
  'A–Z': 'A–Z',
  'a–z': 'a–z',
  'A–Z a–z 0–9': 'A–Z a–z 0–9',
  'full (letters, digits, punctuation)': 'полный (буквы, цифры, знаки)',
  'custom': 'свой',
  'Characters in sheet order': 'Символы в порядке листа',
  'Threshold': 'Порог яркости',
  'Italic angle': 'Наклон (italic angle)',
  'Import': 'Импортировать',
  'importing… this takes up to a minute': 'импортирую… это занимает до минуты',
  'Import failed:': 'Импорт упал:',
  'Imported:': 'Импортирован:',
  'Cancel': 'Отмена',
};

let lang = localStorage.getItem('litera.lang') || 'en';

export function t(key) {
  if (lang === 'ru') return RU[key] || key;
  return key;
}

export function getLang() { return lang; }

export function setLang(l) {
  lang = l === 'ru' ? 'ru' : 'en';
  localStorage.setItem('litera.lang', lang);
  applyDom();
}

export function toggleLang() { setLang(lang === 'ru' ? 'en' : 'ru'); }

// Translate static DOM: elements with data-i18n (text) and data-i18n-title (title attr)
export function applyDom() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    // for hints assembled from several keys, key list separated by '|'
    el.textContent = el.dataset.i18nHtml.split('|').map(k => t(k)).join(' ');
  }
  const lb = document.getElementById('btn-lang');
  if (lb) lb.textContent = lang === 'ru' ? 'EN' : 'RU';
}
