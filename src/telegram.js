// src/telegram.js
// Отправка новостей в Telegram-канал через Bot API.
// api.telegram.org заблокирован для российских IP, поэтому запросы к самому Telegram
// всегда идут через SOCKS5-прокси (RSS_PROXY_URL). Картинки скачиваются напрямую
// (без прокси) — большинство источников это обычные российские сайты, доступные
// без туннеля; для картинок с уже заблокированных источников (UA3/MD1) прокси
// используется отдельно, через параметр useProxyForImage.
//
// Используется нативный FormData/Blob (Node.js 18+), а не пакет form-data —
// node-fetch v3 официально не совместим с form-data (Socket closed при отправке).

import fetch from 'node-fetch';
import { SocksProxyAgent } from 'socks-proxy-agent';
import logger from './logger.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

let cachedProxyAgent = null;
let proxyAgentInitialized = false;

function getProxyAgent() {
  if (proxyAgentInitialized) return cachedProxyAgent;

  proxyAgentInitialized = true;
  const proxyUrl = process.env.RSS_PROXY_URL;

  if (!proxyUrl) return null;

  try {
    cachedProxyAgent = new SocksProxyAgent(proxyUrl);
    logger.info(`Telegram will use SOCKS proxy: ${proxyUrl}`);
  } catch (error) {
    logger.error(`Failed to initialize SOCKS proxy agent for Telegram: ${error.message}`);
    cachedProxyAgent = null;
  }

  return cachedProxyAgent;
}

function assertConfigured() {
  if (!BOT_TOKEN || !CHANNEL_ID) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN и TELEGRAM_CHANNEL_ID должны быть заданы в .env'
    );
  }
}

function escapeMarkdownV2(text) {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

export function buildMessageText(news) {
  const prefix = escapeMarkdownV2(news.sourceRegion || news.sourceName || '');
  const titleText = escapeMarkdownV2(news.title || 'Без заголовка');
  const bodyText = (news.text || '').trim();
  const link = news.link;
  const sourceLabel = escapeMarkdownV2(news.sourceName || 'Первоисточник');

  let message = prefix ? `*${prefix}: ${titleText}*` : `*${titleText}*`;

  if (bodyText) {
    const escapedBody = escapeMarkdownV2(bodyText);
    message += `\n\n${escapedBody}`;
  }

  message += `\n\nИсточник: [${sourceLabel}](${link})`;

  return message;
}

async function downloadImage(imageUrl, useProxy = false) {
  const attempts = useProxy ? [true] : [false, true];

  for (const withProxy of attempts) {
    const agent = withProxy ? getProxyAgent() : null;
    if (withProxy && !agent) continue;

    try {
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OrthodoxNewsAggregator/1.0)',
        },
        ...(agent ? { agent } : {}),
      });

      if (!response.ok) {
        logger.warn(`Failed to download image (status ${response.status}, proxy=${withProxy}): ${imageUrl}`);
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();

      if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
        logger.warn(`Image too large (${arrayBuffer.byteLength} bytes), skipping: ${imageUrl}`);
        return null;
      }

      return arrayBuffer;
    } catch (error) {
      logger.warn(`Error downloading image (proxy=${withProxy}) ${imageUrl}: ${error.message}`);
    }
  }

  return null;
}

export async function sendNewsToTelegram(news) {
  assertConfigured();
  const message = buildMessageText(news);
  const CAPTION_LIMIT = 1024;

  try {
    if (news.imageUrl) {
      const imageArrayBuffer = await downloadImage(news.imageUrl, Boolean(news.imageRequiresProxy));

      if (imageArrayBuffer) {
        if (message.length <= CAPTION_LIMIT) {
          return await sendPhotoFile(imageArrayBuffer, message, news.id);
        }
        const photoResult = await sendPhotoFile(imageArrayBuffer, null, news.id);
        if (!photoResult.ok) return photoResult;
        return await sendTextMessage(message, news.id);
      }

      logger.warn(`Falling back to text-only message for news ${news.id} (image download failed)`);
    }

    return await sendTextMessage(message, news.id);
  } catch (err) {
    logger.error('Failed to send news to Telegram', { error: err.message });
    return { ok: false, error: err.message };
  }
}

async function sendTextMessage(text, newsId) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const agent = getProxyAgent();

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHANNEL_ID,
      text,
      parse_mode: 'MarkdownV2',
    }),
    ...(agent ? { agent } : {}),
  });

  const data = await response.json();
  if (!data.ok) {
    logger.error('Telegram sendMessage error', { description: data.description });
    return { ok: false, error: data.description || 'Unknown Telegram API error' };
  }

  logger.info('News sent to Telegram (text)', { newsId, messageId: data.result.message_id });
  return { ok: true, result: data.result };
}

/**
 * Отправляет фото как multipart/form-data через нативный FormData/Blob
 * (Node.js 18+), а не пакет form-data — избегаем несовместимости с node-fetch v3.
 */
async function sendPhotoFile(imageArrayBuffer, caption, newsId) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  const agent = getProxyAgent();

  const form = new FormData();
  form.append('chat_id', CHANNEL_ID);
  form.append('photo', new Blob([imageArrayBuffer]), 'photo.jpg');
  if (caption) {
    form.append('caption', caption);
    form.append('parse_mode', 'MarkdownV2');
  }

  const response = await fetch(url, {
    method: 'POST',
    body: form,
    ...(agent ? { agent } : {}),
  });

  const data = await response.json();
  if (!data.ok) {
    logger.error('Telegram sendPhoto (file) error', { description: data.description });
    return { ok: false, error: data.description || 'Unknown Telegram API error' };
  }

  logger.info('News sent to Telegram (photo file)', { newsId, messageId: data.result.message_id });
  return { ok: true, result: data.result };
}
