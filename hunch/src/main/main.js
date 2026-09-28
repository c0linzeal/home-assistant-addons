// Electron main process: the window, settings (API keys encrypted with the OS keychain
// via safeStorage), and the bridge between the UI and the indexing engine.
const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme, safeStorage, nativeImage, Menu, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Engine, DEFAULT_SETTINGS } = require('../core/engine');
const { createDemoFiles, fakeJevTransport } = require('../core/demo');
const { CATEGORIES } = require('../core/taxonomy');

const DEMO = process.argv.includes('--demo') || process.env.HUNCH_DEMO === '1';
if (process.env.HUNCH_USER_DATA) app.setPath('userData', process.env.HUNCH_USER_DATA);
const DATA_DIR = DEMO ? path.join(app.getPath('userData'), 'demo') : app.getPath('userData');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const KEY_FIELDS = ['openrouterKey', 'openaiKey'];
const IS_MAC = process.platform === 'darwin';

let win = null;
let engine = null;
let settings = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// ---------- settings ----------

function loadSettings() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { /* first run */ }
  const s = { ...DEFAULT_SETTINGS, firstRunDone: false, view: 'list', inspector: true, ...raw };
  for (const k of KEY_FIELDS) {
    const v = raw[k];
    if (v && typeof v === 'object' && v.enc) {
      try { s[k] = safeStorage.decryptString(Buffer.from(v.enc, 'base64')); } catch { s[k] = ''; }
    }
  }
  return s;
}

function saveSettings() {
  const out = { ...settings };
  for (const k of KEY_FIELDS) {
    if (out[k] && safeStorage.isEncryptionAvailable()) out[k] = { enc: safeStorage.encryptString(out[k]).toString('base64') };
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(out, null, 2));
}

function defaultRoots() {
  const home = app.getPath('home');
  const paths = ['documents', 'desktop', 'downloads', 'pictures'].map((n) => {
    try { return app.getPath(n); } catch { return null; }
  });
  // Some systems map missing special folders to the home folder: skip those and duplicates.
  return [...new Set(paths)].filter((p) => p && p !== home && fs.existsSync(p));
}

/** What the renderer may see: never the keys themselves. */
function publicSettings() {
  const { openrouterKey, openaiKey, ...rest } = settings;
  return {
    ...rest,
    hasOpenrouterKey: !!openrouterKey,
    hasOpenaiKey: !!openaiKey,
    openrouterKeyHint: openrouterKey ? `…${openrouterKey.slice(-4)}` : '',
    openaiKeyHint: openaiKey ? `…${openaiKey.slice(-4)}` : '',
    keysEncrypted: safeStorage.isEncryptionAvailable(),
    demo: DEMO,
  };
}

// ---------- window ----------

function themeColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { bg: dark ? '#1e1e20' : '#ffffff', toolbar: dark ? '#2a2a2d' : '#f7f7f9', symbol: dark ? '#e5e5ea' : '#3a3a3c' };
}

