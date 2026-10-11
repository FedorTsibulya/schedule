// Хранение данных.
//
// На GitHub Pages: data.json лежит в ветке `data` того же репозитория. Сайт собирается
// из основной ветки, поэтому сохранения не запускают пересборку Pages и видны сразу.
// Владелец и репозиторий определяются по адресу страницы (<владелец>.github.io/<репозиторий>),
// так что репозиторий можно передать или скопировать в другой аккаунт без правок кода.
//
// Локально (localhost, файл): данные берутся из data.json (или ?src=файл.json),
// а изменения сохраняются в localStorage этого браузера.
(function (root) {
  'use strict';

  const API = 'https://api.github.com';
  const DATA_BRANCH = 'data';
  const DATA_PATH = 'data.json';
  const TOKEN_KEY = 'schedule.token';
  const LOCAL_KEY = 'schedule.localData';

  const params = new URLSearchParams(location.search);

  function repo() {
    const q = params.get('repo');
    if (q && /^[\w.-]+\/[\w.-]+$/.test(q)) {
      const [owner, name] = q.split('/');
      return { owner, name };
    }
    const host = location.hostname;
    if (!host.endsWith('.github.io')) return null;
    const owner = host.split('.')[0];
    const first = location.pathname.split('/').filter(Boolean)[0];
    return { owner, name: first && !first.includes('.') ? first : host };
  }

  const mode = () => (repo() ? 'github' : 'local');

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  }
  function setToken(token) {
    try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* приватный режим */ }
  }

  function api(path, opts = {}, token = getToken()) {
    const headers = { Accept: 'application/vnd.github+json', ...(opts.headers || {}) };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(API + path, { cache: 'no-store', ...opts, headers });
  }

  // base64 <-> UTF-8 (в данных кириллица)
  function encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  class StorageError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  async function readFromApi(r) {
    const res = await api(`/repos/${r.owner}/${r.name}/contents/${DATA_PATH}?ref=${DATA_BRANCH}`);
    if (!res.ok) throw new StorageError(res.status === 404 ? 'not_found' : 'http', 'GitHub API: ' + res.status);
    const json = await res.json();
    return { data: JSON.parse(decode(json.content)), sha: json.sha };
  }

  async function load() {
    const r = repo();
    if (!r) {
      const src = params.get('src');
      if (!src) {
        try {
          const saved = localStorage.getItem(LOCAL_KEY);
          if (saved) return { data: JSON.parse(saved), sha: null };
        } catch { /* нет доступа к localStorage — читаем файл */ }
      }
      const res = await fetch((src || DATA_PATH) + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new StorageError('http', 'Не удалось загрузить ' + (src || DATA_PATH));
      return { data: await res.json(), sha: null };
    }
    try {
      return await readFromApi(r);
    } catch (e) {
      // Лимит анонимных запросов к API (60 в час на IP) — читаем копию с raw (кэш до 5 минут)
      const res = await fetch(`https://raw.githubusercontent.com/${r.owner}/${r.name}/${DATA_BRANCH}/${DATA_PATH}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw e;
      return { data: await res.json(), sha: null };
    }
  }

  // Сохраняет данные; возвращает новый sha. Ошибки: conflict, auth, http.
  async function save(data, sha) {
    const r = repo();
    const text = JSON.stringify(data, null, 1);
    if (!r) {
      localStorage.setItem(LOCAL_KEY, text);
      return null;
    }
    if (!sha) sha = (await readFromApi(r)).sha;
    const res = await api(`/repos/${r.owner}/${r.name}/contents/${DATA_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Обновление расписания', content: encode(text), sha, branch: DATA_BRANCH }),
    });
    if (res.status === 409 || res.status === 422) throw new StorageError('conflict', 'Данные изменились на другом устройстве');
    if (res.status === 401 || res.status === 403) throw new StorageError('auth', 'Токен не подходит или истёк');
    if (!res.ok) throw new StorageError('http', 'GitHub API: ' + res.status);
    return (await res.json()).content.sha;
  }

  // Проверяет, что токен даёт право записи в репозиторий.
  async function verifyToken(token) {
    const r = repo();
    if (!r) return true;
    const res = await api(`/repos/${r.owner}/${r.name}`, {}, token);
    if (!res.ok) return false;
    const json = await res.json();
    // у fine-grained токенов поля permissions может не быть — тогда право записи проверит первое сохранение
    return !json.permissions || !!json.permissions.push;
  }

  function resetLocal() {
    try { localStorage.removeItem(LOCAL_KEY); } catch { /* ничего */ }
  }

  root.Storage = { repo, mode, load, save, getToken, setToken, verifyToken, resetLocal, StorageError };
})(window);
