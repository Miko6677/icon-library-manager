#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/app.js'), 'utf8');
function extract(startMarker, endMarker, label) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `could not locate ${label}`);
  return app.slice(start, end).trim();
}
const indexPathSource = extract('  function isIconIndexPath(path) {', '\n\n  const $ =', 'icon index path matcher');
const browserHelpersSource = extract('  function iconRootForPath(path) {', '\n\n  const $ =', 'category directory helpers');
const cacheSource = extract('  function getCachedLibrarySnapshot(owner, name)', '\n  async function loadRepositoryState()', 'repository cache loader');
const loaderSource = extract('  async function loadRepositoryState() {', '\n  async function refreshCurrentLibrary()', 'repository loader');
const selectSource = extract('  async function selectRepository(item,', '\n  function encodePath(', 'repository selection');
const promptSource = extract('  function updateIndexSelectPrompt() {', '\n  function renderActiveCategory()', 'empty-index prompt');

const uppercaseIndexEntry = {
  name: '01',
  url: 'https://raw.githubusercontent.com/mock-owner/uppercase-icons-demo/main/Icons/Cute_Cartoon/01.png'
};
const repoFixtures = {
  'me/personal-icon-library': { files: [{ path: 'README.md', type: 'blob', sha: 'readme' }] },
  'mock-owner/uppercase-icons-demo': {
    files: [{ path: 'Icons/Cute_Cartoon/tubiao.json', type: 'blob', sha: 'uppercase-index-blob' }],
    blobSha: 'uppercase-index-blob'
  },
  'me/offline-with-snapshot': { offline: true },
  'me/offline-without-snapshot': { offline: true }
};
const cachedSnapshots = new Map();
const uppercaseIndexOfflineSnapshot = {
  version: 1,
  owner: 'me',
  name: 'offline-with-snapshot',
  branch: 'main',
  commitSha: 'cached-commit',
  baseTreeSha: 'cached-tree',
  activeCategoryPath: 'Icons/Cute_Cartoon/tubiao.json',
  treePaths: ['Icons/Cute_Cartoon/tubiao.json', 'Icons/Cute_Cartoon/01.png'],
  categories: [{
    path: 'Icons/Cute_Cartoon/tubiao.json',
    data: { name: '可爱动漫', description: '', icons: [uppercaseIndexEntry] },
    assetDirectory: 'Icons/Cute_Cartoon'
  }]
};
cachedSnapshots.set('me/offline-with-snapshot', JSON.stringify(uppercaseIndexOfflineSnapshot));

const savedRepositories = [];
const calls = { requests: [], statuses: [], screens: [], connected: [], renderedChoices: [], writes: 0 };
const noopClassList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const sandbox = {
  selectedOwner: 'me',
  selectedRepoName: 'personal-icon-library',
  repository: { full_name: 'me/personal-icon-library', default_branch: 'main' },
  branch: 'main', commitSha: 'empty-index-commit', baseTreeSha: 'empty-index-tree',
  treeFiles: new Map(), repositoryDirectories: new Set(), categories: [], activeCategoryPath: '', categoryBrowsePath: '', librarySnapshotStale: false,
  settingsRepoPickerOpen: true, accessibleRepositories: [], appLanguage: 'zh-CN', busy: false,
  ICON_ROOT: 'icon',
  stagedCategories: new Map(), stagedMoves: [],
  resetFolderStageState() {},
  ui: {
    branchLabel: { textContent: '' },
    repoPickerError: { classList: noopClassList },
    repoChipLabel: { textContent: '' },
    currentRepoLink: { href: '', textContent: '', classList: noopClassList },
    indexSelectKicker: { textContent: '' },
    indexSelectTitle: { textContent: '' },
    indexSelectHelp: { textContent: '' }
  },
  window: {
    CueAppSettings: {
      getCachedLibrarySnapshotFor(owner, name) {
        return cachedSnapshots.get(`${owner.toLowerCase()}/${name.toLowerCase()}`) || '';
      }
    }
  },
  encodeURIComponent,
  repositoryApiPath: () => `/repos/${sandbox.selectedOwner}/${sandbox.selectedRepoName}`,
  async request(url) {
    const owner = sandbox.selectedOwner;
    const repoName = sandbox.selectedRepoName;
    calls.requests.push({ owner, repoName, url });
    const fixture = repoFixtures[`${owner}/${repoName}`];
    if (fixture?.offline) throw new Error('mock network unavailable');
    if (!fixture) throw new Error(`unexpected mocked repository: ${owner}/${repoName}`);
    const base = `/repos/${owner}/${repoName}`;
    if (url === base) return { full_name: `${owner}/${repoName}`, default_branch: 'main' };
    if (url === `${base}/git/ref/heads/main`) return { object: { sha: `${repoName}-commit` } };
    if (url === `${base}/git/commits/${repoName}-commit`) return { tree: { sha: `${repoName}-tree` } };
    if (url === `${base}/git/trees/${repoName}-tree?recursive=1`) return { truncated: false, tree: fixture.files };
    if (fixture.blobSha && url === `${base}/git/blobs/${fixture.blobSha}`) {
      return { content: Buffer.from(JSON.stringify({ name: '可爱动漫', description: '', icons: [uppercaseIndexEntry] })).toString('base64') };
    }
    throw new Error(`unexpected mocked read: ${url}`);
  },
  decodeBase64Utf8(value) { return Buffer.from(value, 'base64').toString('utf8'); },
  defaultAssetDirectory() { return 'Icons/Cute_Cartoon'; },
  persistLibrarySnapshot() { return true; },
  updateStagedUi() {},
  syncLockedControls() {},
  renderCategories() {},
  renderActiveCategory() {},
  renderRepositoryChoices(repositories) {
    calls.renderedChoices.push({ selected: sandbox.selectedRepoName, available: repositories.map((item) => item.name) });
  },
  saveSelectedRepository(owner, name) {
    savedRepositories.push(`${owner}/${name}`);
    return true;
  },
  setBusy(value) { sandbox.busy = value; },
  setConnected(value) { calls.connected.push(value); },
  showStatus(message, kind) { calls.statuses.push({ message, kind }); },
  showToast(message) { calls.statuses.push({ message, kind: 'toast' }); },
  setActiveScreen(screen) { calls.screens.push(screen); }
};

