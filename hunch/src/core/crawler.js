// Walks the folders the user chose and yields plain files worth indexing.
const fs = require('node:fs/promises');
const path = require('node:path');

const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'appdata', 'system volume information', '$recycle.bin',
  'venv', '.venv', 'site-packages', '.git', '.svn', '.hg', '.cache', '.idea', '.vscode', '.gradle', '.m2',
  'bower_components', '.next', '.nuxt', 'my games', 'windowspowershell']);
const SKIP_FILES = new Set(['desktop.ini', 'thumbs.db', '.ds_store', 'ntuser.dat', 'icon\r']);
const SKIP_EXTS = new Set(['tmp', 'temp', 'part', 'crdownload', 'download', 'lnk', 'url', 'partial', 'lock', 'swp', 'bak', 'dll', 'sys', 'pyc', 'class', 'o', 'obj']);
const MAX_DEPTH = 14;

// Cloud-sync folders whose files may be online-only; reading them would download them.
const CLOUD_RE = /(^|[\\/])(onedrive( - [^\\/]+)?|dropbox|google drive|googledrive|icloud ?drive|box|mega)([\\/]|$)/i;
const isCloudPath = (p) => CLOUD_RE.test(p);

function skipFile(name) {
  const lower = name.toLowerCase();
  if (SKIP_FILES.has(lower) || lower.startsWith('~$') || lower.startsWith('.')) return true;
  const i = lower.lastIndexOf('.');
  return i > 0 && SKIP_EXTS.has(lower.slice(i + 1));
}

const skipDir = (name) => name.startsWith('.') || name.startsWith('$') || SKIP_DIRS.has(name.toLowerCase());

/**
 * Yields { path, size, mtime, ctime } for every file under `root`.
 * `shouldStop()` lets a rescan be cancelled.
 */
async function* walk(root, { shouldStop = () => false, maxFiles = 200000 } = {}) {
  let count = 0;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    if (shouldStop()) return;
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // no permission, vanished, not a folder
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH && !skipDir(e.name)) stack.push({ dir: full, depth: depth + 1 });
      } else if (e.isFile() && !skipFile(e.name)) {
        let st;
        try { st = await fs.stat(full); } catch { continue; }
        yield { path: full, size: st.size, mtime: Math.round(st.mtimeMs), ctime: Math.round(st.birthtimeMs || st.ctimeMs) };
        if (++count >= maxFiles) return;
      }
    }
  }
}

module.exports = { walk, skipFile, skipDir, isCloudPath };
