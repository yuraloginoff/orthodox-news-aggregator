// src/contentUtils.js
// Утилиты для извлечения превью-текста и картинки из HTML-контента новости.
// Работает поверх поля `content`, которое парсер уже сохраняет из RSS (description).
//
// ВАЖНО: content — это сырой <description> из RSS, xml2js декодирует его один раз
// (например, &amp;nbsp; в XML становится &nbsp; в JS-строке), но sanitize-html убирает
// только HTML-теги, а не HTML-entity (&nbsp;, &laquo;, &raquo; и т.д.) — поэтому нужно
// декодировать entity отдельно, до того как текст попадёт в превью.
//
// Важный нюанс: некоторые источники (например, patriarchia.ru) отдают в RSS дважды
// экранированные сущности (&amp;laquo; вместо &laquo;). Поэтому &amp; декодируется
// первым делом — это раскрывает &amp;laquo; -> &laquo;, которое затем корректно
// превращается в « ниже по циклу.


import sanitizeHtml from 'sanitize-html';


const NAMED_ENTITIES = {
  '&nbsp;': ' ',
  '&laquo;': '«',
  '&raquo;': '»',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
};


/**
 * Декодирует HTML-сущности (&nbsp;, &laquo;, &raquo;, &#1090; и т.д.) в обычные символы.
 * &amp; декодируется первым — это намеренно, так как у некоторых источников
 * встречается двойное экранирование (&amp;laquo; вместо &laquo;), и без этого шага
 * именоованные сущности ниже просто не найдут совпадений и останутся нераскодированными.
 */
export function decodeHtmlEntities(text) {
  if (!text) return text;


  let result = text.split('&amp;').join('&');


  for (const [entity, char] of Object.entries(NAMED_ENTITIES)) {
    result = result.split(entity).join(char);
  }


  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));


  return result;
}


export function extractImageUrl(html) {
  if (!html) return null;


  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) return imgMatch[1];


  return null;
}


/**
 * Заменяет плейсхолдер обрезки WordPress-фидов "[…]" (иногда "[...]")
 * на обычное многоточие без пробела перед ним, например:
 * "текст новости […]" -> "текст новости…"
 */
function normalizeTruncationPlaceholder(text) {
  return text.replace(/\s*\[\s*(?:…|\.\.\.)\s*\]/g, '…');
}


export function htmlToPlainText(html) {
  if (!html) return '';


  const withBreaks = html
    .replace(/<\/(p|div|br)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n\n');


  const plain = sanitizeHtml(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
  });


  const decoded = decodeHtmlEntities(plain);


  const normalized = normalizeTruncationPlaceholder(decoded);


  return normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
    .join('\n')
    .trim();
}


export function truncateText(text, maxLength = 3500) {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trim() + '…';
}
