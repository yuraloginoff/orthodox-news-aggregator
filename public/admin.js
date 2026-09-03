// public/admin.js
// Vanilla JS фронтенд админки — без фреймворков и сборщиков.

let state = { page: 1, limit: 20, source: '', status: 'unsent' };

const newsListEl = document.getElementById('newsList');
const sourceFilterEl = document.getElementById('sourceFilter');
const statusFilterEl = document.getElementById('statusFilter');
const pageInfoEl = document.getElementById('pageInfo');

async function loadSources() {
  const res = await fetch('/api/sources');
  const sources = await res.json();
  sourceFilterEl.innerHTML =
    '<option value="">Все источники</option>' +
    sources.map((s) => `<option value="${s}">${s}</option>`).join('');
}

async function loadNews() {
  newsListEl.innerHTML = '<p class="loading">Загрузка...</p>';

  const params = new URLSearchParams({
    page: state.page,
    limit: state.limit,
    source: state.source,
    status: state.status,
  });

  const res = await fetch(`/api/news?${params}`);
  const data = await res.json();

  if (data.news.length === 0) {
    newsListEl.innerHTML = '<p class="empty">Новостей нет</p>';
  } else {
    newsListEl.innerHTML = data.news.map(renderNewsCard).join('');
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.limit));
  pageInfoEl.textContent = `Стр. ${data.page} из ${totalPages} (всего: ${data.total})`;

  attachHandlers();
}

function renderNewsCard(news) {
  const sentBadge = news.sent_to_telegram
    ? '<span class="status-badge sent">отправлено</span>'
    : '<span class="status-badge unsent">не отправлено</span>';

  const date = news.publishedAt
    ? new Date(news.publishedAt).toLocaleString('ru-RU')
    : '—';

  const imagePreview = news.image_url
    ? `<div class="image-preview">
         <img src="${escapeAttr(news.image_url)}" alt="preview" onerror="this.parentElement.style.display='none'">
         <button class="btn-remove-image" data-action="remove-image" data-id="${news.id}">Убрать картинку</button>
       </div>`
    : `<div class="image-preview empty-image">Картинка не найдена в источнике</div>`;

  return `
    <div class="news-card ${news.sent_to_telegram ? 'sent' : ''}" data-id="${news.id}">
      <div class="meta">${news.sourceId} · ${date} ${sentBadge}</div>

      <label class="field-label">Заголовок</label>
      <textarea class="title" rows="2">${escapeHtml(news.title)}</textarea>

      <label class="field-label">Текст (превью для Telegram)</label>
      <textarea class="body-text" rows="5">${escapeHtml(news.preview_text)}</textarea>

      ${imagePreview}

      <label class="field-label">URL картинки (можно заменить вручную)</label>
      <input class="image-url-input" type="text" value="${escapeAttr(news.image_url || '')}" placeholder="https://...">

      <div class="actions">
        <button class="btn-save" data-action="save" data-id="${news.id}">Сохранить</button>
        <button class="btn-send" data-action="send" data-id="${news.id}">Отправить в Telegram</button>
        <a class="btn-link" href="${news.link}" target="_blank" rel="noopener">Открыть источник</a>
        ${
          news.hidden
            ? `<button class="btn-unhide" data-action="unhide" data-id="${news.id}">Показать</button>`
            : `<button class="btn-hide" data-action="hide" data-id="${news.id}">Скрыть</button>`
        }
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;');
}

function getCardValues(card) {
  return {
    title: card.querySelector('.title').value,
    text: card.querySelector('.body-text').value,
    imageUrl: card.querySelector('.image-url-input').value,
  };
}

function attachHandlers() {
  document.querySelectorAll('[data-action="save"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.news-card');
      const { title, text, imageUrl } = getCardValues(card);

      btn.disabled = true;
      btn.textContent = 'Сохранение...';

      await fetch(`/api/news/${btn.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, text, imageUrl }),
      });

      btn.disabled = false;
      btn.textContent = 'Сохранено ✓';
      setTimeout(() => (btn.textContent = 'Сохранить'), 1500);
    });
  });

  document.querySelectorAll('[data-action="send"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const card = btn.closest('.news-card');
      const { title, text, imageUrl } = getCardValues(card);

      btn.disabled = true;
      btn.textContent = 'Отправка...';

      const res = await fetch(`/api/news/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, text, imageUrl }),
      });

      if (res.ok) {
        loadNews();
      } else {
        const err = await res.json();
        alert('Ошибка отправки: ' + err.error);
        btn.disabled = false;
        btn.textContent = 'Отправить в Telegram';
      }
    });
  });

  document.querySelectorAll('[data-action="remove-image"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.news-card');
      card.querySelector('.image-url-input').value = '';
      card.querySelector('.image-preview').outerHTML =
        '<div class="image-preview empty-image">Картинка убрана</div>';
    });
  });

  document.querySelectorAll('[data-action="hide"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/news/${btn.dataset.id}/hide`, { method: 'POST' });
      loadNews();
    });
  });

  document.querySelectorAll('[data-action="unhide"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/news/${btn.dataset.id}/unhide`, { method: 'POST' });
      loadNews();
    });
  });
}

sourceFilterEl.addEventListener('change', (e) => {
  state.source = e.target.value;
  state.page = 1;
  loadNews();
});

statusFilterEl.addEventListener('change', (e) => {
  state.status = e.target.value;
  state.page = 1;
  loadNews();
});

document.getElementById('refreshBtn').addEventListener('click', loadNews);

document.getElementById('prevPage').addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    loadNews();
  }
});

document.getElementById('nextPage').addEventListener('click', () => {
  state.page += 1;
  loadNews();
});

loadSources();
loadNews();
