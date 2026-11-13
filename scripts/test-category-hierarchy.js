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
const indexPathSource = extract('  function isIconIndexPath(path) {', '\n\n  function iconRootForPath', 'index path matcher');
const browserHelpersSource = extract('  function iconRootForPath(path) {', '\n\n  const $ =', 'directory tree helpers');
const defaultAssetDirectorySource = extract('  function defaultAssetDirectory(indexPath, entries) {', '\n\n  function persistLibrarySnapshot()', 'image folder inference');
const loaderSource = extract('  async function loadRepositoryState() {', '\n\n  async function refreshCurrentLibrary()', 'repository tree loader');
const navigationSource = extract('  function canGoBackInCategoryBrowser() {', '\n\n  function renderCategoryBrowserNavigation()', 'folder navigation handlers');
const uploadSource = extract('  async function uploadSelected() {', '\n\n  async function deleteIcon(', 'upload preparation');

const indexPath = {
  parent: 'icon/方图/index.json',
  child: 'icon/方图/动画/catalog.json',
  sibling: 'icon/方图/sibling.json',
  malformed: 'icon/方图/broken.json'
};
const oldImagePath = 'icon/方图/shared/old.png';
const entries = [
  { path: 'icon', type: 'tree' },
  { path: 'icon/方图', type: 'tree' },
  { path: 'icon/方图/动画', type: 'tree' },
  { path: 'icon/方图/shared', type: 'tree' },
  { path: 'icon/方图/空文件夹', type: 'tree' },
  { path: 'icon/方图/空文件夹/.gitkeep', type: 'blob', sha: 'empty-placeholder' },
  { path: oldImagePath, type: 'blob', sha: 'old-image' },
  { path: indexPath.parent, type: 'blob', sha: 'parent-index' },
  { path: indexPath.child, type: 'blob', sha: 'child-index' },
  { path: indexPath.sibling, type: 'blob', sha: 'sibling-index' },
  { path: indexPath.malformed, type: 'blob', sha: 'broken-index' }
];
const encoded = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
const oldImageUrl = `https://raw.githubusercontent.com/mock-owner/mock-icon-library/main/${oldImagePath}`;
const blobs = {
  'parent-index': encoded({ name: '方图', description: '', icons: [{ name: '旧图', url: oldImageUrl }] }),
  'child-index': encoded({ name: '动画', description: '子分类', icons: [] }),
  'sibling-index': encoded({ name: '同层索引', description: '', icons: [{ name: '兄弟图', url: oldImageUrl }] }),
  'broken-index': Buffer.from('{ not json', 'utf8').toString('base64')
};
const calls = { reads: [], writes: 0, saved: [], renderCount: 0 };
const sandbox = {
  ICON_ROOT: 'icon',
  selectedOwner: 'mock-owner', selectedRepoName: 'mock-icon-library', repository: null,
  branch: '', commitSha: '', baseTreeSha: '', treeFiles: new Map(), repositoryDirectories: new Set(),
  categories: [], activeCategoryPath: indexPath.child, categoryBrowsePath: '',
  librarySnapshotStale: false, busy: false, cutoutBusy: false, pendingCutout: null,
  stagedCategories: new Map(), stagedMoves: [], selectedFiles: [], selectedFileNames: [],
  token: 'token-must-not-be-changed', appLanguage: 'zh-CN',
  ui: { branchLabel: { textContent: '' }, categoryList: { scrollLeft: 0, scrollTop: 0 } },
  GitHubUrls: {
    rawContentUrl(_base, owner, repository, ref, filePath) {
      return `https://raw.githubusercontent.com/${owner}/${repository}/${ref}/${filePath}`;
    }
  },
  rawContentBaseUrl: 'https://raw.githubusercontent.com', rawBaseHistory: [],
  repositoryApiPath: () => `/repos/${sandbox.selectedOwner}/${sandbox.selectedRepoName}`,
  async request(url) {
    calls.reads.push(url);
    const base = '/repos/mock-owner/mock-icon-library';
    if (url === base) return { full_name: 'mock-owner/mock-icon-library', default_branch: 'main' };
    if (url === `${base}/git/ref/heads/main`) return { object: { sha: 'commit-1' } };
    if (url === `${base}/git/commits/commit-1`) return { tree: { sha: 'tree-1' } };
    if (url === `${base}/git/trees/tree-1?recursive=1`) return { truncated: false, tree: entries };
    const sha = url.match(/\/git\/blobs\/([^/]+)$/)?.[1];
    if (sha && blobs[sha]) return { content: blobs[sha] };
    throw new Error(`Unexpected mocked read: ${url}`);
  },
  decodeBase64Utf8(value) { return Buffer.from(value, 'base64').toString('utf8'); },
  pathFromRawUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const marker = '/main/';
      const offset = pathname.indexOf(marker);
      return offset < 0 ? '' : decodeURIComponent(pathname.slice(offset + marker.length));
    } catch { return ''; }
  },
  persistLibrarySnapshot() { return true; },
  resetFolderStageState() {}, updateStagedUi() {}, syncLockedControls() {}, renderCategories() { calls.renderCount += 1; },
  renderActiveCategory() {},
  MAX_FILE_BYTES: 12 * 1024 * 1024,
  ALLOWED_EXTENSIONS: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']),
  fileExtension(value) { return String(value).split('.').pop().toLowerCase(); },
  arrayBufferToBase64(buffer) { return Buffer.from(buffer).toString('base64'); },
  utf8ToBase64(value) { return Buffer.from(value, 'utf8').toString('base64'); },
  openUploadConfirmation(pending) { calls.saved.push(pending); },
  showStatus(message) { throw new Error(`Unexpected upload status: ${message}`); }
};

