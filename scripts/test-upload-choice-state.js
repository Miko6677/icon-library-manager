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

function classList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); },
  };
}

function selectElement() {
  let options = [];
  let selectedValue = '';
  return {
    disabled: true,
    get options() { return options; },
    get selectedOptions() { return options.filter((option) => option.value === selectedValue); },
    get value() { return selectedValue; },
    set value(value) { selectedValue = options.some((option) => option.value === value) ? value : ''; },
    replaceChildren() { options = []; selectedValue = ''; },
    append(option) {
      options.push(option);
      if (options.length === 1) selectedValue = option.value;
    },
  };
}

const selectIds = [
  'upload-confirm-repository', 'upload-confirm-branch', 'upload-confirm-category',
  'upload-confirm-directory', 'upload-confirm-index',
];
const labelById = {
  'upload-confirm-repository': '仓库',
  'upload-confirm-branch': '分支',
  'upload-confirm-category': '目标分类',
  'upload-confirm-directory': '目标图片文件夹',
  'upload-confirm-index': 'JSON 索引',
};
const primaryRepository = {
  owner: { login: 'owner' }, name: 'repo', full_name: 'owner/repo', default_branch: 'main',
};
const secondaryRepository = {
  owner: { login: 'other' }, name: 'icons', full_name: 'other/icons', default_branch: 'trunk',
};

function createHarness({ branches = ['main', 'feature/icons'], repositories = [primaryRepository] } = {}) {
  const selects = Object.fromEntries(selectIds.map((id) => [id, selectElement()]));
  const buttons = selectIds.map((id) => {
    const valueNode = { textContent: '' };
    return {
      dataset: { choiceSelect: id },
      disabled: false,
      attributes: {},
      closest() { return { querySelector() { return { textContent: labelById[id] }; } }; },
      querySelector() { return valueNode; },
      setAttribute(name, value) { this.attributes[name] = value; },
      valueNode,
    };
  });
  const ui = {
    uploadConfirmRepository: selects['upload-confirm-repository'],
    uploadConfirmBranch: selects['upload-confirm-branch'],
    uploadConfirmCategory: selects['upload-confirm-category'],
    uploadConfirmDirectory: selects['upload-confirm-directory'],
    uploadConfirmIndex: selects['upload-confirm-index'],
    uploadConfirmSubmit: { disabled: false },
    uploadConfirmError: { textContent: '', classList: classList() },
    uploadConfirmModal: { classList: classList() },
    uploadConfirmCancel: { focus() {} },
  };
  const document = {
    getElementById(id) { return selects[id]; },
    querySelectorAll(selector) { return selector === '.upload-target-choice-button[data-choice-select]' ? buttons : []; },
    createElement() { return { value: '', textContent: '' }; },
  };
  const functions = [
    extract('  function updateUploadTargetChoiceButtons() {', '\n  function openChoiceDialog', 'choice button synchronizer'),
    extract('  function setUploadSelectOptions(', '\n  function uploadTargetError', 'select option updater'),
    extract('  async function loadUploadTargetRepository(', '\n\n  async function openUploadConfirmation', 'repository/branch loader'),
    extract('  function renderUploadTargetCategories(', '\n\n  function updateUploadTargetDirectories', 'category/index renderer'),
    extract('  function updateUploadTargetDirectories(', '\n\n  function refreshUploadPlanPreview', 'image-folder renderer'),
    extract('  async function openUploadConfirmation(', '\n  function closeUploadConfirmation', 'upload confirmation opener'),
  ].join('\n\n');
  const context = {
    ui, document, appLanguage: 'zh-CN', uploadTargetLoadSequence: 0,
    uploadTargetState: null, uploadTargetContext: null, pendingUploadConfirmation: null,
    selectedOwner: 'owner', selectedRepoName: 'repo', branch: 'main', activeCategoryPath: '',
    repositoryIdentity: (item) => `${item.owner.login}/${item.name}`.toLowerCase(),
    uploadTargetRepositories: () => repositories,
    async fetchUploadTargetBranches() { return branches; },
    async loadUploadTargetBranch() {},
    uploadTargetError(message) { throw new Error(message); },
    iconRootForPath(value) { return value.split('/')[0]; },
    refreshUploadPlanPreview() {},
    renderUploadConfirmationText() {},
    requestAnimationFrame(callback) { callback(); },
  };
  vm.createContext(context);
  vm.runInContext(`${functions}\n globalThis.openUploadConfirmation = openUploadConfirmation;\n globalThis.renderUploadTargetCategories = renderUploadTargetCategories;`, context);
  return { context, selects, buttons, ui };
}

