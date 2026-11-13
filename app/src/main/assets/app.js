(() => {
  'use strict';

  let selectedOwner = '';
  let selectedRepoName = '';
  const ICON_ROOT = 'icon';
  const GitHubUrls = window.CueGitHubUrlConfig;
  if (!GitHubUrls) throw new Error('GitHub 地址配置模块未加载。');
  const FolderOps = window.CueFolderOperations;
  if (!FolderOps) throw new Error('分类文件夹模块未加载。');
  const DEFAULT_API_BASE = GitHubUrls.DEFAULT_API_BASE;
  const DEFAULT_RAW_BASE = GitHubUrls.DEFAULT_RAW_BASE;
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const MAX_BATCH_BYTES = 24 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);

  function isIconIndexPath(path) {
    if (typeof path !== 'string' || !path.toLowerCase().endsWith('.json')) return false;
    const separator = path.indexOf('/');
    if (separator < 1) return false;
    const root = path.slice(0, separator).toLowerCase();
    const expectedRoot = ICON_ROOT.toLowerCase();
    return root === expectedRoot || root === `${expectedRoot}s`;
  }

  function iconRootForPath(path) {
    if (typeof path !== 'string' || !path) return '';
    const root = path.split('/')[0];
    const normalized = root.toLowerCase();
    return normalized === ICON_ROOT.toLowerCase() || normalized === `${ICON_ROOT.toLowerCase()}s` ? root : '';
  }

  function collectIconDirectories(entries) {
    const directories = new Set();
    for (const entry of entries || []) {
      const path = typeof entry?.path === 'string' ? entry.path : '';
      const root = iconRootForPath(path);
      if (!root || path.startsWith('/') || path.split('/').includes('..')) continue;
      const parts = path.split('/');
      const isDirectory = entry.type === 'tree';
      const lastDirectory = isDirectory ? parts.length : parts.length - 1;
      for (let length = 1; length <= lastDirectory; length += 1) {
        directories.add(parts.slice(0, length).join('/'));
      }
    }
    return directories;
  }

  function categoryBrowserListing(directoryPath, directories, indexCategories) {
    const parentPath = (path) => {
      const separator = path.lastIndexOf('/');
      return separator < 0 ? '' : path.slice(0, separator);
    };
    const folders = [...directories].filter((path) => parentPath(path) === directoryPath)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const indexes = indexCategories.filter((category) => parentPath(category.path) === directoryPath);
    return { folders, indexes };
  }

  function initialCategoryBrowsePath(directories, preferredPath = '') {
    const roots = [...directories].filter((path) => !path.includes('/'))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    if (preferredPath && directories.has(preferredPath)) return preferredPath;
    return roots.length === 1 ? roots[0] : '';
  }

  const $ = (selector) => document.querySelector(selector);
  const ui = {
    connectForm: $('#connect-form'), tokenInput: $('#token-input'), toggleToken: $('#toggle-token'),
    connectButton: $('#connect-button'), connectError: $('#connect-error'), connectPanel: $('#connect-panel'),
    repoPickerPanel: $('#repo-picker-panel'), repoList: $('#repo-list'), repoPickerError: $('#repo-picker-error'),
    repoPickerBack: $('#repo-picker-back'), repoPickerReload: $('#repo-picker-reload'),
    repoRefreshButton: $('#repo-refresh-button'),
    apiBaseInput: $('#github-api-base'), rawBaseInput: $('#github-raw-base'),
    endpointTestButton: $('#test-github-endpoints'), endpointSaveButton: $('#save-github-endpoints'),
    endpointDefaultsButton: $('#restore-github-endpoints'), endpointStatus: $('#github-endpoint-status'),
    savedTokenCard: $('#saved-token-card'),
    savedTokenDisplay: $('#saved-token-display'), toggleSavedToken: $('#toggle-saved-token'),
    copySavedToken: $('#copy-saved-token'), savedTokenReplaceToggle: $('#saved-token-replace-toggle'),
    savedTokenReplacePanel: $('#saved-token-replace-panel'), savedTokenReplacement: $('#saved-token-replacement'),
    toggleSavedTokenReplacement: $('#toggle-saved-token-replacement'), savedTokenReplaceSubmit: $('#saved-token-replace-submit'),
    savedTokenReplaceCancel: $('#saved-token-replace-cancel'), savedTokenStatus: $('#saved-token-status'),
    repoChipLabel: $('#repo-chip-label'), currentRepoLink: $('#current-repo-link'),
    forgetTokenButton: $('#forget-token-button'), disconnectButton: $('#disconnect-button'),
    libraryScreen: $('#library-screen'), cutoutScreen: $('#cutout-screen'), settingsScreen: $('#settings-screen'),
    librarySetupPrompt: $('#library-setup-prompt'), librarySettingsCta: $('#library-settings-cta'),
    bottomNavigation: $('#bottom-navigation'), navItems: [...document.querySelectorAll('.bottom-nav-item')],
    topbar: $('.topbar'), brandTitle: $('.brand-copy strong'), brandSubtitle: $('.brand-copy small'),
    settingsHome: $('#settings-home'), settingsIndex: $('#settings-index'), settingsSubpage: $('#settings-subpage'),
    settingsSubpageBack: $('#settings-subpage-back'),
    settingsPageButtons: [...document.querySelectorAll('[data-settings-page]')],
    settingsPageContents: {
      appearance: $('#settings-appearance-page'), navigation: $('#settings-navigation-page'),
      cache: $('#settings-cache-page'), about: $('#settings-about-page'), account: $('#settings-account-page')
    },
    launcherIconChoices: [...document.querySelectorAll('[data-launcher-icon]')],
    launcherIconStatus: $('#launcher-icon-status'),
    settingsConnectionSummary: $('#settings-connection-summary'), settingsCurrentRepo: $('#settings-current-repo'),
    settingsChangeRepo: $('#settings-change-repo'),
    reopenGuideButton: $('#reopen-guide-button'), walkthroughModal: $('#walkthrough-modal'),
    walkthroughProgress: $('#walkthrough-progress'), walkthroughTitle: $('#walkthrough-title'),
    walkthroughDescription: $('#walkthrough-description'), walkthroughNext: $('#walkthrough-next'),
    walkthroughSkip: $('#walkthrough-skip'),
    workspace: $('#workspace'), connectionState: $('#connection-state'),
    categoryList: $('#category-list'), categoryCount: $('#category-count'), categoryScrollHint: $('#category-scroll-hint'), categoryCreateFolder: $('#create-folder-button'), selectedKicker: $('#selected-kicker'),
    categoryBrowserNavigation: $('#category-browser-navigation'), categoryBrowserBack: $('#category-browser-back'),
    categoryBreadcrumbs: $('#category-breadcrumbs'), categoryBrowserEmpty: $('#category-browser-empty'),
    indexSelectPrompt: $('#index-select-prompt'), indexSelectKicker: $('#index-select-kicker'),
    indexSelectTitle: $('#index-select-title'), indexSelectHelp: $('#index-select-help'), categoryEditor: $('#category-editor'),
    selectedTitle: $('#selected-title'), selectedDescription: $('#selected-description'), branchLabel: $('#branch-label'),
    fileInput: $('#file-input'), galleryInput: $('#gallery-input'), cutoutGallerySelect: $('#cutout-gallery-select'),
    cutoutChangePhoto: $('#cutout-change-photo'), chooseFiles: $('#choose-files'), selectedFiles: $('#selected-files'),
    uploadButton: $('#upload-button'), iconGrid: $('#icon-grid'), iconCount: $('#icon-count'),
    stagedActions: $('#staged-actions'), stagedCount: $('#staged-count'), saveStaged: $('#save-staged'), discardStaged: $('#discard-staged'),
    renameCategory: $('#rename-category'), rawIndexLink: $('#raw-index-link'),
    searchInput: $('#search-input'), status: $('#status-message'), emptyState: $('#empty-state'),
    emptyTitle: $('#empty-title'), emptyDescription: $('#empty-description'), toast: $('#toast'),
    cutoutModal: $('#cutout-modal'), cutoutCanvas: $('#cutout-selection-canvas'), cutoutOriginalLabel: $('#cutout-original-label'),
    cutoutResultPreview: $('#cutout-result-preview'), cutoutOriginalName: $('#cutout-original-name'),
    cutoutResultName: $('#cutout-result-name'), cutoutCancel: $('#cutout-cancel'),
    cutoutClose: $('#cutout-close'), cutoutOriginalOnly: $('#cutout-original-only'),
    cutoutCutoutOnly: $('#cutout-cutout-only'), cutoutNeither: $('#cutout-neither'),
    originalCropModal: $('#original-crop-modal'), originalCropKicker: $('#original-crop-kicker'),
    originalCropTitle: $('#original-crop-title'), originalCropDescription: $('#original-crop-description'),
    originalCropShapes: [...document.querySelectorAll('[data-original-crop-shape]')],
    originalCropRoundedLabel: $('#original-crop-rounded-label'), originalCropRoundedHelp: $('#original-crop-rounded-help'),
    originalCropCircleLabel: $('#original-crop-circle-label'), originalCropCircleHelp: $('#original-crop-circle-help'),
    originalCropPreview: $('#original-crop-preview'), originalCropZoom: $('#original-crop-zoom'),
    originalCropZoomLabel: $('#original-crop-zoom-label'), originalCropZoomValue: $('#original-crop-zoom-value'),
    originalCropError: $('#original-crop-error'), originalCropBack: $('#original-crop-back'),
    originalCropClose: $('#original-crop-close'), originalCropApply: $('#original-crop-apply'),
    cutoutModalError: $('#cutout-modal-error'), cutoutPositiveMode: $('#cutout-positive-mode'),
    cutoutNegativeMode: $('#cutout-negative-mode'), cutoutEraseMode: $('#cutout-erase-mode'),
    cutoutRestoreMode: $('#cutout-restore-mode'), cutoutClearPoints: $('#cutout-clear-points'), cutoutProgress: $('#cutout-progress'),
    cutoutBrushSize: $('#cutout-brush-size'), cutoutBrushSizeTitle: $('#cutout-brush-size-title'),
    cutoutBrushSizeValue: $('#cutout-brush-size-value'), cutoutUndo: $('#cutout-undo'), cutoutRedo: $('#cutout-redo'),
    cutoutOutlineEnabled: $('#cutout-outline-enabled'), cutoutOutlineTitle: $('#cutout-outline-title'),
    cutoutOutlineWidth: $('#cutout-outline-width'), cutoutOutlineWidthTitle: $('#cutout-outline-width-title'),
    cutoutOutlineWidthValue: $('#cutout-outline-width-value'),
    moveModal: $('#move-modal'), moveSourcePath: $('#move-source-path'), moveDestination: $('#move-destination'),
    moveDestinationPath: $('#move-destination-path'), moveImageDirectory: $('#move-image-directory'),
    movePreview: $('#move-preview'), moveError: $('#move-error'), moveConfirm: $('#move-confirm'),
    moveCancel: $('#move-cancel'), moveClose: $('#move-close'), stagedMoves: $('#staged-moves'),
    renameModal: $('#rename-modal'), renameKicker: $('#rename-kicker'), renameTitle: $('#rename-title'),
    renameDescription: $('#rename-description'), renameFieldLabel: $('#rename-field-label'),
    renameInput: $('#rename-input'), renameHelp: $('#rename-help'), renameCount: $('#rename-count'),
    renameError: $('#rename-error'), renameConfirm: $('#rename-confirm'), renameCancel: $('#rename-cancel'),
    renameClose: $('#rename-close'),
    languageSelect: $('#language-select'), appearanceSelect: $('#appearance-select'),
    blackBackgroundToggle: $('#black-background-toggle'), systemColorToggle: $('#system-color-toggle'),
    systemColorNote: $('#system-color-note'), navLayoutSelect: $('#nav-layout-select'),
    navLabelsToggle: $('#nav-labels-toggle'), navAutoHideToggle: $('#nav-autohide-toggle'),
    cacheTotalSize: $('#cache-total-size'), cacheImageUsage: $('#cache-image-usage'),
    cacheImageCount: $('#cache-image-count'), cacheRemoteImageUsage: $('#cache-remote-image-usage'),
    cacheRemoteImageCount: $('#cache-remote-image-count'), cacheRepositoryUsage: $('#cache-repository-usage'),
    cacheRepositoryCount: $('#cache-repository-count'), cacheLibraryUsage: $('#cache-library-usage'),
    cacheLibraryCount: $('#cache-library-count'), cacheRefreshButton: $('#cache-refresh-button'),
    cacheClearButton: $('#cache-clear-button'), cacheStatus: $('#cache-status'),
    libraryRefreshButton: $('#library-refresh-button'),
    accentColorChoices: [...document.querySelectorAll('[data-accent-color]')],
    useWallpaperColorButton: $('#use-wallpaper-color'), chooseThemeImageButton: $('#choose-theme-image'),
    wallpaperAccentChoices: $('#wallpaper-accent-choices'), themeImageInput: $('#theme-image-input'), accentColorStatus: $('#accent-color-status'),
    accentSelectedCopy: $('#accent-selected-copy'),
    accentEyedropperModal: $('#accent-eyedropper-modal'), accentEyedropperImage: $('#accent-eyedropper-image'),
    accentEyedropperPhotoFrame: $('#accent-eyedropper-photo-frame'), accentEyedropperMarker: $('#accent-eyedropper-marker'),
    accentEyedropperSwatch: $('#accent-eyedropper-swatch'), accentEyedropperValue: $('#accent-eyedropper-value'),
    accentEyedropperStatus: $('#accent-eyedropper-status'), accentEyedropperApply: $('#accent-eyedropper-apply'),
    accentEyedropperCancel: $('#accent-eyedropper-cancel'), accentEyedropperClose: $('#accent-eyedropper-close'),
    accentCurrentSwatch: $('#accent-current-swatch'), accentCurrentLabel: $('#accent-current-label'),
    accentCurrentValue: $('#accent-current-value'), accentCurrentTitle: $('#accent-current-title'),
    uploadConfirmModal: $('#upload-confirm-modal'), uploadConfirmRepository: $('#upload-confirm-repository'),
    uploadConfirmBranch: $('#upload-confirm-branch'), uploadConfirmCategory: $('#upload-confirm-category'),
    uploadConfirmIndex: $('#upload-confirm-index'), uploadConfirmDirectory: $('#upload-confirm-directory'),
    uploadConfirmDirectoryNote: $('#upload-confirm-directory-note'), uploadConfirmSelectionNote: $('#upload-confirm-selection-note'),
    uploadConfirmFileList: $('#upload-confirm-file-list'),
    uploadConfirmError: $('#upload-confirm-error'), uploadConfirmCancel: $('#upload-confirm-cancel'),
    uploadConfirmClose: $('#upload-confirm-close'), uploadConfirmSubmit: $('#upload-confirm-submit'),
    folderOperationModal: $('#folder-operation-modal'), folderOperationTitle: $('#folder-operation-title'),
    folderOperationDescription: $('#folder-operation-description'), folderOperationNameWrap: $('#folder-operation-name-wrap'),
    folderOperationNameLabel: $('#folder-operation-name-label'), folderOperationName: $('#folder-operation-name'),
    folderOperationDestinationWrap: $('#folder-operation-destination-wrap'), folderOperationDestinationLabel: $('#folder-operation-destination-label'),
    folderOperationDestination: $('#folder-operation-destination'), folderOperationPreview: $('#folder-operation-preview'),
    folderOperationError: $('#folder-operation-error'), folderOperationStage: $('#folder-operation-stage'),
    folderOperationCancel: $('#folder-operation-cancel'), folderOperationClose: $('#folder-operation-close'),
    aboutVersionValue: $('#about-version-value'), walkthroughVisual: $('#walkthrough-visual'),
    settingsSave: [...document.querySelectorAll('.settings-save')]
  };

  let token = '';
  let tokenSaved = false;
  let apiBaseUrl = DEFAULT_API_BASE;
  let rawContentBaseUrl = DEFAULT_RAW_BASE;
  let rawBaseHistory = [];
  let endpointStatusState = null;
  let repository = null;
  let branch = 'main';
  let commitSha = '';
  let baseTreeSha = '';
  let treeFiles = new Map();
  let repositoryDirectories = new Set();
  let categories = [];
  const stagedCategories = new Map();
  let folderStageSnapshot = null;
  let folderPendingFiles = new Map();
  let folderOperations = [];
  let folderIndexDrafts = new Map();
  let pendingFolderOperation = null;
  let activeCategoryPath = '';
  let categoryBrowsePath = '';
  let selectedFiles = [];
  let selectedFileNames = [];
  const stagedMoves = [];
  let pendingMove = null;
  let pendingRename = null;
  let pendingUploadConfirmation = null;
  let uploadTargetState = null;
  let uploadTargetContext = null;
  let uploadTargetLoadSequence = 0;
  let closeChoiceDialog = null;
  let cutoutBusy = false;
  let cutoutSequence = 0;
  let originalCropShape = 'rounded';
  let originalCropZoom = 1;
  let originalCropCenterX = 0;
  let originalCropCenterY = 0;
  let originalCropPointers = new Map();
  let originalCropGesture = null;
  let originalCropPreviewSource = null;
  let originalCropRenderFrame = 0;
  let originalCropRequest = 0;
  let pendingCutout = null;
  let toastTimer = null;
  let busy = false;
  let accessibleRepositories = [];
  let cutoutTool = 'keep';
  let cutoutBrushSize = 28;
  let cutoutOutlineEnabled = false;
  let cutoutOutlineSize = 4;
  let appLanguage = 'zh-CN';
  let appAppearance = 'system';
  let appBlackBackground = false;
  let appUseSystemAccent = false;
  let systemAccentAvailable = false;
  let systemAccentColors = null;
  let appNavLayout = 'fixed';
  let appShowNavLabels = true;
  let appNavAutoHide = false;
  let lastScrollY = window.scrollY;
  let launcherIcon = 'cream';
  let appVersion = '—';
  let cacheStatusState = null;
  let librarySnapshotStale = false;
  let appAccentColor = '';
  let pendingAccentColor = '';
  let pendingAccentSource = 'preset';
  let accentColorStatusState = null;
  let savedTokenStatusState = null;
  let accentEyedropperObjectUrl = null;
  let accentEyedropperColor = '';
  let accentEyedropperPointerActive = false;
  let systemDarkOverride = null;
  let appearanceMediaQuery = null;
  let activeScreen = 'library';
  let settingsRepoPickerOpen = false;
  let activeSettingsPage = 'home';
  let galleryReplaceIndex = null;
  let walkthroughStep = 0;

  function repositoryApiPathFor(owner, name) {
    if (!owner || !name) throw new Error('请先从 token 可访问的仓库中选择图标库。');
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  }

  function repositoryApiPath() {
    return repositoryApiPathFor(selectedOwner, selectedRepoName);
  }

  function syncLockedControls() {
    const locked = busy || cutoutBusy || Boolean(pendingCutout) || librarySnapshotStale;
    ui.chooseFiles.disabled = locked;
    ui.fileInput.disabled = locked;
    ui.uploadButton.disabled = locked || folderOperations.length > 0;
    ui.disconnectButton.disabled = locked;
    ui.categoryCreateFolder.disabled = locked || stagedCategories.size > 0 || stagedMoves.length > 0;
    ui.libraryRefreshButton.disabled = busy || cutoutBusy || Boolean(pendingCutout)
      || !token || !selectedOwner || !selectedRepoName;
    ui.saveStaged.disabled = locked;
    ui.discardStaged.disabled = locked;
    ui.renameCategory.disabled = locked || folderOperations.length > 0;
    document.querySelectorAll('.delete-button, .category-item, .category-folder-action, .chip-action, .chip-remove, .icon-action, .icon-move-select').forEach((button) => {
      const folderReadOnlyNavigation = button.classList.contains('category-folder');
      const indexLockedByFolderStage = folderOperations.length > 0 && button.classList.contains('category-index');
      button.disabled = (folderReadOnlyNavigation ? busy || cutoutBusy || Boolean(pendingCutout) : locked || indexLockedByFolderStage)
        || button.dataset.unavailable === 'true';
    });
  }

  function setBusy(value) {
    busy = value;
    ui.connectButton.disabled = value;
    syncLockedControls();
  }

  function setConnectError(message = '') {
    ui.connectError.textContent = message;
    ui.connectError.classList.toggle('hidden', !message);
  }

  function setEndpointStatus(kind, zh, en) {
    endpointStatusState = { kind, zh, en };
    renderEndpointStatus();
  }

  function renderEndpointStatus() {
    if (!ui.endpointStatus) return;
    if (!endpointStatusState) {
      ui.endpointStatus.className = 'endpoint-status hidden';
      ui.endpointStatus.textContent = '';
      return;
    }
    ui.endpointStatus.className = `endpoint-status ${endpointStatusState.kind}`;
    ui.endpointStatus.textContent = appLanguage === 'en' ? endpointStatusState.en : endpointStatusState.zh;
  }

  function persistEndpointSettings(apiBase, rawBase, history) {
    if (window.CueAppSettings?.saveGitHubEndpoints) {
      return Boolean(window.CueAppSettings.saveGitHubEndpoints(apiBase, rawBase, JSON.stringify(history)));
    }
    try {
      let existing = {};
      try { existing = JSON.parse(window.localStorage.getItem('cue-app-preferences') || '{}'); } catch { }
      window.localStorage.setItem('cue-app-preferences', JSON.stringify({
        ...existing, githubApiBaseUrl: apiBase, githubRawBaseUrl: rawBase, githubRawBaseHistory: history
      }));
      return true;
    } catch { return false; }
  }

  function readEndpointForm() {
    try {
      return { api: GitHubUrls.normalizeBaseUrl(ui.apiBaseInput.value), raw: GitHubUrls.normalizeBaseUrl(ui.rawBaseInput.value) };
    } catch (error) {
      setEndpointStatus('error', `地址无效：${error.message}`, `Invalid address: ${error.message}`);
      return null;
    }
  }

  function saveEndpointForm(api, raw, restored = false) {
    const history = [...new Set([rawContentBaseUrl, ...rawBaseHistory])].filter((base) => base !== raw).slice(0, 8);
    if (!persistEndpointSettings(api, raw, history)) {
      setEndpointStatus('error', '地址未能保存在本机；当前生效地址和仓库缓存均未改变。', 'Could not save addresses on this device; the active addresses and cached repository list were left unchanged.');
      return false;
    }
    apiBaseUrl = api;
    rawContentBaseUrl = raw;
    rawBaseHistory = history;
    ui.apiBaseInput.value = api;
    ui.rawBaseInput.value = raw;
    if (categories.length) renderActiveCategory();
    setEndpointStatus('saved', restored
      ? '已恢复并保存官方默认地址；仓库缓存保留，刷新列表仍需手动操作。'
      : '地址已保存在本机；仓库缓存保留，刷新列表仍需手动操作。', restored
      ? 'Official default addresses were restored and saved. The repository cache was kept; refreshing it remains a separate manual action.'
      : 'Addresses were saved on this device. The repository cache was kept; refreshing it remains a separate manual action.');
    return true;
  }

  async function testGitHubApiEndpoint() {
    let base;
    try { base = GitHubUrls.normalizeBaseUrl(ui.apiBaseInput.value); }
    catch (error) {
      setEndpointStatus('error', `API 地址无效：${error.message}`, `Invalid API base: ${error.message}`);
      return;
    }
    const candidateToken = token || ui.tokenInput.value.trim();
    if (!candidateToken) {
      setEndpointStatus('error', '请先连接 GitHub 或在令牌框中输入 PAT，再测试 API 地址。', 'Connect GitHub or enter a PAT in the masked token field before testing the API address.');
      return;
    }
    ui.endpointTestButton.disabled = true;
    setEndpointStatus('loading', '正在向填写的 API 主机发送只读连接测试；PAT 会随 Authorization 请求头发送。', 'Sending a read-only test to the entered API host; the PAT is sent in the Authorization header.');
    try {
      const payload = await request('/user/repos?per_page=1&page=1', {}, base, candidateToken);
      if (!Array.isArray(payload)) throw new Error('GitHub API 返回格式无效。');
      const host = new URL(base).host;
      setEndpointStatus('success', `连接成功：${host} 已接受 API 请求。此测试不改动仓库缓存；需要更新仓库清单时请手动刷新。`, `Connection succeeded: ${host} returned a valid API response. This test did not change the repository cache; refresh it separately when needed.`);
    } catch (error) {
      setEndpointStatus('error', `连接测试失败：${error.message || '请检查地址、网络及 Token 权限。'}`, `Connection test failed: ${error.message || 'Check the address, network and token permissions.'}`);
    } finally { ui.endpointTestButton.disabled = false; }
  }

  function showStatus(message = '', type = 'info') {
    ui.status.textContent = message;
    ui.status.className = message ? `status-message ${type}` : 'status-message hidden';
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => ui.toast.classList.remove('show'), 3200);
  }

  function confirmInApp(message, options = {}) {
    return window.CueDialogs?.confirm?.(message, { ...options, language: appLanguage }) || Promise.resolve(false);
  }

  function setSavedTokenStatus(kind, zh, en) {
    if (!kind) {
      savedTokenStatusState = null;
      renderSavedTokenStatus();
      return;
    }
    savedTokenStatusState = { kind, zh, en };
    renderSavedTokenStatus();
  }

  function renderSavedTokenStatus() {
    if (!savedTokenStatusState) {
      ui.savedTokenStatus.className = 'saved-token-status hidden';
      ui.savedTokenStatus.textContent = '';
      return;
    }
    ui.savedTokenStatus.className = `saved-token-status ${savedTokenStatusState.kind}`;
    ui.savedTokenStatus.textContent = appLanguage === 'en' ? savedTokenStatusState.en : savedTokenStatusState.zh;
  }

  function updateSettingsChoiceButtons() {
    document.querySelectorAll('.preference-choice-button[data-choice-select]').forEach((button) => {
      const select = document.getElementById(button.dataset.choiceSelect);
      if (!select) return;
      const value = select.selectedOptions[0]?.textContent || '';
      const label = button.closest('.preference-row')?.querySelector('strong')?.textContent || '';
      button.textContent = value;
      button.setAttribute('aria-label', `${label}: ${value}`);
    });
  }
  function openSettingsChoiceDialog(selectId, trigger) {
    openChoiceDialog(selectId, trigger, false);
  }
  function openUploadTargetChoiceDialog(selectId, trigger) {
    openChoiceDialog(selectId, trigger, true);
  }
  function updateUploadTargetChoiceButtons() {
    document.querySelectorAll('.upload-target-choice-button[data-choice-select]').forEach((button) => {
      const select = document.getElementById(button.dataset.choiceSelect);
      if (!select) return;
      const value = select.selectedOptions[0]?.textContent || (appLanguage === 'en' ? 'Choose an option' : '请选择');
      const label = button.closest('.upload-confirm-target-row')?.querySelector('.upload-confirm-target-label')?.textContent || '';
      const valueNode = button.querySelector('.upload-target-choice-value');
      if (valueNode) valueNode.textContent = value;
      else button.textContent = value;
      button.disabled = select.disabled || select.options.length === 0;
      button.setAttribute('aria-label', `${label}: ${value}`);
    });
  }
  function openChoiceDialog(selectId, trigger, isUploadTarget) {
    const select = document.getElementById(selectId);
    const modal = $('#settings-choice-modal');
    const title = $('#settings-choice-title');
    const options = $('#settings-choice-options');
    if (!select || !modal || !options) return;
    const row = trigger.closest(isUploadTarget ? '.upload-confirm-target-row' : '.preference-row');
    const label = row?.querySelector(isUploadTarget ? '.upload-confirm-target-label' : 'strong')?.textContent;
    title.textContent = label || (appLanguage === 'en' ? 'Choose an option' : '选择选项');
    $('#settings-choice-modal .section-kicker').textContent = isUploadTarget
      ? (appLanguage === 'en' ? 'UPLOAD DESTINATION' : '本次上传目标')
      : (appLanguage === 'en' ? 'DEVICE PREFERENCES' : '本机偏好');
    options.replaceChildren();
    const optionButtons = [...select.options].map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-choice-option';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(option.value === select.value));
      button.tabIndex = option.value === select.value ? 0 : -1;
      button.textContent = option.textContent;
      if (option.value === select.value) button.classList.add('selected');
      button.addEventListener('click', () => {
        const changed = select.value !== option.value;
        select.value = option.value;
        close();
        if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
        updateSettingsChoiceButtons();
        updateUploadTargetChoiceButtons();
      });
      options.append(button);
      return button;
    });
    modal.classList.remove('hidden');
    document.documentElement.classList.add('settings-choice-open');
    const previousFocus = document.activeElement;
    trigger.setAttribute('aria-expanded', 'true');
    const close = () => {
      modal.classList.add('hidden');
      document.documentElement.classList.remove('settings-choice-open');
      modal.removeEventListener('click', onModalClick);
      document.removeEventListener('keydown', onKeydown);
      trigger.setAttribute('aria-expanded', 'false');
      if (closeChoiceDialog === close) closeChoiceDialog = null;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    };
    closeChoiceDialog = close;
    const onModalClick = (event) => {
      if (event.target.matches('[data-settings-choice-close]')) close();
    };
    const focusOption = (index) => {
      if (!optionButtons.length) return;
      const next = (index + optionButtons.length) % optionButtons.length;
      optionButtons.forEach((button, buttonIndex) => { button.tabIndex = buttonIndex === next ? 0 : -1; });
      optionButtons[next].focus();
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && optionButtons.length) {
        event.preventDefault();
        const current = optionButtons.indexOf(document.activeElement);
        if (event.key === 'Home') focusOption(0);
        else if (event.key === 'End') focusOption(optionButtons.length - 1);
        else focusOption((current < 0 ? 0 : current) + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Tab') {
        const focusable = [$('#settings-choice-close'), ...optionButtons];
        const current = focusable.indexOf(document.activeElement);
        if (event.shiftKey && current <= 0) {
          event.preventDefault();
          focusable.at(-1)?.focus();
        } else if (!event.shiftKey && current === focusable.length - 1) {
          event.preventDefault();
          focusable[0]?.focus();
        }
      }
    };
    modal.addEventListener('click', onModalClick);
    document.addEventListener('keydown', onKeydown);
    (optionButtons.find((button) => button.getAttribute('aria-checked') === 'true') || $('#settings-choice-close')).focus();
  }

  function setCacheStatus(kind, zh, en) {
    cacheStatusState = { kind, zh, en };
    renderCacheStatus();
  }

  function renderCacheStatus() {
    if (!cacheStatusState) {
      ui.cacheStatus.className = 'cache-status hidden';
      ui.cacheStatus.textContent = '';
      return;
    }
    ui.cacheStatus.className = `cache-status ${cacheStatusState.kind}`;
    ui.cacheStatus.textContent = appLanguage === 'en' ? cacheStatusState.en : cacheStatusState.zh;
  }

  function refreshCacheInfo() {
    try {
      const raw = window.CueAppSettings?.getCacheInfo?.();
      if (!raw) throw new Error('native bridge unavailable');
      const info = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const imageBytes = Math.max(0, Number(info.imageBytes) || 0);
      const imageFiles = Math.max(0, Number(info.imageFiles) || 0);
      const remoteImageBytes = Math.max(0, Number(info.remoteImageBytes) || 0);
      const remoteImageFiles = Math.max(0, Number(info.remoteImageFiles) || 0);
      const repositoryBytes = Math.max(0, Number(info.repositoryBytes) || 0);
      const repositoryCount = Math.max(0, Number(info.repositoryCount) || 0);
      const libraryBytes = Math.max(0, Number(info.libraryBytes) || 0);
      const libraryCount = Math.max(0, Number(info.libraryCount) || 0);
      const libraryIndexCount = Math.max(0, Number(info.libraryIndexCount) || 0);
      ui.cacheTotalSize.textContent = formatCacheBytes(imageBytes + remoteImageBytes + repositoryBytes + libraryBytes);
      ui.cacheImageUsage.textContent = formatCacheBytes(imageBytes);
      ui.cacheImageCount.textContent = appLanguage === 'en'
        ? `${imageFiles} ${imageFiles === 1 ? 'file' : 'files'}` : `${imageFiles} 个文件`;
      ui.cacheRemoteImageUsage.textContent = formatCacheBytes(remoteImageBytes);
      ui.cacheRemoteImageCount.textContent = appLanguage === 'en'
        ? `${remoteImageFiles} ${remoteImageFiles === 1 ? 'image' : 'images'}` : `${remoteImageFiles} 张图标`;
      ui.cacheRepositoryUsage.textContent = formatCacheBytes(repositoryBytes);
      ui.cacheRepositoryCount.textContent = appLanguage === 'en'
        ? `${repositoryCount} ${repositoryCount === 1 ? 'repository' : 'repositories'}` : `${repositoryCount} 个仓库`;
      ui.cacheLibraryUsage.textContent = formatCacheBytes(libraryBytes);
      ui.cacheLibraryCount.textContent = appLanguage === 'en'
        ? `${libraryCount} library · ${libraryIndexCount} indexes`
        : `${libraryCount} 个图标库 · ${libraryIndexCount} 个索引`;
      ui.cacheClearButton.disabled = false;
      return true;
    } catch {
      ui.cacheTotalSize.textContent = '—';
      ui.cacheImageUsage.textContent = '—';
      ui.cacheImageCount.textContent = '—';
      ui.cacheRemoteImageUsage.textContent = '—';
      ui.cacheRemoteImageCount.textContent = '—';
      ui.cacheRepositoryUsage.textContent = '—';
      ui.cacheRepositoryCount.textContent = '—';
      ui.cacheLibraryUsage.textContent = '—';
      ui.cacheLibraryCount.textContent = '—';
      ui.cacheClearButton.disabled = true;
      setCacheStatus('error', '无法读取本机缓存；此功能需要在 Android 应用中使用。', 'Could not read local cache. Open this feature in the Android app.');
      return false;
    }
  }

  async function clearManagedCache() {
    if (busy || cutoutBusy || pendingCutout || selectedFiles.length) {
      setCacheStatus('info', '请先完成或取消当前图片处理/上传队列，再清理缓存。', 'Finish or cancel the current image processing or upload queue before clearing cache.');
      return;
    }
    const confirmed = await confirmInApp(appLanguage === 'en'
      ? 'Clear temporary image copies, locally cached remote icons and the cached repository list? Your GitHub token, selected repository, settings and GitHub files will remain. Refreshing the library downloads its icons again.'
      : '清理临时图片副本、已缓存的远程图标和仓库清单？GitHub Token、当前仓库选择、其他设置和 GitHub 文件都会保留。刷新图标库或重新打开图标时会再次下载图片。', {
        title: appLanguage === 'en' ? 'Clear local cache?' : '清理本机缓存？',
        confirmLabel: appLanguage === 'en' ? 'Clear cache' : '清理缓存', danger: true
      });
    if (!confirmed) return;
    ui.cacheClearButton.disabled = true;
    try {
      const cleared = Boolean(window.CueAppSettings?.clearManagedCache?.());
      if (!cleared) {
        setCacheStatus('error', '清理未能完整完成；请刷新占用信息后重试。', 'Cache could not be fully cleared. Refresh the usage information and try again.');
        refreshCacheInfo();
        return;
      }
      accessibleRepositories = [];
      renderRepositoryChoices(accessibleRepositories);
      setCacheStatus('success', '已清理图片副本、远程图标缓存与仓库清单；Token、当前仓库选择和设置均已保留。', 'Image copies, cached remote icons and the repository list were cleared. Your token, selected repository and settings were kept.');
      refreshCacheInfo();
    } catch {
      setCacheStatus('error', '清理失败；请稍后重试。', 'Could not clear cache. Please try again.');
      refreshCacheInfo();
    } finally {
      ui.cacheClearButton.disabled = false;
    }
  }

  function getSettingsSubpageTitle(page = activeSettingsPage) {
    const english = appLanguage === 'en';
    const titles = {
      appearance: english ? 'Appearance and language' : '外观与语言',
      navigation: english ? 'Navigation and layout' : '导航与布局',
      cache: english ? 'Cache management' : '缓存管理',
      about: english ? 'About' : '关于',
      account: english ? 'GitHub account and repository' : 'GitHub 账号与仓库'
    };
    return titles[page] || titles.appearance;
  }

  function setSettingsPage(page = 'home') {
    const validPages = ['appearance', 'navigation', 'cache', 'about', 'account'];
    activeSettingsPage = validPages.includes(page) ? page : 'home';
    const home = activeSettingsPage === 'home';
    ui.settingsHome.classList.toggle('hidden', !home);
    ui.settingsIndex.classList.toggle('hidden', !home);
    ui.settingsSubpage.classList.toggle('hidden', home);
    Object.entries(ui.settingsPageContents).forEach(([key, section]) => {
      section.classList.toggle('hidden', key !== activeSettingsPage);
    });
    if (activeSettingsPage === 'cache') refreshCacheInfo();
    updateTopbarTitle();
  }

  function updateTopbarTitle() {
    const english = appLanguage === 'en';
    const nestedSettingsPage = activeScreen === 'settings' && activeSettingsPage !== 'home';
    ui.settingsSubpageBack.classList.toggle('hidden', !nestedSettingsPage);
    ui.topbar.classList.toggle('settings-subpage-active', nestedSettingsPage);
    const titles = activeScreen === 'settings'
      ? activeSettingsPage === 'home'
        ? [english ? 'Settings' : '设置', english ? 'PREFERENCES' : '本机管理']
        : [getSettingsSubpageTitle(), english ? 'SETTINGS' : '设置']
      : activeScreen === 'cutout'
        ? [english ? 'Cutout' : '抠图', english ? 'ON-DEVICE' : '本机处理']
        : [english ? 'Library' : '图标库', english ? 'MANAGER' : '管理台'];
    ui.brandTitle.textContent = titles[0];
    ui.brandSubtitle.textContent = titles[1];
  }

  function setActiveScreen(screen, settingsPage = 'home') {
    if (!['library', 'cutout', 'settings'].includes(screen)) return;
    activeScreen = screen;
    if (screen === 'settings') setSettingsPage(settingsPage);
    ui.libraryScreen.classList.toggle('hidden', screen !== 'library');
    ui.cutoutScreen.classList.toggle('hidden', screen !== 'cutout');
    ui.settingsScreen.classList.toggle('hidden', screen !== 'settings');
    ui.navItems.forEach((button) => {
      const selected = button.dataset.screen === screen;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    updateTopbarTitle();
    setBottomNavHidden(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function walkthroughContent() {
    if (appLanguage === 'en') return [
      ['Connect GitHub safely', 'In Settings → GitHub account and repository, enter your personal access token and validate it. The token is kept encrypted in Android Keystore on this device; this guide never reads or displays its value. Read access is enough to browse; Contents write access is needed only when you submit changes.'],
      ['Load and refresh repositories', 'After validation, the app loads repositories accessible to that token and caches the list locally. Switch among cached repositories anytime. Use “Refresh repository list” only when you want to discover new repositories or update access; changing the token clears the previous token’s cache.'],
      ['Choose a repository and JSON index', 'Select a cached repository in Settings. In the library, choose the category’s separate JSON index; each category has its own file under icon/. Switching repositories or indexes does not write to GitHub.'],
      ['Pick a gallery image', 'Open Cutout from the bottom bar and choose one photo. Android grants access only to the selected image; no broad storage permission is requested, and the image stays on this device.'],
      ['Automatic cutout and optional refinement', 'The on-device IS-Net model creates an automatic cutout. Tap the subject or background to request MobileSAM refinement when useful, or use the erase/restore brush and optional white outline. Refinement is optional.'],
      ['Preview and choose what to keep', 'Review the original and transparent preview, then choose “Original only”, “Cutout only”, or “Save neither”. Original only opens a local circle or rounded-square crop with drag and zoom; the first two add the chosen result to the local upload queue. “Save neither” discards this result. Nothing is uploaded automatically.'],
      ['Name files and review index edits', 'Before upload, edit each chosen file name. Category-name and index organization edits are staged for review; save or discard them explicitly. Each change applies to the selected JSON index.'],
      ['Move icons between categories', 'Use an icon’s move action to choose the destination icon category and JSON index separately from the image folder. The preview shows the exact image path and updated URL; only that icon’s file moves. Review and explicitly confirm before anything is sent to GitHub.'],
      ['Upload or delete only after confirmation', 'Review the affected file and index before continuing. Uploads and deletes require a separate explicit confirmation and then write to GitHub. This tutorial itself never uploads, deletes, or commits anything.'],
      ['Find appearance and app options', 'Settings contains language and theme, system colors, bottom-navigation layout/labels/auto-hide, and launcher-icon choices. You can reopen this guide from the Settings home whenever you need it.']
    ];
    return [
      ['安全连接 GitHub', '进入「设置 → GitHub 账号与仓库」，输入个人访问 Token 并验证。Token 会用 Android Keystore 加密保存在本机；本教程不会读取或显示 Token 值。浏览只需读取权限，提交改动时才需要 Contents 写权限。'],
      ['加载与刷新仓库', '验证后会读取该 Token 可访问的仓库并缓存在本机。平时可直接切换缓存库；只有发现新仓库或更新授权时才点「刷新仓库列表」。更换 Token 会清除旧 Token 对应的缓存。'],
      ['选择仓库和 JSON 索引', '在设置中选择缓存的仓库。进入图标库后，再选择要管理的分类 JSON 索引；每个分类在 icon/ 下都有独立 JSON。切换仓库或索引不会写入 GitHub。'],
      ['从相册选图片', '点底部「抠图」并选择一张照片。Android 只授予所选图片的访问权；不申请广泛存储权限，图片留在本机。'],
      ['自动抠图与可选精修', '本机 IS-Net 会先自动抠图。需要时点主体或背景按需加载 MobileSAM 精修，也可用擦除/恢复笔刷和白色描边；精修是可选的。'],
      ['预览并决定保留什么', '检查原图与透明预览，再选「仅用原图」「仅用透明抠图」或「都不保存」。选「仅用原图」后可在本机调整构图，并裁成圆形或圆角方形；前两项会把所选结果加入本机上传队列，「都不保存」会放弃本次结果。不会自动上传。'],
      ['命名文件并检查索引变更', '上传前可修改每个文件名。分类名称与索引整理会先暂存供检查；可明确保存或撤销，变更只作用于当前选中的 JSON 索引。'],
      ['在分类间移动图标', '使用图标的移动操作，分别选择目标图标分类/JSON 索引和图片文件夹。预览会显示准确图片路径与更新后的 URL；只移动这一个图标文件。检查后还需单独确认才会写入 GitHub。'],
      ['确认后才上传或删除', '操作前先检查受影响的文件与索引。上传和删除都需要单独明确确认，随后才会写入 GitHub。本教程不会上传、删除或提交任何内容。'],
      ['找到外观与应用选项', '设置里可调整语言、主题、系统取色、底部导航布局/标签/自动隐藏，以及桌面图标。以后可在设置主页重新打开本教程。']
    ];
  }

  function guideCompletionStored() {
    try {
      if (window.CueAppSettings?.isOnboardingCompleted?.()) return true;
      return window.localStorage.getItem('cue-onboarding-completed') === 'true';
    } catch { return false; }
  }

  function persistGuideCompletion() {
    try {
      if (window.CueAppSettings?.setOnboardingCompleted?.(true)) return;
      window.localStorage.setItem('cue-onboarding-completed', 'true');
    } catch { /* The guide remains usable even if this device cannot persist completion. */ }
  }

  function renderWalkthroughStep() {
    const steps = walkthroughContent();
    const [title, description] = steps[walkthroughStep];
    const english = appLanguage === 'en';
    const illustrations = [
      ['guide-account.svg', '连接 GitHub 的账号与令牌设置界面', 'GitHub account and token settings'],
      ['guide-account.svg', '可访问的仓库列表界面', 'A list of accessible repositories'],
      ['guide-index.svg', '分类与 JSON 索引选择界面', 'Category and JSON index selection'],
      ['guide-cutout.svg', '从相册选择照片并在本机抠图的界面', 'Photo selection and on-device cutout'],
      ['guide-cutout.svg', '透明抠图与可选精修工具界面', 'Transparent cutout and optional refinement tools'],
      ['guide-preview.svg', '原图与透明抠图对比及保留选项', 'Original and transparent previews with save choices'],
      ['guide-organize.svg', '图标命名与待保存整理操作界面', 'Icon naming and staged organization changes'],
      ['guide-organize.svg', '跨分类移动图标并预览变更界面', 'Previewing an icon move between categories'],
      ['guide-confirm.svg', '上传或删除前检查并明确确认的界面', 'Review and explicit confirmation before upload or delete'],
      ['guide-about.svg', '关于页中的版本与使用引导入口', 'About page with version and walkthrough entry']
    ];
    const [illustrationFile, illustrationDescriptionZh, illustrationDescriptionEn] = illustrations[walkthroughStep];
    const destinations = [
      ['settings', 'account'], ['settings', 'account'], ['library'], ['cutout'], ['cutout'],
      ['cutout'], ['library'], ['library'], ['library'], ['settings', 'home']
    ];
    const destination = destinations[walkthroughStep];
    setActiveScreen(destination[0], destination[1]);
    const illustration = document.createElement('img');
    illustration.src = `./guide/${illustrationFile}`;
    illustration.alt = '';
    illustration.draggable = false;
    ui.walkthroughVisual.replaceChildren(illustration);
    ui.walkthroughVisual.setAttribute('aria-label', english ? illustrationDescriptionEn : illustrationDescriptionZh);
    ui.walkthroughProgress.textContent = english
      ? `FIRST USE · STEP ${walkthroughStep + 1} OF ${steps.length}`
      : `首次使用 · 第 ${walkthroughStep + 1} 步，共 ${steps.length} 步`;
    ui.walkthroughTitle.textContent = title;
    ui.walkthroughDescription.textContent = description;
    ui.walkthroughNext.textContent = walkthroughStep === steps.length - 1
      ? (english ? 'Finish guide' : '完成引导')
      : (english ? 'Next' : '下一步');
    ui.walkthroughSkip.textContent = english ? 'Skip this step' : '跳过此步';
  }

  function openWalkthrough() {
    walkthroughStep = 0;
    renderWalkthroughStep();
    ui.walkthroughModal.classList.remove('hidden');
    ui.walkthroughNext.focus();
  }

  function advanceWalkthrough() {
    if (walkthroughStep < walkthroughContent().length - 1) {
      walkthroughStep += 1;
      renderWalkthroughStep();
      return;
    }
    ui.walkthroughModal.classList.add('hidden');
    persistGuideCompletion();
    if (selectedOwner && selectedRepoName) setActiveScreen('library');
    else setActiveScreen('settings', 'account');
    showToast(appLanguage === 'en' ? 'Guide complete. You can reopen it from Settings.' : '引导已完成；以后可从设置重新打开。');
  }

  function setBottomNavHidden(hidden) {
    const shouldHide = Boolean(hidden && appNavAutoHide && !ui.bottomNavigation.contains(document.activeElement));
    ui.bottomNavigation.classList.toggle('nav-auto-hidden', shouldHide);
    ui.bottomNavigation.setAttribute('aria-hidden', String(shouldHide));
    ui.navItems.forEach((button) => { button.tabIndex = shouldHide ? -1 : 0; });
  }

  const customAccentVariants = (hex, dark) => window.CueAccentColor?.customAccentVariants(hex, dark) || null;

  function applySystemAccent() {
    const root = document.documentElement;
    const validHex = (value, fallback = null) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
    const systemEnabled = appUseSystemAccent && systemAccentAvailable && Boolean(validHex(systemAccentColors?.primary));
    const dark = root.dataset.theme === 'dark';
    const colors = systemEnabled ? systemAccentColors
      : (validHex(appAccentColor) ? customAccentVariants(appAccentColor, dark) : null);
    const enabled = Boolean(colors);
    root.dataset.systemAccent = String(systemEnabled);
    const tokenNames = ['--purple', '--purple-dark', '--lilac', '--purple-light', '--purple-rgb', '--accent', '--accent-hover', '--accent-soft', '--accent-soft-strong', '--accent-border', '--accent-on', '--accent-focus', '--accent-gradient-start', '--accent-gradient-middle', '--accent-gradient-end', '--accent-wash'];
    if (!enabled) {
      tokenNames.forEach((name) => root.style.removeProperty(name));
      return;
    }
    const primary = validHex(dark ? colors.primaryOnDark : colors.primary, colors.primary);
    const hover = validHex(dark ? colors.primaryLight : colors.primaryDark, primary);
    const pale = validHex(colors.primaryLight, primary);
    const deep = validHex(colors.primaryDark, primary);
    const toRgb = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
    const rgb = toRgb(primary);
    const mix = (baseHex, accentHex, weight) => {
      const base = toRgb(baseHex);
      const accent = toRgb(accentHex);
      return `#${base.map((value, index) => Math.round(value * (1 - weight) + accent[index] * weight).toString(16).padStart(2, '0')).join('')}`;
    };
    const surface = dark ? (appBlackBackground ? '#050505' : '#242638') : '#ffffff';
    const border = dark ? (appBlackBackground ? '#303030' : '#393b52') : '#e9eaf2';
    const set = (name, value) => root.style.setProperty(name, value);
    const rgbText = rgb.join(', ');
    const soft = mix(surface, primary, dark ? 0.17 : 0.095);
    set('--purple', primary);
    set('--purple-dark', hover);
    set('--lilac', soft);
    set('--purple-light', pale);
    set('--purple-rgb', rgbText);
    set('--accent', primary);
    set('--accent-hover', hover);
    set('--accent-soft', soft);
    set('--accent-soft-strong', mix(surface, primary, dark ? 0.28 : 0.17));
    set('--accent-border', mix(border, primary, dark ? 0.52 : 0.40));
    set('--accent-on', dark ? '#171724' : '#ffffff');
    set('--accent-focus', `rgba(${rgbText}, ${dark ? '0.42' : '0.28'})`);
    set('--accent-gradient-start', deep);
    set('--accent-gradient-middle', primary);
    set('--accent-gradient-end', pale);
    set('--accent-wash', `rgba(${rgbText}, ${dark ? '0.15' : '0.065'})`);
  }

  function setAccentColorStatus(kind, zh, en) {
    accentColorStatusState = { kind, zh, en };
    renderAccentColorStatus();
  }

  function renderAccentColorStatus() {
    if (!accentColorStatusState) {
      ui.accentColorStatus.className = 'preference-note hidden';
      ui.accentColorStatus.textContent = '';
      return;
    }
    ui.accentColorStatus.className = `preference-note accent-color-status ${accentColorStatusState.kind}`;
    ui.accentColorStatus.textContent = appLanguage === 'en' ? accentColorStatusState.en : accentColorStatusState.zh;
  }

  function updateAccentSelection() {
    let selectedButton = null;
    ui.accentColorChoices.forEach((button) => {
      const presetColor = (button.dataset.accentColor || '').toLowerCase();
      const swatch = button.querySelector('.accent-color-swatch');
      if (swatch) swatch.style.backgroundColor = presetColor || '#897fb5';
      const selected = !ui.systemColorToggle.checked && pendingAccentSource === 'preset'
        && presetColor === pendingAccentColor.toLowerCase();
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('selected', selected);
      if (selected) selectedButton = button;
    });
    document.querySelectorAll('[data-wallpaper-color]').forEach((button) => {
      const selected = !ui.systemColorToggle.checked && pendingAccentSource === 'wallpaper'
        && button.dataset.wallpaperColor === pendingAccentColor.toLowerCase();
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('selected', selected);
    });
    const useSystem = ui.systemColorToggle.checked && systemAccentAvailable && /^#[0-9a-f]{6}$/i.test(systemAccentColors?.primary || '');
    const dark = document.documentElement.dataset.theme === 'dark';
    const systemColor = systemAccentColors?.[dark ? 'primaryOnDark' : 'primary'];
    const customColor = pendingAccentColor
      ? customAccentVariants(pendingAccentColor, dark)?.primary
      : '#897fb5';
    const color = useSystem ? (systemColor || systemAccentColors.primary) : (customColor || '#897fb5');
    ui.accentCurrentSwatch.style.backgroundColor = color;
    ui.accentCurrentValue.textContent = color.toUpperCase();
    const sourceLabel = useSystem
      ? (appLanguage === 'en' ? 'Android system color' : 'Android 系统取色')
      : pendingAccentSource === 'wallpaper'
        ? (appLanguage === 'en' ? 'Wallpaper representative color' : '壁纸代表色')
        : pendingAccentSource === 'gallery'
          ? (appLanguage === 'en' ? 'Gallery image pixel' : '相册图片像素')
          : pendingAccentSource === 'custom'
            ? (appLanguage === 'en' ? 'Custom color' : '自定义颜色')
            : (selectedButton
              ? selectedButton.querySelector('span:last-child').textContent
              : (appLanguage === 'en' ? 'Mist purple' : '雾紫'));
    ui.accentCurrentLabel.textContent = sourceLabel;
    ui.accentSelectedCopy.textContent = `${appLanguage === 'en' ? 'Chosen value: ' : '所选颜色：'}${(pendingAccentColor || '#897fb5').toUpperCase()}`;
  }

  function stageAccentColor(color, zhName, enName, source = 'custom') {
    pendingAccentColor = color.toLowerCase();
    pendingAccentSource = source;
    ui.systemColorToggle.checked = false;
    updateAccentSelection();
    setAccentColorStatus('success', `已选取${zhName}色；点“保存设置”后应用。`, `${enName} accent selected. Save settings to apply it.`);
  }

  function closeAccentEyedropper() {
    accentEyedropperPointerActive = false;
    accentEyedropperColor = '';
    ui.accentEyedropperImage.onload = null;
    ui.accentEyedropperImage.onerror = null;
    ui.accentEyedropperImage.removeAttribute('src');
    ui.accentEyedropperModal.classList.add('hidden');
    ui.accentEyedropperMarker.classList.add('hidden');
    ui.accentEyedropperApply.disabled = true;
    ui.accentEyedropperValue.textContent = '—';
    if (accentEyedropperObjectUrl) URL.revokeObjectURL(accentEyedropperObjectUrl);
    accentEyedropperObjectUrl = null;
  }

  function sampleAccentPixelAt(event) {
    const image = ui.accentEyedropperImage;
    const rect = image.getBoundingClientRect();
    if (!image.naturalWidth || !image.naturalHeight || !rect.width || !rect.height) return;
    const xRatio = Math.max(0, Math.min(0.999999, (event.clientX - rect.left) / rect.width));
    const yRatio = Math.max(0, Math.min(0.999999, (event.clientY - rect.top) / rect.height));
    const x = Math.min(image.naturalWidth - 1, Math.floor(xRatio * image.naturalWidth));
    const y = Math.min(image.naturalHeight - 1, Math.floor(yRatio * image.naturalHeight));
    const color = window.CueAccentColor?.sampleExactPixel(image, x, y);
    if (!color) {
      accentEyedropperColor = '';
      ui.accentEyedropperApply.disabled = true;
      ui.accentEyedropperStatus.textContent = appLanguage === 'en'
        ? 'That pixel is transparent or unavailable. Tap a visible pixel.'
        : '该像素透明或不可读取；请点选可见像素。';
      return;
    }
    accentEyedropperColor = color;
    ui.accentEyedropperSwatch.style.backgroundColor = color;
    ui.accentEyedropperValue.textContent = color.toUpperCase();
    ui.accentEyedropperApply.disabled = false;
    const frameRect = ui.accentEyedropperPhotoFrame.getBoundingClientRect();
    ui.accentEyedropperMarker.style.left = `${event.clientX - frameRect.left}px`;
    ui.accentEyedropperMarker.style.top = `${event.clientY - frameRect.top}px`;
    ui.accentEyedropperMarker.classList.remove('hidden');
    ui.accentEyedropperStatus.textContent = appLanguage === 'en'
      ? `Exact source pixel at ${x + 1}, ${y + 1}. Tap or drag to choose another.`
      : `原图像素 ${x + 1}, ${y + 1}；可继续点按或拖动重新取色。`;
  }

  function sampleAccentFromImage(file) {
    if (!file || !file.type.startsWith('image/')) {
      setAccentColorStatus('error', '请选择图片文件。', 'Choose an image file.');
      return;
    }
    if (file.size > 24 * 1024 * 1024) {
      setAccentColorStatus('error', '图片超过 24 MB，请选小一些的图片。', 'The image is over 24 MB. Choose a smaller image.');
      return;
    }
    closeAccentEyedropper();
    try {
      accentEyedropperObjectUrl = URL.createObjectURL(file);
      ui.accentEyedropperApply.disabled = true;
      ui.accentEyedropperValue.textContent = '—';
      ui.accentEyedropperSwatch.style.backgroundColor = 'transparent';
      ui.accentEyedropperMarker.classList.add('hidden');
      ui.accentEyedropperStatus.textContent = appLanguage === 'en'
        ? 'Tap or drag on the image to sample one exact source pixel.'
        : '在图片上点按或拖动吸管，选取原图中的一个像素。';
      $('#accent-eyedropper-kicker').textContent = appLanguage === 'en' ? 'GALLERY IMAGE · ON-DEVICE' : '相册图片 · 本机取色';
      $('#accent-eyedropper-title').textContent = appLanguage === 'en' ? 'Pick a pixel color' : '点选图片中的颜色';
      $('#accent-eyedropper-help').textContent = appLanguage === 'en'
        ? 'Tap or drag over the photo. The swatch and hex value show the exact selected pixel; the image stays on this device.'
        : '在图片上点按或拖动吸管；色块与色值显示所选位置的原图像素，图片只在本机处理。';
      $('#accent-eyedropper-selection-title').textContent = appLanguage === 'en' ? 'Selected pixel' : '当前像素';
      ui.accentEyedropperCancel.textContent = appLanguage === 'en' ? 'Cancel' : '取消';
      ui.accentEyedropperApply.textContent = appLanguage === 'en' ? 'Use this color' : '使用此颜色';
      ui.accentEyedropperClose.setAttribute('aria-label', appLanguage === 'en' ? 'Close eyedropper' : '关闭取色器');
      ui.accentEyedropperImage.alt = appLanguage === 'en' ? 'Tap or drag to sample an exact image pixel' : '点按或拖动以选取图片像素';
      ui.accentEyedropperImage.onload = () => {
        ui.accentEyedropperStatus.textContent = appLanguage === 'en'
          ? 'Tap or drag on the image to sample one exact source pixel.'
          : '在图片上点按或拖动吸管，选取原图中的一个像素。';
      };
      ui.accentEyedropperImage.onerror = () => {
        setAccentColorStatus('error', '图片无法读取，请换一张图片重试。', 'The image could not be read. Try another one.');
        closeAccentEyedropper();
      };
      ui.accentEyedropperModal.classList.remove('hidden');
      ui.accentEyedropperImage.src = accentEyedropperObjectUrl;
    } catch {
      closeAccentEyedropper();
      setAccentColorStatus('error', '无法打开本机图片取色器，请重试。', 'Could not open the local image eyedropper. Try again.');
    }
  }

  function renderWallpaperAccentChoices(colors) {
    const container = ui.wallpaperAccentChoices;
    container.replaceChildren();
    const sourceNames = appLanguage === 'en'
      ? { primary: 'Primary', secondary: 'Secondary', tertiary: 'Tertiary' }
      : { primary: '壁纸主色', secondary: '壁纸次色', tertiary: '壁纸第三色' };
    colors.forEach((entry) => {
      if (!/^#[0-9a-f]{6}$/i.test(entry?.color || '')) return;
      const name = sourceNames[entry.source] || (appLanguage === 'en' ? 'Wallpaper color' : '壁纸颜色');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wallpaper-accent-choice';
      button.dataset.wallpaperColor = entry.color.toLowerCase();
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', `${name} ${entry.color.toUpperCase()}`);
      const swatch = document.createElement('span');
      swatch.className = 'wallpaper-accent-swatch';
      swatch.style.backgroundColor = entry.color;
      const copy = document.createElement('span');
      copy.textContent = `${name} · ${entry.color.toUpperCase()}`;
      button.append(swatch, copy);
      button.addEventListener('click', () => stageAccentColor(entry.color, name, `Wallpaper ${name}`, 'wallpaper'));
      container.append(button);
    });
    container.classList.toggle('hidden', container.childElementCount === 0);
    updateAccentSelection();
    return container.childElementCount > 0;
  }

  function useWallpaperAccentColor() {
    ui.wallpaperAccentChoices.classList.add('hidden');
    try {
      const raw = window.CueAppSettings?.getWallpaperAccentColors?.();
      if (!raw) throw new Error('wallpaper colors API unavailable');
      const result = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (result?.available && Array.isArray(result.colors) && renderWallpaperAccentChoices(result.colors)) {
        setAccentColorStatus('info', '选择 Android 提供的壁纸主色、次色或第三色。', 'Choose one of Android’s wallpaper-provided primary, secondary, or tertiary colors.');
      } else if (result?.reason === 'unsupported') {
        setAccentColorStatus('info', '此 Android 版本未提供桌面壁纸代表色；可使用下方预设或相册图片吸管。', 'This Android version does not provide wallpaper colors. Use a preset or the gallery eyedropper.');
      } else {
        setAccentColorStatus('info', '系统暂未提供壁纸代表色（部分动态壁纸不会提供）；可使用下方预设或相册图片吸管。', 'Android did not provide wallpaper colors (some live wallpapers do not expose them). Use a preset or the gallery eyedropper.');
      }
    } catch {
      setAccentColorStatus('error', '读取桌面壁纸代表色失败；可使用下方预设或相册图片吸管。', 'Could not read wallpaper colors. Use a preset or the gallery eyedropper.');
    }
  }

  function applyNavigationPreferences() {
    document.documentElement.dataset.navLayout = appNavLayout;
    document.documentElement.dataset.navLabels = appShowNavLabels ? 'shown' : 'hidden';
    document.documentElement.dataset.navAutoHide = String(appNavAutoHide);
    lastScrollY = window.scrollY;
    setBottomNavHidden(false);
  }

  window.addEventListener('scroll', () => {
    const currentY = window.scrollY;
    if (!appNavAutoHide || currentY < 28 || currentY < lastScrollY - 2) {
      setBottomNavHidden(false);
    } else if (currentY > lastScrollY + 4) {
      setBottomNavHidden(true);
    }
    lastScrollY = currentY;
  }, { passive: true });

  function applyAppearance() {
    if (!appearanceMediaQuery) {
      appearanceMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      appearanceMediaQuery.addEventListener?.('change', () => { if (appAppearance === 'system') applyAppearance(); });
    }
    const dark = appAppearance === 'dark' || (appAppearance === 'system'
      && (typeof systemDarkOverride === 'boolean' ? systemDarkOverride : appearanceMediaQuery.matches));
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.blackBackground = String(dark && appBlackBackground);
    applySystemAccent();
    updateAccentSelection();
    applyNavigationPreferences();
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    const colorSchemeMeta = $('meta[name="color-scheme"]');
    if (colorSchemeMeta) colorSchemeMeta.content = dark ? 'dark' : 'light';
    window.CueAppSettings?.applyAppearance?.(appAppearance, appBlackBackground);
  }

  window.onCueSystemThemeChanged = (isDark) => {
    if (typeof isDark === 'boolean') systemDarkOverride = isDark;
    if (appAppearance === 'system') applyAppearance();
  };

  function updateSystemColorAvailability() {
    ui.systemColorToggle.disabled = !systemAccentAvailable;
    ui.systemColorNote.classList.toggle('hidden', systemAccentAvailable);
    ui.systemColorNote.textContent = appLanguage === 'en'
      ? 'System colors require Android 12 or newer. The app keeps its original accent on this version.'
      : '系统取色需要 Android 12 或更新版本；当前版本将继续使用应用原配色。';
    if (!systemAccentAvailable) {
      appUseSystemAccent = false;
      ui.systemColorToggle.checked = false;
    }
  }

  function updateLauncherIconSelection() {
    const names = {
      cream: appLanguage === 'en' ? 'Cream Champagne Gold' : '奶油香槟金',
      glacier: appLanguage === 'en' ? 'Glacier Blue' : '冰川蓝',
      cherry: appLanguage === 'en' ? 'Sakura Blush' : '樱花粉',
      bluegold: appLanguage === 'en' ? 'Midnight Blue & Gold' : '深蓝·鎏金'
    };
    ui.launcherIconChoices.forEach((button) => {
      const selected = button.dataset.launcherIcon === launcherIcon;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('selected', selected);
    });
    ui.launcherIconStatus.textContent = appLanguage === 'en'
      ? `Current launcher icon: ${names[launcherIcon] || names.cream}.`
      : `当前桌面图标：${names[launcherIcon] || names.cream}。`;
  }

  window.onCueSystemAccentChanged = (colors) => {
    systemAccentColors = colors && typeof colors === 'object' ? colors : null;
    systemAccentAvailable = Boolean(systemAccentColors?.primary);
    updateSystemColorAvailability();
    applySystemAccent();
    updateAccentSelection();
  };

  function applyLanguage() {
    const en = appLanguage === 'en';
    const set = (selector, value) => { document.querySelectorAll(selector).forEach((element) => { element.textContent = value; }); };
    const setTextNode = (selector, value) => {
      const element = $(selector);
      const textNode = element && [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (textNode) textNode.nodeValue = value;
    };
    document.documentElement.lang = en ? 'en' : 'zh-CN';
    set('[data-i18n="preferences"]', en ? 'PREFERENCES' : '偏好设置');
    set('[data-i18n="settingsTitle"]', en ? 'Settings' : '设置');
    set('[data-i18n="language"]', en ? 'Language' : '语言');
    set('[data-i18n="appearance"]', en ? 'Appearance' : '外观');
    set('[data-i18n="saveSettings"]', en ? 'Save settings' : '保存设置');
    set('[data-nav-label="library"]', en ? 'Library' : '图标库');
    set('[data-nav-label="cutout"]', en ? 'Cutout' : '抠图');
    set('[data-nav-label="settings"]', en ? 'Settings' : '设置');
    set('#settings-card-appearance', en ? 'Appearance' : '外观');
    set('#settings-card-appearance-summary', en ? 'Theme, system colors and language' : '主题、系统取色与语言');
    set('#settings-card-navigation', en ? 'Navigation and layout' : '导航与布局');
    set('#settings-card-navigation-summary', en ? 'Bottom bar position, labels and scrolling' : '底部栏位置、标签与滚动行为');
    set('#settings-card-cache', en ? 'Cache management' : '缓存管理');
    set('#settings-card-cache-summary', en ? 'Review and clear local cache' : '查看占用并清理本机缓存');
    set('#settings-card-about', en ? 'About' : '关于');
    set('#settings-card-about-summary', en ? 'App version and walkthrough' : '应用版本与使用引导');
    set('#settings-card-account', en ? 'GitHub account and repository' : 'GitHub 账号与仓库');
    set('#settings-card-account-summary', en ? 'Token, cached repositories and switching' : 'Token、缓存仓库与切换');
    set('#guide-settings-note', en ? 'Review the first-use guide again whenever you need it.' : '需要时可重新查看首次使用说明。');
    set('#reopen-guide-button', en ? 'Reopen walkthrough' : '重新打开使用引导');
    ui.settingsSubpageBack.setAttribute('aria-label', en ? 'Back to Settings' : '返回设置主页');
    ui.settingsSubpageBack.title = en ? 'Back to Settings' : '返回设置主页';

    set('#about-version-title', en ? 'App version' : '应用版本');
    set('#about-version-help', en ? 'Currently installed version' : '当前安装版本');
    set('#launcher-icon-kicker', en ? 'LAUNCHER ICON' : '启动器图标');
    set('#launcher-icon-heading', en ? 'Choose a launcher icon' : '选择桌面图标');
    set('#about-guide-title', en ? 'Usage walkthrough' : '使用引导');
    set('#guide-settings-note', en ? 'Step-by-step help for connecting a repository, cutting out images and managing icons.' : '查看连接仓库、抠图与图标管理的分步说明。');
    set('#reopen-guide-button', en ? 'Open usage walkthrough' : '重新打开使用引导');
    set('#launcher-icon-help', en ? 'Choose the home-screen/app-drawer icon here under Appearance. Android App info always uses the fixed Cream Champagne Gold default/round icon. Some launchers may refresh later.' : '在「外观」中切换桌面/应用抽屉图标；Android「应用信息」固定使用奶油香槟金默认/圆形图标。部分桌面可能稍后刷新。');
    set('#icon-name-cream', en ? 'Cream Champagne Gold' : '奶油香槟金');
    set('#icon-description-cream', en ? 'Champagne-gold faceted crystal' : '香槟金切面水晶');
    set('#icon-name-glacier', en ? 'Glacier Blue' : '冰川蓝');
    set('#icon-description-glacier', en ? 'Glacier-blue glass prism' : '冰川蓝透明棱镜');
    set('#icon-name-cherry', en ? 'Sakura Blush' : '樱花粉');
    set('#icon-description-cherry', en ? 'Blush-pink glass prism' : '樱粉玻璃棱镜');
    set('#icon-name-bluegold', en ? 'Midnight Blue & Gold' : '深蓝·鎏金');
    set('#icon-description-bluegold', en ? 'Deep-blue prism with a distinct gold facet' : '深蓝棱镜与独立金色切面');
    set('#settings-change-repo', en ? 'Change repository' : '更换仓库');
    set('#settings-connection-summary .section-kicker', en ? 'GITHUB CONNECTION' : 'GitHub 连接');
    set('#cached-repository-help', en ? 'Switch among locally cached repositories anytime; refresh only to discover or update repositories.' : '可在本机缓存的仓库之间随时切换；刷新用于发现或更新仓库。');
    set('#language-group-title', en ? 'Language' : '语言');
    set('#language-group-help', en ? 'Choose the language used throughout the app.' : '选择应用界面使用的语言。');
    set('#language-row-title', en ? 'Interface language' : '界面语言');
    set('#language-row-help', en ? 'Applied immediately and saved on this device.' : '立即应用并保存在本机。');
    set('#appearance-group-title', en ? 'Appearance' : '外观');
    set('#appearance-group-help', en ? 'Follow system to switch automatically when Android changes between light and dark.' : '跟随系统会在 Android 浅色/深色模式变化时自动切换。');
    set('#appearance-row-title', en ? 'Theme' : '主题');
    set('#appearance-row-help', en ? 'Follow system, or choose light or dark explicitly.' : '可跟随系统，也可固定选择浅色或深色。');
    set('#black-background-title', en ? 'Use a pure black background in dark mode' : '深色模式使用纯黑背景');
    set('#black-background-help', en ? 'Only applies in dark mode; system bars follow the same choice.' : '仅在深色模式生效；状态栏和导航栏会同步。');
    set('#system-color-title', en ? 'System colors' : '系统取色');
    set('#system-color-help', en ? 'Apply the wallpaper-derived Android accent to buttons, focus and active navigation.' : '将 Android 壁纸生成的动态强调色应用到按钮、焦点和当前导航项。');
    set('#navigation-group-title', en ? 'Navigation' : '导航');
    set('#navigation-group-help', en ? 'Choose how the bottom navigation is positioned and shown.' : '选择底部导航的位置、显示方式和滚动行为。');
    set('#nav-layout-title', en ? 'Bottom navigation layout' : '底部导航布局');
    set('#nav-layout-help', en ? 'Docked to the screen edge or floating above it.' : '固定贴底，或悬浮在页面下方。');
    set('#nav-labels-title', en ? 'Show bottom navigation labels' : '显示底部导航文字');
    set('#nav-labels-help', en ? 'When off, icons remain and buttons keep accessible names.' : '关闭后保留图标；按钮仍带有无障碍名称。');
    set('#nav-autohide-title', en ? 'Auto-hide while scrolling down' : '向下滚动时自动隐藏');
    set('#nav-autohide-help', en ? 'Reappears when scrolling up or returning to the top.' : '向上滚动或回到页面顶部时重新显示。');
    set('#launcher-icon-kicker', en ? 'LAUNCHER ICON' : '启动器图标');
    set('#cache-overview-kicker', en ? 'CACHE USAGE' : '缓存占用');
    set('#cache-total-caption', en ? 'Temporary images, cached remote icons, repository list and library snapshots' : '图片临时副本、远程图标、仓库清单与各仓库图标库快照');
    set('#cache-refresh-button', en ? 'Refresh' : '刷新');
    set('#cache-details-title', en ? 'Local cache details' : '本机缓存明细');
    set('#cache-details-help', en ? 'Temporary photo copies expire after 7 days. Remote icons are kept locally for up to 7 days and reloaded when you refresh the library; repository-specific snapshots restore each workspace.' : '临时照片副本会在 7 天后清理；远程图标在本机缓存最多 7 天，刷新图标库会重新下载；各仓库的独立快照用于恢复对应工作区。');
    set('#cache-images-title', en ? 'Temporary photo copies' : '临时照片副本');
    set('#cache-remote-images-title', en ? 'Remote icon images' : '远程图标缓存');
    set('#cache-repositories-title', en ? 'Repository list' : '仓库清单');
    set('#cache-library-title', en ? 'Library snapshots' : '图标库快照');
    set('#cache-clear-button', en ? 'Clear listed caches' : '清理列出的缓存');
    set('#cache-clear-help', en ? 'Removes temporary photo copies, cached remote icon images, the cached repository list and all saved library snapshots. GitHub files, your token, selected repository and other settings stay intact. A library must be loaded online again after its snapshot is cleared.' : '会删除本机临时照片副本、远程图标缓存、仓库清单和各仓库图标库快照；不会删除 GitHub 文件、Token、当前仓库选择或其他设置。清除快照后，打开相应图标库需要联网重新加载。');
    set('#library-setup-prompt .section-kicker', en ? 'LIBRARY NOT CONNECTED' : '图标库尚未连接');
    set('#library-setup-prompt h2', en ? 'Connect GitHub in Settings first' : '先在设置里连接 GitHub');
    set('#library-setup-prompt p', en ? 'Manage your token and repository in Settings. The app lists only repositories accessible to the token; no repository or index URL is hard-coded.' : 'Token 和仓库选择都集中在设置中。应用只会列出当前 Token 可访问的仓库，不会预设仓库或索引地址。');
    set('#library-settings-cta', en ? 'Open Settings to connect →' : '打开设置并连接 →');
    set('.cutout-home-card .section-kicker', en ? 'ON-DEVICE · IMAGES STAY PRIVATE' : '本机处理 · 图片不上传');
    set('.cutout-home-card h1', en ? 'Choose a photo to cut out.' : '选择照片，开始抠图.');
    set('.cutout-home-card p', en ? 'Pick one image from your phone gallery. The on-device model creates a cutout first; refine it with taps or a brush if needed. Keep the original or transparent image in the icon-library upload queue.' : '从手机相册选一张图片，先用本机模型自动抠图；需要时再点选或用笔刷精修。确认后可将原图或透明版加入图标库上传队列。');
    set('#cutout-gallery-select', en ? 'Choose from gallery' : '从相册选择');
    set('.gallery-privacy-note', en ? 'Photos are processed on this device and are never sent to a model service.' : '照片只在此设备上处理；不会发送到模型服务。');
    set('#cutout-change-photo', en ? 'Choose another photo' : '从相册换一张');
    $('#language-select').options[0].textContent = en ? '简体中文' : '简体中文';
    $('#appearance-select').options[0].textContent = en ? 'System' : '跟随系统';
    $('#appearance-select').options[1].textContent = en ? 'Light' : '浅色';
    $('#appearance-select').options[2].textContent = en ? 'Dark' : '深色';
    $('#nav-layout-select').options[0].textContent = en ? 'Fixed' : '固定';
    $('#nav-layout-select').options[1].textContent = en ? 'Floating' : '悬浮';
    setTextNode('.eyebrow', en ? 'REPOSITORY TOOL' : '仓库管理工具');
    setTextNode('.intro-row h1', en ? 'Manage your icon library' : '管理你的图标库');
    set('.intro-copy', en ? 'Upload icons, organize categories, and remove files from one place.' : '在一个地方上传图标、整理分类，或移除不再需要的文件。');
    set('.intro-note span:last-child', en ? 'Uploads and index updates are saved in one GitHub commit' : '上传与索引将一起保存为一次 GitHub 提交');
    set('#repo-chip-label', selectedRepoName ? `${selectedOwner}/${selectedRepoName}` : (en ? 'No library selected' : '尚未选择图标库'));
    set('.connect-content .section-kicker', en ? 'GITHUB · CONNECT TOKEN' : 'GitHub · 连接 Token');
    set('.connect-content h2', en ? 'Connect GitHub' : '连接你的 GitHub');
    set('.connect-content>p', en ? 'Enter a token, then choose an icon library from repositories this token can access. Reading needs read permission; saving changes needs Contents write permission.' : '输入 token 后，应用只会列出该 token 可访问的仓库，再由你选择要管理的图标库。浏览需要读取权限；上传、删除或整理时才需要 Contents 写权限。');
    set('#connect-form label', en ? 'GitHub personal access token' : 'GitHub 个人访问令牌');
    $('#token-input').placeholder = en ? 'github_pat_••••••••••••' : 'github_pat_••••••••••••';
    set('#connect-button span:first-child', en ? 'Verify token and load repositories' : '验证 Token 并加载可访问仓库');
    set('#toggle-token', en ? 'Show' : '显示');
    set('#credential-help', en ? 'After validation, the app dynamically lists repositories this token can access and saves the token encrypted on this device. Browsing needs read access; Contents write access is needed only to submit repository changes.' : '验证后会动态列出此 Token 可访问的仓库，并在本机加密保存。浏览只需读取权限；只有提交仓库内容变更时才需要 Contents 写权限。');
    set('#token-help-link', en ? 'Manage GitHub personal access tokens ↗' : '管理 GitHub 个人访问令牌 ↗');
    set('#forget-token-button', en ? 'Clear saved token on this device' : '清除本机保存的 Token');
    set('.privacy-note span:last-child', en ? 'The token is used only for GitHub API requests. If saved, it is encrypted with Android Keystore and kept in app-private storage; it is not sent to other services.' : 'Token 仅用于请求 GitHub API；若保存，会使用 Android Keystore 加密并只存于本机应用私有空间，不会发送给其他服务。');
    set('.repo-picker-heading .section-kicker', en ? 'GITHUB · CHOOSE LIBRARY' : 'GitHub · 选择图标库');
    set('.repo-picker-heading h2', en ? 'Choose an accessible repository' : '选择一个可访问的仓库');
    set('#repo-picker-help', en ? 'Choose from the cached list without refreshing. A saved repository snapshot can open read-only offline; an online selection refreshes it. Refresh the list explicitly to discover new repositories.' : '无需刷新即可从本机缓存清单中选择。仓库已有快照时可离线只读打开；联网时会校验更新。只有点刷新才会查找新仓库。');
    set('#repo-picker-back', en ? 'Open current library' : '返回当前图标库');
    set('#repo-picker-reload', en ? 'Refresh repository list' : '刷新仓库列表');
    set('#repo-refresh-button', en ? 'Refresh repository list' : '刷新仓库列表');
    set('#settings-change-repo', en ? 'Switch repository' : '更换仓库');
    set('#github-endpoints-title', en ? 'GitHub access addresses' : 'GitHub 访问地址');
    set('label[for="github-api-base"]', en ? 'GitHub API base URL' : 'GitHub API 基址');
    set('#github-api-warning', en ? 'Connection tests and API requests send your PAT in the Authorization header to this host. For a custom address, use only a trusted HTTPS proxy or mirror.' : '连接测试及 API 请求会把你的 PAT 放在 Authorization 请求头发送到此主机。自定义时只使用可信的 HTTPS 代理或镜像。');
    set('label[for="github-raw-base"]', en ? 'Icon/raw-content base URL' : '图标与 raw 内容基址');
    set('#github-raw-help', en ? 'The app appends the selected owner/repository/branch/file path. Raw images are loaded directly by WebView without the PAT; a custom host can still see requested resource paths.' : '应用会在基址后追加所选仓库、分支和文件路径。图片/raw 请求由 WebView 直接加载，不附带 PAT；自定义主机仍可看到请求的资源路径。');
    set('#test-github-endpoints', en ? 'Test GitHub API connection' : '测试 GitHub API 连接');
    set('#save-github-endpoints', en ? 'Save addresses' : '保存地址');
    set('#restore-github-endpoints', en ? 'Restore defaults' : '恢复默认值');
    set('#saved-token-title', en ? 'Token saved encrypted on this device' : 'Token 已在本机加密保存');
    set('#saved-token-help', en ? 'Masked by default. Reveal or copy only when you tap those controls.' : '默认遮蔽；显示或复制只在你点击时执行。');
    set('#saved-token-settings-link', en ? 'Manage GitHub personal access tokens ↗' : '管理 GitHub 个人访问令牌 ↗');
    set('#toggle-saved-token', en ? (ui.savedTokenDisplay.type === 'password' ? 'Show' : 'Hide') : (ui.savedTokenDisplay.type === 'password' ? '显示' : '隐藏'));
    set('#copy-saved-token', en ? 'Copy' : '复制');
    set('#saved-token-replace-toggle', en
      ? (ui.savedTokenReplacePanel.classList.contains('hidden') ? 'Replace token' : 'Cancel replacement')
      : (ui.savedTokenReplacePanel.classList.contains('hidden') ? '替换 Token' : '取消替换'));
    set('#saved-token-replacement-label', en ? 'New GitHub personal access token' : '新的 GitHub 个人访问令牌');
    set('#saved-token-replace-help', en ? 'The new token is validated at the currently configured GitHub API address, then encrypted and saved on this device.' : '新 Token 会先通过当前配置的 GitHub API 地址验证；成功后才加密替换并保存在本机。');
    set('#saved-token-replace-submit', en ? 'Validate and replace token' : '验证并替换 Token');
    set('#saved-token-replace-cancel', en ? 'Cancel' : '取消');
    set('#toggle-saved-token-replacement', en ? (ui.savedTokenReplacement.type === 'password' ? 'Show' : 'Hide') : (ui.savedTokenReplacement.type === 'password' ? '显示' : '隐藏'));
    updateIndexSelectPrompt();
    const sideLabelText = en ? 'Categories ' : '图标分类 ';
    if (ui.categoryCount.previousSibling) ui.categoryCount.previousSibling.textContent = sideLabelText;
    set('.side-tip strong', en ? 'Security' : '安全提示');
    set('.side-tip p', en ? 'Use a fine-grained token scoped to the repository. Never share or paste it into other websites.' : '使用仓库范围的细粒度令牌。不要将令牌发给他人或粘贴到其他网页。');
    set('.side-link', en ? 'Manage GitHub tokens ↗' : '管理 GitHub tokens ↗');
    set('.upload-copy strong', en ? 'Add icons to this category' : '添加图标到此分类');
    set('.upload-copy span', en ? 'PNG, JPG, GIF, WebP, AVIF · 12 MB per file · edit the name before upload' : '支持 PNG、JPG、GIF、WebP、AVIF · 单个文件最大 12 MB · 上传前可改名');
    set('#choose-files', en ? 'Choose files' : '选择文件');
    setTextNode('#upload-button', en ? 'Upload and save ' : '上传并保存 ');
    set('#disconnect-button', en ? 'Disconnect and forget' : '断开并忘记');
    setTextNode('.sync-label', en ? 'Connected to GitHub' : '已连接 GitHub');
    set('.list-title h3', en ? 'Icons in this category' : '已收录图标');
    $('#search-input').placeholder = en ? 'Search names…' : '搜索名称…';
    set('#empty-title', en ? 'No icons here yet' : '这里还没有图标');
    set('#empty-description', en ? 'Choose images to upload; they will be added to this category index.' : '选择图片上传，它们会自动加入这个分类的索引。');
    set('#cutout-kicker', en ? 'ON-DEVICE · AUTO CUTOUT' : '本机处理 · 自动抠图');
    set('#cutout-title', en ? 'Automatic cutout preview' : '自动抠图预览');
    set('.cutout-description', en ? 'An automatic transparent preview is created first. If needed, tap the subject or background to load MobileSAM for point-based refinement, or erase/restore by brush. You can also add a white sticker outline. Images stay on this device; GIFs use the first frame.' : '先自动生成透明预览；如需精修，可点主体或背景按需加载 MobileSAM 修正，也可用笔刷擦除/恢复局部或添加白色贴纸描边。图片始终在本机处理，GIF 按首帧处理。');
    set('#cutout-original-label', en ? 'Original · tap to refine after auto cutout' : '原图 · 自动抠图后可点选精修');
    ui.cutoutCanvas.setAttribute('aria-label', en ? 'Original image; tap the subject or background to refine the automatic cutout' : '原始图片；点击主体或背景可精修自动抠图');
    set('#cutout-positive-mode', en ? 'Tap subject · refine' : '点主体 · 精修');
    set('#cutout-negative-mode', en ? 'Tap background · remove' : '点背景 · 移除');
    set('#cutout-erase-mode', en ? 'Erase by brush' : '手动擦除');
    set('#cutout-restore-mode', en ? 'Restore by brush' : '手动恢复');
    set('#cutout-clear-points', en ? 'Reset to auto mask' : '恢复自动结果');
    set('#cutout-brush-size-title', en ? 'Brush size' : '笔刷大小');
    set('#cutout-brush-size-value', `${cutoutBrushSize} px`);
    ui.cutoutBrushSize.setAttribute('aria-label', en ? 'Brush size in pixels' : '笔刷大小');
    ui.cutoutOutlineTitle.textContent = en ? 'Add white sticker outline' : '添加白色贴纸描边';
    ui.cutoutOutlineWidthTitle.textContent = en ? 'Outline width' : '描边粗细';
    ui.cutoutOutlineWidthValue.textContent = `${cutoutOutlineSize} px`;
    ui.cutoutOutlineWidth.setAttribute('aria-label', en ? 'Outline width in preview pixels' : '描边粗细（预览像素）');
    set('#cutout-undo', en ? 'Undo' : '撤销');
    set('#cutout-redo', en ? 'Redo' : '重做');
    set('#cutout-cancel', en ? 'Cancel, keep current selection' : '取消，返回当前选择');
    set('#cutout-original-only', en ? 'Use original only' : '仅用原图');
    set('#cutout-cutout-only', en ? 'Use cutout only' : '仅用透明抠图');
    set('#cutout-neither', en ? 'Save neither' : '都不保存');
    set('[data-i18n="moveKicker"]', en ? 'ORGANIZE · REVIEW BEFORE SAVING' : '分类整理 · 暂存预览');
    set('[data-i18n="moveTitle"]', en ? 'Move to another category' : '移动到其他分类');
    set('[data-i18n="moveDescription"]', en ? 'Choose the destination category and JSON index, then select an image folder separately. Only this icon’s image file moves; the preview and URL use the exact selected path. Review locally first; a separate confirmation is required before anything is sent to GitHub.' : '先选择目标图标分类及其 JSON 索引，再单独选择图片目标文件夹。只移动这一个图标的图片文件；预览和 URL 都会使用所选的准确路径。先在本机预览；还需单独确认才会写入 GitHub。');
    set('[data-i18n="moveSource"]', en ? 'Source JSON index' : '来源 JSON 索引');
    set('[data-i18n="moveDestination"]', en ? 'Destination icon category' : '目标图标分类');
    set('[data-i18n="moveDestinationIndex"]', en ? 'Destination JSON index' : '目标 JSON 索引');
    set('[data-i18n="moveImageDirectory"]', en ? 'Image destination folder' : '图片目标文件夹');
    set('[data-i18n="moveCancel"]', en ? 'Cancel' : '取消');
    set('[data-i18n="moveStage"]', en ? 'Stage move' : '暂存移动');
    set('#rename-category', en ? 'Edit library name' : '重命名分类');
    set('#raw-index-link', en ? 'View JSON index ↗' : '查看 JSON 索引 ↗');
    set('.footer span:first-child', en ? 'Icon library manager · Works with the selected GitHub repository' : '图标库管理 · 直接与你选择的 GitHub 仓库交互');
    set('.footer span:last-child', en ? 'Token encrypted locally with Android Keystore' : 'Token 使用 Android Keystore 加密保存在本机');
    ui.toggleToken.textContent = appLanguage === 'en'
      ? (ui.tokenInput.type === 'password' ? 'Show' : 'Hide')
      : (ui.tokenInput.type === 'password' ? '显示' : '隐藏');
    if (ui.currentRepoLink && !ui.currentRepoLink.classList.contains('hidden')) ui.currentRepoLink.textContent = en ? 'Open ↗' : '打开 ↗';
    set('#accent-color-title', en ? 'Accent color' : '强调色');
    set('#accent-current-title', en ? 'Effective accent preview' : '实际预览强调色');
    set('#accent-color-help', en ? 'Choose one of seven soft presets, pick an Android-provided wallpaper color, or tap an exact pixel in a gallery image. The app adjusts colors for light and dark themes.' : '可选七款柔和预设、点选 Android 提供的壁纸代表色，或在相册图片上用吸管点选原始像素；应用会为浅色/深色主题调整明暗。');
    set('#accent-name-default', en ? 'Mist purple' : '雾紫');
    set('#accent-name-glacier', en ? 'Glacier blue' : '冰川蓝');
    set('#accent-name-sakura', en ? 'Sakura pink' : '樱花粉');
    set('#accent-name-mint', en ? 'Mint green' : '薄荷绿');
    set('#accent-name-cream', en ? 'Cream apricot' : '奶油杏');
    set('#accent-name-sea', en ? 'Sea-salt teal' : '海盐青');
    set('#accent-name-cloud', en ? 'Cloud gray' : '云雾灰');
    set('#settings-choice-modal .section-kicker', en ? 'DEVICE PREFERENCES' : '本机偏好');
    $('#settings-choice-close').setAttribute('aria-label', en ? 'Close' : '关闭');
    renderSavedTokenStatus();
    updateAccentSelection();
    updateSettingsChoiceButtons();
    set('#use-wallpaper-color', en ? 'Choose wallpaper colors' : '选择壁纸代表色');
    set('#choose-theme-image', en ? 'Tap a gallery pixel' : '点选相册图片像素');
    set('#accent-color-note', en
      ? 'Android exposes representative wallpaper colors (primary, secondary and tertiary), not the wallpaper pixels, to ordinary apps. Gallery images use an on-device exact-pixel eyedropper; nothing is uploaded and no photo-library permission is requested. Save settings to apply your selection.'
      : '普通应用只能读取 Android 提供的壁纸主色、次色和第三代表色，不能读取壁纸像素。相册图片使用本机原像素吸管取色；不会上传，也不申请照片库权限。取色后点“保存设置”应用。');
    renderAccentColorStatus();
    updateAccentSelection();
    renderUploadConfirmationText();
    if (accessibleRepositories.length) renderRepositoryChoices(accessibleRepositories);
    if (categories.length) { renderCategories(); renderActiveCategory(); }
    if (selectedFiles.length) renderSelectedFiles();
    updateStagedUi();
    if (pendingMove) renderMovePreview();
    setConnected(!ui.workspace.classList.contains('hidden'));
    updateSystemColorAvailability();
    renderEndpointStatus();
    renderCacheStatus();
    updateTopbarTitle();
    updateLauncherIconSelection();
    if (activeSettingsPage === 'cache') refreshCacheInfo();
    if (pendingCutout) drawCutoutCanvas();
  }

  function loadAppPreferences() {
    try {
      let stored = window.CueAppSettings?.getPreferences?.();
      if (!stored) stored = window.localStorage.getItem('cue-app-preferences');
      if (stored) {
        const preferences = JSON.parse(stored);
        if (typeof preferences.appVersion === 'string' && preferences.appVersion) appVersion = preferences.appVersion;
        if (['zh-CN', 'en'].includes(preferences.language)) appLanguage = preferences.language;
        if (['system', 'light', 'dark'].includes(preferences.appearance)) appAppearance = preferences.appearance;
        if (typeof preferences.blackBackground === 'boolean') appBlackBackground = preferences.blackBackground;
        systemAccentColors = preferences.systemAccentColors && typeof preferences.systemAccentColors === 'object'
          ? preferences.systemAccentColors : null;
        systemAccentAvailable = Boolean(preferences.systemAccentAvailable && systemAccentColors?.primary);
        appUseSystemAccent = Boolean(preferences.useSystemAccent && systemAccentAvailable);
        if (typeof preferences.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(preferences.accentColor)) appAccentColor = preferences.accentColor.toLowerCase();
        pendingAccentColor = appAccentColor;
        pendingAccentSource = appAccentColor ? 'custom' : 'preset';
        if (appAccentColor && ui.accentColorChoices.some((button) => (button.dataset.accentColor || '').toLowerCase() === appAccentColor)) {
          pendingAccentSource = 'preset';
        }
        if (['fixed', 'floating'].includes(preferences.navLayout)) appNavLayout = preferences.navLayout;
        if (typeof preferences.showNavLabels === 'boolean') appShowNavLabels = preferences.showNavLabels;
        if (typeof preferences.navAutoHide === 'boolean') appNavAutoHide = preferences.navAutoHide;
        if (['cream', 'glacier', 'cherry', 'bluegold'].includes(preferences.launcherIcon)) launcherIcon = preferences.launcherIcon;
        if (typeof preferences.systemDark === 'boolean') systemDarkOverride = preferences.systemDark;
        try { if (preferences.githubApiBaseUrl) apiBaseUrl = GitHubUrls.normalizeBaseUrl(preferences.githubApiBaseUrl); } catch { apiBaseUrl = DEFAULT_API_BASE; }
        try { if (preferences.githubRawBaseUrl) rawContentBaseUrl = GitHubUrls.normalizeBaseUrl(preferences.githubRawBaseUrl); } catch { rawContentBaseUrl = DEFAULT_RAW_BASE; }
        if (Array.isArray(preferences.githubRawBaseHistory)) {
          rawBaseHistory = preferences.githubRawBaseHistory.map((base) => {
            try { return GitHubUrls.normalizeBaseUrl(base); } catch { return ''; }
          }).filter((base, index, values) => base && base !== rawContentBaseUrl && values.indexOf(base) === index).slice(0, 8);
        }
      }
    } catch { /* Use the requested Simplified Chinese/system defaults. */ }
    ui.languageSelect.value = appLanguage;
    ui.appearanceSelect.value = appAppearance;
    ui.blackBackgroundToggle.checked = appBlackBackground;
    ui.systemColorToggle.checked = appUseSystemAccent;
    updateAccentSelection();
    ui.navLayoutSelect.value = appNavLayout;
    ui.navLabelsToggle.checked = appShowNavLabels;
    ui.navAutoHideToggle.checked = appNavAutoHide;
    ui.aboutVersionValue.textContent = appVersion;
    ui.apiBaseInput.value = apiBaseUrl;
    ui.rawBaseInput.value = rawContentBaseUrl;
    applyLanguage();
    applyAppearance();
  }

  function saveAppPreferences() {
    const language = ui.languageSelect.value;
    const appearance = ui.appearanceSelect.value;
    const blackBackground = ui.blackBackgroundToggle.checked;
    const useSystemAccent = systemAccentAvailable && ui.systemColorToggle.checked;
    const accentColor = pendingAccentColor;
    const navLayout = ui.navLayoutSelect.value;
    const showNavLabels = ui.navLabelsToggle.checked;
    const navAutoHide = ui.navAutoHideToggle.checked;
    const previous = {
      language: appLanguage, appearance: appAppearance,
      blackBackground: appBlackBackground, useSystemAccent: appUseSystemAccent,
        accentColor: appAccentColor, accentSource: pendingAccentSource, navLayout: appNavLayout,
      showNavLabels: appShowNavLabels, navAutoHide: appNavAutoHide
    };
    let saved = false;
    try {
      if (window.CueAppSettings?.savePreferences) {
        saved = window.CueAppSettings.savePreferences(
          language, appearance, blackBackground, useSystemAccent, navLayout, showNavLabels, navAutoHide, accentColor
        );
      } else {
        let existing = {};
        try { existing = JSON.parse(window.localStorage.getItem('cue-app-preferences') || '{}'); } catch { }
        window.localStorage.setItem('cue-app-preferences', JSON.stringify({
          ...existing, language, appearance, blackBackground, useSystemAccent, navLayout, showNavLabels, navAutoHide, accentColor,
          githubApiBaseUrl: apiBaseUrl, githubRawBaseUrl: rawContentBaseUrl, githubRawBaseHistory: rawBaseHistory
        }));
        saved = true;
      }
    } catch { saved = false; }
    if (!saved) {
      ui.languageSelect.value = previous.language;
      ui.appearanceSelect.value = previous.appearance;
      ui.blackBackgroundToggle.checked = previous.blackBackground;
      ui.systemColorToggle.checked = previous.useSystemAccent;
      pendingAccentColor = previous.accentColor;
      pendingAccentSource = previous.accentSource;
      updateAccentSelection();
      ui.navLayoutSelect.value = previous.navLayout;
      ui.navLabelsToggle.checked = previous.showNavLabels;
      ui.navAutoHideToggle.checked = previous.navAutoHide;
      showToast(previous.language === 'en' ? 'Could not save preferences on this device.' : '本机设置保存失败，请重试。');
      return false;
    }
    appLanguage = language;
    appAppearance = appearance;
    appBlackBackground = blackBackground;
    appUseSystemAccent = useSystemAccent;
    appAccentColor = accentColor;
    appNavLayout = navLayout;
    appShowNavLabels = showNavLabels;
    appNavAutoHide = navAutoHide;
    applyLanguage();
    applyAppearance();
    showToast(appLanguage === 'en' ? 'Preferences applied and saved on this device.' : '界面偏好已立即应用并保存在本机。');
    return true;
  }

  function apiErrorText(response, payload) {
    if (response.status === 401) return 'Token 无效或已过期，请检查后重试。';
    if (response.status === 403) return 'GitHub 拒绝了请求。请检查 token 对所选仓库的授权范围、组织 SSO 策略或 API 限流。';
    if (response.status === 404) return '找不到仓库、分支或文件；请确认当前 token 仍有权访问所选仓库。';
    if (response.status === 409 || response.status === 422) return '仓库内容可能刚被其他人修改。请重新加载后再试。';
    if (payload && typeof payload.message === 'string' && payload.message.length < 240) return `GitHub API：${payload.message}`;
    return `GitHub API 请求失败（HTTP ${response.status}）。请稍后重试。`;
  }

  async function request(path, options = {}, baseOverride = apiBaseUrl, tokenOverride = token) {
    const response = await GitHubUrls.fetchApi(path, options, baseOverride, tokenOverride, (url, init) => window.fetch(url, init));
    let payload = null;
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    if (!response.ok) {
      const error = new Error(apiErrorText(response, payload));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function fetchAccessibleRepositories() {
    const result = [];
    for (let page = 1; page <= 20; page += 1) {
      const batch = await request(`/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('GitHub 返回的仓库列表格式无效。');
      result.push(...batch);
      if (batch.length < 100) return result;
    }
    throw new Error('可访问仓库超过 2,000 个；请使用范围更小的 token 后重试。');
  }

  function renderRepositoryChoices(repositories) {
    ui.repoList.replaceChildren();
    if (!repositories.length) {
      ui.repoList.textContent = appLanguage === 'en'
        ? 'No accessible repositories were returned. Check repository access, organization SSO, or token permissions.'
        : '此 token 没有返回可访问的仓库。请确认仓库授权、组织 SSO 或 token 的 repository access。';
      return;
    }
    repositories.forEach((item) => {
      const card = document.createElement('article');
      const selected = selectedOwner.toLowerCase() === (item.owner?.login || '').toLowerCase()
        && selectedRepoName.toLowerCase() === (item.name || '').toLowerCase();
      card.className = `repo-choice${selected ? ' selected' : ''}`;
      const name = document.createElement('strong');
      name.textContent = item.full_name || `${item.owner?.login || 'unknown'}/${item.name || ''}`;
      const marker = document.createElement('span');
      marker.className = 'repo-current-marker';
      marker.textContent = selected ? (appLanguage === 'en' ? '✓ CURRENT' : '✓ 当前使用') : '';
      marker.setAttribute('aria-label', selected ? (appLanguage === 'en' ? 'Currently selected' : '当前选中') : '');
      const details = document.createElement('small');
      details.textContent = `${item.private ? (appLanguage === 'en' ? 'Private' : '私有') : (appLanguage === 'en' ? 'Public' : '公开')} · ${appLanguage === 'en' ? 'default branch' : '默认分支'} ${item.default_branch || 'main'}`;
      const description = document.createElement('p');
      description.textContent = item.description || (appLanguage === 'en' ? 'No repository description' : '没有仓库描述');
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'button button-primary';
      choose.textContent = selected
        ? (appLanguage === 'en' ? 'Currently in use' : '当前正在使用')
        : (appLanguage === 'en' ? 'Switch to this library →' : '切换到此图标库 →');
      choose.disabled = selected || busy;
      choose.addEventListener('click', () => selectRepository(item));
      card.append(name, marker, details, description, choose);
      ui.repoList.append(card);
    });
  }

  function readSavedRepository() {
    try {
      if (window.CueAppSettings?.getSelectedRepository) {
        const value = window.CueAppSettings.getSelectedRepository();
        if (!value) return null;
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed?.owner && parsed?.name ? { owner: parsed.owner, name: parsed.name } : null;
      }
      const value = window.localStorage.getItem('cue-selected-repository');
      return value ? JSON.parse(value) : null;
    } catch { return null; }
  }

  function saveSelectedRepository(owner, name) {
    try {
      if (window.CueAppSettings?.saveSelectedRepository) {
        return window.CueAppSettings.saveSelectedRepository(owner, name);
      }
      window.localStorage.setItem('cue-selected-repository', JSON.stringify({ owner, name }));
      return true;
    } catch { return false; }
  }

  function clearSavedRepository() {
    try {
      if (window.CueAppSettings?.clearSelectedRepository) window.CueAppSettings.clearSelectedRepository();
      else window.localStorage.removeItem('cue-selected-repository');
    } catch { /* The next explicit repository choice can replace a stale selection. */ }
  }

  function clearCachedRepositories() {
    try {
      if (window.CueAppSettings?.saveCachedRepositories) window.CueAppSettings.saveCachedRepositories('[]');
      else window.localStorage.removeItem('cue-accessible-repositories');
      accessibleRepositories = [];
    } catch { accessibleRepositories = []; }
  }

  function normalizeRepository(item) {
    const ownerName = typeof item?.owner === 'string' ? item.owner : item?.owner?.login;
    if (!ownerName || !item?.name) return null;
    return {
      owner: { login: ownerName }, name: item.name,
      full_name: item.full_name || `${ownerName}/${item.name}`,
      default_branch: item.default_branch || 'main',
      private: Boolean(item.private), description: typeof item.description === 'string' ? item.description.slice(0, 500) : ''
    };
  }

  function repositoryIdentity(item) {
    return `${item.owner.login.toLowerCase()}/${item.name.toLowerCase()}`;
  }

  function loadCachedRepositories() {
    try {
      let stored = window.CueAppSettings?.getCachedRepositories?.();
      if (!stored) stored = window.localStorage.getItem('cue-accessible-repositories');
      const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
      return Array.isArray(parsed) ? parsed.map(normalizeRepository).filter(Boolean).slice(0, 2000) : [];
    } catch { return []; }
  }

  function persistCachedRepositories(repositories) {
    const compact = repositories.slice(0, 2000).map((item) => ({
      owner: item.owner.login, name: item.name, full_name: item.full_name,
      default_branch: item.default_branch, private: item.private, description: item.description.slice(0, 500)
    }));
    try {
      if (window.CueAppSettings?.saveCachedRepositories) {
        return window.CueAppSettings.saveCachedRepositories(JSON.stringify(compact));
      }
      window.localStorage.setItem('cue-accessible-repositories', JSON.stringify(compact));
      return true;
    } catch { return false; }
  }

  function mergeRepositoryLists(existing, fetched) {
    const combined = new Map();
    fetched.forEach((item) => combined.set(repositoryIdentity(item), item));
    existing.forEach((item) => {
      const key = repositoryIdentity(item);
      if (!combined.has(key)) combined.set(key, item);
    });
    return [...combined.values()].slice(0, 2000);
  }

  async function findRepositories(candidateToken = token, { restoreSaved = true, refresh = false } = {}) {
    token = candidateToken;
    const repoBeforeTokenSave = readSavedRepository();
    const cacheBeforeTokenSave = loadCachedRepositories();
    const previousList = accessibleRepositories.length ? accessibleRepositories : cacheBeforeTokenSave;
    settingsRepoPickerOpen = true;
    ui.repoPickerError.textContent = '';
    ui.repoPickerError.classList.add('hidden');
    setConnected(Boolean(selectedOwner && selectedRepoName));
    if (!accessibleRepositories.length) {
      ui.repoList.textContent = appLanguage === 'en' ? 'Loading repositories accessible to this token…' : '正在读取 token 可访问的仓库…';
    }
    try {
      const fetchedRepositories = (await fetchAccessibleRepositories()).map(normalizeRepository).filter(Boolean);
      if (window.CueTokenStore) {
        const saved = window.CueTokenStore.saveToken(candidateToken);
        tokenSaved = Boolean(saved);
        ui.savedTokenDisplay.type = 'password';
        ui.savedTokenDisplay.value = saved ? candidateToken : '';
        ui.savedTokenCard.classList.toggle('hidden', !saved);
        ui.forgetTokenButton.classList.toggle('hidden', !saved);
        if (!saved) {
          ui.repoPickerError.textContent = '仓库列表已读取，但 token 无法加密保存在本机；本次可继续使用，关闭应用后需要重新输入。';
          ui.repoPickerError.classList.remove('hidden');
        }
      }
      const cacheAfterTokenSave = loadCachedRepositories();
      const tokenChanged = cacheBeforeTokenSave.length > 0 && cacheAfterTokenSave.length === 0;
      accessibleRepositories = refresh && !tokenChanged
        ? mergeRepositoryLists(previousList, fetchedRepositories)
        : fetchedRepositories;
      const newCount = fetchedRepositories.filter((item) =>
        !previousList.some((cached) => repositoryIdentity(cached) === repositoryIdentity(item))).length;
      if (!persistCachedRepositories(accessibleRepositories)) {
        ui.repoPickerError.textContent = appLanguage === 'en'
          ? 'Repositories were loaded for this session, but could not be cached on this device.'
          : '仓库列表已加载，但本机未能缓存；关闭应用后可能需要重新刷新。';
        ui.repoPickerError.classList.remove('hidden');
      }
      const repoAfterTokenSave = readSavedRepository();
      if (restoreSaved && repoAfterTokenSave) {
        const match = accessibleRepositories.find((item) =>
          (item.owner?.login || '').toLowerCase() === repoAfterTokenSave.owner.toLowerCase()
          && (item.name || '').toLowerCase() === repoAfterTokenSave.name.toLowerCase());
        const preserveSnapshot = librarySnapshotStale
          && selectedOwner.toLowerCase() === repoAfterTokenSave.owner.toLowerCase()
          && selectedRepoName.toLowerCase() === repoAfterTokenSave.name.toLowerCase();
        if (match && await selectRepository(match, { restoring: true, preserveSnapshot })) return;
        setConnected(false);
        ui.repoPickerError.textContent = match
          ? (appLanguage === 'en'
            ? 'The saved library could not be verified right now. Your saved selection and local snapshot were kept; check the connection or token, then refresh the library.'
            : '暂时无法校验已保存的图标库。本机快照和原选择均已保留；请检查网络或 Token 后刷新当前图标库。')
          : (appLanguage === 'en'
            ? 'The saved repository is not in the accessible list right now. Your previous selection was kept; choose another only if you want to switch.'
            : '当前可访问仓库清单中没有找到上次选择的仓库；原选择仍已保留，只有想切换时再选择其他仓库。');
        ui.repoPickerError.classList.remove('hidden');
      } else if (restoreSaved && ((repoBeforeTokenSave && !repoAfterTokenSave) || tokenChanged)) {
        ui.repoPickerError.textContent = appLanguage === 'en'
          ? 'The GitHub token changed, so the previous library selection was cleared. Choose a repository for this token.'
          : 'GitHub Token 已更换，先前选择的仓库已清除；请为这个 Token 重新选择仓库。';
        ui.repoPickerError.classList.remove('hidden');
      }
      renderRepositoryChoices(accessibleRepositories);
      if (refresh) {
        showToast(newCount
          ? (appLanguage === 'en' ? `Found ${newCount} new repositories; the cached list is updated.` : `发现 ${newCount} 个新仓库，已更新本机清单。`)
          : (appLanguage === 'en' ? `No new repositories; keeping the ${accessibleRepositories.length} cached choices.` : `没有新仓库，继续保留本机缓存的 ${accessibleRepositories.length} 个选择。`));
      }
    } catch (error) {
      ui.repoPickerError.textContent = error.message || '无法读取仓库列表，请检查 token 权限后重试。';
      ui.repoPickerError.classList.remove('hidden');
      if (accessibleRepositories.length) renderRepositoryChoices(accessibleRepositories);
      else ui.repoList.replaceChildren();
    }
  }

  async function selectRepository(item, { restoring = false, preserveSnapshot = false } = {}) {
    const previous = {
      owner: selectedOwner, name: selectedRepoName, repository, branch, commitSha, baseTreeSha,
      treeFiles, repositoryDirectories, categories, activeCategoryPath, categoryBrowsePath, librarySnapshotStale
    };
    const targetOwner = item.owner?.login || '';
    const targetName = item.name || '';
    const sameRepository = previous.owner.toLowerCase() === targetOwner.toLowerCase()
      && previous.name.toLowerCase() === targetName.toLowerCase();
    selectedOwner = targetOwner;
    selectedRepoName = targetName;
    if (!preserveSnapshot) {
      activeCategoryPath = '';
      categoryBrowsePath = '';
      librarySnapshotStale = false;
    }
    settingsRepoPickerOpen = false;
    ui.repoPickerError.classList.add('hidden');
    setBusy(true);
    renderRepositoryChoices(accessibleRepositories);
    const cachedTargetSnapshot = !sameRepository && applyCachedLibrarySnapshot(targetOwner, targetName);
    try {
      const snapshotSaved = await loadRepositoryState();
      if (!saveSelectedRepository(selectedOwner, selectedRepoName)) {
        showToast(appLanguage === 'en' ? 'The library opened, but could not be saved for next time.' : '图标库已打开，但本机未能保存该选择。');
      }
      ui.repoChipLabel.textContent = `${selectedOwner}/${selectedRepoName}`;
      ui.currentRepoLink.href = `https://github.com/${encodeURIComponent(selectedOwner)}/${encodeURIComponent(selectedRepoName)}`;
      ui.currentRepoLink.textContent = appLanguage === 'en' ? 'Open ↗' : '打开 ↗';
      ui.currentRepoLink.classList.remove('hidden');
      setConnected(true);
      if (!categories.length) {
        showStatus(appLanguage === 'en'
          ? `Selected ${selectedOwner}/${selectedRepoName}; no valid JSON icon index was found. Switching to another repository is still available in Settings.`
          : `已选择 ${selectedOwner}/${selectedRepoName}；未找到有效的 JSON 图标索引，仍可在设置中切换其他仓库。`, 'info');
      } else {
        showStatus(restoring
          ? (appLanguage === 'en' ? `Reopened saved library ${selectedOwner}/${selectedRepoName}.` : `已自动重新打开图标库 ${selectedOwner}/${selectedRepoName}。`)
          : (appLanguage === 'en' ? `Opened ${selectedOwner}/${selectedRepoName}; the repository has only been read.` : `已打开 ${selectedOwner}/${selectedRepoName}；目前只读取仓库，没有写入。`), snapshotSaved ? 'success' : 'info');
        if (!snapshotSaved) showStatus(appLanguage === 'en'
          ? 'Library is open, but the local snapshot could not be saved; reopening it requires a network check.'
          : '图标库已打开，但本机快照保存失败；下次打开时仍需联网读取。', 'info');
      }
      setActiveScreen('library');
      renderRepositoryChoices(accessibleRepositories);
      return true;
    } catch (error) {
      if (cachedTargetSnapshot && applyCachedLibrarySnapshot(targetOwner, targetName)) {
        saveSelectedRepository(targetOwner, targetName);
        setConnected(true);
        setActiveScreen('library');
        showStatus(appLanguage === 'en'
          ? `Switched to the on-device snapshot for ${targetOwner}/${targetName}. GitHub could not be checked, so editing is locked until you refresh online. ${error.message || ''}`
          : `已切换到本机缓存的 ${targetOwner}/${targetName}。目前无法连接 GitHub 校验，编辑暂时锁定；联网后刷新当前图标库即可恢复。${error.message ? `（${error.message}）` : ''}`, 'info');
        return true;
      }
      selectedOwner = previous.owner;
      selectedRepoName = previous.name;
      repository = previous.repository;
      branch = previous.branch;
      commitSha = previous.commitSha;
      baseTreeSha = previous.baseTreeSha;
      treeFiles = previous.treeFiles;
      repositoryDirectories = previous.repositoryDirectories;
      categories = previous.categories;
      activeCategoryPath = previous.activeCategoryPath;
      categoryBrowsePath = previous.categoryBrowsePath;
      librarySnapshotStale = previous.librarySnapshotStale;
      settingsRepoPickerOpen = preserveSnapshot ? false : true;
      renderCategories();
      renderActiveCategory();
      ui.repoPickerError.textContent = error.message || '无法读取此仓库的图标索引。';
      ui.repoPickerError.classList.remove('hidden');
      setConnected(Boolean(previous.owner && previous.name));
      return false;
    } finally {
      setBusy(false);
      renderRepositoryChoices(accessibleRepositories);
    }
  }

  function encodePath(path) {
    return path.split('/').map((part) => encodeURIComponent(part)).join('/');
  }

  function decodeBase64Utf8(value) {
    const binary = atob(value.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function utf8ToBase64(value) {
    return arrayBufferToBase64(new TextEncoder().encode(value).buffer);
  }

  function nameFromPath(path) {
    const file = path.split('/').pop() || path;
    return file.replace(/\.[^.]+$/, '');
  }

  function rawReferenceFromUrl(value) {
    return GitHubUrls.rawReference(value, [rawContentBaseUrl, ...rawBaseHistory, DEFAULT_RAW_BASE], selectedOwner, selectedRepoName);
  }

  function pathFromRawUrl(value) {
    return rawReferenceFromUrl(value)?.path || '';
  }

  function imageAccessUrl(value) {
    const reference = rawReferenceFromUrl(value);
    if (!reference) return value;
    return GitHubUrls.rawContentUrl(rawContentBaseUrl, reference.owner, reference.repository, reference.ref, reference.path);
  }

  function defaultAssetDirectory(indexPath, entries) {
    for (const entry of entries) {
      const filePath = pathFromRawUrl(entry.url || '');
      if (filePath && treeFiles.has(filePath)) return filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ICON_ROOT;
    }
    const dir = indexPath.includes('/') ? indexPath.slice(0, indexPath.lastIndexOf('/')) : ICON_ROOT;
    if (!entries.length) return dir || ICON_ROOT;
    return dir === ICON_ROOT ? ICON_ROOT : `${dir}/icon`;
  }

  function persistLibrarySnapshot() {
    if (!selectedOwner || !selectedRepoName || !categories.length) return false;
    const snapshot = {
      version: 1, owner: selectedOwner, name: selectedRepoName, branch, commitSha, baseTreeSha,
      activeCategoryPath, categoryBrowsePath,
      treePaths: [...treeFiles.keys()],
      directoryPaths: [...repositoryDirectories],
      categories: categories.map((category) => ({ path: category.path, data: category.data, assetDirectory: category.assetDirectory }))
    };
    try {
      const serialized = JSON.stringify(snapshot);
      if (window.CueAppSettings.saveCachedLibrarySnapshotFor) {
        return Boolean(window.CueAppSettings.saveCachedLibrarySnapshotFor(selectedOwner, selectedRepoName, serialized));
      }
      if (window.CueAppSettings?.saveCachedLibrarySnapshot) {
        return Boolean(window.CueAppSettings.saveCachedLibrarySnapshot(serialized));
      }
      window.localStorage.setItem(`cue-library-snapshot:${selectedOwner.toLowerCase()}/${selectedRepoName.toLowerCase()}`, serialized);
      return true;
    }
    catch { return false; }
  }

  function getCachedLibrarySnapshot(owner, name) {
    try {
      if (window.CueAppSettings?.getCachedLibrarySnapshotFor) {
        return window.CueAppSettings.getCachedLibrarySnapshotFor(owner, name) || '';
      }
      const key = `cue-library-snapshot:${owner.toLowerCase()}/${name.toLowerCase()}`;
      const perRepository = window.localStorage.getItem(key);
      if (perRepository) return perRepository;
      const legacy = window.CueAppSettings?.getCachedLibrarySnapshot?.() || window.localStorage.getItem('cue-library-snapshot');
      if (!legacy) return '';
      const parsed = typeof legacy === 'string' ? JSON.parse(legacy) : legacy;
      return String(parsed?.owner || '').toLowerCase() === owner.toLowerCase()
        && String(parsed?.name || '').toLowerCase() === name.toLowerCase() ? legacy : '';
    } catch { return ''; }
  }

  function applyCachedLibrarySnapshot(owner, name) {
    try {
      const raw = getCachedLibrarySnapshot(owner, name);
      if (!raw) return false;
      const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (snapshot?.version !== 1
          || String(snapshot.owner || '').toLowerCase() !== String(owner || '').toLowerCase()
          || String(snapshot.name || '').toLowerCase() !== String(name || '').toLowerCase()
          || typeof snapshot.branch !== 'string' || !snapshot.branch
          || typeof snapshot.commitSha !== 'string' || !snapshot.commitSha
          || typeof snapshot.baseTreeSha !== 'string' || !snapshot.baseTreeSha
          || !Array.isArray(snapshot.categories) || !Array.isArray(snapshot.treePaths)) return false;
      const paths = snapshot.treePaths.filter((path) => typeof path === 'string' && path && !path.startsWith('/') && !path.split('/').includes('..'));
      const savedDirectories = Array.isArray(snapshot.directoryPaths) ? snapshot.directoryPaths
        .filter((path) => typeof path === 'string' && path && !path.startsWith('/')
          && !path.split('/').includes('..') && iconRootForPath(path)) : [];
      const restoredCategories = snapshot.categories.filter((category) => category
        && isIconIndexPath(category.path) && category.data
        && typeof category.data === 'object' && Array.isArray(category.data.icons))
        .map((category) => {
          const entries = category.data.icons.filter((entry) => entry && typeof entry === 'object'
            && typeof entry.name === 'string' && typeof entry.url === 'string');
          const data = { ...category.data, icons: entries };
          const label = typeof data.name === 'string' && data.name.trim()
            ? data.name.trim() : category.path.split('/').slice(1, -1).join('/') || '默认图标包';
          return {
            path: category.path, data, icons: entries, label,
            description: typeof data.description === 'string' ? data.description : '',
            assetDirectory: typeof category.assetDirectory === 'string' && category.assetDirectory
              ? category.assetDirectory : category.path.split('/').slice(0, -1).join('/')
          };
        });
      if (!restoredCategories.length) return false;
      selectedOwner = String(snapshot.owner);
      selectedRepoName = String(snapshot.name);
      repository = { full_name: `${selectedOwner}/${selectedRepoName}`, default_branch: snapshot.branch };
      branch = snapshot.branch;
      commitSha = snapshot.commitSha;
      baseTreeSha = snapshot.baseTreeSha;
      treeFiles = new Map(paths.map((path) => [path, { path, type: 'blob' }]));
      repositoryDirectories = collectIconDirectories([
        ...paths.map((path) => ({ path, type: 'blob' })),
        ...savedDirectories.map((path) => ({ path, type: 'tree' }))
      ]);
      categories = restoredCategories;
      categoryBrowsePath = initialCategoryBrowsePath(repositoryDirectories, snapshot.categoryBrowsePath || '');
      activeCategoryPath = restoredCategories.some((category) => category.path === snapshot.activeCategoryPath)
        ? snapshot.activeCategoryPath : '';
      stagedCategories.clear();
      stagedMoves.length = 0;
      resetFolderStageState();
      updateStagedUi();
      ui.repoChipLabel.textContent = `${selectedOwner}/${selectedRepoName}`;
      ui.currentRepoLink.href = `https://github.com/${encodeURIComponent(selectedOwner)}/${encodeURIComponent(selectedRepoName)}`;
      ui.currentRepoLink.textContent = appLanguage === 'en' ? 'Open ↗' : '打开 ↗';
      ui.currentRepoLink.classList.remove('hidden');
      ui.branchLabel.textContent = branch;
      settingsRepoPickerOpen = false;
      librarySnapshotStale = true;
      renderCategories();
      renderActiveCategory();
      setConnected(true);
      syncLockedControls();
      return true;
    } catch {
      return false;
    }
  }

  async function loadRepositoryState() {
    repository = await request(`${repositoryApiPath()}`);
    branch = repository.default_branch || 'main';
    ui.branchLabel.textContent = branch;

    const ref = await request(`${repositoryApiPath()}/git/ref/heads/${encodeURIComponent(branch)}`);
    commitSha = ref.object.sha;
    const commit = await request(`${repositoryApiPath()}/git/commits/${commitSha}`);
    baseTreeSha = commit.tree.sha;
    const tree = await request(`${repositoryApiPath()}/git/trees/${baseTreeSha}?recursive=1`);
    if (tree.truncated) throw new Error('仓库文件树过大，无法安全读取完整索引。');

    const treeEntries = tree.tree || [];
    treeFiles = new Map(treeEntries.filter((item) => item.type === 'blob').map((item) => [item.path, item]));
    repositoryDirectories = collectIconDirectories(treeEntries);
    categoryBrowsePath = initialCategoryBrowsePath(repositoryDirectories, categoryBrowsePath);
    const jsonPaths = [...treeFiles.keys()].filter(isIconIndexPath);
    const discovered = [];
    for (const path of jsonPaths) {
      const blob = treeFiles.get(path);
      try {
        const data = await request(`${repositoryApiPath()}/git/blobs/${blob.sha}`);
        const parsed = JSON.parse(decodeBase64Utf8(data.content || ''));
        if (!Array.isArray(parsed.icons)) continue;
        const entries = parsed.icons.filter((entry) => entry && typeof entry === 'object' && typeof entry.name === 'string' && typeof entry.url === 'string');
        const label = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : path.split('/').slice(1, -1).join('/') || '默认图标包';
        discovered.push({ path, data: { ...parsed, icons: entries }, label, description: typeof parsed.description === 'string' ? parsed.description : '', icons: entries, assetDirectory: defaultAssetDirectory(path, entries) });
      } catch {
        // Ignore unrelated or malformed JSON; only valid icon indexes are manageable.
      }
    }
    discovered.sort((a, b) => b.icons.length - a.icons.length || a.path.localeCompare(b.path, 'zh-CN'));
    categories = discovered;
    stagedCategories.clear();
    stagedMoves.length = 0;
    resetFolderStageState();
    updateStagedUi();
    if (!categories.some((item) => item.path === activeCategoryPath)) activeCategoryPath = '';
    renderCategories();
    renderActiveCategory();
    librarySnapshotStale = false;
    syncLockedControls();
    return categories.length ? persistLibrarySnapshot() : false;
  }

  async function refreshCurrentLibrary() {
    if (!selectedOwner || !selectedRepoName || !token || busy || cutoutBusy || pendingCutout) return;
    const previous = {
      repository, branch, commitSha, baseTreeSha, treeFiles, repositoryDirectories, categories, activeCategoryPath, categoryBrowsePath,
      librarySnapshotStale
    };
    setBusy(true);
    showStatus(appLanguage === 'en' ? 'Refreshing the current library from GitHub…' : '正在从 GitHub 刷新当前图标库…', 'info');
    try {
      const imageCacheCleared = window.CueAppSettings?.clearRemoteImageCache
        ? Boolean(window.CueAppSettings.clearRemoteImageCache()) : true;
      const snapshotSaved = await loadRepositoryState();
      showStatus(!imageCacheCleared
        ? (appLanguage === 'en' ? 'The library was refreshed, but cached images could not be cleared; some previews may remain cached.' : '图标库已刷新，但本机图片缓存清除失败；部分预览可能仍显示旧缓存。')
        : snapshotSaved
        ? (appLanguage === 'en' ? 'The current library and its local snapshot are up to date.' : '当前图标库及本机快照已更新。')
        : (appLanguage === 'en' ? 'The library was refreshed, but the local snapshot could not be saved.' : '图标库已刷新，但本机快照保存失败。'),
      imageCacheCleared && snapshotSaved ? 'success' : 'info');
    } catch (error) {
      repository = previous.repository;
      branch = previous.branch;
      commitSha = previous.commitSha;
      baseTreeSha = previous.baseTreeSha;
      treeFiles = previous.treeFiles;
      repositoryDirectories = previous.repositoryDirectories;
      categories = previous.categories;
      activeCategoryPath = previous.activeCategoryPath;
      categoryBrowsePath = previous.categoryBrowsePath;
      librarySnapshotStale = true;
      ui.branchLabel.textContent = branch;
      renderCategories();
      renderActiveCategory();
      showStatus(appLanguage === 'en'
        ? `Refresh failed; the previous library view is retained and editing is locked. ${error.message || ''}`
        : `刷新失败；已保留之前的图标库内容并锁定编辑。${error.message || ''}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function getDraftCategory(categoryPath) {
    if (stagedCategories.has(categoryPath)) return stagedCategories.get(categoryPath);
    const original = categories.find((item) => item.path === categoryPath);
    if (!original) return null;
    const draft = {
      originalPath: original.path,
      path: original.path,
      data: { ...original.data },
      icons: original.icons.map((entry) => ({ ...entry })),
      assetDirectory: original.assetDirectory
    };
    stagedCategories.set(categoryPath, draft);
    return draft;
  }

  function iconsFor(category) {
    return stagedCategories.get(category.path)?.icons || category.icons;
  }

  function updateStagedUi() {
    const active = stagedCategories.size > 0 || folderOperations.length > 0;
    ui.stagedActions.classList.toggle('hidden', !active);
    ui.saveStaged.textContent = appLanguage === 'en' ? 'Review & submit' : '检查并提交';
    const count = stagedCategories.size;
    ui.stagedCount.textContent = appLanguage === 'en'
      ? `${count} JSON index${count === 1 ? '' : 'es'}${folderOperations.length ? ` · ${folderOperations.length} folder operation${folderOperations.length === 1 ? '' : 's'}` : ''} staged${stagedMoves.length ? ` · ${stagedMoves.length} icon and image-file move${stagedMoves.length === 1 ? '' : 's'}` : ''}`
      : `${count} 个 JSON 索引${folderOperations.length ? ` · ${folderOperations.length} 项文件夹操作` : ''}待提交${stagedMoves.length ? `，含 ${stagedMoves.length} 项图标与图片文件移动` : ''}`;
    ui.stagedMoves.replaceChildren();
    ui.stagedMoves.classList.toggle('hidden', !stagedMoves.length && !folderOperations.length);
    stagedMoves.forEach((move) => {
      const record = document.createElement('article');
      record.className = 'staged-move-record';
      const title = document.createElement('strong');
      title.textContent = move.entry.name;
      const paths = document.createElement('span');
      paths.textContent = `${move.sourcePath} → ${move.destinationPath}`;
      const result = document.createElement('small');
      result.textContent = appLanguage === 'en' ? 'Move one image file · source index: remove one entry · destination index: add one entry' : '移动 1 个图片文件 · 来源索引移除 1 条 · 目标索引新增 1 条';
      const entry = document.createElement('code');
      entry.textContent = JSON.stringify(move.entry);
      const filePaths = document.createElement('span');
      filePaths.textContent = `${move.sourceFilePath} → ${move.destinationFilePath}`;
      record.append(title, paths, filePaths, result, entry);
      ui.stagedMoves.append(record);
    });
    folderOperations.forEach((operation) => {
      const record = document.createElement('article');
      record.className = 'staged-move-record staged-folder-record';
      const title = document.createElement('strong');
      const verbs = appLanguage === 'en'
        ? { create: 'Create folder', rename: 'Rename folder', move: 'Move folder', delete: 'Delete folder' }
        : { create: '新建文件夹', rename: '重命名文件夹', move: '移动文件夹', delete: '删除文件夹' };
      title.textContent = verbs[operation.type] || (appLanguage === 'en' ? 'Folder change' : '文件夹变更');
      const paths = document.createElement('span');
      paths.textContent = operation.source
        ? `${operation.source}${operation.destination ? ` → ${operation.destination}` : appLanguage === 'en' ? ' · delete' : ' · 删除'}`
        : operation.destination;
      const details = document.createElement('div');
      details.className = 'staged-folder-paths';
      operation.paths.forEach((path) => {
        const code = document.createElement('code');
        code.textContent = path;
        details.append(code);
      });
      record.append(title, paths, details);
      ui.stagedMoves.append(record);
    });
  }

  function appendMovePreviewSection(label, path, change, entry, count) {
    const section = document.createElement('section');
    section.className = 'move-result-index';
    const title = document.createElement('strong');
    title.textContent = label;
    const pathLine = document.createElement('code');
    pathLine.textContent = path;
    const changeLine = document.createElement('span');
    changeLine.textContent = `${change} · ${appLanguage === 'en' ? 'icons[] after move' : '移动后 icons[] 条数'}：${count}`;
    const entryLine = document.createElement('pre');
    entryLine.textContent = JSON.stringify(entry, null, 2);
    section.append(title, pathLine, changeLine, entryLine);
    ui.movePreview.append(section);
  }

  function iconMoveDestinationDirectory(destination, destinationIcons) {
    const separator = destination.path.lastIndexOf('/');
    const categoryDirectory = separator > 0 ? destination.path.slice(0, separator) : ICON_ROOT;
    const candidate = typeof destination.assetDirectory === 'string' ? destination.assetDirectory : '';
    const belongsToCategory = candidate === categoryDirectory
      || (categoryDirectory !== ICON_ROOT && candidate.startsWith(`${categoryDirectory}/`));
    if (candidate && belongsToCategory) return candidate;
    if (!destinationIcons.length) return categoryDirectory;
    return categoryDirectory === ICON_ROOT ? ICON_ROOT : `${categoryDirectory}/icon`;
  }

  function moveImageDirectoryOptions(destination) {
    const directories = new Set([...repositoryDirectories].filter((path) => {
      const root = iconRootForPath(path);
      return root && (path === root || path.startsWith(`${root}/`));
    }));
    directories.add(iconMoveDestinationDirectory(destination, iconsFor(destination)));
    return [...directories].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  function refreshMoveImageDirectoryOptions(destination, resetSelection = false) {
    if (!destination) {
      ui.moveImageDirectory.replaceChildren();
      return;
    }
    const previous = ui.moveImageDirectory.value;
    const directories = moveImageDirectoryOptions(destination);
    const defaultDirectory = iconMoveDestinationDirectory(destination, iconsFor(destination));
    ui.moveImageDirectory.replaceChildren(...directories.map((directory) => {
      const option = document.createElement('option');
      option.value = directory;
      option.textContent = directory;
      return option;
    }));
    ui.moveImageDirectory.value = !resetSelection && directories.includes(previous)
      ? previous : defaultDirectory;
  }

  function planIconMove(move, destination, imageDirectory) {
    const source = categories.find((category) => category.path === move.sourcePath);
    if (!source || !destination || source.path === destination.path) {
      return { ok: false, message: appLanguage === 'en' ? 'Choose a different destination category.' : '请选择另一个目标分类。' };
    }
    const sourceIcons = iconsFor(source);
    const destinationIcons = iconsFor(destination);
    const sourceIndex = sourceIcons[move.index]?.url === move.entry.url && sourceIcons[move.index]?.name === move.entry.name
      ? move.index
      : sourceIcons.findIndex((entry) => entry.url === move.entry.url && entry.name === move.entry.name);
    if (sourceIndex < 0) return { ok: false, message: appLanguage === 'en' ? 'The source index changed; reload it before moving this icon.' : '来源索引内容已变化；请重新加载后再移动此图标。' };
    const currentEntry = sourceIcons[sourceIndex];
    const sourceFilePath = pathFromRawUrl(currentEntry.url || '');
    const sourceReference = rawReferenceFromUrl(currentEntry.url || '');
    const priorFileMove = stagedMoves.find((item) => item.destinationFilePath === sourceFilePath && item.entry.url === currentEntry.url);
    const sourceFile = priorFileMove ? null : treeFiles.get(sourceFilePath);
    const blobSha = priorFileMove?.blobSha || sourceFile?.sha || '';
    if (!sourceFilePath || !blobSha || (!priorFileMove && !sourceReference)) {
      return { ok: false, message: appLanguage === 'en' ? 'This icon’s image file is not available in the selected repository, so it cannot be moved safely.' : '此图标的图片文件不在当前仓库中，无法安全移动。' };
    }
    if (!priorFileMove && sourceReference.ref !== branch) {
      return { ok: false, message: appLanguage === 'en' ? 'This image URL does not use the current repository branch; reload the library before moving it.' : '此图片 URL 未指向当前仓库分支；请先重新加载图标库再移动。' };
    }
    const sharedReference = categories.some((category) => iconsFor(category).some((entry, index) => {
      if (category.path === source.path && index === sourceIndex) return false;
      return pathFromRawUrl(entry.url || '') === sourceFilePath;
    }));
    if (sharedReference) {
      return { ok: false, message: appLanguage === 'en' ? 'Another icon entry also uses this image file. Move is blocked to avoid breaking that reference.' : '还有其他图标条目也在引用此图片文件；为避免产生失效链接，不能移动。' };
    }
    const defaultDirectory = iconMoveDestinationDirectory(destination, destinationIcons);
    if (!moveImageDirectoryOptions(destination).includes(imageDirectory)) {
      return { ok: false, message: appLanguage === 'en' ? 'Choose an available image destination folder.' : '请选择一个可用的图片目标文件夹。' };
    }
    const destinationDirectory = imageDirectory || defaultDirectory;
    const fileName = sourceFilePath.slice(sourceFilePath.lastIndexOf('/') + 1);
    const destinationFilePath = `${destinationDirectory}/${fileName}`;
    const destinationOccupied = treeFiles.has(destinationFilePath)
      && destinationFilePath !== sourceFilePath
      && destinationFilePath !== priorFileMove?.sourceFilePath;
    const stagedCollision = stagedMoves.some((item) => item !== priorFileMove && item.destinationFilePath === destinationFilePath);
    if (destinationOccupied || stagedCollision) {
      return { ok: false, message: appLanguage === 'en' ? `A different image file already occupies the destination path: ${destinationFilePath}` : `目标路径已有其他图片文件：${destinationFilePath}` };
    }
    const destinationUrl = destinationFilePath === sourceFilePath
      ? currentEntry.url
      : priorFileMove && destinationFilePath === priorFileMove.sourceFilePath
        ? priorFileMove.originalUrl
        : GitHubUrls.rawContentUrl(rawContentBaseUrl, selectedOwner, selectedRepoName, branch, destinationFilePath);
    if (destinationIcons.some((entry) => entry.url === destinationUrl || pathFromRawUrl(entry.url || '') === destinationFilePath)) {
      return { ok: false, message: appLanguage === 'en' ? 'The destination index already references this image path; moving it would create a duplicate.' : '目标索引已包含该图片路径；为避免重复条目，不能移动。' };
    }
    return {
      ok: true, source, destination, sourceIcons, destinationIcons, sourceIndex, currentEntry,
      sourceFilePath, destinationFilePath, destinationUrl, blobSha, priorFileMove
    };
  }

  function renderMovePreview() {
    ui.movePreview.replaceChildren();
    ui.moveError.classList.add('hidden');
    ui.moveError.textContent = '';
    const move = pendingMove;
    if (!move) { ui.moveConfirm.disabled = true; return; }
    const destination = categories.find((category) => category.path === ui.moveDestination.value);
    ui.moveSourcePath.textContent = move.sourcePath;
    ui.moveDestinationPath.textContent = destination?.path || '';
    const plan = planIconMove(move, destination, ui.moveImageDirectory.value);
    if (!plan.ok) {
      ui.moveError.textContent = plan.message;
      ui.moveError.classList.remove('hidden');
      ui.moveConfirm.disabled = true;
      return;
    }
    const movedEntry = { ...plan.currentEntry, url: plan.destinationUrl };
    ui.moveConfirm.disabled = false;
    appendMovePreviewSection(
      appLanguage === 'en' ? 'Source index · remove this entry' : '来源索引 · 移除此条目',
      plan.source.path,
      appLanguage === 'en' ? '−1 entry' : '−1 条',
      plan.currentEntry,
      Math.max(0, plan.sourceIcons.length - 1)
    );
    appendMovePreviewSection(
      appLanguage === 'en' ? 'Destination index · add this entry' : '目标索引 · 新增此条目',
      plan.destination.path,
      appLanguage === 'en' ? '+1 entry' : '+1 条',
      movedEntry,
      plan.destinationIcons.length + 1
    );
    const fileSection = document.createElement('section');
    fileSection.className = 'move-result-index';
    const fileTitle = document.createElement('strong');
    fileTitle.textContent = appLanguage === 'en' ? 'One image file · current → destination' : '单个图片文件 · 当前路径 → 目标路径';
    const filePath = document.createElement('code');
    filePath.textContent = `${plan.sourceFilePath} → ${plan.destinationFilePath}`;
    const fileNote = document.createElement('span');
    fileNote.textContent = plan.sourceFilePath === plan.destinationFilePath
      ? (appLanguage === 'en' ? 'Both categories use this same image folder; no physical path change is needed.' : '两个分类共用此图片目录，无需改变文件路径。')
      : (appLanguage === 'en' ? 'Only this file moves; no other file or folder is moved.' : '只移动这一个文件；不会移动其他文件或文件夹。');
    fileSection.append(fileTitle, filePath, fileNote);
    ui.movePreview.append(fileSection);
  }

  function openMoveDialog(categoryPath, index) {
    if (busy || cutoutBusy || pendingCutout) return;
    if (folderOperations.some((operation) => operation.type !== 'create')) return showToast(appLanguage === 'en' ? 'Finish or discard staged folder moves, renames, or deletions first.' : '请先完成或撤销已暂存的文件夹移动、重命名或删除。');
    const source = categories.find((category) => category.path === categoryPath);
    const entry = source && iconsFor(source)[index];
    const destinations = categories.filter((category) => category.path !== categoryPath);
    if (!source || !entry || !destinations.length) return showToast(appLanguage === 'en' ? 'No other category is available.' : '没有可移动到的其他分类。');
    pendingMove = { sourcePath: source.path, index, entry: { ...entry } };
    ui.moveDestination.replaceChildren(...destinations.map((category) => {
      const option = document.createElement('option');
      option.value = category.path;
      option.textContent = category.label;
      return option;
    }));
    refreshMoveImageDirectoryOptions(categories.find((category) => category.path === ui.moveDestination.value), true);
    ui.moveSourcePath.textContent = source.path;
    ui.moveModal.classList.remove('hidden');
    renderMovePreview();
  }

  function closeMoveDialog() {
    pendingMove = null;
    ui.moveModal.classList.add('hidden');
    ui.movePreview.replaceChildren();
    ui.moveError.classList.add('hidden');
  }

  function stageMove() {
    if (!pendingMove || ui.moveConfirm.disabled || busy || cutoutBusy || pendingCutout) return;
    const move = pendingMove;
    const destination = categories.find((category) => category.path === ui.moveDestination.value);
    const plan = planIconMove(move, destination, ui.moveImageDirectory.value);
    if (!plan.ok) {
      renderMovePreview();
      closeMoveDialog();
      return showToast(plan.message);
    }
    const sourceDraft = getDraftCategory(plan.source.path);
    const destinationDraft = getDraftCategory(plan.destination.path);
    sourceDraft.icons.splice(plan.sourceIndex, 1);
    const movedEntry = { ...plan.currentEntry, url: plan.destinationUrl };
    destinationDraft.icons.push(movedEntry);
    if (plan.priorFileMove) {
      plan.priorFileMove.destinationPath = plan.destination.path;
      plan.priorFileMove.destinationFilePath = plan.destinationFilePath;
      plan.priorFileMove.entry = movedEntry;
      if (plan.priorFileMove.destinationFilePath === plan.priorFileMove.sourceFilePath) {
        plan.priorFileMove.sourceFilePath = plan.priorFileMove.destinationFilePath;
        plan.priorFileMove.originalUrl = plan.destinationUrl;
        plan.priorFileMove.blobSha = plan.blobSha;
      }
    } else {
      stagedMoves.push({
        entry: movedEntry, sourcePath: plan.source.path, destinationPath: plan.destination.path,
        sourceFilePath: plan.sourceFilePath, destinationFilePath: plan.destinationFilePath,
        blobSha: plan.blobSha, originalUrl: plan.currentEntry.url
      });
    }
    closeMoveDialog();
    updateStagedUi();
    renderCategories();
    renderActiveCategory();
    showStatus(appLanguage === 'en'
      ? 'One image file and the source/destination indexes are staged locally; nothing reaches GitHub until your separate confirmation.'
      : '一个图片文件及来源/目标 JSON 已在本机暂存；只有再次确认后才会写入 GitHub。', 'info');
  }

  function canGoBackInCategoryBrowser() {
    if (!categoryBrowsePath) return false;
    const roots = [...repositoryDirectories].filter((path) => !path.includes('/'));
    const root = categoryBrowsePath.split('/')[0];
    return categoryBrowsePath !== root || roots.length > 1;
  }

  function navigateCategoryDirectory(path) {
    const roots = [...repositoryDirectories].filter((entry) => !entry.includes('/'));
    if (path && !repositoryDirectories.has(path)) return false;
    if (path && !roots.some((root) => path === root || path.startsWith(`${root}/`))) return false;
    categoryBrowsePath = path;
    ui.categoryList.scrollLeft = 0;
    ui.categoryList.scrollTop = 0;
    renderCategories();
    if (!librarySnapshotStale) persistLibrarySnapshot();
    return true;
  }

  function goCategoryBrowserBack() {
    if (!canGoBackInCategoryBrowser()) return false;
    const root = categoryBrowsePath.split('/')[0];
    const parent = categoryBrowsePath === root ? '' : categoryBrowsePath.slice(0, categoryBrowsePath.lastIndexOf('/'));
    return navigateCategoryDirectory(parent);
  }

  function renderCategoryBrowserNavigation() {
    const roots = [...repositoryDirectories].filter((path) => !path.includes('/'))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const english = appLanguage === 'en';
    ui.categoryCreateFolder.textContent = english ? '+ New folder' : '＋ 新建文件夹';
    ui.categoryBrowserNavigation.setAttribute('aria-label', english ? 'Category folder navigation' : '分类文件夹导航');
    ui.categoryBrowserBack.setAttribute('aria-label', english ? 'Back to parent folder' : '返回上一级文件夹');
    ui.categoryBreadcrumbs.setAttribute('aria-label', english ? 'Current folder path' : '当前文件夹路径');
    ui.categoryBrowserNavigation.classList.toggle('hidden', roots.length === 0);
    ui.categoryBrowserBack.classList.toggle('hidden', !canGoBackInCategoryBrowser());
    ui.categoryBreadcrumbs.replaceChildren();
    if (!roots.length) return;
    const parts = categoryBrowsePath ? categoryBrowsePath.split('/') : [];
    if (!parts.length) {
      const rootLabel = document.createElement('span');
      rootLabel.className = 'category-breadcrumb current';
      rootLabel.textContent = appLanguage === 'en' ? 'Library roots' : '图标库根目录';
      rootLabel.setAttribute('aria-current', 'page');
      ui.categoryBreadcrumbs.append(rootLabel);
      return;
    }
    let path = '';
    parts.forEach((part, index) => {
      path = path ? `${path}/${part}` : part;
      const crumbPath = path;
      const crumb = document.createElement(index === parts.length - 1 ? 'span' : 'button');
      crumb.className = `category-breadcrumb${index === parts.length - 1 ? ' current' : ''}`;
      crumb.textContent = part;
      if (index === parts.length - 1) crumb.setAttribute('aria-current', 'page');
      else crumb.addEventListener('click', () => navigateCategoryDirectory(crumbPath));
      ui.categoryBreadcrumbs.append(crumb);
    });
  }

  function makeCategoryFolderRow(path) {
    const row = document.createElement('div');
    row.className = 'category-folder-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category-item category-folder';
    button.setAttribute('aria-label', `${appLanguage === 'en' ? 'Open folder' : '打开文件夹'} ${path}`);
    const symbol = document.createElement('span');
    symbol.className = 'category-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = '▱';
    const labelWrap = document.createElement('span');
    labelWrap.className = 'category-label-wrap';
    const titleLine = document.createElement('span');
    titleLine.className = 'category-title-line';
    const title = document.createElement('span');
    title.className = 'category-name';
    title.textContent = path.slice(path.lastIndexOf('/') + 1);
    title.title = path;
    const pathLabel = document.createElement('small');
    pathLabel.className = 'category-path';
    pathLabel.textContent = `${path}/`;
    const typeLabel = document.createElement('small');
    typeLabel.className = 'category-type-label folder';
    typeLabel.textContent = appLanguage === 'en' ? 'Folder' : '文件夹';
    titleLine.append(title, typeLabel);
    labelWrap.append(titleLine, pathLabel);
    const indexCount = categories.filter((category) => category.path.startsWith(`${path}/`)).length;
    const count = document.createElement('span');
    count.className = 'category-amount';
    count.textContent = String(indexCount);
    const arrow = document.createElement('span');
    arrow.className = 'category-folder-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';
    button.append(symbol, labelWrap, count, arrow);
    button.addEventListener('click', () => {
      if (busy || cutoutBusy || pendingCutout) return;
      navigateCategoryDirectory(path);
    });
    const actions = document.createElement('div');
    actions.className = 'category-folder-actions';
    const actionLabels = appLanguage === 'en'
      ? [['rename', 'Rename', 'Rename folder'], ['move', 'Move', 'Move folder'], ['delete', 'Delete', 'Delete folder']]
      : [['rename', '改名', '重命名文件夹'], ['move', '移动', '移动文件夹'], ['delete', '删除', '删除文件夹']];
    actionLabels.forEach(([action, label, accessible]) => {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = `category-folder-action${action === 'delete' ? ' danger' : ''}`;
      control.textContent = label;
      control.title = `${accessible} · ${path}`;
      control.setAttribute('aria-label', `${accessible} ${path}`);
      control.addEventListener('click', (event) => {
        event.stopPropagation();
        openFolderOperation(action, path);
      });
      actions.append(control);
    });
    row.append(button, actions);
    return row;
  }

  function makeCategoryBrowserSection(kind, count) {
    const english = appLanguage === 'en';
    const isFolders = kind === 'folders';
    const section = document.createElement('section');
    section.className = `category-browser-section ${isFolders ? 'category-folder-section' : 'category-index-section'}`;
    const heading = document.createElement('div');
    heading.className = 'category-browser-section-heading';
    const title = document.createElement('strong');
    title.textContent = isFolders ? (english ? 'Folders' : '文件夹') : (english ? 'JSON indexes' : 'JSON 索引');
    const amount = document.createElement('span');
    amount.className = 'category-section-count';
    amount.textContent = String(count);
    heading.append(title, amount);
    const rail = document.createElement('div');
    rail.className = `category-browser-rail category-${isFolders ? 'folder' : 'index'}-list`;
    rail.setAttribute('role', 'group');
    rail.setAttribute('tabindex', '0');
    rail.setAttribute('aria-label', isFolders ? (english ? 'Folders' : '文件夹') : (english ? 'JSON indexes' : 'JSON 索引'));
    rail.setAttribute('aria-describedby', 'category-scroll-hint');
    section.append(heading, rail);
    return { section, rail };
  }

  function renderCategories() {
    ui.categoryCount.textContent = String(categories.length);
    ui.categoryList.replaceChildren();
    renderCategoryBrowserNavigation();
    const listing = categoryBrowserListing(categoryBrowsePath, repositoryDirectories, categories);
    const folderSection = listing.folders.length ? makeCategoryBrowserSection('folders', listing.folders.length) : null;
    const indexSection = listing.indexes.length ? makeCategoryBrowserSection('indexes', listing.indexes.length) : null;
    if (folderSection) {
      listing.folders.forEach((path) => folderSection.rail.append(makeCategoryFolderRow(path)));
      ui.categoryList.append(folderSection.section);
    }
    listing.indexes.forEach((category) => {
      const draft = stagedCategories.get(category.path);
      const icons = draft?.icons || category.icons;
      const label = draft?.data.name || category.label;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `category-item category-index${category.path === activeCategoryPath ? ' active' : ''}`;
      button.setAttribute('aria-pressed', String(category.path === activeCategoryPath));
      button.setAttribute('aria-label', appLanguage === 'en'
        ? `Select JSON index ${category.path}, ${label}, ${icons.length} icons`
        : `选择 JSON 索引 ${category.path}，${label}，${icons.length} 个图标`);
      const symbol = document.createElement('span');
      symbol.className = 'category-symbol';
      symbol.setAttribute('aria-hidden', 'true');
      symbol.textContent = '▦';
      const title = document.createElement('span');
      title.className = 'category-name';
      title.textContent = label;
      title.title = draft?.path || category.path;
      const labelWrap = document.createElement('span');
      labelWrap.className = 'category-label-wrap';
      const titleLine = document.createElement('span');
      titleLine.className = 'category-title-line';
      titleLine.append(title);
      const typeLabel = document.createElement('small');
      typeLabel.className = 'category-type-label json';
      typeLabel.textContent = 'JSON';
      titleLine.append(typeLabel);
      const pathLabel = document.createElement('small');
      pathLabel.className = 'category-path';
      pathLabel.textContent = category.path;
      pathLabel.title = category.path;
      labelWrap.append(titleLine, pathLabel);
      const count = document.createElement('span');
      count.className = 'category-amount';
      count.textContent = String(icons.length);
      button.append(symbol, labelWrap, count);
      button.addEventListener('click', () => {
        if (busy || cutoutBusy || pendingCutout) return;
        if (stagedCategories.size && !stagedCategories.has(category.path) && !stagedMoves.length) {
          showToast(appLanguage === 'en' ? 'Save or discard the current index changes before selecting another index.' : '请先保存或撤销当前索引的整理操作，再切换到其他索引。');
          return;
        }
        const hadActiveCategory = Boolean(activeCategoryPath);
        activeCategoryPath = category.path;
        renderCategories();
        renderActiveCategory();
        if (!librarySnapshotStale) persistLibrarySnapshot();
        if (hadActiveCategory) clearSelectedFiles();
      });
      indexSection.rail.append(button);
    });
    if (indexSection) ui.categoryList.append(indexSection.section);
    const empty = listing.folders.length === 0 && listing.indexes.length === 0;
    ui.categoryBrowserEmpty.textContent = appLanguage === 'en'
      ? 'No subfolders or valid JSON indexes in this folder.'
      : '此文件夹中没有子文件夹或有效 JSON 索引。';
    ui.categoryBrowserEmpty.classList.toggle('hidden', !empty || repositoryDirectories.size === 0);
    updateCategoryScrollHint();
  }

  function folderOperationFiles() {
    if (folderStageSnapshot) return [...folderPendingFiles.values()].filter((file) => file.path).map((file) => file.path);
    return [...treeFiles.keys()];
  }

  function resetFolderStageState() {
    folderStageSnapshot = null;
    folderPendingFiles = new Map();
    folderOperations = [];
    folderIndexDrafts = new Map();
    pendingFolderOperation = null;
  }

  function beginFolderStage() {
    if (stagedCategories.size || stagedMoves.length) {
      showToast(appLanguage === 'en' ? 'Save or discard staged index edits before changing folders.' : '请先保存或撤销已暂存的索引整理，再管理文件夹。');
      return false;
    }
    if (selectedFiles.length) {
      showToast(appLanguage === 'en' ? 'Clear the pending upload queue before changing folders.' : '请先清空待上传队列，再管理文件夹。');
      return false;
    }
    if (!folderStageSnapshot) {
      folderStageSnapshot = {
        categories: categories.map((category) => ({ ...category, data: JSON.parse(JSON.stringify(category.data)), icons: category.icons.map((entry) => ({ ...entry })) })),
        directories: new Set(repositoryDirectories), activeCategoryPath, categoryBrowsePath
      };
      folderPendingFiles = new Map([...treeFiles].map(([path, file]) => [path, { originalPath: path, path, sha: file.sha || '', mode: file.mode || '100644' }]));
    }
    return true;
  }

  function currentFolderDirectories() {
    return repositoryDirectories;
  }

  function setFolderOperationError(message) {
    ui.folderOperationError.textContent = message;
    ui.folderOperationError.classList.toggle('hidden', !message);
  }

  function addFolderOperationPreviewPath(path, target = '') {
    const item = document.createElement('li');
    const from = document.createElement('code');
    from.textContent = path;
    item.append(from);
    if (target) {
      const arrow = document.createElement('span');
      arrow.className = 'folder-operation-arrow';
      arrow.textContent = '→';
      const to = document.createElement('code');
      to.textContent = target;
      item.append(arrow, to);
    }
    ui.folderOperationPreview.append(item);
  }

  function folderPreviewMappings(source, destination) {
    const paths = new Set();
    repositoryDirectories.forEach((path) => { if (FolderOps.isInside(path, source)) paths.add(path); });
    folderOperationFiles().forEach((path) => { if (FolderOps.isInside(path, source)) paths.add(path); });
    return [...paths].sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((from) => ({ from, to: `${destination}${from.slice(source.length)}` }));
  }

  function folderReferencedIndexes(source) {
    return categories.filter((category) => category.icons.some((entry) => {
      const path = pathFromRawUrl(entry.url || '');
      return path && FolderOps.isInside(path, source);
    })).map((category) => category.path).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  function renderFolderOperationPreview() {
    const pending = pendingFolderOperation;
    ui.folderOperationPreview.replaceChildren();
    setFolderOperationError('');
    ui.folderOperationStage.disabled = false;
    if (!pending) return;
    const english = appLanguage === 'en';
    const name = ui.folderOperationName.value;
    const destination = ui.folderOperationDestination.value;
    const directories = currentFolderDirectories();
    const files = folderOperationFiles();
    let plan;
    if (pending.type === 'create') {
      plan = FolderOps.planCreateFolder({ parent: destination, name, directories, files });
      ui.folderOperationTitle.textContent = english ? 'Create category folder' : '新建分类文件夹';
      ui.folderOperationDescription.textContent = english
        ? 'A .gitkeep placeholder keeps the folder in Git. No JSON index is created. This change stays local until you review and explicitly submit it.'
        : '将用 .gitkeep 占位文件保留空文件夹；不会创建 JSON 索引。变更先暂存在本机，检查后还需单独确认提交。';
      ui.folderOperationNameWrap.classList.remove('hidden');
      ui.folderOperationNameLabel.textContent = english ? 'Folder name' : '文件夹名称';
      ui.folderOperationDestinationWrap.classList.remove('hidden');
      ui.folderOperationDestinationLabel.textContent = english ? 'Create inside' : '创建位置';
      if (!plan.ok) return thisFolderOperationError(plan);
      const heading = document.createElement('strong');
      heading.textContent = english ? 'Will create folder and placeholder:' : '将新建文件夹及占位文件：';
      ui.folderOperationPreview.append(heading);
      addFolderOperationPreviewPath(plan.path);
      addFolderOperationPreviewPath(plan.placeholderPath);
    } else if (pending.type === 'rename') {
      plan = FolderOps.planRenameFolder({ folder: pending.folder, name, directories, files });
      ui.folderOperationTitle.textContent = english ? 'Rename folder' : '重命名文件夹';
      ui.folderOperationDescription.textContent = english
        ? 'Every file and child folder is staged under the new path. Existing JSON image URLs are rewritten where needed.'
        : '整棵子树的文件与子文件夹都会暂存到新路径；有效 JSON 索引中指向该子树图片的 URL 会同步更新。';
      ui.folderOperationNameWrap.classList.remove('hidden');
      ui.folderOperationNameLabel.textContent = english ? 'New folder name' : '新的文件夹名称';
      ui.folderOperationDestinationWrap.classList.add('hidden');
      if (!plan.ok) return thisFolderOperationError(plan);
      if (plan.noOp) return thisFolderOperationError({ reason: 'no-op' });
      appendFolderMappingsPreview(plan.source, plan.destination);
    } else if (pending.type === 'move') {
      plan = FolderOps.planMoveFolder({ folder: pending.folder, destinationFolder: destination, directories, files });
      ui.folderOperationTitle.textContent = english ? 'Move folder' : '移动文件夹';
      ui.folderOperationDescription.textContent = english
        ? 'Move the whole subtree into any existing category folder at any depth. Self/descendant moves and path conflicts are blocked; affected JSON image URLs are rewritten.'
        : '可将整棵子树移动到任意层级的现有分类文件夹；禁止移入自身或后代，并检查路径冲突；受影响的 JSON 图像 URL 会同步更新。';
      ui.folderOperationNameWrap.classList.add('hidden');
      ui.folderOperationDestinationWrap.classList.remove('hidden');
      ui.folderOperationDestinationLabel.textContent = english ? 'Move into folder' : '移动到目标分类文件夹';
      if (!plan.ok) return thisFolderOperationError(plan);
      if (plan.noOp) return thisFolderOperationError({ reason: 'no-op' });
      appendFolderMappingsPreview(plan.source, plan.destination);
    } else {
      plan = FolderOps.planDeleteFolder({ folder: pending.folder, directories, files });
      ui.folderOperationTitle.textContent = english ? 'Review folder deletion' : '预览删除文件夹';
      ui.folderOperationDescription.textContent = english
        ? 'Review every affected file before staging. This removes only the listed subtree; other indexes that link to these images will be left unchanged and may contain broken links.'
        : '暂存前请检查所有受影响文件。仅删除下列子树；其他索引若引用这些图片，不会被改写，可能留下失效链接。';
      ui.folderOperationNameWrap.classList.add('hidden');
      ui.folderOperationDestinationWrap.classList.add('hidden');
      if (!plan.ok) return thisFolderOperationError(plan);
      const summary = document.createElement('strong');
      const imageCount = plan.paths.filter((path) => /\.(png|jpe?g|gif|webp|avif)$/i.test(path)).length;
      const indexCount = plan.paths.filter((path) => path.toLowerCase().endsWith('.json')).length;
      const placeholderCount = plan.paths.filter((path) => path.split('/').pop() === '.gitkeep').length;
      summary.textContent = english
        ? `${plan.count} files · ${indexCount} JSON indexes · ${imageCount} images · ${placeholderCount} placeholders`
        : `共 ${plan.count} 个文件 · ${indexCount} 个 JSON 索引 · ${imageCount} 张图片 · ${placeholderCount} 个占位文件`;
      ui.folderOperationPreview.append(summary);
      plan.paths.forEach((path) => addFolderOperationPreviewPath(path));
      if (!plan.count) {
        const empty = document.createElement('p');
        empty.textContent = english ? 'No tracked files were found under this folder.' : '此文件夹下没有可删除的已跟踪文件。';
        ui.folderOperationPreview.append(empty);
      }
    }
    pending.plan = plan;
    return plan;

    function thisFolderOperationError(result) {
      const messages = {
        'invalid-name': english ? 'Use 1–120 characters without slash, backslash, control characters, or reserved names.' : '名称需为 1–120 个字符，不能含斜线、反斜线、控制字符或保留名称。',
        'collision': english ? `A file or folder already uses this path: ${result.path || ''}` : `目标路径已被文件或文件夹占用：${result.path || ''}`,
        'missing-parent': english ? 'Choose an existing category folder.' : '请选择一个现有分类文件夹。',
        'missing-destination': english ? 'Choose an existing destination folder.' : '请选择一个现有目标文件夹。',
        'into-self': english ? 'A folder cannot be moved into itself or one of its descendants.' : '不能将文件夹移动到自身或其子文件夹内。',
        'invalid-source': english ? 'The selected root or folder is not eligible for this operation.' : '所选根目录不能执行此文件夹操作。',
        'no-op': english ? 'The destination is unchanged; choose a different name or folder.' : '目标位置没有变化，请选择其他名称或文件夹。'
      };
      setFolderOperationError(messages[result.reason] || (english ? 'This folder operation is not valid.' : '此文件夹操作无效。'));
      ui.folderOperationStage.disabled = true;
      return result;
    }

    function appendFolderMappingsPreview(source, target) {
      const mappings = folderPreviewMappings(source, target);
      const heading = document.createElement('strong');
      heading.textContent = english ? `${mappings.length} affected paths · current → staged` : `共影响 ${mappings.length} 个路径 · 当前路径 → 暂存路径`;
      ui.folderOperationPreview.append(heading);
      mappings.forEach((mapping) => addFolderOperationPreviewPath(mapping.from, mapping.to));
      const referencePaths = folderReferencedIndexes(source).filter((path) => !mappings.some((item) => item.from === path));
      if (referencePaths.length) {
        const references = document.createElement('strong');
        references.textContent = english ? 'Also update image URLs in these external indexes:' : '还会同步改写以下外部索引中的图片 URL：';
        ui.folderOperationPreview.append(references);
        referencePaths.forEach((path) => addFolderOperationPreviewPath(path, english ? `${path} · JSON URLs` : `${path} · JSON URL 更新`));
      }
    }
  }

  function openFolderOperation(type, folder = '') {
    if (busy || cutoutBusy || pendingCutout || librarySnapshotStale) return;
    if (stagedCategories.size || stagedMoves.length || selectedFiles.length) {
      showToast(appLanguage === 'en' ? 'Finish or discard pending index edits or uploads first.' : '请先完成或撤销索引整理和待上传队列，再管理文件夹。');
      return;
    }
    const english = appLanguage === 'en';
    pendingFolderOperation = { type, folder };
    ui.folderOperationName.value = type === 'rename' ? folder.slice(folder.lastIndexOf('/') + 1) : '';
    const candidates = [...repositoryDirectories].filter((path) => type !== 'move' || !FolderOps.isInside(path, folder))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    ui.folderOperationDestination.replaceChildren(...candidates.map((path) => {
      const option = document.createElement('option');
      option.value = path;
      option.textContent = path;
      return option;
    }));
    const preferred = type === 'create' && repositoryDirectories.has(categoryBrowsePath)
      ? categoryBrowsePath : (type === 'create' ? folder : '');
    if (preferred && candidates.includes(preferred)) ui.folderOperationDestination.value = preferred;
    if (type === 'delete') ui.folderOperationStage.textContent = english ? 'Stage deletion' : '暂存删除';
    else ui.folderOperationStage.textContent = english ? 'Stage change' : '暂存变更';
    ui.folderOperationModal.classList.remove('hidden');
    renderFolderOperationPreview();
    requestAnimationFrame(() => (type === 'rename' || type === 'create' ? ui.folderOperationName : ui.folderOperationDestination).focus());
  }

  function closeFolderOperation() {
    pendingFolderOperation = null;
    ui.folderOperationModal.classList.add('hidden');
    ui.folderOperationPreview.replaceChildren();
    setFolderOperationError('');
  }

  function rewriteCategoryUrlsForMove(source, destination) {
    const mapPath = (path) => FolderOps.mapSubtreePath(path, source, destination);
    const pathFromUrlWithMap = (url) => pathFromRawUrl(url);
    pathFromUrlWithMap.mapPath = mapPath;
    const nextCategories = [];
    categories.forEach((category) => {
      const originalPath = category.folderOriginalPath || category.path;
      const movedPath = mapPath(category.path);
      const rewritten = FolderOps.rewriteIndexUrls(category.data, pathFromUrlWithMap, (oldUrl, nextPath) => {
        const reference = rawReferenceFromUrl(oldUrl);
        if (!reference) return oldUrl;
        return GitHubUrls.rawContentUrl(rawContentBaseUrl, reference.owner, reference.repository, reference.ref, nextPath);
      });
      if (rewritten.changed) {
        category.data = rewritten.data;
        category.icons = rewritten.data.icons;
      }
      if (movedPath !== category.path) category.path = movedPath;
      category.folderOriginalPath = originalPath;
      nextCategories.push(category);
    });
    categories = nextCategories;
    folderIndexDrafts = new Map();
    const baseline = new Map(folderStageSnapshot.categories.map((category) => [category.path, category.data]));
    categories.forEach((category) => {
      const originalPath = category.folderOriginalPath || category.path;
      const original = baseline.get(originalPath);
      if (original && JSON.stringify(original) !== JSON.stringify(category.data)) {
        folderIndexDrafts.set(originalPath, { originalPath, path: category.path, data: category.data });
      }
    });
  }

  function applyFolderPathTransform(source, destination = '') {
    const isDelete = !destination;
    folderPendingFiles.forEach((file) => {
      if (!file.path || !FolderOps.isInside(file.path, source)) return;
      file.path = isDelete ? null : FolderOps.mapSubtreePath(file.path, source, destination);
    });
    const nextDirectories = new Set();
    repositoryDirectories.forEach((path) => {
      if (!FolderOps.isInside(path, source)) nextDirectories.add(path);
      else if (!isDelete) nextDirectories.add(FolderOps.mapSubtreePath(path, source, destination));
    });
    repositoryDirectories = nextDirectories;
    const mapVisiblePath = (path) => {
      if (!path) return path;
      if (isDelete && FolderOps.isInside(path, source)) return '';
      return isDelete ? path : FolderOps.mapSubtreePath(path, source, destination);
    };
    const oldCategoryPaths = categories.map((category) => category.path);
    categories = categories.filter((category) => !isDelete || !FolderOps.isInside(category.path, source));
    if (!isDelete) rewriteCategoryUrlsForMove(source, destination);
    else {
      folderIndexDrafts = new Map();
      const baseline = new Map(folderStageSnapshot.categories.map((category) => [category.path, category.data]));
      categories.forEach((category) => {
        const originalPath = category.folderOriginalPath || category.path;
        const original = baseline.get(originalPath);
        if (original && JSON.stringify(original) !== JSON.stringify(category.data)) {
          folderIndexDrafts.set(originalPath, { originalPath, path: category.path, data: category.data });
        }
      });
    }
    if (activeCategoryPath && isDelete && FolderOps.isInside(activeCategoryPath, source)) activeCategoryPath = '';
    else if (activeCategoryPath && !isDelete) activeCategoryPath = mapVisiblePath(activeCategoryPath);
    if (categoryBrowsePath && isDelete && FolderOps.isInside(categoryBrowsePath, source)) categoryBrowsePath = FolderOps.parentPath(source);
    else if (categoryBrowsePath && !isDelete) categoryBrowsePath = mapVisiblePath(categoryBrowsePath);
    if (oldCategoryPaths.length !== categories.length && !activeCategoryPath) renderActiveCategory();
  }

  function stageFolderOperation() {
    if (!pendingFolderOperation || busy || ui.folderOperationStage.disabled) return;
    const pending = pendingFolderOperation;
    const plan = renderFolderOperationPreview();
    if (!plan?.ok) return;
    if (plan.noOp) return;
    if (!beginFolderStage()) return closeFolderOperation();
    if (pending.type === 'create') {
      repositoryDirectories.add(plan.path);
      const key = `new:${plan.placeholderPath}:${folderOperations.length}`;
      folderPendingFiles.set(key, { originalPath: '', path: plan.placeholderPath, sha: '' });
      folderOperations.push({ type: 'create', source: '', destination: plan.path, paths: [plan.placeholderPath] });
    } else if (pending.type === 'rename' || pending.type === 'move') {
      const mappings = folderPreviewMappings(plan.source, plan.destination);
      const referencePaths = folderReferencedIndexes(plan.source).filter((path) => !mappings.some((item) => item.from === path));
      applyFolderPathTransform(plan.source, plan.destination);
      folderOperations.push({ type: pending.type, source: plan.source, destination: plan.destination,
        paths: [...mappings.map((item) => `${item.from} → ${item.to}`), ...referencePaths.map((path) => `${path} · JSON URL 更新`)] });
    } else {
      applyFolderPathTransform(plan.folder);
      folderOperations.push({ type: 'delete', source: plan.folder, destination: '', paths: plan.paths });
    }
    closeFolderOperation();
    renderCategories();
    renderActiveCategory();
    updateStagedUi();
    syncLockedControls();
    showStatus(appLanguage === 'en'
      ? 'Folder changes are staged locally only. Review all affected paths, then explicitly confirm before anything is sent to GitHub.'
      : '文件夹变更仅暂存在本机。检查所有受影响路径后，还需单独确认才会提交到 GitHub。', 'info');
  }

  function folderChangesForCommit() {
    const changes = [];
    const added = new Set();
    folderPendingFiles.forEach((file) => {
      const original = file.originalPath;
      const current = file.path;
      if (!original) {
        if (current) changes.push({ path: current, content: utf8ToBase64('.gitkeep\n') });
        return;
      }
      const draft = folderIndexDrafts.get(original);
      if (!current) {
        changes.push({ path: original, delete: true });
        return;
      }
      if (current !== original) {
        changes.push({ path: original, delete: true });
        const change = draft
          ? { path: current, content: utf8ToBase64(`${JSON.stringify(draft.data, null, 2)}\n`) }
          : { path: current, sha: file.sha, mode: file.mode || '100644' };
        if (!added.has(current)) { changes.push(change); added.add(current); }
      } else if (draft) {
        changes.push({ path: current, content: utf8ToBase64(`${JSON.stringify(draft.data, null, 2)}\n`) });
      }
    });
    return changes;
  }

  let categoryStripResizeObserver = null;
  function updateCategoryScrollHint() {
    if (!categoryStripResizeObserver && 'ResizeObserver' in window) {
      categoryStripResizeObserver = new ResizeObserver(updateCategoryScrollHint);
      categoryStripResizeObserver.observe(ui.categoryList);
    }
    const rails = [...ui.categoryList.querySelectorAll('.category-browser-rail')];
    rails.forEach((rail) => categoryStripResizeObserver?.observe(rail));
    const hasHorizontalOverflow = window.innerWidth <= 680
      && rails.some((rail) => rail.scrollWidth > rail.clientWidth + 1);
    ui.categoryScrollHint.classList.toggle('hidden', !hasHorizontalOverflow);
    ui.categoryScrollHint.textContent = appLanguage === 'en' ? '↔ Swipe to see more' : '↔ 左右滑动查看更多';
    ui.categoryList.setAttribute('aria-label', appLanguage === 'en' ? 'Folders and JSON indexes' : '文件夹与 JSON 索引');
  }

  window.addEventListener('resize', updateCategoryScrollHint, { passive: true });

  function updateIndexSelectPrompt() {
    const english = appLanguage === 'en';
    const emptyRepository = Boolean(selectedOwner && selectedRepoName && categories.length === 0);
    if (emptyRepository) {
      ui.indexSelectKicker.textContent = english ? 'NO ICON INDEX FOUND' : '当前仓库没有索引';
      ui.indexSelectTitle.textContent = english ? 'This repository has no manageable icon index' : '这个仓库没有可管理的图标索引';
      ui.indexSelectHelp.textContent = english
        ? `Selected ${selectedOwner}/${selectedRepoName}, but no valid JSON icon index was found under the icon/ or icons/ root (directory name is case-insensitive). No categories or icons are shown. You can switch to another accessible repository from Settings → GitHub account and repository.`
        : `已成功选择 ${selectedOwner}/${selectedRepoName}，但 icon/ 或 icons/ 根目录下（目录名不区分大小写）没有有效的 JSON 图标索引，因此没有分类或图标可显示。仍可在「设置 → GitHub 账号与仓库」切换到其他可访问仓库。`;
      return;
    }
    ui.indexSelectKicker.textContent = english ? 'TASK 3 / 3 · SELECT JSON INDEX' : '任务 3 / 3 · 选择 JSON 索引';
    ui.indexSelectTitle.textContent = english ? 'Choose the category index to manage' : '先选择要管理的分类索引';
    ui.indexSelectHelp.textContent = english
      ? 'Browse repository folders one level at a time. Only valid JSON indexes are selectable; each index stays separate, and edits affect only the selected JSON.'
      : '在左侧按仓库文件夹逐层浏览；只有有效 JSON 索引可选。每个索引彼此独立，上传、改名和整理只会更新选中的那份 JSON。';
  }

  function renderActiveCategory() {
    updateIndexSelectPrompt();
    const category = categories.find((item) => item.path === activeCategoryPath);
    if (!category) {
      ui.indexSelectPrompt.classList.remove('hidden');
      ui.categoryEditor.classList.add('hidden');
      return;
    }
    ui.indexSelectPrompt.classList.add('hidden');
    ui.categoryEditor.classList.remove('hidden');
    const draft = stagedCategories.get(category.path);
    ui.selectedKicker.textContent = draft?.path || category.path;
    ui.selectedTitle.textContent = draft?.data.name || category.label;
    ui.selectedDescription.textContent = typeof draft?.data.description === 'string' ? draft.data.description : category.description;
    ui.iconCount.textContent = String(draft?.icons.length ?? category.icons.length);
    ui.rawIndexLink.href = GitHubUrls.rawContentUrl(rawContentBaseUrl, selectedOwner, selectedRepoName, branch, category.path);
    ui.rawIndexLink.textContent = appLanguage === 'en' ? 'View JSON index ↗' : '查看 JSON 索引 ↗';
    renderIcons();
  }

  function iconCard(entry, index, category) {
    const card = document.createElement('article');
    card.className = 'icon-card';
    const preview = document.createElement('div');
    preview.className = 'icon-preview';
    const fallback = document.createElement('span');
    fallback.className = 'icon-fallback';
    fallback.setAttribute('aria-hidden', 'true');
    fallback.textContent = '▧';
    const image = document.createElement('img');
    image.src = imageAccessUrl(entry.url);
    image.alt = entry.name;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { image.remove(); preview.append(fallback); }, { once: true });
    preview.append(image);

    const info = document.createElement('div');
    info.className = 'icon-info';
    const name = document.createElement('span');
    name.className = 'icon-name';
    name.textContent = entry.name;
    name.title = entry.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete-button';
    remove.setAttribute('aria-label', `${appLanguage === 'en' ? 'Delete' : '删除'} ${entry.name}`);
    remove.title = appLanguage === 'en' ? 'Delete icon and index entry' : '删除图标及其索引条目';
    remove.textContent = '×';
    const filePath = pathFromRawUrl(entry.url);
    if (!filePath || !treeFiles.has(filePath) || stagedCategories.size) {
      remove.disabled = true;
      remove.dataset.unavailable = 'true';
      remove.title = !filePath || !treeFiles.has(filePath) ? '此索引指向的文件不在仓库内，无法安全删除' : '请先保存或撤销整理操作';
    } else {
      remove.addEventListener('click', () => deleteIcon(entry, filePath));
    }
    const details = document.createElement('div');
    details.className = 'icon-details';
    const urlLink = document.createElement('a');
    urlLink.className = 'icon-url';
    urlLink.href = imageAccessUrl(entry.url);
    urlLink.textContent = imageAccessUrl(entry.url);
    urlLink.target = '_blank';
    urlLink.rel = 'noopener noreferrer';
    urlLink.title = entry.url;
    details.append(name, urlLink);
    info.append(details, remove);

    const actions = document.createElement('div');
    actions.className = 'icon-actions';
    const up = document.createElement('button');
    up.type = 'button'; up.className = 'icon-action'; up.textContent = appLanguage === 'en' ? '↑ Up' : '↑ 上移';
    up.title = appLanguage === 'en' ? 'Move up' : '在分类中上移';
    up.disabled = index === 0;
    up.dataset.unavailable = String(index === 0);
    up.addEventListener('click', () => reorderIcon(category.path, index, -1));
    const down = document.createElement('button');
    down.type = 'button'; down.className = 'icon-action'; down.textContent = appLanguage === 'en' ? '↓ Down' : '↓ 下移';
    down.title = appLanguage === 'en' ? 'Move down' : '在分类中下移';
    down.disabled = index >= iconsFor(category).length - 1;
    down.dataset.unavailable = String(down.disabled);
    down.addEventListener('click', () => reorderIcon(category.path, index, 1));
    const rename = document.createElement('button');
    rename.type = 'button'; rename.className = 'icon-action';
    rename.textContent = appLanguage === 'en' ? 'Edit name' : '改名称';
    rename.title = appLanguage === 'en' ? 'Edit this icons[].name field; URL stays unchanged' : '编辑 icons[].name，URL 保持不变';
    rename.addEventListener('click', () => stageIconLabelRename(category.path, index));
    const move = document.createElement('button');
    move.type = 'button'; move.className = 'icon-action';
    move.textContent = appLanguage === 'en' ? 'Move category' : '移到分类';
    move.title = appLanguage === 'en' ? 'Move this entry between separate category indexes' : '把此图标移动到另一个独立分类索引';
    move.disabled = categories.length < 2;
    move.dataset.unavailable = String(categories.length < 2);
    move.addEventListener('click', () => openMoveDialog(category.path, index));
    actions.append(up, down, rename, move);
    card.append(preview, info, actions);
    return card;
  }

  function reorderIcon(categoryPath, index, direction) {
    const draft = getDraftCategory(categoryPath);
    const targetIndex = index + direction;
    if (!draft || targetIndex < 0 || targetIndex >= draft.icons.length) return;
    [draft.icons[index], draft.icons[targetIndex]] = [draft.icons[targetIndex], draft.icons[index]];
    updateStagedUi();
    renderCategories();
    renderActiveCategory();
  }

  function updateRenameCount() {
    const count = ui.renameInput.value.length;
    const text = `${count}/120`;
    ui.renameCount.value = text;
    ui.renameCount.textContent = text;
  }

  function openRenameDialog(request) {
    pendingRename = { ...request, returnFocus: document.activeElement };
    const english = appLanguage === 'en';
    const category = request.kind === 'category';
    ui.renameKicker.textContent = english ? 'LOCAL STAGING · NOT SAVED' : '本机暂存 · 尚未写入';
    ui.renameTitle.textContent = category
      ? (english ? 'Rename category' : '修改分类名称')
      : (english ? 'Rename icon' : '修改图标名称');
    ui.renameDescription.textContent = english
      ? 'This change is staged in the selected JSON index only. It will not be written to GitHub until you save the pending changes.'
      : '改名只会暂存在当前 JSON 索引；点击「保存整理」前不会写入 GitHub。';
    ui.renameFieldLabel.textContent = category
      ? (english ? 'Category name' : '分类名称')
      : (english ? 'Icon name' : '图标名称');
    ui.renameHelp.textContent = english ? 'Use 1–120 characters.' : '名称长度为 1–120 个字符。';
    ui.renameConfirm.textContent = english ? 'Stage name change' : '暂存改名';
    ui.renameInput.value = request.currentName || '';
    ui.renameError.classList.add('hidden');
    ui.renameError.textContent = '';
    updateRenameCount();
    ui.renameModal.classList.remove('hidden');
    requestAnimationFrame(() => {
      ui.renameInput.focus();
      ui.renameInput.select();
    });
  }

  function closeRenameDialog(restoreFocus = true) {
    const target = pendingRename?.returnFocus;
    pendingRename = null;
    ui.renameModal.classList.add('hidden');
    ui.renameError.classList.add('hidden');
    if (restoreFocus && target?.isConnected) requestAnimationFrame(() => target.focus());
  }

  function submitRenameDialog() {
    if (!pendingRename) return;
    const state = pendingRename;
    const nextName = ui.renameInput.value.trim();
    if (!nextName || nextName.length > 120) {
      ui.renameError.textContent = appLanguage === 'en'
        ? 'Enter a name containing 1–120 characters.'
        : '名称不能为空，且不能超过 120 个字符。';
      ui.renameError.classList.remove('hidden');
      ui.renameInput.focus();
      return;
    }
    if (state.kind === 'icon') {
      const draft = getDraftCategory(state.categoryPath);
      if (!draft?.icons?.[state.index]) return closeRenameDialog(false);
      draft.icons[state.index].name = nextName;
      closeRenameDialog(false);
      updateStagedUi();
      renderCategories();
      renderActiveCategory();
      showStatus(appLanguage === 'en'
        ? 'Icon label staged; its URL and image file are unchanged.'
        : '已暂存图标名称；URL 和图像文件都未改变。', 'info');
      return;
    }
    const draft = getDraftCategory(state.categoryPath);
    if (!draft) return closeRenameDialog(false);
    draft.data.name = nextName;
    closeRenameDialog(false);
    updateStagedUi();
    renderCategories();
    renderActiveCategory();
    showStatus(appLanguage === 'en'
      ? 'Category name staged; the JSON index path and icon URLs are unchanged.'
      : '已暂存分类名称；JSON 索引路径和图像 URL 都未改变。', 'info');
  }

  function stageIconLabelRename(categoryPath, index) {
    const category = categories.find((item) => item.path === categoryPath);
    const entry = stagedCategories.get(categoryPath)?.icons[index] || category?.icons[index];
    if (!entry) return;
    openRenameDialog({ kind: 'icon', categoryPath, index, currentName: entry.name });
  }

  function stageCategoryNameRename() {
    if (!activeCategoryPath) return;
    const original = categories.find((item) => item.path === activeCategoryPath);
    const existingDraft = stagedCategories.get(activeCategoryPath);
    if (!original) return;
    openRenameDialog({
      kind: 'category', categoryPath: activeCategoryPath,
      currentName: existingDraft?.data.name || original.label
    });
  }

  function renderIcons() {
    const category = categories.find((item) => item.path === activeCategoryPath);
    if (!category) return;
    const query = ui.searchInput.value.trim().toLocaleLowerCase();
    const entries = iconsFor(category);
    const visible = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.name.toLocaleLowerCase().includes(query));
    ui.iconGrid.replaceChildren(...visible.map(({ entry, index }) => iconCard(entry, index, category)));
    const empty = visible.length === 0;
    ui.emptyState.classList.toggle('hidden', !empty);
    ui.iconGrid.classList.toggle('hidden', empty);
    if (empty && entries.length && query) {
      ui.emptyTitle.textContent = appLanguage === 'en' ? 'No matching icons' : '没有匹配的图标';
      ui.emptyDescription.textContent = appLanguage === 'en' ? 'Try another search term.' : '换个关键词试试。';
    } else {
      ui.emptyTitle.textContent = appLanguage === 'en' ? 'No icons here yet' : '这里还没有图标';
      ui.emptyDescription.textContent = appLanguage === 'en' ? 'Choose images to add them to this category index.' : '选择图片上传，它们会自动加入这个分类的索引。';
    }
  }

  function clearSelectedFiles() {
    closeCutoutPreview();
    selectedFiles = [];
    selectedFileNames = [];
    ui.fileInput.value = '';
    ui.selectedFiles.replaceChildren();
    ui.selectedFiles.classList.add('hidden');
    ui.uploadButton.classList.add('hidden');
  }

  function fileExtension(name) {
    const match = name.toLowerCase().match(/\.([^.]+)$/);
    return match ? match[1] : '';
  }

  function chooseFiles(files, sourceInput = ui.fileInput) {
    if (busy || cutoutBusy || pendingCutout) return;
    const list = [...files];
    if (!list.length) return;
    const invalid = list.filter((file) => !ALLOWED_EXTENSIONS.has(fileExtension(file.name)));
    if (invalid.length) {
      showToast(`不支持的文件格式：${invalid.map((item) => item.name).join('、')}`);
      sourceInput.value = '';
      return;
    }
    const tooLarge = list.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) {
      showToast(`“${tooLarge.name}”超过 12 MB 限制。`);
      sourceInput.value = '';
      return;
    }
    const total = list.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_BATCH_BYTES) {
      showToast('本次选择总大小不能超过 24 MB，请分批上传。');
      sourceInput.value = '';
      return;
    }
    selectedFiles = list;
    selectedFileNames = list.map((file) => file.name);
    renderSelectedFiles();
  }

  function openGalleryPicker(replaceCurrent = false) {
    if (busy || (cutoutBusy && !pendingCutout)) return;
    galleryReplaceIndex = replaceCurrent && pendingCutout ? pendingCutout.index : null;
    ui.galleryInput.value = '';
    ui.galleryInput.click();
  }

  function acceptGalleryPhoto(file) {
    if (!file || busy) return;
    if (!ALLOWED_EXTENSIONS.has(fileExtension(file.name))) {
      galleryReplaceIndex = null;
      ui.galleryInput.value = '';
      return showToast(`不支持的图片格式：“${file.name}”。`);
    }
    if (file.size > MAX_FILE_BYTES) {
      galleryReplaceIndex = null;
      ui.galleryInput.value = '';
      return showToast(`“${file.name}”超过 12 MB 限制。`);
    }
    const nextFiles = [...selectedFiles];
    const nextNames = [...selectedFileNames];
    let index = Number.isInteger(galleryReplaceIndex) && galleryReplaceIndex >= 0 && galleryReplaceIndex < nextFiles.length
      ? galleryReplaceIndex : nextFiles.length;
    if (index < nextFiles.length) {
      nextFiles[index] = file;
      nextNames[index] = file.name;
    } else {
      nextFiles.push(file);
      nextNames.push(file.name);
    }
    galleryReplaceIndex = null;
    if (nextFiles.reduce((sum, item) => sum + item.size, 0) > MAX_BATCH_BYTES) {
      ui.galleryInput.value = '';
      return showToast('本次选择总大小不能超过 24 MB；请先从待上传列表移除文件。');
    }
    if (pendingCutout) closeCutoutPreview();
    selectedFiles = nextFiles;
    selectedFileNames = nextNames;
    ui.galleryInput.value = '';
    renderSelectedFiles();
    startCutout(index, true);
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatCacheBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value === 0) return '0 B';
    if (value < 1024) return `${Math.round(value)} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fileStem(name) {
    const extension = fileExtension(name);
    return extension ? name.slice(0, -(extension.length + 1)) : name;
  }

  function updatePendingName(index, input) {
    const file = selectedFiles[index];
    if (!file) return;
    const extension = fileExtension(file.name);
    const base = input.value.trim();
    const candidate = extension ? `${base}.${extension}` : base;
    const valid = Boolean(base) && base.length <= 120 && !/[\\/\u0000-\u001f\u007f]/.test(base);
    selectedFileNames[index] = candidate;
    input.setAttribute('aria-invalid', String(!valid));
    input.title = valid ? candidate : (appLanguage === 'en' ? 'Use 1–120 characters without slashes or control characters.' : '名称需为 1–120 个字符，且不能含斜线或控制字符。');
  }

  function renderSelectedFiles() {
    ui.selectedFiles.replaceChildren();
    selectedFiles.forEach((file, index) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      const details = document.createElement('label');
      details.className = 'file-chip-main';
      const nameLabel = document.createElement('span');
      nameLabel.className = 'file-name-label';
      nameLabel.textContent = appLanguage === 'en' ? 'Upload name' : '上传名称';
      const nameRow = document.createElement('span');
      nameRow.className = 'file-name-row';
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'pending-name-input';
      name.value = fileStem(selectedFileNames[index] || file.name);
      name.maxLength = 120;
      name.autocomplete = 'off';
      name.setAttribute('aria-label', appLanguage === 'en' ? `Upload name for ${file.name}` : `编辑 ${file.name} 的上传名称`);
      name.addEventListener('input', () => updatePendingName(index, name));
      const extension = fileExtension(file.name);
      const suffix = document.createElement('small');
      suffix.className = 'file-extension';
      suffix.textContent = extension ? `.${extension}` : '';
      nameRow.append(name, suffix);
      details.append(nameLabel, nameRow);
      const size = document.createElement('small');
      size.className = 'file-size';
      size.textContent = formatBytes(file.size);
      const actions = document.createElement('span');
      actions.className = 'file-chip-actions';
      const cutout = document.createElement('button');
      cutout.type = 'button';
      cutout.className = 'chip-action';
      cutout.textContent = appLanguage === 'en' ? 'Cut out' : '抠图';
      cutout.title = appLanguage === 'en' ? 'Remove the background on this device' : '在本机处理并预览背景去除结果';
      cutout.dataset.unavailable = String(!window.CueBackgroundRemoval);
      cutout.disabled = !window.CueBackgroundRemoval;
      cutout.addEventListener('click', () => startCutout(index));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'chip-remove';
      remove.setAttribute('aria-label', appLanguage === 'en' ? `Remove ${file.name} from pending uploads` : `从待上传列表移除 ${file.name}`);
      remove.title = appLanguage === 'en' ? 'Remove from pending uploads' : '从待上传列表移除';
      remove.textContent = '×';
      remove.addEventListener('click', () => removeSelectedFile(index));
      actions.append(cutout, remove);
      chip.append(details, size, actions);
      ui.selectedFiles.append(chip);
    });
    ui.selectedFiles.classList.toggle('hidden', !selectedFiles.length);
    ui.uploadButton.classList.toggle('hidden', !selectedFiles.length);
    ui.uploadButton.textContent = appLanguage === 'en'
      ? (selectedFiles.length > 1 ? `Upload ${selectedFiles.length} icons and save →` : 'Upload and save →')
      : (selectedFiles.length > 1 ? `上传 ${selectedFiles.length} 个图标并保存 →` : '上传并保存 →');
    syncLockedControls();
  }

  function removeSelectedFile(index) {
    if (busy || cutoutBusy || pendingCutout) return;
    const removed = selectedFiles.splice(index, 1)[0];
    selectedFileNames.splice(index, 1);
    if (!removed) return;
    renderSelectedFiles();
    showToast(appLanguage === 'en' ? `Removed “${removed.name}” from pending uploads.` : `已从待上传列表移除“${removed.name}”。`);
  }

  function stopCutoutWithError(message) {
    if (pendingCutout) {
      window.CueBackgroundRemoval?.cancel?.(pendingCutout.id);
      pendingCutout.sourceBase64 = '';
      if (pendingCutout.originalUrl) URL.revokeObjectURL(pendingCutout.originalUrl);
      if (pendingCutout.resultUrl) URL.revokeObjectURL(pendingCutout.resultUrl);
    }
    pendingCutout = null;
    cutoutBusy = false;
    ui.cutoutModal.classList.add('hidden');
    ui.originalCropModal.classList.add('hidden');
    syncLockedControls();
    showStatus(message || '本机抠图失败，请换一张图片后重试。', 'error');
  }

  function drawCutoutCanvas() {
    if (!pendingCutout || !pendingCutout.image?.complete) return;
    const canvas = ui.cutoutCanvas;
    const image = pendingCutout.image;
    const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (pendingCutout.editReady && pendingCutout.maskCanvas) {
      const overlay = pendingCutout.overlayCanvas || (pendingCutout.overlayCanvas = document.createElement('canvas'));
      if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
        overlay.width = canvas.width;
        overlay.height = canvas.height;
      }
      const overlayContext = overlay.getContext('2d');
      overlayContext.clearRect(0, 0, overlay.width, overlay.height);
      overlayContext.globalCompositeOperation = 'source-over';
      overlayContext.drawImage(pendingCutout.maskCanvas, 0, 0, canvas.width, canvas.height);
      overlayContext.globalCompositeOperation = 'source-in';
      overlayContext.fillStyle = 'rgba(103, 86, 232, .48)';
      overlayContext.fillRect(0, 0, overlay.width, overlay.height);
      context.drawImage(overlay, 0, 0);
      ui.cutoutOriginalLabel.textContent = appLanguage === 'en' ? 'Original · purple area is kept' : '原图 · 紫色区域会保留';
    } else {
      ui.cutoutOriginalLabel.textContent = appLanguage === 'en' ? 'Original · tap the subject to cut it out' : '原图 · 点一下主体即可抠图';
    }
    pendingCutout.points.forEach((point) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      const radius = Math.max(7, Math.min(13, canvas.width / 55));
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = point.label === 1 ? '#20ad7c' : '#df5965';
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = '#fff';
      context.stroke();
      context.fillStyle = '#fff';
      context.font = `bold ${Math.max(10, radius)}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(point.label === 1 ? '+' : '−', x, y);
    });
    if ((cutoutTool === 'erase' || cutoutTool === 'restore') && pendingCutout.editReady && pendingCutout.brushCursor) {
      const rect = canvas.getBoundingClientRect();
      const radius = Math.max(2, cutoutBrushSize * canvas.width / Math.max(1, rect.width) / 2);
      context.beginPath();
      context.arc(pendingCutout.brushCursor.x * canvas.width, pendingCutout.brushCursor.y * canvas.height, radius, 0, Math.PI * 2);
      context.lineWidth = Math.max(2, canvas.width / Math.max(1, rect.width) * 2);
      context.strokeStyle = '#fff';
      context.stroke();
      context.beginPath();
      context.arc(pendingCutout.brushCursor.x * canvas.width, pendingCutout.brushCursor.y * canvas.height, radius, 0, Math.PI * 2);
      context.lineWidth = Math.max(1, canvas.width / Math.max(1, rect.width));
      context.strokeStyle = cutoutTool === 'erase' ? '#d95666' : '#27a982';
      context.stroke();
    }
  }

  function setCutoutTool(tool) {
    cutoutTool = tool;
    const states = [
      [ui.cutoutPositiveMode, 'keep'], [ui.cutoutNegativeMode, 'remove'],
      [ui.cutoutEraseMode, 'erase'], [ui.cutoutRestoreMode, 'restore']
    ];
    states.forEach(([button, name]) => {
      const selected = tool === name;
      button.classList.toggle('button-primary', selected);
      button.classList.toggle('button-outline', !selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    updateCutoutToolAvailability();
    drawCutoutCanvas();
  }

  function updateCutoutToolAvailability() {
    if (!pendingCutout) return;
    const hasForeground = pendingCutout.points.some((point) => point.label === 1);
    ui.cutoutPositiveMode.disabled = cutoutBusy || !pendingCutout.autoReady;
    ui.cutoutNegativeMode.disabled = cutoutBusy || !pendingCutout.autoReady || !hasForeground;
    ui.cutoutEraseMode.disabled = cutoutBusy || !pendingCutout.editReady;
    ui.cutoutRestoreMode.disabled = cutoutBusy || !pendingCutout.editReady;
    ui.cutoutClearPoints.disabled = cutoutBusy || !pendingCutout.autoReady;
    ui.cutoutBrushSize.disabled = cutoutBusy || !pendingCutout.editReady;
    ui.cutoutUndo.disabled = cutoutBusy || !pendingCutout.editReady || !pendingCutout.undoStack?.length;
    ui.cutoutRedo.disabled = cutoutBusy || !pendingCutout.editReady || !pendingCutout.redoStack?.length;
    ui.cutoutOutlineEnabled.disabled = cutoutBusy || !pendingCutout.editReady;
    ui.cutoutOutlineWidth.disabled = cutoutBusy || !pendingCutout.editReady || !cutoutOutlineEnabled;
  }

  function startCutout(index, fromGallery = false) {
    if (busy || cutoutBusy || pendingCutout) return;
    const original = selectedFiles[index];
    if (!original || !window.CueBackgroundRemoval) {
      showToast('当前环境暂不支持本机抠图。');
      return;
    }
    const requestId = `cutout-${Date.now()}-${++cutoutSequence}`;
    const originalUrl = URL.createObjectURL(original);
    const image = new Image();
    pendingCutout = { id: requestId, index, original, fromGallery, originalUrl, resultUrl: '', resultFile: null, modelResultFile: null, autoResultFile: null, sourceBase64: '', points: [], autoReady: false, samReady: false, samPreparing: false, resultMode: 'auto', editReady: false, image, sequence: 0, outputCanvas: null, outlineCanvas: null, sourceCanvas: null, maskCanvas: null, baseMaskCanvas: null, overlayCanvas: null, undoStack: [], redoStack: [], activeStroke: null, brushCursor: null };
    cutoutBusy = true;
    cutoutOutlineEnabled = false;
    ui.cutoutOutlineEnabled.checked = false;
    ui.cutoutOutlineWidth.value = String(cutoutOutlineSize);
    ui.cutoutOutlineWidthValue.textContent = `${cutoutOutlineSize} px`;
    setCutoutTool('keep');
    ui.cutoutOriginalName.textContent = original.name;
    ui.cutoutResultName.textContent = appLanguage === 'en' ? 'Generating the automatic transparent mask…' : '正在自动生成透明掩码…';
    ui.cutoutResultPreview.removeAttribute('src');
    ui.cutoutCutoutOnly.disabled = true;
    ui.cutoutProgress.textContent = appLanguage === 'en' ? 'Running the local automatic cutout…' : '正在本机自动抠图…';
    ui.cutoutModalError.classList.add('hidden');
    ui.cutoutModal.classList.remove('hidden');
    syncLockedControls();
    showStatus(`正在本机准备“${original.name}”… 图片不会上传到任何服务。`, 'info');
    image.onload = drawCutoutCanvas;
    image.onerror = () => stopCutoutWithError('无法在此设备预览该图片；请尝试 PNG、JPG 或 WebP。');
    image.src = originalUrl;

    const reader = new FileReader();
    reader.onerror = () => stopCutoutWithError('无法读取所选图片，请重新选择后重试。');
    reader.onload = () => {
      if (!pendingCutout || pendingCutout.id !== requestId) return;
      const dataUrl = String(reader.result || '');
      const separator = dataUrl.indexOf(',');
      if (separator < 0) return stopCutoutWithError('无法读取所选图片，请重新选择后重试。');
      try {
        const encodedImage = dataUrl.slice(separator + 1);
        pendingCutout.sourceBase64 = encodedImage;
        window.CueBackgroundRemoval.autoCutout(requestId, encodedImage);
      } catch {
        stopCutoutWithError('无法启动本机自动抠图，请关闭后重试。');
      }
    };
    reader.readAsDataURL(original);
  }

  function addCutoutPoint(event) {
    if (!pendingCutout || !pendingCutout.image?.complete || !pendingCutout.autoReady || cutoutBusy) return;
    if (cutoutTool === 'erase' || cutoutTool === 'restore') return;
    const rect = ui.cutoutCanvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    if (pendingCutout.points.length >= 16) {
      showToast('最多添加 16 个提示点；请清除部分点后再试。');
      return;
    }
    pendingCutout.points.push({ x, y, label: cutoutTool === 'remove' ? 0 : 1 });
    drawCutoutCanvas();
    updateCutoutToolAvailability();
    pendingCutout.resultMode = 'refine';
    pendingCutout.sequence += 1;
    cutoutBusy = true;
    ui.cutoutModalError.classList.add('hidden');
    if (!pendingCutout.samReady) {
      pendingCutout.samPreparing = true;
      ui.cutoutProgress.textContent = appLanguage === 'en'
        ? 'Loading MobileSAM on-device for point refinement…'
        : '正在本机按需加载 MobileSAM，准备点选精修…';
      updateCutoutToolAvailability();
      syncLockedControls();
      const state = pendingCutout;
      const fail = (message) => {
        if (pendingCutout !== state) return;
        state.samPreparing = false;
        cutoutBusy = false;
        ui.cutoutModalError.textContent = message;
        ui.cutoutModalError.classList.remove('hidden');
        updateCutoutToolAvailability();
        syncLockedControls();
      };
      const sendToMobileSam = (encodedImage) => {
        if (pendingCutout !== state) return;
        state.sourceBase64 = encodedImage;
        try {
          window.CueBackgroundRemoval.prepare(state.id, encodedImage);
        } catch {
          fail(appLanguage === 'en' ? 'Could not start MobileSAM; try again.' : '无法启动 MobileSAM，请重试。');
        }
      };
      if (state.sourceBase64) {
        sendToMobileSam(state.sourceBase64);
      } else {
        const reader = new FileReader();
        reader.onerror = () => fail(appLanguage === 'en'
          ? 'Could not read the locally cached source image; choose the photo again to refine it.'
          : '无法读取本机缓存的原图；请重新选择后再精修。');
        reader.onload = () => {
          if (pendingCutout !== state) return;
          const dataUrl = String(reader.result || '');
          const separator = dataUrl.indexOf(',');
          if (separator < 0) return fail(appLanguage === 'en'
            ? 'Could not read the locally cached source image; choose the photo again to refine it.'
            : '无法读取本机缓存的原图；请重新选择后再精修。');
          sendToMobileSam(dataUrl.slice(separator + 1));
        };
        reader.readAsDataURL(state.original);
      }
      return;
    }
    updateCutoutToolAvailability();
    ui.cutoutProgress.textContent = cutoutTool === 'remove'
      ? (appLanguage === 'en' ? 'Refining with the background point…' : '正在根据背景点修正…')
      : (pendingCutout.points.filter((point) => point.label === 1).length === 1
        ? (appLanguage === 'en' ? 'Cutting out the selected subject…' : '正在抠出刚才点选的主体…')
        : (appLanguage === 'en' ? 'Refining the kept subject…' : '正在修正要保留的主体…'));
    syncLockedControls();
    try {
      window.CueBackgroundRemoval.predict(pendingCutout.id, JSON.stringify(pendingCutout.points));
    } catch {
      cutoutBusy = false;
      ui.cutoutModalError.textContent = '点选请求未能启动；请重试。';
      ui.cutoutModalError.classList.remove('hidden');
      updateCutoutToolAvailability();
      syncLockedControls();
    }
  }

  function pointOnCutoutEditor(event) {
    const rect = ui.cutoutCanvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * pendingCutout.maskCanvas.width,
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * pendingCutout.maskCanvas.height
    };
  }

  function brushDiameterInImage(state) {
    const rect = ui.cutoutCanvas.getBoundingClientRect();
    return Math.max(1, cutoutBrushSize * state.maskCanvas.width / Math.max(1, rect.width));
  }

  function applyBrushStroke(context, stroke) {
    if (!stroke.points.length) return;
    context.save();
    context.globalCompositeOperation = stroke.tool === 'erase' ? 'destination-out' : 'source-over';
    context.globalAlpha = 1;
    context.strokeStyle = '#fff';
    context.fillStyle = '#fff';
    context.lineWidth = stroke.diameter;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      context.arc(point.x, point.y, stroke.diameter / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
    }
    context.restore();
  }

  function repaintCutoutMask(state) {
    const context = state.maskCanvas.getContext('2d');
    context.clearRect(0, 0, state.maskCanvas.width, state.maskCanvas.height);
    context.drawImage(state.baseMaskCanvas, 0, 0);
    state.undoStack.forEach((stroke) => applyBrushStroke(context, stroke));
  }

  function paintCutoutMask(point) {
    const state = pendingCutout;
    if (!state?.maskCanvas || !state.activeStroke) return;
    state.activeStroke.points.push(point);
    applyBrushStroke(state.maskCanvas.getContext('2d'), { ...state.activeStroke, points: state.activeStroke.points.slice(-2) });
  }

  function finishCutoutBrush() {
    if (!pendingCutout?.brushActive) return;
    const state = pendingCutout;
    state.brushActive = false;
    state.brushPointerId = null;
    if (state.activeStroke?.points.length) {
      state.undoStack.push(state.activeStroke);
      if (state.undoStack.length > 40) {
        const oldest = state.undoStack.shift();
        applyBrushStroke(state.baseMaskCanvas.getContext('2d'), oldest);
      }
      state.redoStack = [];
    }
    state.activeStroke = null;
    drawCutoutCanvas();
    updateCutoutToolAvailability();
    saveCutoutBrushResult(state);
  }

  function changeCutoutHistory(direction) {
    const state = pendingCutout;
    if (!state?.editReady || cutoutBusy) return;
    const from = direction === 'undo' ? state.undoStack : state.redoStack;
    const to = direction === 'undo' ? state.redoStack : state.undoStack;
    const stroke = from.pop();
    if (!stroke) return;
    to.push(stroke);
    repaintCutoutMask(state);
    drawCutoutCanvas();
    saveCutoutBrushResult(state);
  }

  function drawCutoutOutline(state) {
    const width = state.maskCanvas.width;
    const height = state.maskCanvas.height;
    const outline = state.outlineCanvas || (state.outlineCanvas = document.createElement('canvas'));
    if (outline.width !== width || outline.height !== height) {
      outline.width = width;
      outline.height = height;
    }
    const context = outline.getContext('2d');
    context.clearRect(0, 0, width, height);
    const previewWidth = Math.max(1, ui.cutoutCanvas.getBoundingClientRect().width);
    const radius = Math.max(1, cutoutOutlineSize * width / previewWidth);
    context.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 16; i += 1) {
      const angle = (Math.PI * 2 * i) / 16;
      context.drawImage(state.maskCanvas, Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    return outline;
  }

  function saveCutoutBrushResult(state) {
    if (!state.outputCanvas || !state.sourceCanvas || !state.maskCanvas) return;
    cutoutBusy = true;
    updateCutoutToolAvailability();
    ui.cutoutProgress.textContent = appLanguage === 'en' ? 'Updating the transparent preview…' : '正在更新透明预览…';
    const context = state.outputCanvas.getContext('2d');
    context.clearRect(0, 0, state.outputCanvas.width, state.outputCanvas.height);
    context.globalCompositeOperation = 'source-over';
    context.drawImage(state.sourceCanvas, 0, 0);
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(state.maskCanvas, 0, 0);
    context.globalCompositeOperation = 'source-over';
    let renderCanvas = state.outputCanvas;
    let outlineError = '';
    if (cutoutOutlineEnabled) {
      try {
        const outline = drawCutoutOutline(state);
        outline.getContext('2d').drawImage(state.outputCanvas, 0, 0);
        renderCanvas = outline;
      } catch {
        outlineError = appLanguage === 'en' ? 'The outline could not be rendered on this device; previewing the cutout without it.' : '此设备无法生成描边；当前预览将使用无描边的透明抠图。';
        cutoutOutlineEnabled = false;
        ui.cutoutOutlineEnabled.checked = false;
      }
    }
    renderCanvas.toBlob((blob) => {
      if (!pendingCutout || pendingCutout !== state) return;
      cutoutBusy = false;
      if (!blob) {
        ui.cutoutModalError.textContent = appLanguage === 'en' ? 'Could not save this brush edit; try again.' : '无法生成笔刷修改结果，请重试。';
        ui.cutoutModalError.classList.remove('hidden');
        updateCutoutToolAvailability();
        syncLockedControls();
        return;
      }
      const stem = state.original.name.replace(/\.[^.]+$/, '') || state.original.name;
      const resultFile = new File([blob], `${stem}-no-bg.png`, { type: 'image/png', lastModified: Date.now() });
      if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
      state.resultFile = resultFile;
      state.resultUrl = URL.createObjectURL(resultFile);
      ui.cutoutResultPreview.src = state.resultUrl;
      ui.cutoutResultName.textContent = `${resultFile.name} · ${formatBytes(resultFile.size)}`;
      const total = selectedFiles.reduce((sum, file, index) => sum + (index === state.index ? 0 : file.size), 0) + resultFile.size;
      ui.cutoutCutoutOnly.disabled = resultFile.size > MAX_FILE_BYTES || total > MAX_BATCH_BYTES;
      ui.cutoutModalError.classList.toggle('hidden', !ui.cutoutCutoutOnly.disabled && !outlineError);
      if (ui.cutoutCutoutOnly.disabled) ui.cutoutModalError.textContent = appLanguage === 'en' ? 'Edited PNG exceeds the upload size limit; you can still choose the original or save neither.' : '修改后的 PNG 超出上传大小限制；仍可选择原图或都不保存。';
      else if (outlineError) ui.cutoutModalError.textContent = outlineError;
      ui.cutoutProgress.textContent = appLanguage === 'en' ? 'Preview updated. Continue editing or choose which version to use.' : '透明预览已更新；可继续修整，或选择要使用的版本。';
      updateCutoutToolAvailability();
      syncLockedControls();
    }, 'image/png');
  }

  function handleCutoutPointerDown(event) {
    if (cutoutTool !== 'erase' && cutoutTool !== 'restore') return addCutoutPoint(event);
    if (!pendingCutout?.editReady || cutoutBusy) return;
    event.preventDefault();
    const state = pendingCutout;
    const point = pointOnCutoutEditor(event);
    state.brushActive = true;
    state.brushPointerId = event.pointerId;
    state.brushCursor = { x: point.x / state.maskCanvas.width, y: point.y / state.maskCanvas.height };
    state.activeStroke = { tool: cutoutTool, diameter: brushDiameterInImage(state), points: [] };
    ui.cutoutCanvas.setPointerCapture?.(event.pointerId);
    paintCutoutMask(point);
    drawCutoutCanvas();
  }

  function handleCutoutPointerMove(event) {
    const state = pendingCutout;
    if (!state?.editReady || (cutoutTool !== 'erase' && cutoutTool !== 'restore')) return;
    if (state.brushActive && state.brushPointerId === event.pointerId && !cutoutBusy) {
      event.preventDefault();
      const point = pointOnCutoutEditor(event);
      state.brushCursor = { x: point.x / state.maskCanvas.width, y: point.y / state.maskCanvas.height };
      paintCutoutMask(point);
      drawCutoutCanvas();
      return;
    }
    if (!state.brushActive && !cutoutBusy) {
      const rect = ui.cutoutCanvas.getBoundingClientRect();
      state.brushCursor = {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      };
      drawCutoutCanvas();
    }
  }

  function handleCutoutPointerEnd(event) {
    if (!pendingCutout?.brushActive || pendingCutout.brushPointerId !== event.pointerId) return;
    finishCutoutBrush();
  }

  function initializeCutoutBrushEditor(state, resultFile) {
    const image = new Image();
    const imageUrl = URL.createObjectURL(resultFile);
    image.onload = () => {
      URL.revokeObjectURL(imageUrl);
      if (!pendingCutout || pendingCutout !== state || state.resultFile !== resultFile) return;
      try {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        state.outputCanvas = document.createElement('canvas');
        state.outputCanvas.width = width;
        state.outputCanvas.height = height;
        state.sourceCanvas = document.createElement('canvas');
        state.sourceCanvas.width = width;
        state.sourceCanvas.height = height;
        state.maskCanvas = document.createElement('canvas');
        state.maskCanvas.width = width;
        state.maskCanvas.height = height;
        state.sourceCanvas.getContext('2d').drawImage(state.image, 0, 0, width, height);
        const maskContext = state.maskCanvas.getContext('2d');
        maskContext.drawImage(image, 0, 0, width, height);
        const mask = maskContext.getImageData(0, 0, width, height);
        for (let i = 0; i < mask.data.length; i += 4) {
          mask.data[i] = 255;
          mask.data[i + 1] = 255;
          mask.data[i + 2] = 255;
        }
        maskContext.putImageData(mask, 0, 0);
        state.baseMaskCanvas = document.createElement('canvas');
        state.baseMaskCanvas.width = width;
        state.baseMaskCanvas.height = height;
        state.baseMaskCanvas.getContext('2d').drawImage(state.maskCanvas, 0, 0);
        state.undoStack = [];
        state.redoStack = [];
        state.editReady = true;
        drawCutoutCanvas();
        updateCutoutToolAvailability();
        if (cutoutOutlineEnabled) saveCutoutBrushResult(state);
      } catch {
        state.editReady = false;
        ui.cutoutModalError.textContent = appLanguage === 'en' ? 'Brush editing is unavailable for this image; tap keep/remove points instead.' : '此图片暂不能使用笔刷修整；仍可用主体点/背景点修正。';
        ui.cutoutModalError.classList.remove('hidden');
      }
    };
    image.onerror = () => URL.revokeObjectURL(imageUrl);
    image.src = imageUrl;
  }

  function clearCutoutPoints() {
    if (!pendingCutout || cutoutBusy) return;
    const state = pendingCutout;
    if (!state.autoResultFile) return;
    window.CueBackgroundRemoval?.cancel?.(state.id);
    state.points = [];
    state.samReady = false;
    state.samPreparing = false;
    state.resultMode = 'auto';
    state.resultFile = state.autoResultFile;
    state.modelResultFile = state.autoResultFile;
    state.editReady = false;
    state.outputCanvas = null;
    state.outlineCanvas = null;
    state.sourceCanvas = null;
    state.maskCanvas = null;
    state.baseMaskCanvas = null;
    state.overlayCanvas = null;
    state.undoStack = [];
    state.redoStack = [];
    state.activeStroke = null;
    state.brushCursor = null;
    cutoutOutlineEnabled = false;
    ui.cutoutOutlineEnabled.checked = false;
    state.sequence += 1;
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = URL.createObjectURL(state.autoResultFile);
    ui.cutoutResultPreview.src = state.resultUrl;
    ui.cutoutResultName.textContent = `${state.autoResultFile.name} · ${formatBytes(state.autoResultFile.size)}`;
    ui.cutoutCutoutOnly.disabled = state.autoResultFile.size > MAX_FILE_BYTES;
    setCutoutTool('keep');
    ui.cutoutProgress.textContent = appLanguage === 'en' ? 'Automatic mask restored. Tap a point to refine again.' : '已恢复自动抠图；可重新点选以精修。';
    drawCutoutCanvas();
    updateCutoutToolAvailability();
    initializeCutoutBrushEditor(state, state.autoResultFile);
  }

  function closeCutoutPreview() {
    resetOriginalCropGesture();
    originalCropPreviewSource = null;
    if (pendingCutout) {
      window.CueBackgroundRemoval?.cancel?.(pendingCutout.id);
      pendingCutout.sourceBase64 = '';
      if (pendingCutout.originalUrl) URL.revokeObjectURL(pendingCutout.originalUrl);
      if (pendingCutout.resultUrl) URL.revokeObjectURL(pendingCutout.resultUrl);
    }
    pendingCutout = null;
    cutoutBusy = false;
    ui.cutoutModal.classList.add('hidden');
    ui.originalCropModal.classList.add('hidden');
    ui.cutoutCanvas.width = 1;
    ui.cutoutCanvas.height = 1;
    ui.cutoutResultPreview.removeAttribute('src');
    ui.cutoutCutoutOnly.disabled = true;
    ui.cutoutModalError.classList.add('hidden');
    ui.cutoutPositiveMode.disabled = true;
    ui.cutoutNegativeMode.disabled = true;
    ui.cutoutEraseMode.disabled = true;
    ui.cutoutRestoreMode.disabled = true;
    ui.cutoutClearPoints.disabled = true;
    ui.cutoutOutlineEnabled.disabled = true;
    ui.cutoutOutlineWidth.disabled = true;
    syncLockedControls();
  }

  function originalCropRect() {
    const image = pendingCutout?.image;
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return null;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const side = Math.min(width, height) / originalCropZoom;
    originalCropCenterX = Math.max(side / 2, Math.min(width - side / 2, originalCropCenterX));
    originalCropCenterY = Math.max(side / 2, Math.min(height - side / 2, originalCropCenterY));
    return { x: originalCropCenterX - side / 2, y: originalCropCenterY - side / 2, side };
  }

  function appendOriginalCropShape(context, x, y, size) {
    if (originalCropShape === 'circle') {
      context.moveTo(x + size, y + size / 2);
      context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    } else {
      const radius = size * 0.18;
      context.moveTo(x + radius, y);
      context.lineTo(x + size - radius, y);
      context.quadraticCurveTo(x + size, y, x + size, y + radius);
      context.lineTo(x + size, y + size - radius);
      context.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
      context.lineTo(x + radius, y + size);
      context.quadraticCurveTo(x, y + size, x, y + size - radius);
      context.lineTo(x, y + radius);
      context.quadraticCurveTo(x, y, x + radius, y);
    }
    context.closePath();
  }

  function clipOriginalCropShape(context, size) {
    context.beginPath();
    appendOriginalCropShape(context, 0, 0, size);
    context.clip();
  }

  function drawOriginalCropFrame(canvas, size) {
    const image = pendingCutout?.image;
    const crop = originalCropRect();
    if (!image || !crop) return false;
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.clearRect(0, 0, size, size);
    context.save();
    clipOriginalCropShape(context, size);
    const scale = size / crop.side;
    context.drawImage(image,
      -crop.x * scale,
      -crop.y * scale,
      image.naturalWidth * scale,
      image.naturalHeight * scale);
    context.restore();
    return true;
  }

  function renderOriginalCropLabels() {
    const english = appLanguage === 'en';
    const circle = originalCropShape === 'circle';
    ui.originalCropKicker.textContent = english ? 'ORIGINAL ONLY · ON-DEVICE CROP' : '仅用原图 · 本机裁切';
    ui.originalCropTitle.textContent = english ? 'Choose the image shape' : '选择图片边角';
    ui.originalCropDescription.textContent = english
      ? 'The full source stays visible at its original aspect ratio. The selected mask is live with the outside dimmed; drag with one finger or pinch with two fingers to reframe the crop.'
      : '完整原图按比例显示；所选蒙版实时可见，选区外压暗。可单指拖动、双指捏合缩放图片，调整圆形/圆角方形裁切。';
    ui.originalCropShapes[0].setAttribute('aria-label', english ? 'Rounded square' : '圆角方形');
    ui.originalCropShapes[1].setAttribute('aria-label', english ? 'Circle' : '圆形');
    ui.originalCropRoundedLabel.textContent = english ? 'Rounded square' : '圆角方形';
    ui.originalCropRoundedHelp.textContent = english ? 'Live mask preview' : '实时预览选区';
    ui.originalCropCircleLabel.textContent = english ? 'Circle' : '圆形';
    ui.originalCropCircleHelp.textContent = english ? 'Live circle preview' : '圆形实时预览';
    ui.originalCropZoomLabel.textContent = english ? 'Zoom' : '缩放';
    ui.originalCropPreview.setAttribute('aria-label', english
      ? 'Crop preview; drag with one finger, pinch with two fingers, or use arrow keys to reframe.'
      : '裁切预览；可单指拖动、双指捏合缩放，也可用方向键微调。');
    ui.originalCropApply.textContent = english
      ? `Apply ${circle ? 'circle' : 'rounded-square'} crop`
      : `采用${circle ? '圆形' : '圆角方形'}裁切`;
  }

  function createOriginalCropPreviewSource(image) {
    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, 1024 / longestSide);
    const preview = document.createElement('canvas');
    preview.width = Math.max(1, Math.round(image.naturalWidth * scale));
    preview.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = preview.getContext('2d');
    if (!context) return image;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, preview.width, preview.height);
    return preview;
  }

  function scheduleOriginalCropPreview() {
    if (originalCropRenderFrame || ui.originalCropModal.classList.contains('hidden')) return;
    originalCropRenderFrame = requestAnimationFrame(() => {
      originalCropRenderFrame = 0;
      drawOriginalCropPreview();
    });
  }

  function updateOriginalCropZoomControl() {
    const formatted = originalCropZoom.toFixed(2).replace(/0$/, '');
    ui.originalCropZoom.value = String(originalCropZoom);
    ui.originalCropZoomValue.value = `${formatted}×`;
    ui.originalCropZoomValue.textContent = `${formatted}×`;
  }

  function originalCropCanvasPoint(clientX, clientY) {
    const canvas = ui.originalCropPreview;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (clientX - rect.left) * canvas.width / rect.width,
      y: (clientY - rect.top) * canvas.height / rect.height
    };
  }

  function resetOriginalCropGesture() {
    const canvas = ui.originalCropPreview;
    const pointerIds = [...originalCropPointers.keys()];
    originalCropPointers.clear();
    originalCropGesture = null;
    document.documentElement.classList.remove('crop-gesture-active');
    pointerIds.forEach((pointerId) => {
      try {
        if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
      } catch { /* Capture may already have ended during cancellation. */ }
    });
  }

  function startOriginalCropGesture() {
    const entries = [...originalCropPointers.entries()].slice(0, 2);
    if (!entries.length) { originalCropGesture = null; return; }
    const canvas = ui.originalCropPreview;
    const first = originalCropCanvasPoint(entries[0][1].x, entries[0][1].y);
    if (!first) return;
    if (entries.length === 1) {
      originalCropGesture = {
        mode: 'pan', pointerId: entries[0][0],
        startX: first.x, startY: first.y,
        startCenterX: originalCropCenterX, startCenterY: originalCropCenterY
      };
      return;
    }
    const second = originalCropCanvasPoint(entries[1][1].x, entries[1][1].y);
    if (!second) return;
    const image = pendingCutout?.image;
    if (!image?.naturalWidth || !image?.naturalHeight) return;
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const fitScale = 512 / Math.max(image.naturalWidth, image.naturalHeight);
    const imageScale = fitScale * originalCropZoom;
    originalCropGesture = {
      mode: 'pinch', pointerIds: [entries[0][0], entries[1][0]],
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      startZoom: originalCropZoom,
      anchorX: originalCropCenterX + (midpoint.x - canvas.width / 2) / imageScale,
      anchorY: originalCropCenterY + (midpoint.y - canvas.height / 2) / imageScale
    };
  }

  function updateOriginalCropGesture() {
    const gesture = originalCropGesture;
    const canvas = ui.originalCropPreview;
    if (!gesture) return;
    if (gesture.mode === 'pan') {
      const pointer = originalCropPointers.get(gesture.pointerId);
      const point = pointer && originalCropCanvasPoint(pointer.x, pointer.y);
      const crop = originalCropRect();
      if (!point || !crop) return;
      const scale = crop.side / Math.min(canvas.width, canvas.height);
      originalCropCenterX = gesture.startCenterX - (point.x - gesture.startX) * scale;
      originalCropCenterY = gesture.startCenterY - (point.y - gesture.startY) * scale;
      originalCropRect();
      scheduleOriginalCropPreview();
      return;
    }
    const firstPointer = originalCropPointers.get(gesture.pointerIds[0]);
    const secondPointer = originalCropPointers.get(gesture.pointerIds[1]);
    const first = firstPointer && originalCropCanvasPoint(firstPointer.x, firstPointer.y);
    const second = secondPointer && originalCropCanvasPoint(secondPointer.x, secondPointer.y);
    const image = pendingCutout?.image;
    if (!first || !second || !image?.naturalWidth || !image?.naturalHeight) return;
    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
    const requestedZoom = gesture.startZoom * distance / gesture.startDistance;
    originalCropZoom = Math.round(Math.max(1, Math.min(3, requestedZoom)) * 100) / 100;
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const imageScale = (512 / Math.max(image.naturalWidth, image.naturalHeight)) * originalCropZoom;
    originalCropCenterX = gesture.anchorX - (midpoint.x - canvas.width / 2) / imageScale;
    originalCropCenterY = gesture.anchorY - (midpoint.y - canvas.height / 2) / imageScale;
    originalCropRect();
    updateOriginalCropZoomControl();
    scheduleOriginalCropPreview();
  }

  function drawOriginalCropPreview() {
    const image = pendingCutout?.image;
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return;
    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const fitScale = 512 / longestSide;
    const width = Math.max(1, Math.round(image.naturalWidth * fitScale));
    const height = Math.max(1, Math.round(image.naturalHeight * fitScale));
    const canvas = ui.originalCropPreview;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'low';
    context.clearRect(0, 0, width, height);
    const imageScale = fitScale * originalCropZoom;
    const previewSource = originalCropPreviewSource || image;
    context.drawImage(previewSource,
      width / 2 - originalCropCenterX * imageScale,
      height / 2 - originalCropCenterY * imageScale,
      image.naturalWidth * imageScale,
      image.naturalHeight * imageScale);

    const frameSide = Math.min(width, height);
    const frameX = (width - frameSide) / 2;
    const frameY = (height - frameSide) / 2;
    context.beginPath();
    context.rect(0, 0, width, height);
    appendOriginalCropShape(context, frameX, frameY, frameSide);
    context.fillStyle = 'rgba(15, 18, 28, 0.48)';
    context.fill('evenodd');
    context.beginPath();
    appendOriginalCropShape(context, frameX, frameY, frameSide);
    context.strokeStyle = 'rgba(255, 255, 255, 0.96)';
    context.lineWidth = 2.5;
    context.stroke();
  }

  function openOriginalCrop() {
    const state = pendingCutout;
    if (!state?.image?.complete || !state.image.naturalWidth || !state.image.naturalHeight) {
      ui.cutoutModalError.textContent = appLanguage === 'en'
        ? 'The original photo is not ready to crop. Please wait or choose it again.'
        : '原图尚未准备好，暂时无法裁切；请稍等或重新选择。';
      ui.cutoutModalError.classList.remove('hidden');
      return;
    }
    originalCropShape = 'rounded';
    originalCropZoom = 1;
    originalCropCenterX = state.image.naturalWidth / 2;
    originalCropCenterY = state.image.naturalHeight / 2;
    resetOriginalCropGesture();
    originalCropPreviewSource = createOriginalCropPreviewSource(state.image);
    originalCropRequest += 1;
    updateOriginalCropZoomControl();
    ui.originalCropError.classList.add('hidden');
    ui.originalCropApply.disabled = false;
    ui.originalCropBack.disabled = false;
    ui.originalCropClose.disabled = false;
    ui.originalCropShapes.forEach((button) => {
      const selected = button.dataset.originalCropShape === originalCropShape;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    renderOriginalCropLabels();
    drawOriginalCropPreview();
    ui.cutoutModal.classList.add('hidden');
    ui.originalCropModal.classList.remove('hidden');
    requestAnimationFrame(() => ui.originalCropApply.focus());
  }

  function returnToCutoutPreview() {
    if (!pendingCutout || ui.originalCropApply.disabled) return false;
    originalCropRequest += 1;
    resetOriginalCropGesture();
    originalCropPreviewSource = null;
    ui.originalCropModal.classList.add('hidden');
    ui.cutoutModal.classList.remove('hidden');
    ui.cutoutOriginalOnly.focus();
    return true;
  }

  function setOriginalCropBusy(value) {
    ui.originalCropApply.disabled = value;
    ui.originalCropBack.disabled = value;
    ui.originalCropClose.disabled = value;
    ui.originalCropZoom.disabled = value;
    ui.originalCropShapes.forEach((button) => { button.disabled = value; });
  }

  function applyOriginalCrop() {
    const state = pendingCutout;
    if (!state?.image?.complete || !state.image.naturalWidth || !state.image.naturalHeight || ui.originalCropApply.disabled) return;
    if (selectedFiles[state.index] !== state.original) {
      ui.originalCropError.textContent = appLanguage === 'en'
        ? 'The pending photo changed; this crop was not applied.'
        : '待上传图片已变化；本次裁切未采用。';
      ui.originalCropError.classList.remove('hidden');
      return;
    }
    const request = ++originalCropRequest;
    resetOriginalCropGesture();
    const stateId = state.id;
    const fromGallery = state.fromGallery;
    const shape = originalCropShape;
    const image = state.image;
    const size = Math.max(1, Math.min(2048, Math.floor(Math.min(image.naturalWidth, image.naturalHeight))));
    const output = document.createElement('canvas');
    if (!drawOriginalCropFrame(output, size)) return;
    ui.originalCropError.classList.add('hidden');
    setOriginalCropBusy(true);
    output.toBlob((blob) => {
      if (request !== originalCropRequest || !pendingCutout || pendingCutout.id !== stateId) return;
      setOriginalCropBusy(false);
      if (!blob) {
        ui.originalCropError.textContent = appLanguage === 'en'
          ? 'Could not create the local crop. Please try again.'
          : '无法生成本机裁切图，请重试。';
        ui.originalCropError.classList.remove('hidden');
        return;
      }
      const totalWithoutOriginal = selectedFiles.reduce((sum, file, index) => sum + (index === state.index ? 0 : file.size), 0);
      if (blob.size > MAX_FILE_BYTES || totalWithoutOriginal + blob.size > MAX_BATCH_BYTES) {
        ui.originalCropError.textContent = appLanguage === 'en'
          ? 'The cropped PNG exceeds the per-file or batch size limit. Zoom in less and try again.'
          : '裁切后的 PNG 超过单文件或批次大小限制；请缩小原图后重试。';
        ui.originalCropError.classList.remove('hidden');
        return;
      }
      const base = fileStem(selectedFileNames[state.index] || state.original.name);
      const suffix = shape === 'circle' ? 'circle' : 'rounded';
      const file = new File([blob], `${base}-${suffix}.png`, { type: 'image/png', lastModified: Date.now() });
      selectedFiles[state.index] = file;
      selectedFileNames[state.index] = file.name;
      closeCutoutPreview();
      renderSelectedFiles();
      showStatus(appLanguage === 'en'
        ? `Added the ${shape === 'circle' ? 'circle' : 'rounded-square'} crop of “${state.original.name}” to the local upload queue.`
        : `已将“${state.original.name}”的${shape === 'circle' ? '圆形' : '圆角方形'}原图裁切版加入本机待上传列表。`, 'success');
      if (fromGallery) setActiveScreen(token && selectedOwner ? 'library' : 'settings');
    }, 'image/png');
  }

  function applyCutoutChoice(choice) {
    if (!pendingCutout || (cutoutBusy && choice === 'cutout')) return;
    if (choice === 'cutout' && !pendingCutout.resultFile) return;
    const { index, original, resultFile, fromGallery } = pendingCutout;
    if (selectedFiles[index] !== original) {
      closeCutoutPreview();
      showStatus('待上传图片已变化；抠图结果未采用。', 'error');
      return;
    }
    if (choice === 'cutout') {
      const totalWithoutOriginal = selectedFiles.reduce((sum, file, fileIndex) => sum + (fileIndex === index ? 0 : file.size), 0);
      if (resultFile.size > MAX_FILE_BYTES || totalWithoutOriginal + resultFile.size > MAX_BATCH_BYTES) {
        ui.cutoutModalError.textContent = '抠图文件超出单文件或批次大小限制，无法采用。';
        ui.cutoutModalError.classList.remove('hidden');
        return;
      }
      const priorBase = fileStem(selectedFileNames[index] || original.name);
      selectedFiles[index] = resultFile;
      selectedFileNames[index] = `${priorBase}-no-bg.png`;
      closeCutoutPreview();
      renderSelectedFiles();
      showStatus(`已选择透明版“${resultFile.name}”；原图仍未改写，确认后可上传。`, 'success');
      if (fromGallery) setActiveScreen(token && selectedOwner ? 'library' : 'settings');
      return;
    }
    if (choice === 'original') {
      openOriginalCrop();
      return;
    }
    selectedFiles.splice(index, 1);
    selectedFileNames.splice(index, 1);
    closeCutoutPreview();
    renderSelectedFiles();
    showStatus('原图和抠图结果都未保存：这张图片已从待上传列表移除。', 'success');
  }

  window.onCueCutoutProgress = (requestId, message) => {
    if (pendingCutout && pendingCutout.id === requestId) ui.cutoutProgress.textContent = message;
  };

  window.onCueCutoutReady = (requestId, width, height, error) => {
    if (!pendingCutout || pendingCutout.id !== requestId) return;
    const state = pendingCutout;
    state.samPreparing = false;
    if (error) {
      state.samReady = false;
      cutoutBusy = false;
      ui.cutoutProgress.textContent = appLanguage === 'en' ? 'MobileSAM refinement could not be prepared.' : 'MobileSAM 精修模型准备失败。';
      ui.cutoutModalError.textContent = error;
      ui.cutoutModalError.classList.remove('hidden');
      updateCutoutToolAvailability();
      syncLockedControls();
      return;
    }
    state.sourceBase64 = '';
    state.samReady = true;
    state.resultMode = 'refine';
    cutoutBusy = true;
    updateCutoutToolAvailability();
    drawCutoutCanvas();
    ui.cutoutProgress.textContent = appLanguage === 'en'
      ? `MobileSAM is ready (${width} × ${height}); applying your refinement points…`
      : `MobileSAM 已就绪（${width} × ${height}），正在应用精修点…`;
    updateCutoutToolAvailability();
    syncLockedControls();
    try {
      window.CueBackgroundRemoval.predict(requestId, JSON.stringify(state.points));
    } catch {
      cutoutBusy = false;
      state.samReady = false;
      ui.cutoutModalError.textContent = appLanguage === 'en' ? 'Could not start the cutout; tap the subject again.' : '未能启动抠图；请再点一次主体。';
      ui.cutoutModalError.classList.remove('hidden');
      ui.cutoutProgress.textContent = appLanguage === 'en' ? 'Tap the subject to try again.' : '再点一次主体即可重试。';
      updateCutoutToolAvailability();
      syncLockedControls();
    }
  };

  window.onCueCutoutResult = (requestId, encodedPng, error) => {
    if (!pendingCutout || pendingCutout.id !== requestId) return;
    const state = pendingCutout;
    const resultMode = state.resultMode || 'auto';
    cutoutBusy = false;
    if (error || !encodedPng) {
      state.samPreparing = false;
      ui.cutoutModalError.textContent = error || (appLanguage === 'en' ? 'No cutout preview was produced. Tap the subject to retry.' : '未能生成抠图预览；可再点一次主体重试。');
      ui.cutoutModalError.classList.remove('hidden');
      ui.cutoutProgress.textContent = resultMode === 'auto'
        ? (appLanguage === 'en' ? 'Automatic cutout failed; you can still keep the original.' : '自动抠图失败；仍可保留原图。')
        : (appLanguage === 'en' ? 'Automatic mask retained; add a point to retry refinement.' : '已保留自动掩码；可再添加提示点重试精修。');
      updateCutoutToolAvailability();
      syncLockedControls();
      return;
    }
    try {
      const binary = atob(encodedPng);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });
      const stem = pendingCutout.original.name.replace(/\.[^.]+$/, '') || pendingCutout.original.name;
      const resultFile = new File([blob], `${stem}-no-bg.png`, { type: 'image/png', lastModified: Date.now() });
      if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
      state.resultFile = resultFile;
      state.modelResultFile = resultFile;
      state.editReady = false;
      if (resultMode === 'auto') {
        state.autoReady = true;
        state.autoResultFile = resultFile;
      } else {
        state.samPreparing = false;
        state.samReady = true;
      }
      state.resultUrl = URL.createObjectURL(resultFile);
      ui.cutoutResultPreview.src = state.resultUrl;
      ui.cutoutResultName.textContent = `${resultFile.name} · ${formatBytes(resultFile.size)}`;
      ui.cutoutModalError.classList.add('hidden');
      const replacedTotal = selectedFiles.reduce((sum, file, index) => sum + (index === pendingCutout.index ? 0 : file.size), 0) + resultFile.size;
      ui.cutoutCutoutOnly.disabled = resultFile.size > MAX_FILE_BYTES || replacedTotal > MAX_BATCH_BYTES;
      if (ui.cutoutCutoutOnly.disabled) {
        ui.cutoutModalError.textContent = '透明版超出上传大小限制，仍可选择原图或都不保存。';
        ui.cutoutModalError.classList.remove('hidden');
      }
      ui.cutoutProgress.textContent = resultMode === 'auto'
        ? (appLanguage === 'en'
          ? 'Automatic mask ready. Tap a subject/background point to load MobileSAM for refinement, or edit by brush.'
          : '自动掩码已就绪；可点主体/背景按需加载 MobileSAM 精修，或用笔刷修整。')
        : (appLanguage === 'en'
          ? 'Refined preview ready. Continue editing or choose which version to use.'
          : '精修预览已更新；可继续修整或选择要使用的版本。');
      initializeCutoutBrushEditor(state, resultFile);
      updateCutoutToolAvailability();
      syncLockedControls();
      showStatus(resultMode === 'auto'
        ? (appLanguage === 'en' ? 'On-device automatic preview is ready.' : '本机自动抠图预览已就绪。')
        : (appLanguage === 'en' ? 'On-device refinement preview is ready.' : '本机精修预览已就绪。'), 'success');
    } catch {
      ui.cutoutModalError.textContent = '无法显示抠图结果，请清除点后重试。';
      ui.cutoutModalError.classList.remove('hidden');
      updateCutoutToolAvailability();
      syncLockedControls();
    }
  };

  async function createBlob(content, target = {}) {
    const path = repositoryApiPathFor(target.owner || selectedOwner, target.repositoryName || selectedRepoName);
    return request(`${path}/git/blobs`, { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
  }

  async function commitChanges(changes, message, target = {}) {
    if (!changes.length) return;
    const owner = target.owner || selectedOwner;
    const name = target.repositoryName || selectedRepoName;
    const targetBranch = target.branch || branch;
    const expectedCommitSha = target.commitSha || commitSha;
    const apiPath = repositoryApiPathFor(owner, name);
    const freshRef = await request(`${apiPath}/git/ref/heads/${encodeURIComponent(targetBranch)}`);
    if (freshRef.object.sha !== expectedCommitSha) throw new Error('目标仓库或分支在预览后又有新提交。为避免覆盖他人的改动，请取消并重新准备上传。');
    const freshCommitSha = freshRef.object.sha;
    const freshCommit = await request(`${apiPath}/git/commits/${freshCommitSha}`);
    const freshTree = await request(`${apiPath}/git/trees/${freshCommit.tree.sha}?recursive=1`);
    if (freshTree.truncated) throw new Error('仓库文件树过大，无法安全写入。');
    const currentPaths = new Set((freshTree.tree || []).filter((item) => item.type === 'blob').map((item) => item.path));
    const entryList = [];
    for (const change of changes) {
      if (change.delete) {
        if (currentPaths.has(change.path)) entryList.push({ path: change.path, mode: change.mode || '100644', type: 'blob', sha: null });
      } else if (change.sha) {
        entryList.push({ path: change.path, mode: change.mode || '100644', type: 'blob', sha: change.sha });
      } else {
        const blob = await createBlob(change.content, { owner, repositoryName: name });
        entryList.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
    }
    if (!entryList.length) return;
    const nextTree = await request(`${apiPath}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: freshCommit.tree.sha, tree: entryList }) });
    const nextCommit = await request(`${apiPath}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: nextTree.sha, parents: [freshCommitSha] }) });
    await request(`${apiPath}/git/refs/heads/${encodeURIComponent(targetBranch)}`, { method: 'PATCH', body: JSON.stringify({ sha: nextCommit.sha, force: false }) });
  }

  async function commitStagedChanges() {
    if (busy || (!stagedCategories.size && !folderOperations.length)) return;
    const drafts = [...stagedCategories.values()];
    const changedPaths = drafts.map((draft) => `${draft.originalPath} · ${draft.icons.length} ${appLanguage === 'en' ? 'icons' : '条 icons[]'}`).join('\n• ');
    const moveReview = stagedMoves.map((move) => appLanguage === 'en'
      ? `Move ${JSON.stringify(move.entry)}\n  source JSON: ${move.sourcePath}\n  destination JSON: ${move.destinationPath}\n  image file: ${move.sourceFilePath} → ${move.destinationFilePath}`
      : `移动条目 ${JSON.stringify(move.entry)}\n  来源 JSON：${move.sourcePath}\n  目标 JSON：${move.destinationPath}\n  图片文件：${move.sourceFilePath} → ${move.destinationFilePath}`).join('\n\n');
    const folderReview = folderOperations.map((operation) => {
      const heading = appLanguage === 'en'
        ? `${operation.type.toUpperCase()}: ${operation.source || operation.destination}${operation.source && operation.destination ? ` → ${operation.destination}` : ''}`
        : `${({ create: '新建文件夹', rename: '重命名文件夹', move: '移动文件夹', delete: '删除文件夹' })[operation.type] || '文件夹变更'}：${operation.source || operation.destination}${operation.source && operation.destination ? ` → ${operation.destination}` : ''}`;
      const paths = operation.paths.map((path) => `  • ${path}`).join('\n');
      return `${heading}${paths ? `\n${paths}` : ''}`;
    }).join('\n\n');
    const folderChanges = folderChangesForCommit();
    const indexReview = changedPaths ? `\n\n${appLanguage === 'en' ? 'Affected independent JSON indexes:' : '受影响的独立 JSON 索引：'}\n• ${changedPaths}` : '';
    const warning = appLanguage === 'en'
      ? `Review every staged change for ${selectedOwner}/${selectedRepoName} (${branch}) before submission.${indexReview}${moveReview ? `\n\nCross-category moves:\n${moveReview}` : ''}${folderReview ? `\n\nFolder changes and affected paths:\n${folderReview}` : ''}\n\nNothing is sent until you explicitly confirm this review. All accepted changes are applied together in one GitHub commit.`
      : `请逐项审核 ${selectedOwner}/${selectedRepoName}（${branch}）的全部暂存变更。${indexReview}${moveReview ? `\n\n跨分类移动：\n${moveReview}` : ''}${folderReview ? `\n\n文件夹操作及受影响路径：\n${folderReview}` : ''}\n\n只有你单独确认此审核后才会写入 GitHub；确认的变更会合并为一次提交。`;
    if (!await confirmInApp(warning, {
      title: appLanguage === 'en' ? 'Review repository changes' : '确认仓库变更',
      confirmLabel: appLanguage === 'en' ? 'Confirm and submit' : '确认并提交', danger: true
    })) return;
    const indexChanges = drafts.map((draft) => ({
      path: draft.originalPath,
      content: utf8ToBase64(`${JSON.stringify({ ...draft.data, icons: draft.icons }, null, 2)}\n`)
    }));
    const iconFileChanges = stagedMoves.flatMap((move) => move.sourceFilePath === move.destinationFilePath ? [] : [
      { path: move.destinationFilePath, sha: move.blobSha },
      { path: move.sourceFilePath, delete: true }
    ]);
    const changes = [...indexChanges, ...iconFileChanges, ...folderChanges];
    if (!changes.length) return;
    const includesFolders = folderOperations.length > 0;
    const includesIconMoves = stagedMoves.length > 0;
    setBusy(true);
    showStatus(appLanguage === 'en' ? 'Saving the confirmed icon file and JSON index changes…' : '正在保存已确认的图片文件与 JSON 索引变更…', 'info');
    try {
      await commitChanges(changes, `Update icon library in ${selectedOwner}/${selectedRepoName}`);
      await loadRepositoryState();
      showStatus(appLanguage === 'en'
        ? (includesFolders ? 'Folder and JSON index changes were submitted successfully.' : includesIconMoves ? 'Icon image file and JSON index changes were submitted successfully.' : 'JSON index updated successfully.')
        : (includesFolders ? '文件夹与 JSON 索引变更已成功提交。' : includesIconMoves ? '图标图片文件与 JSON 索引已成功提交。' : 'JSON 索引已更新。'), 'success');
      showToast(appLanguage === 'en'
        ? (includesFolders ? 'Folder and index changes saved.' : includesIconMoves ? 'Icon image file and index changes saved.' : 'Index changes saved.')
        : (includesFolders ? '文件夹与索引变更已保存。' : includesIconMoves ? '图标图片文件与索引变更已保存。' : '索引变更已保存。'));
    } catch (error) {
      showStatus(error.message || (appLanguage === 'en' ? 'Could not save the index.' : '保存索引失败。'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function renderUploadConfirmationText() {
    const en = appLanguage === 'en';
    const text = (id, value) => { const element = $(id); if (element) element.textContent = value; };
    text('#upload-confirm-kicker', en ? 'GITHUB · FINAL REVIEW' : '写入 GitHub · 最后确认');
    text('#upload-confirm-title', en ? 'Confirm icon upload?' : '确认上传图标？');
    text('#upload-confirm-description', en
      ? 'Choose the destination, review the resulting image paths and JSON index, then confirm. Nothing is written before confirmation.'
      : '可选择本次上传目标；请核对生成的图片路径和 JSON 索引。只有点击下方确认后才会写入。');
    text('#upload-confirm-repository-label', en ? 'Repository' : '仓库');
    text('#upload-confirm-branch-label', en ? 'Branch' : '分支');
    text('#upload-confirm-category-label', en ? 'Target category' : '目标分类');
    text('#upload-confirm-directory-label', en ? 'Image folder' : '目标图片文件夹');
    text('#upload-confirm-index-label', en ? 'JSON index' : 'JSON 索引');
    text('#upload-confirm-selection-note', en
      ? 'Category and JSON index stay in sync. Changing repository or branch reloads valid indexes; selections affect this upload only.'
      : '分类与 JSON 索引相互联动；切换仓库或分支后会重新读取有效索引。选择只影响本次预览。');
    text('#upload-confirm-cancel', en ? 'Cancel' : '取消');
    text('#upload-confirm-submit', en ? 'Upload and save' : '确认上传并保存');
    text('#upload-confirm-atomic-note', en
      ? 'The image file(s) and the selected JSON index will be updated together in one GitHub commit. Other indexes will not be changed.'
      : '图像文件与所选 JSON 索引会在同一个 GitHub 提交中更新；不会修改其他分类索引。');
    ui.uploadConfirmClose.setAttribute('aria-label', en ? 'Cancel upload' : '取消上传');
    const files = pendingUploadConfirmation?.files || [];
    text('#upload-confirm-files-title', en ? `Files to upload · ${files.length}` : `将上传的文件 · ${files.length} 个`);
    updateUploadTargetChoiceButtons();
  }

  function uploadTargetRepositories() {
    const items = [...accessibleRepositories];
    if (selectedOwner && selectedRepoName && !items.some((item) => repositoryIdentity(item) === `${selectedOwner}/${selectedRepoName}`.toLowerCase())) {
      items.unshift(normalizeRepository(repository || { owner: selectedOwner, name: selectedRepoName, default_branch: branch }));
    }
    return items.filter(Boolean).sort((a, b) => repositoryIdentity(a).localeCompare(repositoryIdentity(b)));
  }

  function setUploadSelectOptions(select, items, selectedValue = '', placeholder = '', disabled = select.disabled) {
    select.disabled = disabled;
    select.replaceChildren();
    if (placeholder) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = placeholder;
      select.append(option);
    }
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.append(option);
    }
    if (items.some((item) => item.value === selectedValue)) select.value = selectedValue;
    else if (items.length) select.value = items[0].value;
    updateUploadTargetChoiceButtons();
  }

  function uploadTargetError(message) {
    uploadTargetState = null;
    ui.uploadConfirmError.textContent = message;
    ui.uploadConfirmError.classList.remove('hidden');
    ui.uploadConfirmSubmit.disabled = true;
    for (const select of [ui.uploadConfirmCategory, ui.uploadConfirmIndex, ui.uploadConfirmDirectory]) {
      select.disabled = true;
      setUploadSelectOptions(select, [], '', appLanguage === 'en' ? 'Unavailable' : '不可用');
    }
  }

  function uploadPlanError(message) {
    ui.uploadConfirmError.textContent = message;
    ui.uploadConfirmError.classList.remove('hidden');
    ui.uploadConfirmSubmit.disabled = true;
  }

  async function fetchUploadTargetBranches(owner, name) {
    const path = repositoryApiPathFor(owner, name);
    const branches = [];
    for (let page = 1; page <= 20; page += 1) {
      const batch = await request(`${path}/branches?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error(appLanguage === 'en' ? 'GitHub returned an invalid branch list.' : 'GitHub 返回的分支列表格式无效。');
      branches.push(...batch.map((item) => item?.name).filter((item) => typeof item === 'string' && item));
      if (batch.length < 100) return [...new Set(branches)].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    }
    throw new Error(appLanguage === 'en' ? 'The repository has too many branches to load safely.' : '分支数量过多，无法安全读取。');
  }

  function inferUploadTargetDirectory(indexPath, entries, files, owner, name) {
    for (const entry of entries || []) {
      const reference = GitHubUrls.rawReference(entry.url || '', [rawContentBaseUrl, ...rawBaseHistory, DEFAULT_RAW_BASE], owner, name);
      const filePath = reference?.path || '';
      if (filePath && files.has(filePath)) return filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : iconRootForPath(indexPath);
    }
    const dir = indexPath.includes('/') ? indexPath.slice(0, indexPath.lastIndexOf('/')) : iconRootForPath(indexPath);
    if (!entries?.length) return dir || iconRootForPath(indexPath);
    const root = iconRootForPath(indexPath);
    return dir === root ? root : `${dir}/icon`;
  }

  async function loadUploadTargetBranch(owner, name, targetBranch, generation, preferredCategoryPath = '') {
    const apiPath = repositoryApiPathFor(owner, name);
    const ref = await request(`${apiPath}/git/ref/heads/${encodeURIComponent(targetBranch)}`);
    const targetCommitSha = ref?.object?.sha;
    if (!targetCommitSha) throw new Error(appLanguage === 'en' ? 'Could not read the selected branch head.' : '无法读取所选分支的最新提交。');
    const commit = await request(`${apiPath}/git/commits/${targetCommitSha}`);
    const tree = await request(`${apiPath}/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error(appLanguage === 'en' ? 'This repository tree is too large to inspect safely.' : '仓库文件树过大，无法安全读取。');
    const entries = tree.tree || [];
    const files = new Map(entries.filter((item) => item.type === 'blob').map((item) => [item.path, item]));
    const directories = collectIconDirectories(entries);
    const discovered = [];
    for (const indexPath of [...files.keys()].filter(isIconIndexPath)) {
      const blob = files.get(indexPath);
      try {
        const data = await request(`${apiPath}/git/blobs/${blob.sha}`);
        const parsed = JSON.parse(decodeBase64Utf8(data.content || ''));
        if (!Array.isArray(parsed.icons)) continue;
        const icons = parsed.icons.filter((entry) => entry && typeof entry === 'object' && typeof entry.name === 'string' && typeof entry.url === 'string');
        const label = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : indexPath.split('/').slice(1, -1).join('/') || (appLanguage === 'en' ? 'Icon library' : '默认图标包');
        const assetDirectory = inferUploadTargetDirectory(indexPath, icons, files, owner, name);
        if (assetDirectory) directories.add(assetDirectory);
        discovered.push({ path: indexPath, data: { ...parsed, icons }, label, description: typeof parsed.description === 'string' ? parsed.description : '', icons, assetDirectory });
      } catch {
        // Malformed JSON and unrelated JSON files are deliberately not selectable.
      }
    }
    if (generation !== uploadTargetLoadSequence || !pendingUploadConfirmation) return;
    discovered.sort((a, b) => b.icons.length - a.icons.length || a.path.localeCompare(b.path, 'zh-CN'));
    if (!discovered.length) throw new Error(appLanguage === 'en' ? 'No valid icon JSON index was found on this branch.' : '此分支没有找到有效的图标 JSON 索引。');
    uploadTargetState = { owner, repositoryName: name, branch: targetBranch, commitSha: targetCommitSha, files, directories, categories: discovered };
    const preferred = discovered.some((item) => item.path === preferredCategoryPath) ? preferredCategoryPath : discovered[0].path;
    renderUploadTargetCategories(uploadTargetState, preferred);
  }

  function renderUploadTargetCategories(state, selectedPath) {
    const categories = state.categories;
    const categoryOptions = categories.map((category) => ({ value: category.path, label: `${category.label} · ${category.path}` }));
    const indexOptions = categories.map((category) => ({ value: category.path, label: category.path }));
    setUploadSelectOptions(ui.uploadConfirmCategory, categoryOptions, selectedPath, '', false);
    setUploadSelectOptions(ui.uploadConfirmIndex, indexOptions, selectedPath, '', false);
    updateUploadTargetDirectories(selectedPath);
    ui.uploadConfirmError.classList.add('hidden');
    ui.uploadConfirmError.textContent = '';
    ui.uploadConfirmSubmit.disabled = false;
    refreshUploadPlanPreview();
  }

  function updateUploadTargetDirectories(categoryPath) {
    const state = uploadTargetState;
    const category = state?.categories.find((item) => item.path === categoryPath);
    if (!state || !category) {
      setUploadSelectOptions(ui.uploadConfirmDirectory, [], '', appLanguage === 'en' ? 'Choose an index first' : '请先选择索引', true);
      return;
    }
    const root = iconRootForPath(category.path);
    const directorySet = new Set([...state.directories].filter((path) => path === root || path.startsWith(`${root}/`)));
    if (category.assetDirectory) directorySet.add(category.assetDirectory);
    const directories = [...directorySet].filter((path) => path && !path.startsWith('/') && !path.split('/').includes('..'))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    setUploadSelectOptions(ui.uploadConfirmDirectory, directories.map((path) => ({ value: path, label: path })), category.assetDirectory, '', false);
  }

  function refreshUploadPlanPreview() {
    const pending = pendingUploadConfirmation;
    const state = uploadTargetState;
    if (!pending || !state) return;
    const categoryPath = ui.uploadConfirmCategory.value;
    const category = state.categories.find((item) => item.path === categoryPath);
    const directory = ui.uploadConfirmDirectory.value;
    if (!category || ui.uploadConfirmIndex.value !== categoryPath || !directory) {
      uploadPlanError(appLanguage === 'en' ? 'Choose a valid category, JSON index and image folder.' : '请选择有效的分类、JSON 索引和图片文件夹。');
      return;
    }
    const root = iconRootForPath(category.path);
    if (!root || (directory !== root && !directory.startsWith(`${root}/`)) || directory.startsWith('/') || directory.split('/').includes('..') || !state.directories.has(directory) && directory !== category.assetDirectory) {
      uploadPlanError(appLanguage === 'en' ? 'The image folder is incompatible with this index.' : '此图片文件夹与所选索引不兼容。');
      return;
    }
    const incomingNames = new Set();
    const changes = [];
    const fileRows = [];
    const nextIcons = [...category.icons];
    for (const file of pending.files) {
      const name = file.name;
      const extension = fileExtension(name);
      const baseName = name.replace(/\.[^.]+$/, '');
      if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name)
          || !ALLOWED_EXTENSIONS.has(extension) || extension !== fileExtension(file.file.name) || !baseName || baseName.length > 120) {
        uploadPlanError(appLanguage === 'en'
          ? `Invalid upload name “${name}”. Keep the original extension and use 1–120 name characters without slashes.`
          : `上传名称“${name}”无效。请保留原扩展名，名称需为 1–120 个字符且不能含斜线。`);
        return;
      }
      const path = `${directory}/${name}`;
      const collisionKey = path.toLocaleLowerCase();
      if (incomingNames.has(collisionKey) || [...state.files.keys()].some((known) => known.toLocaleLowerCase() === collisionKey)) {
        uploadPlanError(appLanguage === 'en' ? `“${name}” already exists in ${directory}. Rename it or choose another folder.` : `目标文件夹 ${directory} 中已存在“${name}”，请改名或选择其他文件夹。`);
        return;
      }
      incomingNames.add(collisionKey);
      changes.push({ path, content: file.content });
      fileRows.push({ file, path });
      nextIcons.push({ name: baseName, url: GitHubUrls.rawContentUrl(rawContentBaseUrl, state.owner, state.repositoryName, state.branch, path) });
    }
    const nextIndex = { ...category.data, icons: nextIcons };
    changes.push({ path: category.path, content: utf8ToBase64(`${JSON.stringify(nextIndex, null, 2)}\n`) });
    pending.owner = state.owner;
    pending.repositoryName = state.repositoryName;
    pending.branch = state.branch;
    pending.commitSha = state.commitSha;
    pending.categoryLabel = category.label;
    pending.categoryPath = category.path;
    pending.assetDirectory = directory;
    pending.emptyIndex = category.icons.length === 0;
    pending.changes = changes;
    ui.uploadConfirmRepository.value = `${state.owner}/${state.repositoryName}`;
    ui.uploadConfirmBranch.value = state.branch;
    ui.uploadConfirmCategory.value = category.path;
    ui.uploadConfirmIndex.value = category.path;
    ui.uploadConfirmDirectory.value = directory;
    ui.uploadConfirmDirectoryNote.textContent = appLanguage === 'en'
      ? `All selected images will be placed in ${directory}; the preview shows the exact path.`
      : `所选图片都会放入 ${directory}；下方预览显示每个文件的准确路径。`;
    ui.uploadConfirmFileList.replaceChildren();
    fileRows.forEach(({ file, path }) => {
      const item = document.createElement('li');
      const details = document.createElement('div');
      details.className = 'upload-confirm-file-details';
      const name = document.createElement('strong');
      name.textContent = file.name;
      const targetPath = document.createElement('code');
      targetPath.textContent = path;
      const size = document.createElement('small');
      size.textContent = formatBytes(file.size);
      details.append(name, targetPath);
      item.append(details, size);
      ui.uploadConfirmFileList.append(item);
    });
    ui.uploadConfirmError.classList.add('hidden');
    ui.uploadConfirmError.textContent = '';
    ui.uploadConfirmSubmit.disabled = false;
  }

  async function loadUploadTargetRepository(owner, name, preferredBranch = '') {
    const generation = ++uploadTargetLoadSequence;
    uploadTargetState = null;
    uploadTargetContext = null;
    ui.uploadConfirmSubmit.disabled = true;
    ui.uploadConfirmError.classList.add('hidden');
    const en = appLanguage === 'en';
    for (const select of [ui.uploadConfirmBranch, ui.uploadConfirmCategory, ui.uploadConfirmIndex, ui.uploadConfirmDirectory]) {
      select.disabled = true;
      setUploadSelectOptions(select, [], '', en ? 'Loading…' : '正在读取…');
    }
    try {
      const branches = await fetchUploadTargetBranches(owner, name);
      if (generation !== uploadTargetLoadSequence || !pendingUploadConfirmation) return;
      if (!branches.length) throw new Error(en ? 'This repository has no readable branches.' : '此仓库没有可读取的分支。');
      const repo = uploadTargetRepositories().find((item) => repositoryIdentity(item) === `${owner}/${name}`.toLowerCase());
      const preferredDefault = repo?.default_branch || (owner.toLowerCase() === selectedOwner.toLowerCase() && name.toLowerCase() === selectedRepoName.toLowerCase() ? branch : '');
      const chosenBranch = branches.includes(preferredBranch) ? preferredBranch : branches.includes(preferredDefault) ? preferredDefault : branches[0];
      uploadTargetContext = { owner, repositoryName: name, branches, defaultBranch: preferredDefault };
      setUploadSelectOptions(ui.uploadConfirmBranch, branches.map((value) => ({ value, label: value })), chosenBranch, '', branches.length === 0);
      await loadUploadTargetBranch(owner, name, chosenBranch, generation,
        owner.toLowerCase() === selectedOwner.toLowerCase() && name.toLowerCase() === selectedRepoName.toLowerCase() ? activeCategoryPath : '');
    } catch (error) {
      if (generation !== uploadTargetLoadSequence || !pendingUploadConfirmation) return;
      uploadTargetError(error.message || (en ? 'Could not inspect the selected repository.' : '无法读取所选仓库。'));
    }
  }

  async function openUploadConfirmation(pending) {
    pendingUploadConfirmation = pending;
    uploadTargetState = null;
    uploadTargetContext = null;
    renderUploadConfirmationText();
    const repositories = uploadTargetRepositories();
    const repoOptions = repositories.map((item) => ({
      value: `${item.owner.login}/${item.name}`,
      label: item.full_name || `${item.owner.login}/${item.name}`
    }));
    setUploadSelectOptions(ui.uploadConfirmRepository, repoOptions, `${selectedOwner}/${selectedRepoName}`, '', repoOptions.length === 0);
    ui.uploadConfirmBranch.disabled = true;
    ui.uploadConfirmCategory.disabled = true;
    ui.uploadConfirmDirectory.disabled = true;
    ui.uploadConfirmIndex.disabled = true;
    ui.uploadConfirmSubmit.disabled = true;
    ui.uploadConfirmModal.classList.remove('hidden');
    requestAnimationFrame(() => ui.uploadConfirmCancel.focus());
    const [owner, ...nameParts] = ui.uploadConfirmRepository.value.split('/');
    await loadUploadTargetRepository(owner, nameParts.join('/'), branch);
  }

  function closeUploadConfirmation() {
    if (ui.uploadConfirmModal.classList.contains('hidden')) return;
    uploadTargetLoadSequence += 1;
    uploadTargetState = null;
    uploadTargetContext = null;
    ui.uploadConfirmModal.classList.add('hidden');
    pendingUploadConfirmation = null;
    ui.uploadButton.focus({ preventScroll: true });
  }

  async function confirmPendingUpload() {
    const pending = pendingUploadConfirmation;
    if (!pending || busy) return;
    const stillSameFiles = selectedFiles.length === pending.files.length
      && pending.files.every((item, index) => selectedFiles[index] === item.file
        && selectedFileNames[index] === item.selectedName);
    const stillSameTarget = uploadTargetState
      && pending.owner === uploadTargetState.owner
      && pending.repositoryName === uploadTargetState.repositoryName
      && pending.branch === uploadTargetState.branch
      && pending.categoryPath === ui.uploadConfirmCategory.value
      && pending.categoryPath === ui.uploadConfirmIndex.value
      && pending.assetDirectory === ui.uploadConfirmDirectory.value
      && ui.uploadConfirmRepository.value === `${pending.owner}/${pending.repositoryName}`
      && ui.uploadConfirmBranch.value === pending.branch
      && pending.changes?.length === pending.files.length + 1;
    if (!stillSameFiles || !stillSameTarget || stagedCategories.size) {
      ui.uploadConfirmError.textContent = appLanguage === 'en'
        ? 'The upload selection or target changed. Review the refreshed preview; nothing was written.'
        : '待上传文件或目标位置已变化。请检查更新后的预览；尚未写入任何内容。';
      ui.uploadConfirmError.classList.remove('hidden');
      return;
    }
    pendingUploadConfirmation = null;
    ui.uploadConfirmModal.classList.add('hidden');
    setBusy(true);
    showStatus(appLanguage === 'en' ? 'Writing the selected image files and JSON index to GitHub…' : '正在按所选目标写入图片文件并同步 JSON 索引…', 'info');
    try {
      const label = pending.files.length === 1 ? pending.files[0].name : `${pending.files.length} ${appLanguage === 'en' ? 'icons' : '个图标'}`;
      await commitChanges(pending.changes, `Add ${label} to ${pending.categoryLabel}`, pending);
      clearSelectedFiles();
      if (selectedOwner.toLowerCase() === pending.owner.toLowerCase()
          && selectedRepoName.toLowerCase() === pending.repositoryName.toLowerCase()
          && branch === pending.branch) {
        try { await loadRepositoryState(); } catch { /* The confirmed commit succeeded; the visible library can be refreshed separately. */ }
      }
      showStatus(appLanguage === 'en'
        ? `Upload complete: files and JSON index were updated in ${pending.owner}/${pending.repositoryName} (${pending.branch}).`
        : `上传完成：已在 ${pending.owner}/${pending.repositoryName}（${pending.branch}）同步图片文件与 JSON 索引。`, 'success');
      showToast(appLanguage === 'en' ? 'Upload complete; the selected repository was updated.' : '上传成功，所选仓库已更新。');
    } catch (error) {
      showStatus(error.message || (appLanguage === 'en' ? 'Upload failed. Please retry.' : '上传失败，请重试。'), 'error');
    } finally {
      uploadTargetState = null;
      uploadTargetContext = null;
      setBusy(false);
    }
  }

  async function uploadSelected() {
    if (busy || cutoutBusy || pendingCutout || !selectedFiles.length) return;
    if (stagedCategories.size) return showStatus(appLanguage === 'en' ? 'Save or discard pending index edits before uploading.' : '请先保存或撤销待整理的索引变更，再上传图标。', 'error');
    const category = categories.find((item) => item.path === activeCategoryPath);
    if (!category) return;
    const filesForReview = [];
    const changes = [];
    const incomingNames = new Set();
    const assetDirectory = category.assetDirectory || (category.path.includes('/') ? category.path.slice(0, category.path.lastIndexOf('/')) : ICON_ROOT);
    const nextIcons = [...category.icons];
    for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex += 1) {
      const file = selectedFiles[fileIndex];
      const requestedName = selectedFileNames[fileIndex] || file.name;
      const normalized = requestedName.normalize('NFC').trim();
      const extension = fileExtension(normalized);
      const baseName = normalized.replace(/\.[^.]+$/, '');
      if (!normalized || normalized === '.' || normalized === '..' || /[\\/\u0000-\u001f\u007f]/.test(normalized)
          || !ALLOWED_EXTENSIONS.has(extension) || extension !== fileExtension(file.name) || !baseName || baseName.length > 120) {
        throw new Error(appLanguage === 'en'
          ? `Invalid upload name “${requestedName}”. Keep the original extension and use 1–120 name characters without slashes.`
          : `上传名称“${requestedName}”无效。请保留原扩展名，名称需为 1–120 个字符且不能含斜线。`);
      }
      const content = arrayBufferToBase64(await file.arrayBuffer());
      const path = `${assetDirectory}/${normalized}`;
      const collisionKey = path.toLocaleLowerCase();
      if (incomingNames.has(collisionKey) || treeFiles.has(path) || [...treeFiles.keys()].some((known) => known.toLocaleLowerCase() === collisionKey)) {
        throw new Error(appLanguage === 'en' ? `“${normalized}” already exists in the repository. Rename it before uploading.` : `仓库中已存在“${normalized}”，请改名后再上传。`);
      }
      incomingNames.add(collisionKey);
      changes.push({ path, content });
      filesForReview.push({ file, name: normalized, selectedName: selectedFileNames[fileIndex], size: file.size, content, path });
      nextIcons.push({ name: baseName, url: GitHubUrls.rawContentUrl(rawContentBaseUrl, selectedOwner, selectedRepoName, branch, path) });
    }
    changes.push({ path: category.path, content: utf8ToBase64(`${JSON.stringify({ ...category.data, icons: nextIcons }, null, 2)}\n`) });
    await openUploadConfirmation({
      owner: selectedOwner, repositoryName: selectedRepoName, branch, commitSha,
      categoryLabel: category.label, categoryPath: category.path, assetDirectory,
      emptyIndex: category.icons.length === 0, files: filesForReview, changes
    });
  }

  async function deleteIcon(entry, filePath) {
    if (busy || cutoutBusy || pendingCutout) return;
    if (stagedCategories.size) return showStatus(appLanguage === 'en' ? 'Save or discard pending index edits before deleting.' : '请先保存或撤销待整理的索引变更，再删除图标。', 'error');
    const category = categories.find((item) => item.path === activeCategoryPath);
    if (!category) return;
    const deleteConfirmation = appLanguage === 'en'
      ? `Delete “${entry.name}” from ${selectedOwner}/${selectedRepoName} (${branch})?\n\nFile: ${filePath}\nIndex: ${category.path}\nThe file and its entry in the selected JSON will be removed in one GitHub commit.`
      : `确认从 ${selectedOwner}/${selectedRepoName}（${branch}）删除“${entry.name}”吗？\n\n图像文件：${filePath}\n所选索引：${category.path}\n图像文件及其索引条目会在同一个 GitHub 提交中移除。`;
    const confirmed = await confirmInApp(deleteConfirmation, {
      title: appLanguage === 'en' ? 'Delete this icon?' : '确认删除此图标？',
      confirmLabel: appLanguage === 'en' ? 'Delete' : '删除', danger: true
    });
    if (!confirmed) return;
    const nextIcons = category.icons.filter((item) => item !== entry);
    const nextIndex = { ...category.data, icons: nextIcons };
    setBusy(true);
    showStatus(appLanguage === 'en' ? `Deleting ${entry.name} and updating the selected index…` : `正在删除 ${entry.name}，并同步所选索引…`, 'info');
    try {
      await commitChanges([
        { path: filePath, delete: true },
        { path: category.path, content: utf8ToBase64(`${JSON.stringify(nextIndex, null, 2)}\n`) }
      ], `Remove ${entry.name} from ${category.label}`);
      await loadRepositoryState();
      showStatus(appLanguage === 'en' ? `Deleted ${entry.name}; the file and index were updated in one commit.` : `已删除 ${entry.name}，图像文件和索引已在同一提交中更新。`, 'success');
      showToast(appLanguage === 'en' ? 'Icon deleted.' : '图标已删除。');
    } catch (error) {
      showStatus(error.message || '删除失败，请重试。', 'error');
    } finally {
      setBusy(false);
    }
  }

  function setConnected(connected) {
    const hasToken = Boolean(token);
    if (tokenSaved && token) ui.savedTokenDisplay.value = token;
    if (!tokenSaved) ui.savedTokenDisplay.value = '';
    ui.connectPanel.classList.toggle('hidden', hasToken);
    ui.repoPickerPanel.classList.toggle('hidden', !hasToken);
    ui.settingsConnectionSummary.classList.toggle('hidden', !connected);
    ui.savedTokenCard.classList.toggle('hidden', !tokenSaved);
    ui.repoPickerBack.classList.toggle('hidden', !connected);
    ui.repoRefreshButton.classList.toggle('hidden', !hasToken);
    ui.workspace.classList.toggle('hidden', !connected);
    ui.librarySetupPrompt.classList.toggle('hidden', connected);
    ui.disconnectButton.classList.toggle('hidden', !hasToken);
    ui.connectionState.classList.toggle('connected', hasToken);
    ui.settingsCurrentRepo.textContent = selectedOwner && selectedRepoName
      ? `${selectedOwner}/${selectedRepoName}`
      : (appLanguage === 'en' ? 'No library selected' : '尚未选择图标库');
    $('#settings-card-account-summary').textContent = selectedOwner && selectedRepoName
      ? (appLanguage === 'en' ? `Current: ${selectedOwner}/${selectedRepoName}` : `当前：${selectedOwner}/${selectedRepoName}`)
      : (appLanguage === 'en' ? `${accessibleRepositories.length} cached libraries available` : `可切换 ${accessibleRepositories.length} 个本机缓存仓库`);
    const stateLabel = connected ? (appLanguage === 'en' ? 'Connected' : '已连接')
      : hasToken ? (appLanguage === 'en' ? 'Authorized' : '已授权') : (appLanguage === 'en' ? 'Not connected' : '未连接');
    ui.connectionState.innerHTML = `<i></i>${stateLabel}`;
    if (hasToken) renderRepositoryChoices(accessibleRepositories);
  }

  function toggleTokenVisibility(input, button) {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.textContent = appLanguage === 'en' ? (reveal ? 'Hide' : 'Show') : (reveal ? '隐藏' : '显示');
    button.setAttribute('aria-label', appLanguage === 'en'
      ? (reveal ? 'Hide token' : 'Reveal token')
      : (reveal ? '隐藏 Token' : '显示 Token'));
  }

  async function copySavedToken() {
    if (!tokenSaved || !token) {
      setSavedTokenStatus('error', '本机没有可复制的已保存 Token。', 'There is no saved token to copy on this device.');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(token);
      } else {
        const temporary = document.createElement('textarea');
        temporary.value = token;
        temporary.readOnly = true;
        temporary.style.position = 'fixed';
        temporary.style.opacity = '0';
        document.body.append(temporary);
        temporary.select();
        const copied = document.execCommand('copy');
        temporary.remove();
        if (!copied) throw new Error('Clipboard unavailable');
      }
      setSavedTokenStatus('success', 'Token 已复制到剪贴板。使用后请留意剪贴板中仍有敏感内容。', 'Token copied to the clipboard. Remember that sensitive text remains available there until replaced.');
    } catch {
      setSavedTokenStatus('error', '复制失败；可点“显示”后手动复制。', 'Copy failed. Reveal the token and copy it manually.');
    }
  }

  async function replaceSavedToken() {
    if (busy || ui.savedTokenReplaceSubmit.disabled) return;
    if (stagedCategories.size || stagedMoves.length || selectedFiles.length || pendingCutout) {
      setSavedTokenStatus('error', '请先保存或撤销待整理内容、清空上传队列并完成当前抠图，再替换 Token。', 'Save or discard staged edits, clear the upload queue, and finish the current cutout before replacing the token.');
      return;
    }
    const candidate = ui.savedTokenReplacement.value.trim();
    if (!candidate) {
      setSavedTokenStatus('error', '请先输入新的 GitHub Token。', 'Enter the new GitHub token first.');
      ui.savedTokenReplacement.focus();
      return;
    }
    if (candidate === token) {
      ui.savedTokenReplacement.value = '';
      ui.savedTokenReplacement.type = 'password';
      ui.savedTokenReplacePanel.classList.add('hidden');
      ui.savedTokenReplaceToggle.textContent = appLanguage === 'en' ? 'Replace token' : '替换 Token';
      setSavedTokenStatus('info', '输入值与当前 Token 相同，无需替换。', 'This is the current token; no replacement was needed.');
      return;
    }

    ui.savedTokenReplaceSubmit.disabled = true;
    setSavedTokenStatus('info', '正在向配置的 GitHub API 地址验证新 Token…', 'Validating the new token at the configured GitHub API address…');
    try {
      const validation = await request('/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=1&page=1', {}, apiBaseUrl, candidate);
      if (!Array.isArray(validation)) throw new Error(appLanguage === 'en' ? 'The API did not return a valid repository list.' : 'API 未返回有效的仓库列表。');
      if (!window.CueTokenStore?.saveToken?.(candidate)) {
        throw new Error(appLanguage === 'en' ? 'Android Keystore could not save the new token.' : 'Android Keystore 无法保存新 Token。');
      }

      token = candidate;
      tokenSaved = true;
      ui.savedTokenDisplay.type = 'password';
      ui.savedTokenDisplay.value = candidate;
      ui.toggleSavedToken.textContent = appLanguage === 'en' ? 'Show' : '显示';
      ui.savedTokenReplacement.value = '';
      ui.savedTokenReplacement.type = 'password';
      ui.savedTokenReplacePanel.classList.add('hidden');
      ui.savedTokenReplaceToggle.textContent = appLanguage === 'en' ? 'Replace token' : '替换 Token';
      setSavedTokenStatus('', '', '');
      ui.forgetTokenButton.classList.remove('hidden');

      selectedOwner = '';
      selectedRepoName = '';
      repository = null;
      accessibleRepositories = [];
      categories = [];
      treeFiles.clear();
      repositoryDirectories.clear();
      activeCategoryPath = '';
      categoryBrowsePath = '';
      clearSavedRepository();
      clearCachedRepositories();
      ui.categoryList.replaceChildren();
      ui.categoryBrowserNavigation.classList.add('hidden');
      ui.categoryBreadcrumbs.replaceChildren();
      ui.categoryBrowserEmpty.classList.add('hidden');
      ui.iconGrid.replaceChildren();
      ui.repoChipLabel.textContent = appLanguage === 'en' ? 'No library selected' : '尚未选择图标库';
      ui.currentRepoLink.classList.add('hidden');
      ui.repoPickerPanel.classList.remove('hidden');
      setConnected(false);
      setActiveScreen('settings', 'account');
      await findRepositories(candidate, { restoreSaved: false, refresh: true });
      setSavedTokenStatus('success', '新 Token 已验证并使用 Android Keystore 加密替换。请重新选择要管理的仓库。', 'The new token was validated and encrypted with Android Keystore. Choose a repository again.');
    } catch (error) {
      setSavedTokenStatus('error', error.message || (appLanguage === 'en' ? 'The token could not be validated or saved.' : 'Token 验证或保存失败。'));
    } finally {
      ui.savedTokenReplaceSubmit.disabled = false;
    }
  }

  ui.connectForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const candidate = ui.tokenInput.value.trim();
    if (!candidate) return;
    token = candidate;
    tokenSaved = false;
    ui.tokenInput.value = '';
    ui.connectButton.disabled = true;
    ui.connectButton.querySelector('span').textContent = appLanguage === 'en'
      ? 'Validating token and loading repositories…'
      : '正在验证 Token 并加载仓库…';
    setConnectError('');
    try {
      await findRepositories(candidate);
      if (!(selectedOwner && selectedRepoName)) setConnected(false);
    } catch (error) {
      token = '';
      setConnected(false);
      setConnectError(error.message || '连接失败，请确认 token 权限后重试。');
    } finally {
      ui.connectButton.disabled = false;
      ui.connectButton.querySelector('span').textContent = appLanguage === 'en'
        ? 'Verify token and load repositories'
        : '验证 Token 并加载可访问仓库';
    }
  });

  ui.endpointTestButton.addEventListener('click', testGitHubApiEndpoint);
  ui.endpointSaveButton.addEventListener('click', () => {
    const values = readEndpointForm();
    if (values) saveEndpointForm(values.api, values.raw);
  });
  ui.endpointDefaultsButton.addEventListener('click', () => {
    saveEndpointForm(DEFAULT_API_BASE, DEFAULT_RAW_BASE, true);
  });

  ui.repoPickerReload.addEventListener('click', () => { findRepositories(token, { restoreSaved: false, refresh: true }); });
  ui.repoPickerBack.addEventListener('click', () => {
    if (selectedOwner && selectedRepoName) {
      settingsRepoPickerOpen = false;
      setActiveScreen('library');
      return;
    }
    settingsRepoPickerOpen = false;
    setActiveScreen('settings', 'home');
  });

  ui.toggleToken.addEventListener('click', () => {
    const show = ui.tokenInput.type === 'password';
    ui.tokenInput.type = show ? 'text' : 'password';
    ui.toggleToken.textContent = appLanguage === 'en' ? (show ? 'Hide' : 'Show') : (show ? '隐藏' : '显示');
    ui.tokenInput.focus();
  });
  ui.toggleSavedToken.addEventListener('click', () => toggleTokenVisibility(ui.savedTokenDisplay, ui.toggleSavedToken));
  ui.toggleSavedTokenReplacement.addEventListener('click', () => toggleTokenVisibility(ui.savedTokenReplacement, ui.toggleSavedTokenReplacement));
  ui.copySavedToken.addEventListener('click', copySavedToken);
  ui.savedTokenReplaceToggle.addEventListener('click', () => {
    ui.savedTokenReplacePanel.classList.toggle('hidden');
    ui.savedTokenReplaceToggle.textContent = appLanguage === 'en'
      ? (ui.savedTokenReplacePanel.classList.contains('hidden') ? 'Replace token' : 'Cancel replacement')
      : (ui.savedTokenReplacePanel.classList.contains('hidden') ? '替换 Token' : '取消替换');
    if (!ui.savedTokenReplacePanel.classList.contains('hidden')) ui.savedTokenReplacement.focus();
  });
  ui.savedTokenReplaceCancel.addEventListener('click', () => {
    ui.savedTokenReplacement.value = '';
    ui.savedTokenReplacement.type = 'password';
    ui.savedTokenReplacePanel.classList.add('hidden');
    ui.savedTokenReplaceToggle.textContent = appLanguage === 'en' ? 'Replace token' : '替换 Token';
    setSavedTokenStatus('', '', '');
  });
  ui.savedTokenReplaceSubmit.addEventListener('click', replaceSavedToken);

  ui.disconnectButton.addEventListener('click', () => {
    if (busy) return;
    const hasNativeStore = Boolean(window.CueTokenStore);
    window.CueTokenStore?.clearSavedToken?.();
    clearSavedRepository();
    clearCachedRepositories();
    token = '';
    tokenSaved = false;
    ui.savedTokenDisplay.value = '';
    ui.savedTokenDisplay.type = 'password';
    ui.toggleSavedToken.textContent = appLanguage === 'en' ? 'Show' : '显示';
    ui.savedTokenReplacement.value = '';
    ui.savedTokenReplacement.type = 'password';
    ui.savedTokenReplacePanel.classList.add('hidden');
    ui.savedTokenReplaceToggle.textContent = appLanguage === 'en' ? 'Replace token' : '替换 Token';
    setSavedTokenStatus('', '', '');
    repository = null;
    selectedOwner = '';
    selectedRepoName = '';
    accessibleRepositories = [];
      settingsRepoPickerOpen = false;
      categories = [];
      treeFiles.clear();
      repositoryDirectories.clear();
      activeCategoryPath = '';
      categoryBrowsePath = '';
    clearSelectedFiles();
    ui.tokenInput.value = '';
      ui.searchInput.value = '';
      ui.categoryList.replaceChildren();
      ui.categoryBrowserNavigation.classList.add('hidden');
      ui.categoryBreadcrumbs.replaceChildren();
      ui.categoryBrowserEmpty.classList.add('hidden');
      ui.iconGrid.replaceChildren();
    ui.repoChipLabel.textContent = '尚未选择图标库';
    ui.currentRepoLink.classList.add('hidden');
    ui.repoPickerPanel.classList.add('hidden');
    showStatus('');
    setConnected(false);
    setConnectError('');
    ui.forgetTokenButton.classList.add('hidden');
    setActiveScreen('settings', 'account');
    showToast(hasNativeStore ? '已断开连接，并清除了本机保存的 token。' : '已断开连接，页面内存中的 token 已清除。');
  });

  ui.forgetTokenButton.addEventListener('click', () => {
    if (busy) return;
    ui.disconnectButton.click();
  });

  ui.navItems.forEach((button) => button.addEventListener('click', () => setActiveScreen(button.dataset.screen)));
  document.querySelectorAll('.preference-choice-button[data-choice-select]').forEach((button) => {
    button.addEventListener('click', () => openSettingsChoiceDialog(button.dataset.choiceSelect, button));
  });
  document.querySelectorAll('.upload-target-choice-button[data-choice-select]').forEach((button) => {
    button.addEventListener('click', () => openUploadTargetChoiceDialog(button.dataset.choiceSelect, button));
  });
  ui.librarySettingsCta.addEventListener('click', () => setActiveScreen('settings', 'account'));
  ui.settingsPageButtons.forEach((button) => button.addEventListener('click', () => setSettingsPage(button.dataset.settingsPage)));
  ui.settingsSubpageBack.addEventListener('click', () => setSettingsPage('home'));
  ui.launcherIconChoices.forEach((button) => button.addEventListener('click', () => {
    const choice = button.dataset.launcherIcon;
    const saved = window.CueAppSettings?.setLauncherIcon?.(choice);
    if (!saved) {
      showToast(appLanguage === 'en' ? 'Could not change the launcher icon on this device.' : '此设备无法切换启动器图标。');
      return;
    }
    launcherIcon = choice;
    updateLauncherIconSelection();
    showToast(appLanguage === 'en' ? 'Launcher icon changed.' : '桌面图标已更换。');
  }));
  ui.settingsChangeRepo.addEventListener('click', () => {
    if (!token || busy) return;
    settingsRepoPickerOpen = true;
    renderRepositoryChoices(accessibleRepositories);
    ui.repoPickerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  ui.repoRefreshButton.addEventListener('click', () => {
    if (!token || busy) return;
    findRepositories(token, { restoreSaved: false, refresh: true });
  });
  ui.reopenGuideButton.addEventListener('click', openWalkthrough);
  ui.walkthroughNext.addEventListener('click', advanceWalkthrough);
  ui.walkthroughSkip.addEventListener('click', advanceWalkthrough);
  ui.languageSelect.addEventListener('change', saveAppPreferences);
  ui.appearanceSelect.addEventListener('change', saveAppPreferences);
  ui.blackBackgroundToggle.addEventListener('change', saveAppPreferences);
  ui.systemColorToggle.addEventListener('change', saveAppPreferences);
  ui.navLayoutSelect.addEventListener('change', saveAppPreferences);
  ui.navLabelsToggle.addEventListener('change', saveAppPreferences);
  ui.navAutoHideToggle.addEventListener('change', saveAppPreferences);
  ui.settingsSave.forEach((button) => button.addEventListener('click', saveAppPreferences));
  loadAppPreferences();
  setActiveScreen('library');

  ui.chooseFiles.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', () => chooseFiles(ui.fileInput.files));
  ui.cutoutGallerySelect.addEventListener('click', () => openGalleryPicker(false));
  ui.galleryInput.addEventListener('change', () => acceptGalleryPhoto(ui.galleryInput.files?.[0]));
  ui.cutoutChangePhoto.addEventListener('click', async () => {
    if (!pendingCutout || !await confirmInApp(appLanguage === 'en'
      ? 'Discard the current cutout preview and choose another photo? The current edit will not be applied.'
      : '放弃当前抠图预览并换一张照片吗？当前修改不会采用。', {
        title: appLanguage === 'en' ? 'Discard this cutout?' : '放弃当前抠图？',
        confirmLabel: appLanguage === 'en' ? 'Discard and choose' : '放弃并换图', danger: true
      })) return;
    openGalleryPicker(true);
  });
  ui.originalCropShapes.forEach((button) => button.addEventListener('click', () => {
    if (ui.originalCropApply.disabled) return;
    originalCropShape = button.dataset.originalCropShape === 'circle' ? 'circle' : 'rounded';
    ui.originalCropShapes.forEach((choice) => {
      const selected = choice === button;
      choice.classList.toggle('selected', selected);
      choice.setAttribute('aria-pressed', String(selected));
    });
    renderOriginalCropLabels();
    scheduleOriginalCropPreview();
  }));
  ui.originalCropZoom.addEventListener('input', () => {
    if (ui.originalCropApply.disabled) return;
    originalCropZoom = Number(ui.originalCropZoom.value) || 1;
    updateOriginalCropZoomControl();
    originalCropRect();
    scheduleOriginalCropPreview();
  });
  ui.originalCropPreview.addEventListener('pointerdown', (event) => {
    if (!pendingCutout || ui.originalCropApply.disabled) return;
    event.preventDefault();
    originalCropPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    document.documentElement.classList.add('crop-gesture-active');
    try { ui.originalCropPreview.setPointerCapture(event.pointerId); } catch { /* Capture is optional in older WebViews. */ }
    startOriginalCropGesture();
  });
  ui.originalCropPreview.addEventListener('pointermove', (event) => {
    if (!originalCropPointers.has(event.pointerId) || ui.originalCropApply.disabled) return;
    event.preventDefault();
    originalCropPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    updateOriginalCropGesture();
  });
  const finishOriginalCropGesture = (event) => {
    if (!originalCropPointers.has(event.pointerId)) return;
    event.preventDefault();
    originalCropPointers.delete(event.pointerId);
    if (originalCropPointers.size === 0) {
      originalCropGesture = null;
      document.documentElement.classList.remove('crop-gesture-active');
    } else {
      startOriginalCropGesture();
    }
  };
  ui.originalCropPreview.addEventListener('pointerup', finishOriginalCropGesture);
  ui.originalCropPreview.addEventListener('pointercancel', finishOriginalCropGesture);
  ui.originalCropPreview.addEventListener('lostpointercapture', finishOriginalCropGesture);
  ui.originalCropPreview.addEventListener('keydown', (event) => {
    const crop = originalCropRect();
    if (!crop || ui.originalCropApply.disabled) return;
    const step = crop.side / 24;
    if (event.key === 'ArrowLeft') originalCropCenterX -= step;
    else if (event.key === 'ArrowRight') originalCropCenterX += step;
    else if (event.key === 'ArrowUp') originalCropCenterY -= step;
    else if (event.key === 'ArrowDown') originalCropCenterY += step;
    else return;
    event.preventDefault();
    originalCropRect();
    scheduleOriginalCropPreview();
  });
  ui.originalCropBack.addEventListener('click', returnToCutoutPreview);
  ui.originalCropClose.addEventListener('click', returnToCutoutPreview);
  ui.originalCropApply.addEventListener('click', applyOriginalCrop);
  ui.cutoutCancel.addEventListener('click', closeCutoutPreview);
  ui.cutoutClose.addEventListener('click', closeCutoutPreview);
  ui.cutoutOriginalOnly.addEventListener('click', () => applyCutoutChoice('original'));
  ui.cutoutCutoutOnly.addEventListener('click', () => applyCutoutChoice('cutout'));
  ui.cutoutNeither.addEventListener('click', () => applyCutoutChoice('neither'));
  ui.cutoutCanvas.addEventListener('pointerdown', handleCutoutPointerDown);
  ui.cutoutCanvas.addEventListener('pointermove', handleCutoutPointerMove);
  ui.cutoutCanvas.addEventListener('pointerup', handleCutoutPointerEnd);
  ui.cutoutCanvas.addEventListener('pointercancel', handleCutoutPointerEnd);
  ui.cutoutCanvas.addEventListener('pointerleave', () => {
    if (pendingCutout && !pendingCutout.brushActive && pendingCutout.brushCursor) {
      pendingCutout.brushCursor = null;
      drawCutoutCanvas();
    }
  });
  ui.cutoutBrushSize.addEventListener('input', () => {
    cutoutBrushSize = Number(ui.cutoutBrushSize.value) || 28;
    ui.cutoutBrushSizeValue.textContent = `${cutoutBrushSize} px`;
    drawCutoutCanvas();
  });
  ui.cutoutOutlineEnabled.addEventListener('change', () => {
    cutoutOutlineEnabled = ui.cutoutOutlineEnabled.checked;
    updateCutoutToolAvailability();
    if (pendingCutout?.editReady && !cutoutBusy) saveCutoutBrushResult(pendingCutout);
  });
  ui.cutoutOutlineWidth.addEventListener('input', () => {
    cutoutOutlineSize = Number(ui.cutoutOutlineWidth.value) || 4;
    ui.cutoutOutlineWidthValue.textContent = `${cutoutOutlineSize} px`;
  });
  ui.cutoutOutlineWidth.addEventListener('change', () => {
    if (pendingCutout?.editReady && !cutoutBusy && cutoutOutlineEnabled) saveCutoutBrushResult(pendingCutout);
  });
  ui.cutoutUndo.addEventListener('click', () => changeCutoutHistory('undo'));
  ui.cutoutRedo.addEventListener('click', () => changeCutoutHistory('redo'));
  ui.cutoutPositiveMode.addEventListener('click', () => setCutoutTool('keep'));
  ui.cutoutNegativeMode.addEventListener('click', () => setCutoutTool('remove'));
  ui.cutoutEraseMode.addEventListener('click', () => setCutoutTool('erase'));
  ui.cutoutRestoreMode.addEventListener('click', () => setCutoutTool('restore'));
  ui.cutoutClearPoints.addEventListener('click', clearCutoutPoints);
  ui.cutoutModal.addEventListener('click', (event) => {
    if (event.target.matches('[data-cutout-close]')) closeCutoutPreview();
  });
  window.onCueAndroidBackPressed = () => {
    if (closeChoiceDialog) {
      closeChoiceDialog();
      return true;
    }
    if (!ui.folderOperationModal.classList.contains('hidden')) {
      closeFolderOperation();
      return true;
    }
    if (!ui.accentEyedropperModal.classList.contains('hidden')) {
      closeAccentEyedropper();
      return true;
    }
    if (!ui.uploadConfirmModal.classList.contains('hidden')) {
      closeUploadConfirmation();
      return true;
    }
    if (!ui.renameModal.classList.contains('hidden')) {
      closeRenameDialog();
      return true;
    }
    if (!ui.originalCropModal.classList.contains('hidden')) {
      returnToCutoutPreview();
      return true;
    }
    if (!ui.cutoutModal.classList.contains('hidden')) {
      closeCutoutPreview();
      return true;
    }
    if (!ui.moveModal.classList.contains('hidden')) {
      closeMoveDialog();
      return true;
    }
    if (!ui.walkthroughModal.classList.contains('hidden')) {
      ui.walkthroughModal.classList.add('hidden');
      return true;
    }
    if (settingsRepoPickerOpen && activeScreen === 'settings') {
      settingsRepoPickerOpen = false;
      if (selectedOwner && selectedRepoName) ui.settingsConnectionSummary.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else setActiveScreen('settings', 'home');
      return true;
    }
    if (activeScreen === 'settings' && activeSettingsPage !== 'home') {
      setActiveScreen('settings', 'home');
      return true;
    }
    if (activeScreen === 'library' && canGoBackInCategoryBrowser()) {
      goCategoryBrowserBack();
      return true;
    }
    if (activeScreen !== 'library') {
      setActiveScreen('library');
      return true;
    }
    return false;
  };
  ui.moveDestination.addEventListener('change', () => {
    const destination = categories.find((category) => category.path === ui.moveDestination.value);
    refreshMoveImageDirectoryOptions(destination, true);
    renderMovePreview();
  });
  ui.moveImageDirectory.addEventListener('change', renderMovePreview);
  ui.moveConfirm.addEventListener('click', stageMove);
  ui.moveCancel.addEventListener('click', closeMoveDialog);
  ui.moveClose.addEventListener('click', closeMoveDialog);
  ui.moveModal.addEventListener('click', (event) => {
    if (event.target.matches('[data-move-close]')) closeMoveDialog();
  });
  ui.categoryCreateFolder.addEventListener('click', () => openFolderOperation('create'));
  ui.folderOperationName.addEventListener('input', renderFolderOperationPreview);
  ui.folderOperationName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      stageFolderOperation();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeFolderOperation();
    }
  });
  ui.folderOperationDestination.addEventListener('change', renderFolderOperationPreview);
  ui.folderOperationStage.addEventListener('click', stageFolderOperation);
  ui.folderOperationCancel.addEventListener('click', closeFolderOperation);
  ui.folderOperationClose.addEventListener('click', closeFolderOperation);
  ui.folderOperationModal.addEventListener('click', (event) => {
    if (event.target.matches('[data-folder-operation-close]')) closeFolderOperation();
  });
  ui.renameInput.addEventListener('input', updateRenameCount);
  ui.renameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitRenameDialog();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeRenameDialog();
    }
  });
  ui.renameConfirm.addEventListener('click', submitRenameDialog);
  ui.renameCancel.addEventListener('click', () => closeRenameDialog());
  ui.renameClose.addEventListener('click', () => closeRenameDialog());
  ui.renameModal.addEventListener('click', (event) => {
    if (event.target.matches('[data-rename-close]')) closeRenameDialog();
  });
  ui.renameCategory.addEventListener('click', stageCategoryNameRename);
  ui.saveStaged.addEventListener('click', () => { commitStagedChanges(); });
  ui.discardStaged.addEventListener('click', () => {
    if (busy || (!stagedCategories.size && !stagedMoves.length && !folderOperations.length)) return;
    stagedCategories.clear();
    stagedMoves.length = 0;
    if (folderStageSnapshot) {
      categories = folderStageSnapshot.categories.map((category) => ({ ...category, data: JSON.parse(JSON.stringify(category.data)), icons: category.icons.map((entry) => ({ ...entry })) }));
      repositoryDirectories = new Set(folderStageSnapshot.directories);
      activeCategoryPath = folderStageSnapshot.activeCategoryPath;
      categoryBrowsePath = folderStageSnapshot.categoryBrowsePath;
    }
    resetFolderStageState();
    updateStagedUi();
    renderCategories();
    renderActiveCategory();
    syncLockedControls();
    showStatus(appLanguage === 'en' ? 'Pending icon, image-file, index and folder changes were discarded locally.' : '已在本机撤销尚未提交的图标、图片文件、索引和文件夹变更。', 'info');
  });
  ui.uploadButton.addEventListener('click', () => {
    uploadSelected().catch((error) => showStatus(error.message || '上传失败。', 'error'));
  });
  ui.uploadConfirmCancel.addEventListener('click', closeUploadConfirmation);
  ui.uploadConfirmClose.addEventListener('click', closeUploadConfirmation);
  ui.uploadConfirmRepository.addEventListener('change', () => {
    const [owner, ...nameParts] = ui.uploadConfirmRepository.value.split('/');
    if (!owner || !nameParts.length) return;
    loadUploadTargetRepository(owner, nameParts.join('/')).catch((error) => uploadTargetError(error.message || '无法读取所选仓库。'));
  });
  ui.uploadConfirmBranch.addEventListener('change', () => {
    const context = uploadTargetContext;
    const targetBranch = ui.uploadConfirmBranch.value;
    if (!context || !targetBranch || !context.branches.includes(targetBranch)) return;
    const generation = ++uploadTargetLoadSequence;
    uploadTargetState = null;
    ui.uploadConfirmSubmit.disabled = true;
    for (const select of [ui.uploadConfirmCategory, ui.uploadConfirmIndex, ui.uploadConfirmDirectory]) {
      select.disabled = true;
      setUploadSelectOptions(select, [], '', appLanguage === 'en' ? 'Loading…' : '正在读取…');
    }
    loadUploadTargetBranch(context.owner, context.repositoryName, targetBranch, generation).catch((error) => {
      if (generation === uploadTargetLoadSequence) uploadTargetError(error.message || '无法读取所选分支。');
    });
  });
  ui.uploadConfirmCategory.addEventListener('change', () => {
    const path = ui.uploadConfirmCategory.value;
    ui.uploadConfirmIndex.value = path;
    updateUploadTargetDirectories(path);
    refreshUploadPlanPreview();
  });
  ui.uploadConfirmIndex.addEventListener('change', () => {
    const path = ui.uploadConfirmIndex.value;
    ui.uploadConfirmCategory.value = path;
    updateUploadTargetDirectories(path);
    refreshUploadPlanPreview();
  });
  ui.uploadConfirmDirectory.addEventListener('change', refreshUploadPlanPreview);
  ui.uploadConfirmSubmit.addEventListener('click', () => {
    confirmPendingUpload().catch((error) => showStatus(error.message || '上传失败，请重试。', 'error'));
  });
  ui.uploadConfirmModal.addEventListener('click', (event) => {
    if (event.target.matches('[data-upload-confirm-close]')) closeUploadConfirmation();
  });
  ui.accentColorChoices.forEach((button) => button.addEventListener('click', () => {
    const color = button.dataset.accentColor || '';
    const names = {
      '': ['雾紫', 'Mist purple'], '#7899c5': ['冰川蓝', 'Glacier blue'],
      '#c27b96': ['樱花粉', 'Sakura pink'], '#789985': ['薄荷绿', 'Mint green'],
      '#cc956d': ['奶油杏', 'Cream apricot'], '#679598': ['海盐青', 'Sea-salt teal'],
      '#818b99': ['云雾灰', 'Cloud gray']
    };
    const name = names[color.toLowerCase()] || ['自定义', 'Custom'];
    stageAccentColor(color, name[0], name[1], 'preset');
  }));
  ui.systemColorToggle.addEventListener('change', updateAccentSelection);
  ui.useWallpaperColorButton.addEventListener('click', useWallpaperAccentColor);
  ui.chooseThemeImageButton.addEventListener('click', () => ui.themeImageInput.click());
  ui.themeImageInput.addEventListener('change', () => {
    const file = ui.themeImageInput.files?.[0];
    if (file) sampleAccentFromImage(file);
    ui.themeImageInput.value = '';
  });
  ui.accentEyedropperImage.addEventListener('pointerdown', (event) => {
    if (!ui.accentEyedropperImage.naturalWidth) return;
    event.preventDefault();
    accentEyedropperPointerActive = true;
    try { ui.accentEyedropperImage.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional in older WebViews. */ }
    sampleAccentPixelAt(event);
  });
  ui.accentEyedropperImage.addEventListener('pointermove', (event) => {
    if (!accentEyedropperPointerActive) return;
    event.preventDefault();
    sampleAccentPixelAt(event);
  });
  const finishAccentEyedropperPointer = () => { accentEyedropperPointerActive = false; };
  ui.accentEyedropperImage.addEventListener('pointerup', finishAccentEyedropperPointer);
  ui.accentEyedropperImage.addEventListener('pointercancel', finishAccentEyedropperPointer);
  ui.accentEyedropperImage.addEventListener('lostpointercapture', finishAccentEyedropperPointer);
  ui.accentEyedropperCancel.addEventListener('click', closeAccentEyedropper);
  ui.accentEyedropperClose.addEventListener('click', closeAccentEyedropper);
  ui.accentEyedropperModal.addEventListener('click', (event) => {
    if (event.target.matches('[data-accent-eyedropper-close]')) closeAccentEyedropper();
  });
  ui.accentEyedropperApply.addEventListener('click', () => {
    if (!/^#[0-9a-f]{6}$/i.test(accentEyedropperColor)) return;
    stageAccentColor(accentEyedropperColor, '图片像素', 'Image pixel', 'gallery');
    closeAccentEyedropper();
  });
  ui.libraryRefreshButton.addEventListener('click', refreshCurrentLibrary);
  ui.categoryBrowserBack.addEventListener('click', goCategoryBrowserBack);
  ui.cacheRefreshButton.addEventListener('click', refreshCacheInfo);
  ui.cacheClearButton.addEventListener('click', clearManagedCache);
  ui.searchInput.addEventListener('input', renderIcons);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && closeChoiceDialog) {
      closeChoiceDialog();
      return;
    }
    if (event.key === 'Escape' && !ui.accentEyedropperModal.classList.contains('hidden')) {
      closeAccentEyedropper();
      return;
    }
    if (event.key === 'Escape' && !ui.uploadConfirmModal.classList.contains('hidden')) {
      closeUploadConfirmation();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !ui.cutoutModal.classList.contains('hidden')) {
      event.preventDefault();
      changeCutoutHistory(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (event.key === 'Escape' && !ui.cutoutModal.classList.contains('hidden')) {
      closeCutoutPreview();
      return;
    }
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !ui.workspace.classList.contains('hidden')) {
      event.preventDefault();
      ui.searchInput.focus();
    }
    if (event.key === 'Escape' && document.activeElement === ui.searchInput) ui.searchInput.blur();
  });
  const savedToken = window.CueTokenStore?.getSavedToken?.() || '';
  tokenSaved = Boolean(savedToken);
  ui.savedTokenDisplay.type = 'password';
  ui.savedTokenDisplay.value = savedToken;
  ui.forgetTokenButton.classList.toggle('hidden', !savedToken);
  accessibleRepositories = loadCachedRepositories();
  renderRepositoryChoices(accessibleRepositories);
  const savedSelection = readSavedRepository();
  const hasRestoredSnapshot = Boolean(savedToken && savedSelection
    && applyCachedLibrarySnapshot(savedSelection.owner, savedSelection.name));
  if (hasRestoredSnapshot) {
    setActiveScreen('library');
    showStatus(appLanguage === 'en'
      ? 'Restored the last library from this device; checking GitHub for updates. Editing stays locked until that check succeeds.'
      : '已从本机恢复上次打开的图标库，正在校验 GitHub 更新；校验成功前暂不允许编辑。', 'info');
  }
  if (savedToken) {
    token = savedToken;
    setConnected(hasRestoredSnapshot);
    if (accessibleRepositories.length) {
      const lastRepository = savedSelection;
      if (lastRepository) {
        const cachedMatch = accessibleRepositories.find((item) =>
          item.owner.login.toLowerCase() === lastRepository.owner.toLowerCase()
          && item.name.toLowerCase() === lastRepository.name.toLowerCase());
        if (cachedMatch) {
          if (!hasRestoredSnapshot) setActiveScreen('settings', 'account');
          selectRepository(cachedMatch, { restoring: true, preserveSnapshot: hasRestoredSnapshot }).then((opened) => {
            if (!opened) {
              if (hasRestoredSnapshot && categories.length) {
                setActiveScreen('library');
                setConnected(true);
                showStatus(appLanguage === 'en'
                  ? 'Could not verify the cached library with GitHub. The saved view and selection are kept; check the connection or token and use “Refresh current library” to try again.'
                  : '暂时无法通过 GitHub 校验本机图标库；已保留当前显示和仓库选择。检查网络或 Token 后，可点“刷新当前图标库”重试。', 'info');
              } else {
                setActiveScreen('settings', 'account');
                setConnected(false);
                ui.repoPickerError.textContent = appLanguage === 'en'
                  ? 'The saved library could not be loaded. Your repository selection was kept; check the connection or token, then retry.'
                  : '无法加载已保存的图标库；仓库选择已保留。请检查网络或 Token 后重试。';
                ui.repoPickerError.classList.remove('hidden');
                renderRepositoryChoices(accessibleRepositories);
              }
            }
            if (!guideCompletionStored()) openWalkthrough();
          });
        } else {
          if (hasRestoredSnapshot) {
            setActiveScreen('library');
            findRepositories(savedToken).finally(() => {
              if (librarySnapshotStale) showStatus(appLanguage === 'en'
                ? 'Showing the saved library snapshot. The repository list could not verify access; the previous selection is still kept.'
                : '当前显示本机图标库快照；仓库清单暂未能校验访问权限，之前的仓库选择仍已保留。', 'info');
              if (!guideCompletionStored()) openWalkthrough();
            });
          } else {
            setActiveScreen('settings', 'account');
            ui.repoPickerError.textContent = appLanguage === 'en'
              ? 'The last-used repository is not in the cached list. Your selection is kept; refresh the repository list or choose another library if you want to switch.'
              : '上次使用的仓库不在本机仓库清单中；原选择已保留，可刷新清单或在想切换时选择其他图标库。';
            ui.repoPickerError.classList.remove('hidden');
            if (!guideCompletionStored()) openWalkthrough();
          }
        }
      } else {
        setActiveScreen('settings', 'account');
        if (!guideCompletionStored()) openWalkthrough();
      }
    } else {
      if (!hasRestoredSnapshot) setActiveScreen('settings', 'account');
      findRepositories(savedToken).finally(() => {
        if (hasRestoredSnapshot && librarySnapshotStale) showStatus(appLanguage === 'en'
          ? 'The saved library remains available on this device, but GitHub could not be reached to verify it.'
          : '本机仍保留上次的图标库内容，但暂时无法连接 GitHub 进行校验。', 'info');
        if (!guideCompletionStored()) openWalkthrough();
      });
    }
  } else {
    setActiveScreen('library');
    if (!guideCompletionStored()) openWalkthrough();
  }
  window.addEventListener('pagehide', () => {
    token = '';
    ui.savedTokenDisplay.value = '';
    ui.savedTokenDisplay.type = 'password';
    ui.savedTokenReplacement.value = '';
    ui.savedTokenReplacement.type = 'password';
    ui.tokenInput.value = '';
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      token = window.CueTokenStore?.getSavedToken?.() || '';
      tokenSaved = Boolean(token);
      ui.savedTokenDisplay.value = token;
      ui.savedTokenDisplay.type = 'password';
      ui.tokenInput.value = '';
      setConnected(false);
    }
  });
})();