vm.runInNewContext(`${indexPathSource}\n${browserHelpersSource}\n${cacheSource}\n${loaderSource}\n${selectSource}\n${promptSource}\nglobalThis.__loadRepositoryState = loadRepositoryState;\nglobalThis.__selectRepository = selectRepository;\nglobalThis.__updateIndexSelectPrompt = updateIndexSelectPrompt;`, sandbox, { filename: 'repository-switching-under-test.js' });
const selectRepository = sandbox.__selectRepository;
const updateIndexSelectPrompt = sandbox.__updateIndexSelectPrompt;
const repositories = [
  { owner: { login: 'me' }, name: 'personal-icon-library', full_name: 'me/personal-icon-library', default_branch: 'main' },
  { owner: { login: 'mock-owner' }, name: 'uppercase-icons-demo', full_name: 'mock-owner/uppercase-icons-demo', default_branch: 'main' },
  { owner: { login: 'me' }, name: 'offline-with-snapshot', full_name: 'me/offline-with-snapshot', default_branch: 'main' },
  { owner: { login: 'me' }, name: 'offline-without-snapshot', full_name: 'me/offline-without-snapshot', default_branch: 'main' }
];
sandbox.accessibleRepositories = repositories;

(async () => {
  // The real loader sees the empty current repository and does not throw or clear its selection.
  const emptySnapshotSaved = await sandbox.__loadRepositoryState();
  assert.equal(emptySnapshotSaved, false, 'an empty-index repository has no library snapshot to save');
  assert.equal(sandbox.categories.length, 0, 'the selected repository should contain no displayed categories');

  // Reproduce repository switching with the real app code: current repository → uppercase-index demo → current repository.
  assert.equal(await selectRepository(repositories[1]), true, 'the uppercase-index demo must be selectable from an empty-index repository');
  assert.equal(sandbox.selectedOwner, 'mock-owner');
  assert.equal(sandbox.selectedRepoName, 'uppercase-icons-demo');
  assert.equal(sandbox.categories.length, 1, 'an uppercase Icons/ index should be discovered');
  assert.equal(sandbox.categories[0].path, 'Icons/Cute_Cartoon/tubiao.json', 'preserve the repository path case');
  assert.equal(sandbox.categories[0].label, '可爱动漫');
  assert.equal(sandbox.categories[0].icons.length, 1);
  assert.equal(savedRepositories.at(-1), 'mock-owner/uppercase-icons-demo');

  assert.equal(await selectRepository(repositories[0]), true, 'switching back to the original empty-index repository should succeed');
  assert.equal(sandbox.selectedOwner, 'me');
  assert.equal(sandbox.selectedRepoName, 'personal-icon-library');
  assert.equal(sandbox.categories.length, 0, 'switching back should show no categories without undoing the repository selection');
  assert.equal(savedRepositories.at(-1), 'me/personal-icon-library');
  assert.equal(calls.connected.at(-1), true, 'a selected repository stays connected even with no JSON icon index');
  assert.equal(calls.screens.at(-1), 'library', 'successful selection returns to the library screen');
  updateIndexSelectPrompt();
  assert.match(sandbox.ui.indexSelectTitle.textContent, /没有可管理的图标索引/);
  assert.match(sandbox.ui.indexSelectHelp.textContent, /切换到其他可访问仓库/);
  assert.ok(calls.renderedChoices.some((entry) => entry.selected === 'personal-icon-library' && entry.available.includes('uppercase-icons-demo')),
    'the accessible repository list should still offer the uppercase-index demo after returning');

  sandbox.appLanguage = 'en';
  updateIndexSelectPrompt();
  assert.match(sandbox.ui.indexSelectHelp.textContent, /switch to another accessible repository/i);
  sandbox.appLanguage = 'zh-CN';

  // A cached target using uppercase Icons/ is allowed offline and remains stale/read-only.
  assert.equal(await selectRepository(repositories[2]), true, 'a target with a per-repository cached snapshot may open read-only offline');
  assert.equal(sandbox.selectedRepoName, 'offline-with-snapshot');
  assert.equal(sandbox.categories[0].path, 'Icons/Cute_Cartoon/tubiao.json', 'uppercase index paths must restore from cache');
  assert.equal(sandbox.librarySnapshotStale, true, 'offline cache remains marked stale/read-only');
  const selectedBeforeMissingCache = sandbox.selectedRepoName;
  assert.equal(await selectRepository(repositories[3]), false, 'an offline target without a saved snapshot must not replace the current library');
  assert.equal(sandbox.selectedRepoName, selectedBeforeMissingCache, 'failed offline switch must preserve the prior repository selection');

  assert.equal(calls.writes, 0, 'mock scenario must never issue a GitHub write');
  assert.ok(calls.requests.length > 0, 'repository loading should run through mocked reads');
  console.log('Repository switching regressions passed (empty index → uppercase-index demo → back; uppercase index discovery/cache; offline safety; no writes).');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
