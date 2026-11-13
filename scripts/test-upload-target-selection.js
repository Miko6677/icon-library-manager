#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/app.js'), 'utf8');
function extract(startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `could not locate ${label}`);
  return source.slice(start, end).trim();
}
function element() {
  return {
    value: '', textContent: '', disabled: false,
    classList: { add() {}, remove() {} },
    replaceChildren() {}, append() {},
    setAttribute() {},
  };
}
function runPreview({ collision = false, branch = 'feature/icons', categoryPath = 'icon/Fang/tubiao.json', assetDirectory = 'icon/Fang/uploads' } = {}) {
  const filePath = `${assetDirectory}/new.png`;
  const targetFiles = new Map(collision ? [[filePath.toUpperCase(), { path: filePath.toUpperCase() }]] : []);
  const category = {
    path: categoryPath, label: '目标分类', assetDirectory,
    data: { name: '目标分类', description: 'demo' },
    icons: [{ name: '已有图标', url: 'https://example.invalid/old.png' }],
  };
  const ui = {
    uploadConfirmCategory: element(), uploadConfirmIndex: element(), uploadConfirmDirectory: element(),
    uploadConfirmRepository: element(), uploadConfirmBranch: element(), uploadConfirmDirectoryNote: element(),
    uploadConfirmFileList: element(), uploadConfirmError: element(), uploadConfirmSubmit: element(),
  };
  ui.uploadConfirmCategory.value = category.path;
  ui.uploadConfirmIndex.value = category.path;
  ui.uploadConfirmDirectory.value = category.assetDirectory;
  const pending = {
    files: [{ name: 'new.png', size: 5, content: 'cGl4ZWxz', file: { name: 'new.png' }, selectedName: 'new.png' }],
    changes: [],
  };
  const sandbox = {
    pendingUploadConfirmation: pending,
    uploadTargetState: {
      owner: 'target-owner', repositoryName: 'target-library', branch, commitSha: 'reviewed-head',
      files: targetFiles,
      directories: new Set([categoryPath.split('/')[0], assetDirectory]),
      categories: [category],
    },
    ui, appLanguage: 'zh-CN',
    ALLOWED_EXTENSIONS: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']),
    iconRootForPath: (value) => value.split('/')[0],
    fileExtension: (value) => String(value).split('.').pop().toLowerCase(),
    GitHubUrls: { rawContentUrl: (_base, owner, repo, branch, file) => `https://raw.test/${owner}/${repo}/${encodeURIComponent(branch)}/${file}` },
    rawContentBaseUrl: 'https://raw.test',
    utf8ToBase64: (value) => Buffer.from(value, 'utf8').toString('base64'),
    formatBytes: (value) => `${value} B`,
    uploadPlanError(message) { ui.uploadConfirmError.textContent = message; ui.uploadConfirmSubmit.disabled = true; },
    document: { createElement: () => element() },
  };
  vm.runInNewContext(extract('  function refreshUploadPlanPreview() {', '\n\n  async function loadUploadTargetRepository', 'upload preview planner'), sandbox);
  sandbox.refreshUploadPlanPreview();
  return { pending, ui, sandbox, category };
}

const planned = runPreview();
assert.equal(planned.pending.owner, 'target-owner');
assert.equal(planned.pending.repositoryName, 'target-library');
assert.equal(planned.pending.branch, 'feature/icons');
assert.equal(planned.pending.assetDirectory, 'icon/Fang/uploads');
assert.equal(planned.pending.files.length + 1, planned.pending.changes.length);
assert.equal(planned.pending.changes[0].path, 'icon/Fang/uploads/new.png');
assert.equal(planned.pending.changes[1].path, 'icon/Fang/tubiao.json');
assert.equal(planned.ui.uploadConfirmCategory.value, 'icon/Fang/tubiao.json');
assert.equal(planned.ui.uploadConfirmIndex.value, 'icon/Fang/tubiao.json');
const previewIndex = JSON.parse(Buffer.from(planned.pending.changes[1].content, 'base64').toString('utf8'));
assert.equal(previewIndex.icons.at(-1).url, 'https://raw.test/target-owner/target-library/feature%2Ficons/icon/Fang/uploads/new.png');
assert.equal(planned.pending.changes.filter((change) => change.path.endsWith('.json')).length, 1,
  'only the selected JSON index is changed');
