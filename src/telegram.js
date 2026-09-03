// src/telegram.js
// Отправка новостей в Telegram-канал через Bot API.
// Использует уже установленный node-fetch, дополнительных зависимостей не требует.

import fetch from 'node-fetch';
import logger from './logger.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

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
  const title = escapeMarkdownV2(news.title || 'Без заголовка');
  const bodyText = (news.text || '').trim();
  const link = news.link;
  const sourceLabel = escapeMarkdownV2(news.sourceName || 'Первоисточник');

  let message = `*${title}*`;

  if (bodyText) {
    const escapedBody = escapeMarkdownV2(bodyText);
    message += `\n\n${escapedBody}`;
  }

  message += `\n\nИсточник: [${sourceLabel}](${link})`;

  return message;
}

export async function sendNewsToTelegram(news) {
  assertConfigured();
  const message = buildMessageText(news);
  const CAPTION_LIMIT = 1024;

  try {
    if (news.imageUrl) {
      if (message.length <= CAPTION_LIMIT) {
        return await sendPhoto(news.imageUrl, message, news.id);
      }
      const photoResult = await sendPhoto(news.imageUrl, null, news.id);
      if (!photoResult.ok) return photoResult;
      return await sendTextMessage(message, news.id);
    }

    return await sendTextMessage(message, news.id);
  } catch (err) {
    logger.error('Failed to send news to Telegram', { error: err.message });
    return { ok: false, error: err.message };
  }
}

async function sendTextMessage(text, newsId) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHANNEL_ID,
      text,
      parse_mode: 'MarkdownV2',
    }),
  });

  const data = await response.json();
  if (!data.ok) {
    logger.error('Telegram sendMessage error', { description: data.description });
    return { ok: false, error: data.description || 'Unknown Telegram API error' };
  }

  logger.info('News sent to Telegram (text)', { newsId, messageId: data.result.message_id });
  return { ok: true, result: data.result };
}

async function sendPhoto(imageUrl, caption, newsId) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  const body = {
    chat_id: CHANNEL_ID,
    photo: imageUrl,
  };
  if (caption) {
    body.caption = caption;
    body.parse_mode = 'MarkdownV2';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!data.ok) {
    logger.error('Telegram sendPhoto error', { description: data.description, imageUrl });
    return { ok: false, error: data.description || 'Unknown Telegram API error' };
  }

  logger.info('News sent to Telegram (photo)', { newsId, messageId: data.result.message_id });
  return { ok: true, result: data.result };
}
