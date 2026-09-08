// src/imageUtils.js
// Конвертация изображений в формат, который принимает Telegram Bot API.
// Telegram sendPhoto не поддерживает WEBP как обычное фото (WEBP там воспринимается
// только как стикер), поэтому такие картинки нужно конвертировать в JPEG перед отправкой.

import sharp from 'sharp';
import logger from './logger.js';

const WEBP_SIGNATURE_OFFSET = 8;
const WEBP_SIGNATURE = 'WEBP';

/**
 * Определяет, является ли буфер изображением в формате WEBP, по магическим байтам
 * RIFF-контейнера (несмотря на любое расширение файла или Content-Type в ответе сервера).
 */
function isWebp(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const riff = buffer.toString('ascii', 0, 4);
  const webp = buffer.toString('ascii', WEBP_SIGNATURE_OFFSET, WEBP_SIGNATURE_OFFSET + 4);
  return riff === 'RIFF' && webp === WEBP_SIGNATURE;
}

/**
 * Если переданный ArrayBuffer/Buffer — WEBP, конвертирует его в JPEG через sharp.
 * Для остальных форматов (JPEG, PNG, GIF) возвращает буфер без изменений,
 * так как Telegram sendPhoto их поддерживает напрямую.
 */
export async function convertImageForTelegram(arrayBufferOrBuffer) {
  const buffer = Buffer.isBuffer(arrayBufferOrBuffer)
    ? arrayBufferOrBuffer
    : Buffer.from(arrayBufferOrBuffer);

  if (!isWebp(buffer)) {
    return buffer;
  }

  try {
    const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
    logger.info(`Converted WEBP image to JPEG (${buffer.length} -> ${jpegBuffer.length} bytes)`);
    return jpegBuffer;
  } catch (error) {
    logger.error(`Failed to convert WEBP image to JPEG: ${error.message}`);
    return buffer;
  }
}