vm.runInNewContext([
  indexPathSource, browserHelpersSource, defaultAssetDirectorySource, loaderSource,
  navigationSource, uploadSource,
  'globalThis.__loadRepositoryState = loadRepositoryState;',
  'globalThis.__categoryBrowserListing = categoryBrowserListing;',
  'globalThis.__navigateCategoryDirectory = navigateCategoryDirectory;',
  'globalThis.__goCategoryBrowserBack = goCategoryBrowserBack;',
  'globalThis.__uploadSelected = uploadSelected;'
].join('\n'), sandbox, { filename: 'category-hierarchy-under-test.js' });

(async () => {
  const loaded = await sandbox.__loadRepositoryState();
  assert.equal(loaded, true, 'the test repository with valid icon indexes should load');
  assert.deepEqual([...sandbox.categories].map((category) => category.path).sort(), [indexPath.child, indexPath.parent, indexPath.sibling].sort(),
    'only valid JSON icon indexes become selectable leaves');
  assert.equal(sandbox.categories.find((category) => category.path === indexPath.parent).icons.length, 1,
    'populated JSON indexes retain their name/url entries');
  assert.equal(sandbox.categories.find((category) => category.path === indexPath.child).icons.length, 0,
    'empty JSON indexes remain selectable leaves');

  const rootListing = sandbox.__categoryBrowserListing('icon', sandbox.repositoryDirectories, sandbox.categories);
  assert.deepEqual([...rootListing.folders], ['icon/方图'], 'root listing contains its actual child directory');
  assert.equal(rootListing.indexes.length, 0);
  const parentListing = sandbox.__categoryBrowserListing('icon/方图', sandbox.repositoryDirectories, sandbox.categories);
  assert.ok(parentListing.folders.includes('icon/方图/动画'), 'the 方图 parent exposes the nested 动画 folder');
  assert.ok(parentListing.folders.includes('icon/方图/空文件夹'), 'a .gitkeep placeholder preserves an empty folder in the hierarchy');
  assert.ok(parentListing.indexes.some((category) => category.path === indexPath.parent),
    'a valid index in a parent folder appears alongside child folders');
  assert.ok(parentListing.indexes.some((category) => category.path === indexPath.sibling),
    'the sibling JSON is a separate leaf, not merged into the parent category');
  assert.ok(!parentListing.indexes.some((category) => category.path === indexPath.malformed),
    'malformed JSON is never shown as a leaf');
  assert.ok(!parentListing.indexes.some((category) => category.path.endsWith('.gitkeep')),
    'folder placeholders are never shown as JSON index leaves');

  const selectedBefore = sandbox.activeCategoryPath;
  const ownerBefore = sandbox.selectedOwner;
  const repoBefore = sandbox.selectedRepoName;
  const tokenBefore = sandbox.token;
  assert.equal(sandbox.__navigateCategoryDirectory('icon/方图'), true);
  assert.equal(sandbox.categoryBrowsePath, 'icon/方图');
  assert.equal(sandbox.__goCategoryBrowserBack(), true);
  assert.equal(sandbox.categoryBrowsePath, 'icon', 'folder back returns to the root directory');
  assert.equal(sandbox.activeCategoryPath, selectedBefore, 'browsing folders does not silently change the selected JSON leaf');
  assert.equal(sandbox.selectedOwner, ownerBefore);
  assert.equal(sandbox.selectedRepoName, repoBefore);
  assert.equal(sandbox.token, tokenBefore, 'folder navigation does not clear or replace the local token');

  const child = sandbox.categories.find((category) => category.path === indexPath.child);
  assert.equal(child.assetDirectory, 'icon/方图/动画', 'an empty index deterministically targets its own folder');
  const parent = sandbox.categories.find((category) => category.path === indexPath.parent);
  assert.equal(parent.assetDirectory, 'icon/方图/shared', 'a populated index continues to infer its image folder from existing URLs');

  async function prepareUpload(categoryPath, filename) {
    sandbox.activeCategoryPath = categoryPath;
    sandbox.selectedFiles = [{ name: filename, size: 3, async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; } }];
    sandbox.selectedFileNames = [filename];
    await sandbox.__uploadSelected();
    return calls.saved.at(-1);
  }
  const childConfirmation = await prepareUpload(indexPath.child, 'new-animation.png');
  assert.equal(childConfirmation.assetDirectory, 'icon/方图/动画');
  assert.equal(childConfirmation.emptyIndex, true);
  assert.equal(childConfirmation.files[0].path, 'icon/方图/动画/new-animation.png',
    'the final uploaded image path for the empty child index is exact and deterministic');
  const childChangedIndexes = Array.from(childConfirmation.changes).filter((change) => change.path.endsWith('.json')).map((change) => change.path);
  assert.deepEqual(childChangedIndexes, [indexPath.child], 'uploading into 动画 changes only its own JSON, not parent or sibling indexes');
  const childIndexChange = childConfirmation.changes.find((change) => change.path === indexPath.child);
  const childJson = JSON.parse(Buffer.from(childIndexChange.content, 'base64').toString('utf8'));
  assert.equal(childJson.icons.at(-1).name, 'new-animation');
  assert.equal(childConfirmation.changes.some((change) => change.path === indexPath.parent || change.path === indexPath.sibling), false);

  const parentConfirmation = await prepareUpload(indexPath.parent, 'new-parent.png');
  assert.equal(parentConfirmation.assetDirectory, 'icon/方图/shared');
  assert.equal(parentConfirmation.files[0].path, 'icon/方图/shared/new-parent.png',
    'the final image path for a populated index follows its existing URL folder');
  assert.deepEqual(Array.from(parentConfirmation.changes).filter((change) => change.path.endsWith('.json')).map((change) => change.path), [indexPath.parent],
    'uploading into the parent index does not update its nested or sibling JSON indexes');
  assert.equal(parentConfirmation.changes.some((change) => change.path === indexPath.child || change.path === indexPath.sibling), false);

  assert.equal(calls.writes, 0, 'the test exercises upload preparation only and never writes to GitHub');
  assert.ok(calls.reads.length > 0);
  console.log('Category hierarchy regressions passed (方图/动画 folders, valid parent+child leaves, empty/populated destinations, exact upload paths, isolated JSON changes, no GitHub writes).');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