function createWindow() {
  const c = themeColors();
  win = new BrowserWindow({
    width: 1220,
    height: 780,
    minWidth: 780,
    minHeight: 480,
    show: false,
    title: 'Hunch',
    backgroundColor: c.bg,
    icon: path.join(__dirname, '../../assets/icon.png'),
    titleBarStyle: 'hidden',
    ...(IS_MAC
      ? { trafficLightPosition: { x: 18, y: 19 }, vibrancy: 'sidebar', visualEffectState: 'followWindow' }
      : { titleBarOverlay: { color: c.toolbar, symbolColor: c.symbol, height: 52 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => send('focus', true));
  win.on('blur', () => send('focus', false));
  // Links open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  nativeTheme.on('updated', () => {
    const t = themeColors();
    if (!IS_MAC && win && !win.isDestroyed()) win.setTitleBarOverlay?.({ color: t.toolbar, symbolColor: t.symbol });
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function openExternal(url) {
  if (/^https:\/\/(openrouter\.ai|platform\.openai\.com|github\.com|docs\.typesafe\.ai)\//.test(url)) shell.openExternal(url);
}

function setMenu() {
  const template = [
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- engine ----------

async function startEngine() {
  settings = loadSettings();
  let jevTransport = null;
  if (DEMO) {
    const filesDir = path.join(DATA_DIR, 'files');
    const roots = fs.existsSync(filesDir)
      ? ['Documents', 'Desktop', 'Downloads', 'Pictures'].map((r) => path.join(filesDir, r))
      : await createDemoFiles(filesDir);
    settings.roots = roots;
    settings.firstRunDone = true;
    jevTransport = fakeJevTransport();
  } else if (!settings.roots.length && !settings.firstRunDone) {
    settings.roots = defaultRoots();
  }
  engine = new Engine({ indexPath: path.join(DATA_DIR, 'index.json'), settings, jevTransport });
  engine.on('status', (s) => send('status', s));
  engine.on('changed', () => send('changed', engine.overview()));
  // Indexing waits for the first-run choices, so nothing is read or sent before the user agrees.
  if (settings.firstRunDone) engine.start();
  else await engine.load();
}

const known = (p) => typeof p === 'string' && engine.records.has(p);

// ---------- thumbnails ----------

const thumbCache = new Map();
async function thumbnail(p, size) {
  const key = `${size}:${p}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const rec = engine.records.get(p);
  let url = null;
  if (process.platform === 'win32' || IS_MAC) {
    try {
      const img = await nativeImage.createThumbnailFromPath(p, { width: size, height: size });
      if (!img.isEmpty()) url = img.toDataURL();
    } catch { /* no shell thumbnail for this type */ }
  }
  if (!url && rec.group === 'image' && rec.size < 25 * 1024 * 1024) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      const scale = Math.min(1, size / Math.max(width, height));
      url = img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }).toDataURL();
    }
  }
  thumbCache.set(key, url);
  if (thumbCache.size > 800) thumbCache.delete(thumbCache.keys().next().value);
  return url;
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('init', () => ({
    platform: process.platform,
    settings: publicSettings(),
    overview: engine.overview(),
    status: engine.status(),
    defaultRoots: defaultRoots(),
    categories: Object.fromEntries(Object.entries(CATEGORIES).map(([id, c]) => [id, { label: c.label, color: c.color }])),
    version: app.getVersion(),
  }));
  ipcMain.handle('search', (_e, q) => engine.query(q));
  ipcMain.handle('browse', (_e, scope) => engine.browse(scope));
  ipcMain.handle('details', (_e, p) => (known(p) ? engine.details(p) : null));
  ipcMain.handle('thumb', (_e, p, size) => (known(p) ? thumbnail(p, Math.min(1024, Math.max(16, Number(size) || 64))) : null));
  ipcMain.handle('open', (_e, p) => (known(p) ? shell.openPath(p) : 'unknown file'));
  ipcMain.handle('reveal', (_e, p) => { if (known(p)) shell.showItemInFolder(p); });
  ipcMain.handle('copyPath', (_e, p) => { if (known(p)) clipboard.writeText(p); });
  ipcMain.handle('openExternal', (_e, url) => openExternal(url));
  ipcMain.on('startDrag', (e, p) => {
    if (!known(p)) return;
    const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/icon.png')).resize({ width: 48, height: 48 });
    e.sender.startDrag({ file: p, icon });
  });
  ipcMain.handle('contextMenu', (e, p) => new Promise((resolve) => {
    if (!known(p)) return resolve(null);
    const pick = (v) => () => resolve(v);
    Menu.buildFromTemplate([
      { label: 'Open', click: pick('open') },
      { label: 'Quick Look', click: pick('quicklook') },
      { type: 'separator' },
      { label: IS_MAC ? 'Show in Finder' : 'Show in Folder', click: pick('reveal') },
      { label: 'Copy Path', click: pick('copy') },
    ]).popup({ window: BrowserWindow.fromWebContents(e.sender), callback: () => resolve(null) });
  }));
  ipcMain.handle('pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections'], title: 'Choose folders for Hunch to search' });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('settings:set', (_e, patch) => {
    const clean = {};
    const allowed = ['roots', 'privateRoots', 'jevMode', 'redact', 'embeddings', 'readCloudFiles', 'jevModel', 'firstRunDone', 'view', 'inspector', ...KEY_FIELDS];
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
    if (clean.roots) clean.roots = [...new Set(clean.roots.filter((p) => typeof p === 'string' && fs.existsSync(p)))];
    for (const k of KEY_FIELDS) if (typeof clean[k] === 'string') clean[k] = clean[k].trim();
    const firstStart = clean.firstRunDone && !settings.firstRunDone;
    settings = { ...settings, ...clean };
    saveSettings();
    const engineKeys = Object.keys(clean).filter((k) => !['view', 'inspector', 'firstRunDone'].includes(k));
    if (engineKeys.length) engine.updateSettings(Object.fromEntries(engineKeys.map((k) => [k, settings[k]])));
    if (firstStart) engine.start();
    return publicSettings();
  });
  ipcMain.handle('rescan', () => { engine.rescan(); });
  ipcMain.handle('retag', () => { engine.retagAll(); });
  ipcMain.handle('tryDemo', () => { app.relaunch({ args: [...process.argv.slice(1), '--demo'] }); app.exit(0); });
  ipcMain.handle('status', () => engine.status());
}

// ---------- lifecycle ----------

app.whenReady().then(async () => {
  setMenu();
  await startEngine();
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting || !engine) return;
  e.preventDefault();
  quitting = true;
  try { await engine.stop(); } finally { app.quit(); }
});

app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
