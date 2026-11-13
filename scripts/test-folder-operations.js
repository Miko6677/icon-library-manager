'use strict';
const assert = require('node:assert/strict');
const FolderOps = require('../app/src/main/assets/folder-operations.js');

const dirs = new Set([
  'icons', 'icons/方图', 'icons/方图/角色', 'icons/方图/角色/旧版',
  'icons/方图/素材', 'icons/方图/素材/角色', 'icons/横图', 'icons/横图/游戏'
]);
const files = [
  { path: 'icons/方图/角色/index.json', sha: 'index-a' },
  { path: 'icons/方图/角色/hero.png', sha: 'hero-image' },
  { path: 'icons/方图/角色/旧版/.gitkeep', sha: 'placeholder' },
  { path: 'icons/方图/素材/shared.webp', sha: 'shared-image' },
  { path: 'icons/方图/素材/角色/index.json', sha: 'collision-index' },
  { path: 'icons/横图/游戏/index.json', sha: 'index-b' }
];

const created = FolderOps.planCreateFolder({ parent: 'icons/方图', name: '新分类', directories: dirs, files });
assert.deepEqual(created, { ok: true, path: 'icons/方图/新分类', placeholderPath: 'icons/方图/新分类/.gitkeep' });
assert.equal(FolderOps.planCreateFolder({ parent: 'icons/方图', name: '角色', directories: dirs, files }).reason, 'collision');
assert.equal(FolderOps.planCreateFolder({ parent: 'icons/方图', name: '../逃逸', directories: dirs, files }).reason, 'invalid-name');

const renamed = FolderOps.planRenameFolder({ folder: 'icons/方图/角色', name: '人物', directories: dirs, files });
assert.equal(renamed.destination, 'icons/方图/人物');
assert.deepEqual(renamed.fileMoves.sort((a, b) => a.from.localeCompare(b.from)), [
  { from: 'icons/方图/角色/index.json', to: 'icons/方图/人物/index.json' },
  { from: 'icons/方图/角色/hero.png', to: 'icons/方图/人物/hero.png' },
  { from: 'icons/方图/角色/旧版/.gitkeep', to: 'icons/方图/人物/旧版/.gitkeep' }
].sort((a, b) => a.from.localeCompare(b.from)));
assert.equal(FolderOps.planRenameFolder({ folder: 'icons/方图/角色', name: '素材', directories: dirs, files }).reason, 'collision');

const moved = FolderOps.planMoveFolder({ folder: 'icons/方图/角色', destinationFolder: 'icons/横图/游戏', directories: dirs, files });
assert.equal(moved.destination, 'icons/横图/游戏/角色');
assert.equal(moved.fileMoves.length, 3, 'folder move previews every nested index, image and placeholder');
assert.equal(FolderOps.planMoveFolder({ folder: 'icons/方图/角色', destinationFolder: 'icons/方图/角色/旧版', directories: dirs, files }).reason, 'into-self');
assert.equal(FolderOps.planMoveFolder({ folder: 'icons/方图/角色', destinationFolder: 'icons/方图/素材', directories: dirs, files }).reason, 'collision');
assert.equal(FolderOps.planMoveFolder({ folder: 'icons/方图/角色', destinationFolder: 'icons/方图/角色', directories: dirs, files }).reason, 'into-self');

const deleted = FolderOps.planDeleteFolder({ folder: 'icons/方图/角色', directories: dirs, files });
assert.equal(deleted.count, 3);
assert.ok(deleted.paths.includes('icons/方图/角色/旧版/.gitkeep'));
assert.ok(deleted.paths.includes('icons/方图/角色/index.json'));
assert.ok(deleted.paths.includes('icons/方图/角色/hero.png'));

const emptyFolder = FolderOps.planCreateFolder({ parent: 'icons/方图', name: '空文件夹', directories: dirs, files });
assert.match(emptyFolder.placeholderPath, /\.gitkeep$/);
assert.equal(emptyFolder.placeholderPath.toLowerCase().endsWith('.json'), false,
  'creating a folder does not create a category JSON index');
assert.equal(FolderOps.isCategoryFolder('icons/方图/新分类', new Set(['icons', 'icons/方图', 'icons/方图/新分类'])), true);
assert.equal(FolderOps.isCategoryFolder('icons/方图/新分类/.gitkeep', dirs), false,
  'a placeholder file is never exposed as a category folder or index');

const json = { name: '方图', icons: [
  { name: '图标', url: 'https://raw.githubusercontent.com/u/r/main/icons/方图/角色/hero.png', keep: 1 },
  { name: '外部', url: 'https://raw.githubusercontent.com/u/r/main/icons/方图/素材/shared.webp' }
] };
const pathFromUrl = (url) => {
  const pathname = new URL(url).pathname;
  const marker = '/main/';
  return pathname.includes(marker) ? decodeURIComponent(pathname.slice(pathname.indexOf(marker) + marker.length)) : '';
};
pathFromUrl.mapPath = (path) => FolderOps.mapSubtreePath(path, 'icons/方图/角色', 'icons/横图/游戏/角色');
const rewritten = FolderOps.rewriteIndexUrls(json, pathFromUrl, (oldUrl, nextPath) => {
  const url = new URL(oldUrl);
  const marker = '/main/';
  return `${url.origin}${url.pathname.slice(0, url.pathname.indexOf(marker) + marker.length)}${nextPath}`;
});
assert.equal(rewritten.changed, true);
assert.equal(pathFromUrl(rewritten.data.icons[0].url), 'icons/横图/游戏/角色/hero.png');
assert.equal(rewritten.data.icons[0].keep, 1, 'URL rewriting preserves unrelated JSON fields');
assert.equal(rewritten.data.icons[1].url, json.icons[1].url, 'unmoved image references remain unchanged');
assert.equal(json.icons[0].url.includes('/角色/'), true, 'input JSON is not mutated');

console.log('Folder operation regressions passed (nested hierarchy, create, rename, arbitrary-depth move, delete preview, .gitkeep, conflicts, path traversal and URL rewrite).');
