#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const html = read('app/src/main/assets/index.html');
const app = read('app/src/main/assets/app.js');
const styles = read('app/src/main/assets/styles.css');
const manifest = read('app/src/main/AndroidManifest.xml');
const dialogs = read('app/src/main/assets/dialogs.js');
const activity = read('app/src/main/java/io/cue/iconmanager/MainActivity.java');

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
assert.deepEqual(duplicateIds, [], `duplicate DOM ids: ${duplicateIds.join(', ')}`);
assert.equal((html.match(/id="connect-button"/g) || []).length, 1, 'PAT page must have one connect action');
assert.match(app, /set\('#connect-button span:first-child'/, 'translation should change only the button label, not its arrow');
assert.doesNotMatch(app, /set\('#connect-button span'/, 'do not overwrite every span in the connect button');

assert.doesNotMatch(app, /\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/, 'app code must not invoke browser-native prompt dialogs');
assert.doesNotMatch(html, /appassets\.androidplatform\.net|网址为/, 'UI must not expose the WebView asset origin');
assert.match(html, /dialogs\.js[\s\S]*app\.js/, 'dialog helper must load before application code');
assert.match(html, /id="app-confirm-modal"[\s\S]*data-confirm-cancel[\s\S]*id="app-confirm-accept"/, 'in-app confirmation needs cancel and accept controls');
assert.match(dialogs, /event\.key === 'Escape'[\s\S]*finish\(false\)/, 'Escape must cancel in-app confirmation');
assert.match(dialogs, /resolve\(result\)/, 'confirmation result must resolve to the caller');

const presetButtons = [...html.matchAll(/class="accent-color-choice"[^>]*data-accent-color="([^"]*)"[^>]*>[\s\S]*?style="--swatch-color:(#[0-9a-f]{6})"/gi)];
assert.equal(presetButtons.length, 7, 'all seven accent presets need explicit visible swatch colors');
assert.match(styles, /\.accent-color-swatch\{[^}]*background-color:var\(--swatch-color,#897fb5\)/, 'preset swatches need an explicit background-color');
assert.match(app, /button\.setAttribute\('aria-pressed', String\(selected\)\)/, 'selected states must be exposed accessibly');
assert.match(app, /data-wallpaper-color[\s\S]*pendingAccentSource === 'wallpaper'/, 'wallpaper representatives must have a distinct selection state');
assert.match(app, /stageAccentColor\(accentEyedropperColor,[^\n]*'gallery'\)/, 'gallery pixels must stay a distinct source from wallpaper colors');
assert.match(html, /accent-selected-copy/, 'chosen color value must be shown separately from effective preview');

for (const id of ['saved-token-display', 'toggle-saved-token', 'copy-saved-token', 'saved-token-replace-toggle', 'saved-token-replacement', 'saved-token-replace-submit']) {
  assert.match(html, new RegExp(`id="${id}"`), `missing saved-token control ${id}`);
}
assert.match(html, /id="saved-token-display" type="password" readonly/, 'saved token must be masked by default');
assert.match(app, /navigator\.clipboard\?\.writeText[\s\S]*navigator\.clipboard\.writeText\(token\)/, 'clipboard access must be reachable only through the explicit copy action');
assert.match(app, /request\('\/user\/repos\?affiliation=[^\n]*apiBaseUrl, candidate\)/, 'replacement validation must use the configured API base and the candidate token');
assert.match(app, /window\.CueTokenStore\?\.saveToken\?\.\(candidate\)/, 'replacement must use the existing native encrypted store');
assert.doesNotMatch(app, /console\.(?:log|info|debug)\([^\n]*token/i, 'do not log tokens');

for (const id of ['language-choice-button', 'appearance-choice-button', 'nav-layout-choice-button']) {
  assert.match(html, new RegExp(`id="${id}"`), `missing in-app settings choice trigger ${id}`);
}
assert.match(app, /openSettingsChoiceDialog/, 'settings choices should use the shared in-app list dialog');
const settingsHome = html.match(/<div id="settings-home"[^>]*>([\s\S]*?)<section id="settings-subpage"/);
assert.ok(settingsHome, 'settings landing content should have its own visibility container');
assert.equal((settingsHome[1].match(/<h[1-6]\b/g) || []).length, 0, 'settings home should use the top-bar title without a repeated body heading');
assert.doesNotMatch(settingsHome[1], /选择一个设置类别|settings-index-description/, 'remove redundant settings category instruction');
assert.match(app, /activeSettingsPage === 'home'[\s\S]*\[english \? 'Settings' : '设置'/, 'settings home title should appear in the top bar');
assert.match(app, /ui\.settingsHome\.classList\.toggle\('hidden', !home\)/, 'settings landing cards must hide on every subpage');
assert.doesNotMatch(html, /id="settings-subpage-kicker"|id="settings-subpage-title"/, 'remove repeated page kicker and title from all settings subpages');
assert.match(html, /<header class="topbar">[\s\S]*?<div class="brand">[\s\S]*?<button id="settings-subpage-back"[^>]*class="topbar-back-button hidden"[^>]*aria-label="返回设置主页"[^>]*>[\s\S]*?<\/button>[\s\S]*?<span class="brand-mark"[\s\S]*?<\/span>[\s\S]*?<a class="brand-copy"/, 'back arrow and brand mark must share the leading icon slot beside the current title');
assert.match(styles, /\.topbar\.settings-subpage-active \.brand-mark\{display:none\}/, 'Settings subpages must replace, not accompany, the brand icon with the back arrow');
assert.match(styles, /\.topbar\{flex-wrap:nowrap\}/, 'the shared top bar must stay on one row');
assert.doesNotMatch(html, /settings-subpage-heading/, 'settings subpages should not render a second body back row');
assert.match(app, /nestedSettingsPage = activeScreen === 'settings' && activeSettingsPage !== 'home'[\s\S]*settingsSubpageBack\.classList\.toggle\('hidden', !nestedSettingsPage\)/, 'back arrow should appear only on nested Settings pages');
assert.match(html, /<button id="settings-subpage-back"[^>]*aria-label="返回设置主页"[^>]*>[\s\S]*?<svg[\s\S]*?<\/svg>[\s\S]*?<\/button>/, 'subpage back control should be an icon-only accessible button');
assert.doesNotMatch(html, /id="settings-subpage-back-label"|<span[^>]*>设置主页<\/span>/, 'back button should not show a text label');
assert.match(app, /ui\.settingsSubpageBack\.setAttribute\('aria-label', en \? 'Back to Settings' : '返回设置主页'\)/, 'back button accessible label should follow the selected language');
assert.match(app, /ui\.settingsSubpageBack\.addEventListener\('click', \(\) => setSettingsPage\('home'\)\)/, 'icon-only back control should remain functional');
assert.match(app, /window\.onCueAndroidBackPressed = \(\) => \{[\s\S]*activeScreen === 'settings' && activeSettingsPage !== 'home'[\s\S]*setActiveScreen\('settings', 'home'\)/, 'Android system back must return Settings subpages to Settings home');
for (const page of ['appearance', 'navigation', 'cache', 'about', 'account']) {
  assert.ok(app.includes(`${page}: english ?`), `settings page ${page} should keep its current-page title mapping`);
}
assert.match(app, /function getSettingsSubpageTitle\(page = activeSettingsPage\)/, 'the top bar should own the current settings subpage title');
assert.match(manifest, /android:icon="@mipmap\/ic_launcher_cream"/, 'packaged default app icon must use the approved cream prism resource');
assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_cream_round"/, 'packaged round app icon must use the approved cream prism resource');
assert.match(app, /function updateTopbarTitle\(\)/, 'top header title must be driven by the active screen');
assert.match(app, /activeSettingsPage === 'home'[\s\S]*getSettingsSubpageTitle\(\)/, 'settings subpages must use the page title map in the top bar');
for (const label of ["english ? 'Library' : '图标库'", "english ? 'Cutout' : '抠图'", "english ? 'Settings' : '设置'"]) {
  assert.match(app, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `top-level header must match its bottom tab: ${label}`);
}
assert.match(app, /updateTopbarTitle\(\);[\s\S]*function updateTopbarTitle/, 'settings navigation must refresh the header');
assert.match(app, /saveCachedLibrarySnapshotFor\(selectedOwner, selectedRepoName, serialized\)/, 'library snapshots must be persisted per repository');
assert.match(app, /cachedTargetSnapshot && applyCachedLibrarySnapshot\(targetOwner, targetName\)/, 'cached repositories must remain switchable when GitHub is unavailable');
assert.match(app, /function isIconIndexPath\(path\)[\s\S]*root === expectedRoot \|\| root === `\$\{expectedRoot\}s`/, 'recognize only singular/plural icon roots without case sensitivity');
assert.match(app, /const jsonPaths = \[\.\.\.treeFiles\.keys\(\)\]\.filter\(isIconIndexPath\)/, 'online discovery must use the validated icon-index path matcher');
for (const id of ['category-browser-navigation', 'category-browser-back', 'category-breadcrumbs', 'category-browser-empty', 'upload-confirm-directory', 'upload-confirm-directory-note']) {
  assert.ok(html.includes(`id="${id}"`), `missing hierarchy/target path UI element ${id}`);
}
assert.match(app, /function collectIconDirectories\(entries\)[\s\S]*function categoryBrowserListing\(directoryPath, directories, indexCategories\)/, 'real repository directories must drive the hierarchical category browser');
assert.match(app, /function goCategoryBrowserBack\(\)[\s\S]*navigateCategoryDirectory\(parent\)/, 'folder back navigation must return to the parent folder');
assert.match(app, /activeScreen === 'library' && canGoBackInCategoryBrowser\(\)[\s\S]*goCategoryBrowserBack\(\)/, 'Android system back must traverse category folders before leaving the library');
for (const id of ['upload-confirm-repository', 'upload-confirm-branch', 'upload-confirm-category', 'upload-confirm-directory', 'upload-confirm-index']) {
  assert.match(html, new RegExp(`<select id="${id}"`), `upload target ${id} must be user-selectable`);
}
assert.match(app, /pending\.categoryPath = category\.path[\s\S]*pending\.assetDirectory = directory[\s\S]*pending\.changes = changes/, 'each target selection must rebuild the exact file paths and only the selected JSON index');
assert.match(app, /uploadConfirmCategory\.addEventListener\('change'[\s\S]*uploadConfirmIndex\.value = path/, 'choosing a category must synchronize the matching JSON index');
assert.match(app, /uploadConfirmIndex\.addEventListener\('change'[\s\S]*uploadConfirmCategory\.value = path/, 'choosing a JSON index must synchronize its category');
assert.match(app, /GitHubUrls\.rawContentUrl\(rawContentBaseUrl, state\.owner, state\.repositoryName, state\.branch, path\)/, 'new index URLs must target the selected repository and branch');
assert.match(app, /await commitChanges\(pending\.changes,[\s\S]*?, pending\)/, 'the final write must use the exact target reviewed by the user');
assert.match(app, /freshRef\.object\.sha !== expectedCommitSha/, 'a target branch that changed after review must be rejected before writes');
assert.match(app, /if \(!entries\.length\) return dir \|\| ICON_ROOT/, 'empty indexes must upload beside their own JSON index');
assert.match(app, /const assetDirectory = category\.assetDirectory \|\|[\s\S]*emptyIndex: category\.icons\.length === 0/, 'the initial upload review must preserve empty-index folder defaults');
assert.match(app, /ui\.repoPickerBack\.addEventListener\('click', \(\) => \{\s*if \(selectedOwner && selectedRepoName\) \{/, 'repository picker back action must work even with no categories');
const repoPickerBackHandler = app.match(/ui\.repoPickerBack\.addEventListener\('click', \(\) => \{([\s\S]*?)\n  \}\);/);
assert.ok(repoPickerBackHandler, 'repository picker navigation handler must exist');
assert.doesNotMatch(repoPickerBackHandler[1], /clearSavedToken|clearSavedRepository|clearCachedRepositories|token\s*=\s*''/, 'repository picker return must not clear token or repository state');
const cropHeading = html.match(/<header class="cutout-heading original-crop-heading">([\s\S]*?)<\/header>/);
assert.ok(cropHeading, 'the crop step must have its own modal header');
assert.match(cropHeading[1], /id="original-crop-back"[^>]*class="crop-page-back"[\s\S]*?<h2 id="original-crop-title"/, 'crop-step navigation must be in the header row before its current title');
assert.match(cropHeading[1], /id="original-crop-close"[^>]*aria-label="关闭裁切预览"/, 'the modal close control remains distinct from page navigation');
assert.doesNotMatch(html, /<div class="cutout-modal-actions original-crop-actions"><button id="original-crop-back"/, 'the crop step must not keep a duplicate back row below its header');
assert.match(html, /id="cutout-cancel" class="button button-quiet" type="button">取消，返回当前选择/, 'the cutout modal cancel control must remain unchanged');
assert.match(activity, /public void onBackPressed\(\)\s*\{\s*dispatchBackToWeb\(\);\s*\}/, 'Android hardware back must dispatch to the WebView route handler');
assert.match(activity, /backInvokedCallback = this::dispatchBackToWeb/, 'Android predictive back gesture must use the same route handler');
assert.match(activity, /window\.onCueAndroidBackPressed \? window\.onCueAndroidBackPressed\(\) : false;/, 'native back dispatch must call the JavaScript page/modal parent handler');
assert.match(activity, /getCachedLibrarySnapshotFor\(String owner, String name\)/, 'Android bridge must read snapshots by repository');
assert.match(activity, /saveCachedLibrarySnapshotFor\(String owner, String name, String serializedSnapshot\)/, 'Android bridge must save snapshots by repository');
assert.match(activity, /repositorySnapshotFile\(String owner, String name\)/, 'repository snapshot filenames must be isolated from raw repository names');

class ClassList {
  constructor(...items) { this.items = new Set(items); }
  add(item) { this.items.add(item); }
  remove(item) { this.items.delete(item); }
  contains(item) { return this.items.has(item); }
  toggle(item, force) {
    if (force === undefined) force = !this.items.has(item);
    if (force) this.items.add(item); else this.items.delete(item);
    return force;
  }
}
class Element {
  constructor(tagName = 'DIV') { this.tagName = tagName; this.classList = new ClassList(); this.textContent = ''; this.attributes = {}; this.listeners = new Map(); this.focused = false; }
  addEventListener(name, fn) { const list = this.listeners.get(name) || []; list.push(fn); this.listeners.set(name, list); }
  removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== fn)); }
  dispatch(name, event = {}) { for (const fn of [...(this.listeners.get(name) || [])]) fn({ target: this, preventDefault() {}, ...event }); }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { this.focused = true; document.activeElement = this; }
}
const elements = new Map([
  ['app-confirm-modal', new Element()], ['app-confirm-title', new Element()], ['app-confirm-message', new Element()],
  ['app-confirm-cancel', new Element('BUTTON')], ['app-confirm-accept', new Element('BUTTON')]
]);
elements.get('app-confirm-modal').classList.add('hidden');
const listeners = new Map();
const document = {
  activeElement: new Element('BUTTON'),
  documentElement: new Element('HTML'),
  getElementById(id) { return elements.get(id) || null; },
  addEventListener(name, fn) { const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list); },
  removeEventListener(name, fn) { listeners.set(name, (listeners.get(name) || []).filter((item) => item !== fn)); },
  dispatch(name, event = {}) { for (const fn of [...(listeners.get(name) || [])]) fn(event); }
};
const window = {};
vm.runInNewContext(dialogs, { window, document, Promise });

(async () => {
  const modal = elements.get('app-confirm-modal');
  const accept = elements.get('app-confirm-accept');
  const cancel = elements.get('app-confirm-cancel');
  const first = window.CueDialogs.confirm('清理本机缓存？', { language: 'zh-CN', title: '清理本机缓存？', confirmLabel: '清理缓存', danger: true });
  assert.equal(elements.get('app-confirm-title').textContent, '清理本机缓存？');
  assert.equal(elements.get('app-confirm-message').textContent, '清理本机缓存？');
  assert.equal(accept.textContent, '清理缓存');
  assert.equal(accept.classList.contains('button-danger'), true);
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal(await window.CueDialogs.confirm('second dialog'), false, 'do not stack confirmations');
  accept.dispatch('click');
  assert.equal(await first, true);
  assert.equal(modal.classList.contains('hidden'), true);

  const second = window.CueDialogs.confirm('Discard?', { language: 'en' });
  assert.equal(elements.get('app-confirm-cancel').textContent, 'Cancel');
  document.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(await second, false, 'Escape must cancel');
  assert.equal(modal.classList.contains('hidden'), true);

  const third = window.CueDialogs.confirm('Cancel?', {});
  cancel.dispatch('click');
  assert.equal(await third, false, 'cancel button must cancel');
  console.log('UI regressions: passed (static contracts + in-app confirm behavior)');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
