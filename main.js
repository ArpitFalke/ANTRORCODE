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
    icon: path.join(__dirname, 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.once('ready-to-show', () => win.show());   // paint only when ready — no white flash
  win.webContents.on('render-process-gone', (_e, details) => {
    try { if (details.reason !== 'clean-exit') win.webContents.reload(); } catch (e) {}
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url); // open legal/key links in the real browser
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  /* ── device commands: always behind a native permission dialog ── */
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

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
