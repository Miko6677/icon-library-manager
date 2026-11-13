(() => {
  'use strict';

  function parentPath(path) {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? '' : path.slice(0, slash);
  }

  function isInside(path, folder) {
    return path === folder || path.startsWith(`${folder}/`);
  }

  function pathKey(path) {
    return String(path).normalize('NFC').toLocaleLowerCase();
  }

  function validateFolderName(value) {
    const name = String(value || '').normalize('NFC').trim();
    if (!name || name === '.' || name === '..' || name.length > 120
        || /[\\/\u0000-\u001f\u007f]/.test(name) || name.toLowerCase() === '.git') {
      return { valid: false, name, reason: 'invalid-name' };
    }
    return { valid: true, name };
  }

  function isCategoryFolder(path, directories) {
    if (typeof path !== 'string' || !directories.has(path)) return false;
    const root = path.split('/')[0].toLowerCase();
    return (root === 'icon' || root === 'icons') && !path.startsWith('/') && !path.split('/').includes('..');
  }

  function occupiedPaths(directories, files, excludedFolder = '') {
    const paths = [];
    for (const directory of directories || []) {
      if ((!excludedFolder || !isInside(directory, excludedFolder))) paths.push(directory);
    }
    for (const file of files || []) {
      const path = typeof file === 'string' ? file : file?.path;
      if (path && (!excludedFolder || !isInside(path, excludedFolder))) paths.push(path);
    }
    return new Set(paths.map(pathKey));
  }

  function planCreateFolder({ parent, name, directories, files }) {
    if (!isCategoryFolder(parent, directories)) return { ok: false, reason: 'missing-parent' };
    const checked = validateFolderName(name);
    if (!checked.valid) return { ok: false, reason: checked.reason };
    const path = `${parent}/${checked.name}`;
    const occupied = occupiedPaths(directories, files);
    if (occupied.has(pathKey(path)) || occupied.has(pathKey(`${path}/.gitkeep`))) return { ok: false, reason: 'collision', path };
    return { ok: true, path, placeholderPath: `${path}/.gitkeep` };
  }

  function planRenameFolder({ folder, name, directories, files }) {
    if (!isCategoryFolder(folder, directories) || !folder.includes('/')) return { ok: false, reason: 'invalid-source' };
    const checked = validateFolderName(name);
    if (!checked.valid) return { ok: false, reason: checked.reason };
    const parent = parentPath(folder);
    const destination = `${parent}/${checked.name}`;
    if (destination === folder) return { ok: true, noOp: true, source: folder, destination };
    const occupied = occupiedPaths(directories, files, folder);
    if (occupied.has(pathKey(destination))) return { ok: false, reason: 'collision', path: destination };
    return { ok: true, source: folder, destination, fileMoves: [...(files || [])]
      .map((file) => typeof file === 'string' ? file : file?.path)
      .filter((path) => path && isInside(path, folder))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((from) => ({ from, to: `${destination}${from.slice(folder.length)}` })) };
  }

  function planMoveFolder({ folder, destinationFolder, directories, files }) {
    if (!isCategoryFolder(folder, directories) || !folder.includes('/')) return { ok: false, reason: 'invalid-source' };
    if (!isCategoryFolder(destinationFolder, directories)) return { ok: false, reason: 'missing-destination' };
    if (isInside(destinationFolder, folder)) return { ok: false, reason: 'into-self' };
    const destination = `${destinationFolder}/${folder.slice(folder.lastIndexOf('/') + 1)}`;
    if (destination === folder) return { ok: true, noOp: true, source: folder, destination, destinationFolder };
    const occupied = occupiedPaths(directories, files, folder);
    if (occupied.has(pathKey(destination))) return { ok: false, reason: 'collision', path: destination };
    return { ok: true, source: folder, destination, destinationFolder, fileMoves: [...(files || [])]
      .map((file) => typeof file === 'string' ? file : file?.path)
      .filter((path) => path && isInside(path, folder))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((from) => ({ from, to: `${destination}${from.slice(folder.length)}` })) };
  }

  function planDeleteFolder({ folder, directories, files }) {
    if (!isCategoryFolder(folder, directories) || !folder.includes('/')) return { ok: false, reason: 'invalid-source' };
    const paths = [...(files || [])]
      .map((file) => typeof file === 'string' ? file : file?.path)
      .filter((path) => path && isInside(path, folder))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return { ok: true, folder, paths, count: paths.length };
  }

  function mapSubtreePath(path, source, destination) {
    return isInside(path, source) ? `${destination}${path.slice(source.length)}` : path;
  }

  function rewriteIndexUrls(data, pathFromUrl, urlForPath) {
    const result = JSON.parse(JSON.stringify(data));
    let changed = false;
    if (Array.isArray(result.icons)) {
      result.icons = result.icons.map((entry) => {
        if (!entry || typeof entry !== 'object' || typeof entry.url !== 'string') return entry;
        const oldPath = pathFromUrl(entry.url);
        if (!oldPath) return entry;
        const nextPath = pathFromUrl.mapPath(oldPath);
        if (!nextPath || nextPath === oldPath) return entry;
        changed = true;
        return { ...entry, url: urlForPath(entry.url, nextPath) };
      });
    }
    return { data: result, changed };
  }

  const api = {
    parentPath,
    isInside,
    isCategoryFolder,
    validateFolderName,
    planCreateFolder,
    planRenameFolder,
    planMoveFolder,
    planDeleteFolder,
    mapSubtreePath,
    rewriteIndexUrls
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CueFolderOperations = api;
})();
