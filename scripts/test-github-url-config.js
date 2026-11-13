'use strict';

const assert = require('node:assert/strict');
const urls = require('../app/src/main/assets/github-url-config.js');

async function main() {
  assert.equal(urls.apiUrl(urls.DEFAULT_API_BASE, '/user/repos?per_page=1'),
    'https://api.github.com/user/repos?per_page=1');
  assert.equal(urls.apiUrl('https://mirror.example/github/api/v3/', '/user/repos'),
    'https://mirror.example/github/api/v3/user/repos');

  const defaultRaw = urls.rawContentUrl(urls.DEFAULT_RAW_BASE, 'cue', 'icons', 'main', 'icon/a b.png');
  assert.equal(defaultRaw, 'https://raw.githubusercontent.com/cue/icons/main/icon/a%20b.png');
  const customRaw = urls.rawContentUrl('https://mirror.example/github/raw/', 'cue', 'icons', 'feature/x', 'icon/a b.png');
  assert.equal(customRaw, 'https://mirror.example/github/raw/cue/icons/feature%2Fx/icon/a%20b.png');
  assert.deepEqual(urls.rawReference(defaultRaw, [urls.DEFAULT_RAW_BASE], 'cue', 'icons'),
    { owner: 'cue', repository: 'icons', ref: 'main', path: 'icon/a b.png' });
  assert.deepEqual(urls.rawReference(customRaw, ['https://mirror.example/github/raw'], 'cue', 'icons'),
    { owner: 'cue', repository: 'icons', ref: 'feature/x', path: 'icon/a b.png' });

  for (const invalid of [
    'http://mirror.example/api',
    'https://user:pass@mirror.example/api',
    'https://mirror.example/api?token=secret',
    'https://mirror.example/api#section'
  ]) assert.throws(() => urls.normalizeBaseUrl(invalid), /HTTPS URL/);

  let observed;
  const fakeFetch = async (url, options) => {
    observed = { url, options };
    return { status: 200, ok: true };
  };
  await urls.fetchApi('/user/repos?per_page=1', { method: 'GET' },
    'https://proxy.example/github/api/v3', 'fake-test-token', fakeFetch);
  assert.equal(observed.url, 'https://proxy.example/github/api/v3/user/repos?per_page=1');
  assert.equal(observed.options.headers.get('Authorization'), 'Bearer fake-test-token');
  assert.equal(observed.options.credentials, 'omit');
  assert.equal(observed.options.referrerPolicy, 'no-referrer');
  assert.equal(observed.options.cache, 'no-store');

  await urls.fetchApi('/user/repos', { method: 'GET', headers: { Authorization: 'stale-value' } },
    urls.DEFAULT_API_BASE, '', fakeFetch);
  assert.equal(observed.options.headers.has('Authorization'), false);
  assert.equal(customRaw.includes('fake-test-token'), false);
  console.log('GitHub URL configuration tests passed (default/custom bases; mocked requests only).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
