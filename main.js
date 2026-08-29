/* ════════════════════════════════════════════════════════════════
   ANTROR Code — desktop app (Electron main process)
   A product by ANTROR.
   The renderer is the exact same web app; the main process adds
   native powers: run device commands (with a permission dialog),
   auto-save generated projects to disk, pick a workspace folder.
   ════════════════════════════════════════════════════════════════ */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

let win = null;

/* ── Windows stability hardening ──
   • single instance: a second launch just focuses the existing window
   • GPU acceleration off: the #1 crash source on Windows is flaky GPU
     drivers crashing the GPU process — software rendering is stable and
     plenty fast for an IDE-style UI
   • crashed renderer auto-reloads instead of leaving a dead white window */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.disableHardwareAcceleration();
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}
app.setAppUserModelId('com.antror.code');
process.on('uncaughtException', (err) => { try { console.error('[antror]', err); } catch (e) {} });

/* ── workspace folder (where generated projects are saved) ── */
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'antror-settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')); } catch (e) { return {}; }
}
function writeSettings(s) {
  try { fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true }); fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(s, null, 2)); } catch (e) {}
}
function workspace() {
  const s = readSettings();
  return s.workspace || path.join(os.homedir(), 'ANTRORCode');
}
function safeName(n) {
  return String(n || 'untitled').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'untitled';
}
/* write files with nested dirs; refuse path escapes */
function writeProjectFiles(baseDir, projName, files) {
  const projDir = path.join(baseDir, safeName(projName));
  const resolvedBase = path.resolve(projDir);
  let count = 0;
  for (const [rel, content] of Object.entries(files || {})) {
    const clean = String(rel).replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..');
    if (!clean.length) continue;
    const target = path.resolve(resolvedBase, ...clean);
    if (!target.startsWith(resolvedBase)) continue; // escape guard
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(content));
    count++;
  }
  return { dir: projDir, count };
}

/* ── startup splash: animated 3D logo, desktop only, web never sees it ── */
let splash = null;
let splashShownAt = 0;
function createSplash() {
  splash = new BrowserWindow({
    width: 360, height: 440, frame: false, resizable: false, movable: false,
    transparent: true, alwaysOnTop: true, center: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => { splash.show(); splashShownAt = Date.now(); });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    show: false,   // avoids the blank first paint; shown on ready-to-show
    title: 'ANTROR Code',
    icon: path.join(__dirname, 'favicon-3d.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.once('ready-to-show', () => {
    // sequence: splash plays its animation → closes → THEN the app appears. Never both.
    const elapsed = splash ? Date.now() - splashShownAt : 99999;
    const wait = Math.max(0, 1600 - elapsed);
    setTimeout(() => {
      try { if (splash) { splash.close(); splash = null; } } catch (e) {}
      win.show();
    }, wait);
  });
  win.webContents.on('did-fail-load', (e, code, _desc, url) => {
    // main frame failed (missing file etc.) → recover to the app instead of a black window
    if (e.isMainFrame && code !== -3 && !String(url || '').includes('index.html')) {
      try { win.loadFile('index.html'); } catch (err) {}
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    try { if (details.reason !== 'clean-exit') win.webContents.reload(); } catch (e) {}
  });
  // safety net: map clean URLs (/settings) and stray absolute paths to local files
  // so no in-app navigation can ever land on a blank screen
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file://')) return;
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') { shell.openExternal(url); e.preventDefault(); return; }
      let name = decodeURIComponent(u.pathname).replace(/^\/+/,'').replace(/\/+$/,'') || 'index';
      if (!/\.(html?|js|css|json|png|svg|ico|webmanifest)$/i.test(name)) name += '.html';
      e.preventDefault();
      win.loadFile(name);
    } catch (err) { e.preventDefault(); win.loadFile('index.html'); }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^blob:/.test(url)) {                                   // preview "New tab": real child window
      const w = new BrowserWindow({ autoHideMenuBar: true, backgroundColor: '#ffffff' });
      w.loadURL(url);
      return { action: 'deny' };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url); // open legal/key links in the real browser
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  /* ── in-app page navigation (settings/login/…) — loadFile always works ── */
  ipcMain.handle('antror:go', async (_e, page) => {
    const name = String(page || 'index').replace(/[^a-z0-9-]/gi, '') || 'index';
    try { await win.loadFile(name + '.html'); }
    catch (e) { try { await win.loadFile('index.html'); } catch (e2) {} }
  });

  /* ── OAuth inside the app: popup window, tokens captured, no browser hop ── */
  ipcMain.handle('antror:oauth', (_e, url) => {
    return new Promise((resolve) => {
      let done = false;
      const authWin = new BrowserWindow({
        parent: win, width: 520, height: 700, autoHideMenuBar: true,
        title: 'Sign in — ANTROR Code',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      const finish = (hash) => {
        if (done) return; done = true;
        try { win.webContents.send('antror:oauth-result', hash || ''); } catch (e) {}
        try { authWin.close(); } catch (e) {}
        resolve(hash || '');
      };
      const check = async () => {
        try {
          const href = await authWin.webContents.executeJavaScript('location.href', true);
          if (/[#&](access_token|error)=/.test(href)) finish('#' + (href.split('#')[1] || ''));
        } catch (e) { /* page may block eval — keep waiting */ }
      };
      authWin.webContents.on('did-navigate', check);
      authWin.webContents.on('did-navigate-in-page', check);
      authWin.on('closed', () => { if (!done) { done = true; try { win.webContents.send('antror:oauth-result', ''); } catch (e) {} resolve(''); } });
      authWin.loadURL(String(url || ''));
    });
  });

  /* ── device commands: always behind a native permission dialog ──
  ipcMain.handle('antror:runCommand', async (_e, cmd) => {
    const c = String(cmd || '').slice(0, 2000).trim();
    if (!c) return { code: 1, stdout: '', stderr: 'no command' };
    const r = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Allow', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'ANTROR Code — permission',
      message: 'ANTROR Code wants to run this command on your device:',
      detail: c,
    });
    if (r.response !== 0) return { denied: true };
    return new Promise((resolve) => {
      const child = exec(c, {
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
        cwd: workspace(),
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      }, (err, stdout, stderr) => {
        resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout || '').slice(0, 200000), stderr: String(stderr || '').slice(0, 50000) });
      });
      child.on('error', (e) => resolve({ code: 127, stdout: '', stderr: String(e.message) }));
    });
  });

  /* ── auto-save generated projects ── */
  ipcMain.handle('antror:writeProject', (_e, name, files) => {
    try {
      const base = workspace();
      fs.mkdirSync(base, { recursive: true });
      return writeProjectFiles(base, name, files);
    } catch (e) { return { error: String(e.message) }; }
  });
  ipcMain.handle('antror:getWorkspace', () => workspace());
  ipcMain.handle('antror:chooseWorkspace', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose where ANTROR Code saves projects' });
    if (r.canceled || !r.filePaths[0]) return null;
    const s = readSettings(); s.workspace = r.filePaths[0]; writeSettings(s);
    return r.filePaths[0];
  });

  createSplash();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
