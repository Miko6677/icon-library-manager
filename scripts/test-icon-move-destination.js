#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const GitHubUrls = require('../app/src/main/assets/github-url-config.js');
const app = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/index.html'), 'utf8');

function extract(startMarker, endMarker, label) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `could not locate ${label}`);
  return app.slice(start, end).trim();
}

const resolverSource = extract(
  '  function iconMoveDestinationDirectory(destination, destinationIcons) {',
  '\n\n  function planIconMove',
  'destination directory and folder chooser helpers'
);
const plannerSource = extract(
  '  function planIconMove(move, destination, imageDirectory) {',
  '\n\n  function renderMovePreview()',
  'icon move planner'
);
assert.match(app, /const plan = planIconMove\(move, destination, ui\.moveImageDirectory\.value\)/,
  'move planning must use the user-selected image folder');
assert.match(app, /function renderMovePreview\(\)[\s\S]*plan\.destinationFilePath[\s\S]*plan\.destinationUrl/,
  'preview and destination JSON URL must be generated from the selected image folder');
assert.match(html, /id="move-destination"[\s\S]*id="move-destination-path"[\s\S]*id="move-image-directory"/,
  'the category, JSON index path, and image folder must appear as separate controls/rows');
assert.match(app, /ui\.moveDestinationPath\.textContent = destination\?\.path \|\| ''/,
  'the selected target JSON path must be shown separately from its category name');