assert.equal(planned.ui.uploadConfirmSubmit.disabled, false);

const alternateBranch = runPreview({
  branch: 'release/icons',
  categoryPath: 'icons/Spring/index.json',
  assetDirectory: 'icons/Spring/images',
});
assert.equal(alternateBranch.pending.branch, 'release/icons');
assert.equal(alternateBranch.pending.changes[0].path, 'icons/Spring/images/new.png',
  'the selected branch preview uses that branch’s image-folder path');
assert.equal(alternateBranch.pending.changes[1].path, 'icons/Spring/index.json',
  'the selected branch preview updates only its matching JSON index');
const alternateIndex = JSON.parse(Buffer.from(alternateBranch.pending.changes[1].content, 'base64').toString('utf8'));
assert.equal(alternateIndex.icons.at(-1).url,
  'https://raw.test/target-owner/target-library/release%2Ficons/icons/Spring/images/new.png',
  'the indexed URL reflects the selected branch and exact image path');

const collision = runPreview({ collision: true });
assert.match(collision.ui.uploadConfirmError.textContent, /已存在/);
assert.equal(collision.ui.uploadConfirmSubmit.disabled, true, 'a target-path collision blocks confirmation');
assert.equal(collision.ui.uploadConfirmDirectory.disabled, false, 'a collision leaves the folder selector available for correction');

const transactionSource = extract('  async function createBlob(content, target = {}) {', '\n\n  async function commitStagedChanges()', 'target-aware commit transaction');
async function verifyCommitSafety() {
  const calls = [];
  let refSha = 'reviewed-head';
  const sandbox = {
    selectedOwner: 'current-owner', selectedRepoName: 'current-library', branch: 'main', commitSha: 'current-head',
    repositoryApiPathFor: (owner, name) => `/repos/${owner}/${name}`,
    async request(url, options = {}) {
      calls.push({ url, method: options.method || 'GET' });
      if (url.endsWith('/git/ref/heads/feature%2Ficons')) return { object: { sha: refSha } };
      if (url.endsWith('/git/commits/reviewed-head')) return { tree: { sha: 'target-tree' } };
      if (url.endsWith('/git/trees/target-tree?recursive=1')) return { truncated: false, tree: [] };
      if (url.endsWith('/git/blobs')) return { sha: 'new-blob' };
      if (url.endsWith('/git/trees')) return { sha: 'new-tree' };
      if (url.endsWith('/git/commits')) return { sha: 'new-commit' };
      if (url.endsWith('/git/refs/heads/feature%2Ficons')) return { object: { sha: 'new-commit' } };
      throw new Error(`unexpected mocked request ${options.method || 'GET'} ${url}`);
    },
  };
  vm.runInNewContext(transactionSource, sandbox);
  const changes = [{ path: 'icon/Fang/uploads/new.png', content: 'image' }, { path: 'icon/Fang/tubiao.json', content: 'index' }];
  await sandbox.commitChanges(changes, 'Add test icon', {
    owner: 'target-owner', repositoryName: 'target-library', branch: 'feature/icons', commitSha: 'reviewed-head',
  });
  const writes = calls.filter((call) => call.method !== 'GET');
  assert.equal(writes.length, 5, 'image/index blobs, tree, commit and ref update are all on the selected target');
  assert.ok(writes.every((call) => call.url.startsWith('/repos/target-owner/target-library/')));
  assert.ok(writes.some((call) => call.url.endsWith('/git/refs/heads/feature%2Ficons')));

  calls.length = 0;
  refSha = 'changed-after-review';
  await assert.rejects(() => sandbox.commitChanges(changes, 'Add test icon', {
    owner: 'target-owner', repositoryName: 'target-library', branch: 'feature/icons', commitSha: 'reviewed-head',
  }), /目标仓库或分支在预览后又有新提交/);
  assert.equal(calls.filter((call) => call.method !== 'GET').length, 0,
    'a branch that changes after preview is rejected before any write request');
}

verifyCommitSafety().then(() => {
  console.log('Upload target selection regressions passed (selected destination drives file path and URL, only selected index changes, collisions block confirmation, selected repository/branch are used, stale branch writes are rejected).');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