async function main() {
  const single = createHarness({ branches: ['main'] });
  await single.context.openUploadConfirmation({ files: [] });
  assert.equal(single.selects['upload-confirm-repository'].options.length, 1);
  assert.equal(single.selects['upload-confirm-repository'].disabled, false,
    'a repository selector with one valid repository remains enabled');
  assert.equal(single.buttons[0].disabled, false,
    'the one-option repository button remains tappable');
  assert.equal(single.buttons[0].valueNode.textContent, 'owner/repo');
  assert.equal(single.selects['upload-confirm-branch'].options.length, 1);
  assert.equal(single.selects['upload-confirm-branch'].disabled, false,
    'a branch selector with one valid branch remains enabled');
  assert.equal(single.buttons[1].disabled, false,
    'the one-option branch button remains tappable');
  assert.equal(single.buttons[1].valueNode.textContent, 'main');

  const category = {
    path: 'icon/Fang/tubiao.json', label: '图标库', assetDirectory: 'icon/Fang/icon',
    icons: [], data: { name: '图标库', icons: [] },
  };
  const state = {
    categories: [category],
    directories: new Set(['icon/Fang/icon']),
  };
  single.context.uploadTargetState = state;
  single.context.renderUploadTargetCategories(state, category.path);
  const expectedSingleValues = [
    ['upload-confirm-category', `${category.label} · ${category.path}`],
    ['upload-confirm-directory', category.assetDirectory],
    ['upload-confirm-index', category.path],
  ];
  for (const [id, expectedValue] of expectedSingleValues) {
    const index = selectIds.indexOf(id);
    assert.equal(single.selects[id].options.length, 1, `${id} test fixture has one valid option`);
    assert.equal(single.selects[id].disabled, false, `${id} native selector stays enabled with one option`);
    assert.equal(single.buttons[index].disabled, false, `${id} visible button stays tappable with one option`);
    assert.equal(single.buttons[index].valueNode.textContent, expectedValue, `${id} button displays its selected option`);
  }
  assert.equal(single.selects['upload-confirm-category'].value, category.path);
  assert.equal(single.selects['upload-confirm-index'].value, category.path,
    'the category and JSON index remain aligned');
  assert.equal(single.selects['upload-confirm-directory'].value, category.assetDirectory);

  const multi = createHarness({ branches: ['main', 'feature/icons'], repositories: [primaryRepository, secondaryRepository] });
  await multi.context.openUploadConfirmation({ files: [] });
  for (const [id, count] of [['upload-confirm-repository', 2], ['upload-confirm-branch', 2]]) {
    const index = selectIds.indexOf(id);
    assert.equal(multi.selects[id].options.length, count);
    assert.equal(multi.selects[id].disabled, false, `${id} remains enabled with multiple options`);
    assert.equal(multi.buttons[index].disabled, false, `${id} button stays tappable with multiple options`);
  }
  assert.equal(multi.selects['upload-confirm-branch'].value, 'main');
  assert.equal(multi.buttons[1].valueNode.textContent, 'main', 'the branch button shows the selected default branch');

  const empty = createHarness();
  vm.runInContext('setUploadSelectOptions(ui.uploadConfirmBranch, [], "", "", false);', empty.context);
  assert.equal(empty.buttons[1].disabled, true, 'a selector with no available options is not tappable');

  console.log('Upload target picker state regressions passed: all five selector types stay tappable with exactly one valid option; multi-option repository/branch controls remain enabled and selected labels stay synchronized.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
