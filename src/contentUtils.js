// src/contentUtils.js
// Утилиты для извлечения превью-текста и картинки из HTML-контента новости.
// Работает поверх поля `content`, которое парсер уже сохраняет из RSS (description/content:encoded).

import sanitizeHtml from 'sanitize-html';

export function extractImageUrl(html) {
  if (!html) return null;

  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) return imgMatch[1];

  return null;
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

  return plain
    .replace(/&nbsp;/g, ' ')
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
