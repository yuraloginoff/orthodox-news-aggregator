// public/site.js
// Публичная лента новостей. Читает /api/public/news и /api/public/filters.
// Состояние синхронизировано с URL (аналогично admin.js) — фильтры сохраняются в закладки.

const urlParams = new URLSearchParams(window.location.search);
let state = {
  page: Number(urlParams.get('page')) || 1,
  limit: 20,
  jurisdiction: urlParams.get('jurisdiction') || '',
  country: urlParams.get('country') || '',
  date: urlParams.get('date') || '',
  q: urlParams.get('q') || '',
};

const newsListEl = document.getElementById('newsList');
const jurisdictionFilterEl = document.getElementById('jurisdictionFilter');
const countryFilterEl = document.getElementById('countryFilter');
const dateFilterEl = document.getElementById('dateFilter');
const searchInputEl = document.getElementById('searchInput');
const pageInfoEl = document.getElementById('pageInfo');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');

const JURISDICTION_LABELS = {
  ROC: 'РПЦ (Московский патриархат)',
  UOC: 'УПЦ',
  OCU: 'ПЦУ',
  Moldova_ROC: 'Молдова (МП)',
  Moldova_ROM: 'Митрополия Бессарабии',
  Armenia: 'Армянская церковь',
  Greece_HOC: 'Элладская церковь',
  Greece_CP: 'Греция (Константинополь)',
  Athos: 'Афон',
  Other: 'Другое',
};

const COUNTRY_LABELS = {
  RU: 'Россия', UA: 'Украина', MD: 'Молдова', AM: 'Армения', GR: 'Греция',
  BY: 'Беларусь', KZ: 'Казахстан', GE: 'Грузия', RS: 'Сербия', BG: 'Болгария',
  RO: 'Румыния', other: 'Прочие',
};

function syncUrl() {
  const params = new URLSearchParams();
  if (state.jurisdiction) params.set('jurisdiction', state.jurisdiction);
  if (state.country) params.set('country', state.country);
  if (state.date) params.set('date', state.date);
  if (state.q) params.set('q', state.q);
  if (state.page > 1) params.set('page', String(state.page));
  const query = params.toString();
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
}

async function loadFilters() {
  try {
    const res = await fetch('/api/public/filters');
    const data = await res.json();

    jurisdictionFilterEl.innerHTML =
      '<option value="">Все</option>' +
      data.jurisdictions.map((j) => `<option value="${j}">${JURISDICTION_LABELS[j] || j}</option>`).join('');

    countryFilterEl.innerHTML =
      '<option value="">Все</option>' +
      data.countries.map((c) => `<option value="${c}">${COUNTRY_LABELS[c] || c}</option>`).join('');

    jurisdictionFilterEl.value = state.jurisdiction;
    countryFilterEl.value = state.country;
  } catch (err) {
    console.error('Failed to load filters', err);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function renderCard(news) {
  const badge = news.sourceRegion || JURISDICTION_LABELS[news.jurisdiction] || news.jurisdiction || '';

  return `
    <article class="news-card">
      <div class="news-card__meta">
        ${badge ? `<span class="news-card__badge">${escapeHtml(badge)}</span>` : ''}
        <span>${escapeHtml(news.sourceName)}</span>
        <span>&middot;</span>
        <time datetime="${news.publishedAt}">${formatDate(news.publishedAt)}</time>
      </div>
      <h2 class="news-card__title"><a href="${news.link}" target="_blank" rel="noopener noreferrer">${escapeHtml(news.title)}</a></h2>
      <p class="news-card__summary">${escapeHtml(news.summary)}</p>
      <a class="news-card__link" href="${news.link}" target="_blank" rel="noopener noreferrer">Читать далее &rarr;</a>
    </article>
  `;
}

let debounceTimer = null;

async function loadNews() {
  newsListEl.setAttribute('aria-busy', 'true');

  const params = new URLSearchParams({
    page: state.page,
    limit: state.limit,
    jurisdiction: state.jurisdiction,
    country: state.country,
    date: state.date,
    q: state.q,
  });

  syncUrl();

  try {
    const res = await fetch(`/api/public/news?${params}`);
    const data = await res.json();

    if (data.news.length === 0) {
      newsListEl.innerHTML = `
        <div class="empty-state">
          <h3>Новостей не найдено</h3>
          <p>Попробуйте изменить фильтры или период.</p>
        </div>`;
    } else {
      newsListEl.innerHTML = data.news.map(renderCard).join('');
    }

    const totalPages = Math.max(1, Math.ceil(data.total / data.limit));
    pageInfoEl.textContent = `Стр. ${data.page} из ${totalPages} (всего: ${data.total})`;
    prevPageBtn.disabled = data.page <= 1;
    nextPageBtn.disabled = data.page >= totalPages;
  } catch (err) {
    newsListEl.innerHTML = `
      <div class="error-state">
        <h3>Не удалось загрузить новости</h3>
        <p>Проверьте подключение к интернету и попробуйте обновить страницу.</p>
      </div>`;
    console.error(err);
  } finally {
    newsListEl.removeAttribute('aria-busy');
  }
}

jurisdictionFilterEl.addEventListener('change', (e) => {
  state.jurisdiction = e.target.value;
  state.page = 1;
  loadNews();
});

countryFilterEl.addEventListener('change', (e) => {
  state.country = e.target.value;
  state.page = 1;
  loadNews();
});

dateFilterEl.addEventListener('change', (e) => {
  state.date = e.target.value;
  state.page = 1;
  loadNews();
});

searchInputEl.addEventListener('input', (e) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    state.page = 1;
    loadNews();
  }, 400);
});

prevPageBtn.addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    loadNews();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

nextPageBtn.addEventListener('click', () => {
  state.page += 1;
  loadNews();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

dateFilterEl.value = state.date;
searchInputEl.value = state.q;

(function () {
  const toggle = document.getElementById('themeToggle');
  const root = document.documentElement;
  let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.setAttribute('data-theme', theme);

  function renderIcon() {
    toggle.innerHTML = theme === 'dark'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему');
  }

  renderIcon();
  toggle.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    renderIcon();
  });
})();

loadFilters();
loadNews();