assert.match(app, /if \(!await confirmInApp\(warning,/,
  'repository writes must remain behind an explicit confirmation dialog');
assert.match(app, /Nothing is sent until you explicitly confirm this review/,
  'the separate explicit confirmation before repository writes must remain in place');
assert.match(app, /folderOperations\.some\(\(operation\) => operation\.type !== 'create'\)/,
  'a newly staged folder can be selected, while staged moves/renames/deletions stay protected');

const owner = 'mock-owner';
const repository = 'mock-icon-library';
const rawBase = GitHubUrls.DEFAULT_RAW_BASE;
const raw = (filePath) => GitHubUrls.rawContentUrl(rawBase, owner, repository, 'main', filePath);
const reference = (value) => GitHubUrls.rawReference(value, [rawBase], owner, repository);
const sourceFilePath = 'icon/测试 2.png';
const sourceEntry = { name: '测试 2', url: raw(sourceFilePath) };
const foreignExistingEntry = { name: 'Yuan 现有图标', url: raw('icon/Fang/icon/existing.png') };
const categories = [
  { path: 'icon/icon.json', assetDirectory: 'icon', icons: [sourceEntry] },
  { path: 'icon/Yuan/tubiao.json', assetDirectory: 'icon/Fang/icon', icons: [foreignExistingEntry] }
];
const repositoryDirectories = new Set([
  'icon', 'icon/Fang', 'icon/Fang/icon', 'icon/Yuan', 'icon/Yuan/icon',
  'icon/Shared', 'icon/Shared/assets', 'icon/New', 'icon/Parent',
  'icon/Parent/New', 'icon/Parent/Nested', 'icon/Parent/Nested/icon',
  'icon/Parent/Custom', 'icon/Parent/Custom/images'
]);
const sandbox = {
  ICON_ROOT: 'icon',
  categories,
  stagedMoves: [],
  repositoryDirectories,
  treeFiles: new Map([[sourceFilePath, { path: sourceFilePath, sha: 'mock-image-sha' }]]),
  branch: 'main',
  selectedOwner: owner,
  selectedRepoName: repository,
  rawContentBaseUrl: rawBase,
  GitHubUrls,
  appLanguage: 'zh-CN',
  iconsFor(category) { return category.icons; },
  iconRootForPath(value) {
    const root = String(value || '').split('/')[0];
    return root.toLowerCase() === 'icon' || root.toLowerCase() === 'icons' ? root : '';
  },
  pathFromRawUrl(value) { return reference(value)?.path || ''; },
  rawReferenceFromUrl(value) { return reference(value); }
};
vm.runInNewContext([
  resolverSource,
  plannerSource,
  'globalThis.__moveImageDirectoryOptions = moveImageDirectoryOptions;',
  'globalThis.__planIconMove = planIconMove;',
  'globalThis.__destinationDirectory = iconMoveDestinationDirectory;'
].join('\n'), sandbox, { filename: 'icon-move-destination-under-test.js' });

const move = { sourcePath: categories[0].path, index: 0, entry: { ...sourceEntry } };
const screenshotPlan = sandbox.__planIconMove(move, categories[1], 'icon/Yuan/icon');
assert.equal(screenshotPlan.ok, true, 'the screenshot example should produce a valid local move plan');
assert.equal(screenshotPlan.sourceFilePath, 'icon/测试 2.png');
assert.equal(screenshotPlan.destinationFilePath, 'icon/Yuan/icon/测试 2.png',
  'the screenshot destination must follow the Yuan JSON category, not stale Fang state');
assert.equal(screenshotPlan.destinationUrl, raw('icon/Yuan/icon/测试 2.png'),
  'the Yuan JSON entry URL must exactly match the destination image path');
assert.equal(screenshotPlan.blobSha, 'mock-image-sha');

const userSelectedPlan = sandbox.__planIconMove(move, categories[1], 'icon/Shared/assets');
assert.equal(userSelectedPlan.ok, true, 'an available user-selected image folder should be accepted');
assert.equal(userSelectedPlan.destinationFilePath, 'icon/Shared/assets/测试 2.png',
  'a user-selected image folder must control the physical destination path');
assert.equal(userSelectedPlan.destinationUrl, raw('icon/Shared/assets/测试 2.png'),
  'the destination JSON URL must use the exact user-selected path');

const newCategory = { path: 'icon/New/tubiao.json', assetDirectory: 'icon/Fang/icon', icons: [] };
assert.equal(sandbox.__destinationDirectory(newCategory, newCategory.icons), 'icon/New',
  'a newly created empty category defaults to its own JSON folder');
assert.ok(sandbox.__moveImageDirectoryOptions(newCategory).includes('icon/New'),
  'a newly created category folder is available in the image folder chooser');

const nestedNewCategory = { path: 'icon/Parent/New/tubiao.json', assetDirectory: 'icon/Fang/icon', icons: [] };
assert.equal(sandbox.__destinationDirectory(nestedNewCategory, nestedNewCategory.icons), 'icon/Parent/New',
  'a newly created nested empty category defaults to its own folder');
assert.ok(sandbox.__moveImageDirectoryOptions(nestedNewCategory).includes('icon/Parent/New'),
  'the nested new folder can be chosen for the image destination');

const nestedPopulatedCategory = {
  path: 'icon/Parent/Nested/tubiao.json', assetDirectory: 'icon/Fang/icon',
  icons: [{ name: 'nested item', url: raw('icon/Parent/Nested/icon/existing.png') }]
};
assert.equal(sandbox.__destinationDirectory(nestedPopulatedCategory, nestedPopulatedCategory.icons), 'icon/Parent/Nested/icon',
  'a populated nested category defaults within its own folder rather than Fang');
assert.ok(sandbox.__moveImageDirectoryOptions(nestedPopulatedCategory).includes('icon/Parent/Nested'),
  'nested repository folders remain available in the chooser');

const nestedCustomFolder = {
  path: 'icon/Parent/Custom/tubiao.json', assetDirectory: 'icon/Parent/Custom/images',
  icons: [{ name: 'existing', url: raw('icon/Parent/Custom/images/existing.png') }]
};
assert.equal(sandbox.__destinationDirectory(nestedCustomFolder, nestedCustomFolder.icons), 'icon/Parent/Custom/images',
  'a valid custom image folder inside the selected JSON category is preserved as the default');

const rootCategory = { path: 'icon/icon.json', assetDirectory: 'icon/Fang/icon', icons: [foreignExistingEntry] };
assert.equal(sandbox.__destinationDirectory(rootCategory, rootCategory.icons), 'icon',
  'the root JSON index cannot inherit a nested category image folder');
assert.equal(repositoryDirectories.has('icon/Shared/assets'), true,
  'the local test uses only mocked repository folder data');

console.log('Icon move destination regressions passed (screenshot Yuan target, separate category/JSON rows, user-selected folder and URL, new/nested folders, stale-path isolation; local mocks only, no GitHub writes).');
