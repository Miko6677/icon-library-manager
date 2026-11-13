(function attachGitHubUrlConfig(root) {
  'use strict';

  const DEFAULT_API_BASE = 'https://api.github.com';
  const DEFAULT_RAW_BASE = 'https://raw.githubusercontent.com';

  function normalizeBaseUrl(value) {
    const input = String(value || '').trim();
    if (!input) throw new Error('请输入 HTTPS 基址。');
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new Error('基址不是有效的 URL。');
    }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
      throw new Error('基址必须是无用户名、密码、查询参数或片段的 HTTPS URL。');
    }
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path}`;
  }

  function joinBaseUrl(base, relativePath) {
    const normalizedBase = normalizeBaseUrl(base);
    const path = String(relativePath || '').replace(/^\/+/, '');
    return path ? `${normalizedBase}/${path}` : normalizedBase;
  }

  function apiUrl(base, path) {
    return joinBaseUrl(base, path);
  }

  function rawContentUrl(base, owner, repository, ref, filePath) {
    const segments = [owner, repository, ref, ...String(filePath || '').split('/')];
    if (segments.some((segment) => !String(segment || '').trim())) {
      throw new Error('仓库、分支和文件路径都必须有值。');
    }
    return joinBaseUrl(base, segments.map((segment) => encodeURIComponent(String(segment))).join('/'));
  }

  function rawReference(value, bases, expectedOwner, expectedRepository) {
    try {
      const target = new URL(value);
      for (const candidate of [...new Set((bases || []).filter(Boolean))]) {
        const base = new URL(normalizeBaseUrl(candidate));
        if (target.origin !== base.origin) continue;
        const basePath = base.pathname.replace(/\/+$/, '');
        const prefix = `${basePath}/` || '/';
        if (!target.pathname.startsWith(prefix)) continue;
        const suffix = target.pathname.slice(prefix.length);
        const segments = suffix.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
        if (segments.length < 4) continue;
        if (expectedOwner && segments[0].toLowerCase() !== String(expectedOwner).toLowerCase()) continue;
        if (expectedRepository && segments[1].toLowerCase() !== String(expectedRepository).toLowerCase()) continue;
        return { owner: segments[0], repository: segments[1], ref: segments[2], path: segments.slice(3).join('/') };
      }
    } catch { /* Keep unknown external URLs unchanged. */ }
    return null;
  }

  async function fetchApi(path, options, base, token, fetchImpl) {
    const fetcher = fetchImpl || root.fetch;
    if (typeof fetcher !== 'function') throw new Error('当前环境不支持网络请求。');
    const headers = new Headers((options && options.headers) || {});
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', '2022-11-28');
    headers.delete('Authorization');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options && options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetcher(apiUrl(base, path), {
      ...(options || {}),
      headers,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
  }

  const api = Object.freeze({
    DEFAULT_API_BASE,
    DEFAULT_RAW_BASE,
    normalizeBaseUrl,
    joinBaseUrl,
    apiUrl,
    rawContentUrl,
    rawReference,
    fetchApi
  });
  root.CueGitHubUrlConfig = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {}));
