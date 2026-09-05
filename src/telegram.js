// src/telegram.js
// Отправка новостей в Telegram-канал через Bot API.
// api.telegram.org заблокирован для российских IP, поэтому запросы идут через
// тот же SOCKS5-прокси (RSS_PROXY_URL), что и парсер для UA3/MD1.

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

async function sendPhoto(imageUrl, caption, newsId) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  const agent = getProxyAgent();
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
    ...(agent ? { agent } : {}),
  });

  const data = await response.json();
  if (!data.ok) {
    logger.error('Telegram sendPhoto error', { description: data.description, imageUrl });
    return { ok: false, error: data.description || 'Unknown Telegram API error' };
  }

  logger.info('News sent to Telegram (photo)', { newsId, messageId: data.result.message_id });
  return { ok: true, result: data.result };
}
