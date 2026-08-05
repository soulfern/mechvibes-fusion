'use strict';

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { ConfigStore } = require('./config-store');

// Play audio on global key/mouse events without requiring an in-app
// user gesture (same switch MechVibes++ sets).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Windows uses the AppUserModelId as the notification source name. A dotted
// reverse-DNS id makes Windows show "com.mechvibes.fusion"; using the bare
// product name makes the toast title read just "Mechvibes Fusion". Same
// approach Electron apps without an installer use for portable toasts.
app.setAppUserModelId('MechvibesFusion');

const isMac = process.platform === 'darwin';
const TRAY_ICON = path.join(__dirname, '..', '..', 'assets', 'icon.ico');
const APP_ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');

let win = null;
let tray = null;
let store = null;
let isQuitting = false;
let closeToTrayNotified = false;

const soundpacksRoot = () => path.join(app.getPath('userData'), 'soundpacks');
const keyboardCustomDir = () => path.join(soundpacksRoot(), 'keyboard');
const mouseCustomDir = () => path.join(soundpacksRoot(), 'mouse');
const bundledSoundpacksDir = () => path.join(__dirname, '..', 'soundpacks');

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 760,
    resizable: false,
    show: false,
    backgroundColor: '#131313',
    frame: false,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    webPreferences: {
      // The renderer runs the audio engine (howler) and global input hook
      // (uiohook-napi), so it needs node integration — same model as
      // MechVibes++. The UI layer stays a plain HTML/CSS/JS page.
      contextIsolation: false,
      nodeIntegration: true,
      backgroundThrottling: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.once('ready-to-show', () => win.show());

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => { win = null; });
  return win;
}

// Smoke-test mode: set MVF_SMOKE=1 to boot the app, log renderer console
// messages, then auto-quit so it can be verified non-interactively.
function enableSmokeMode() {
  if (process.env.MVF_SMOKE !== '1') return;
  win.webContents.on('console-message', (event) => {
    console.log('[renderer]', event.message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.log('[renderer] FAILED LOAD', code, desc);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[renderer] GONE', JSON.stringify(details));
  });
  win.once('ready-to-show', () => {
    setTimeout(() => {
      console.log('[smoke] window shown; quitting cleanly');
      isQuitting = true;
      app.quit();
    }, 4000);
  });
}

function buildTrayMenu() {
  const s = store.get();
  return Menu.buildFromTemplate([
    {
      label: 'Show Mechvibes Fusion',
      click: () => showWindow()
    },
    { type: 'separator' },
    {
      label: 'Keyboard',
      type: 'checkbox',
      checked: !!s.sound.keyboardEnabled,
      click: (item) => updateSetting('sound.keyboardEnabled', item.checked)
    },
    {
      label: 'Mouse',
      type: 'checkbox',
      checked: !!s.sound.mouseEnabled,
      click: (item) => updateSetting('sound.mouseEnabled', item.checked)
    },
    {
      label: 'Key-up sounds',
      type: 'checkbox',
      checked: !!s.sound.keyup,
      click: (item) => updateSetting('sound.keyup', item.checked)
    },
    {
      label: 'Random sounds',
      type: 'checkbox',
      checked: !!s.sound.random,
      click: (item) => updateSetting('sound.random', item.checked)
    },
    { type: 'separator' },
    {
      label: 'Open soundpack folder',
      click: () => shell.openPath(soundpacksRoot())
    },
    {
      label: 'Refresh soundpacks',
      click: () => sendToRenderer('packs:refresh')
    },
    {
      label: 'Quit',
      click: () => { isQuitting = true; app.quit(); }
    }
  ]);
}

function updateSetting(dotted, value) {
  store.setValue(dotted, value);
  if (dotted === 'system.startAtLogin') {
    app.setLoginItemSettings({ openAtLogin: !!value });
  }
  sendToRenderer('settings:changed', dotted, value);
  syncTray();
  return store.get();
}

function sendToRenderer(channel, ...args) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function syncTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function registerIpc() {
  ipcMain.handle('settings:get', () => store.get());
  ipcMain.handle('settings:update', (_e, dotted, value) => updateSetting(dotted, value));
  ipcMain.handle('app:info', () => ({ name: 'Mechvibes Fusion', version: app.getVersion(), platform: process.platform }));
  ipcMain.handle('app:dirs', () => ({
    soundpacks: soundpacksRoot(),
    keyboardCustom: keyboardCustomDir(),
    mouseCustom: mouseCustomDir(),
    keyboardBundled: path.join(soundpacksRoot(), 'bundled', 'keyboard'),
    mouseBundled: path.join(soundpacksRoot(), 'bundled', 'mouse')
  }));
  ipcMain.handle('packs:openFolder', () => shell.openPath(soundpacksRoot()));
  ipcMain.handle('open:external', (_e, url) => shell.openExternal(url));

  // Keycap icon as a data URL. Read via fs from the main process, which CAN
  // read inside app.asar (the renderer's file:// URL cannot), so the logo
  // renders in both dev and the packaged portable exe.
  ipcMain.handle('app:icon', () => {
    try {
      const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
      if (!fs.existsSync(iconPath)) return null;
      const data = fs.readFileSync(iconPath);
      return `data:image/png;base64,${data.toString('base64')}`;
    } catch (e) {
      return null;
    }
  });

  // Lexend Deca as a data URL — main fs reads inside app.asar, so the font
  // loads in both dev and the packaged exe (renderer file:// cannot).
  ipcMain.handle('app:font', () => {
    try {
      const fontPath = path.join(__dirname, '..', '..', 'assets', 'fonts', 'LexendDeca-Regular.ttf');
      if (!fs.existsSync(fontPath)) return null;
      const data = fs.readFileSync(fontPath);
      return `data:font/ttf;base64,${data.toString('base64')}`;
    } catch (e) {
      return null;
    }
  });

  ipcMain.on('win:minimize', () => win && win.minimize());
  // X hides to tray (real quit lives in the tray menu); show a one-time
  // notification so users know the app keeps running.
  ipcMain.on('win:close', () => {
    if (!win) return;
    win.hide();
    if (!closeToTrayNotified) {
      closeToTrayNotified = true;
      new Notification({ title: 'Mechvibes Fusion', body: 'Still running in the system tray. Use the tray menu to quit.', icon: APP_ICON }).show();
    }
  });
}

function ensureCustomDirs() {
  for (const d of [keyboardCustomDir(), mouseCustomDir()]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

// Copy bundled soundpacks out of app.asar into userData, so the renderer's
// fs and howler (which cannot read inside asar) can load their config.json
// and audio files. fs.cpSync cannot copy FROM asar (it's a read-only virtual
// FS), so each file is read via readFileSync (which works in asar) and
// written to disk individually. A pack counts as extracted only when its
// config.json exists on disk; a stale dir gets force-recopied.
function extractBundledPacks() {
  const src = path.join(__dirname, '..', 'soundpacks');
  const dest = path.join(soundpacksRoot(), 'bundled');
  const copyTree = (from, to) => {
    let entries = [];
    try { entries = fs.readdirSync(from, { withFileTypes: true }); } catch (e) { return; }
    fs.mkdirSync(to, { recursive: true });
    for (const ent of entries) {
      const f = path.join(from, ent.name);
      const t = path.join(to, ent.name);
      if (ent.isDirectory()) {
        copyTree(f, t);
      } else {
        try { fs.writeFileSync(t, fs.readFileSync(f)); } catch (e) { /* skip unreadable */ }
      }
    }
  };
  for (const kind of ['keyboard', 'mouse']) {
    const srcDir = path.join(src, kind);
    const destDir = path.join(dest, kind);
    let entries = [];
    try { entries = fs.readdirSync(srcDir, { withFileTypes: true }); } catch (e) { continue; }
    fs.mkdirSync(destDir, { recursive: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const srcPack = path.join(srcDir, ent.name);
      const destPack = path.join(destDir, ent.name);
      const done = fs.existsSync(path.join(destPack, 'config.json'));
      if (done) continue; // fully extracted already
      try { fs.rmSync(destPack, { recursive: true, force: true }); } catch (e) { /* ignore */ }
      copyTree(srcPack, destPack);
    }
  }
  return path.join(dest, 'keyboard'); // caller maps custom + bundled below
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.on('ready', () => {
    ensureCustomDirs();
    const bundledRoot = extractBundledPacks();
    store = new ConfigStore(path.join(app.getPath('userData'), 'config.json'));
    store.load();

    // restore start-at-login preference
    app.setLoginItemSettings({ openAtLogin: !!store.get().system.startAtLogin });

    win = createWindow();
    enableSmokeMode();
    registerIpc();

    tray = new Tray(TRAY_ICON);
    tray.setToolTip('Mechvibes Fusion'); // productName casing: Mechvibes Fusion
    tray.setContextMenu(buildTrayMenu());
    tray.on('double-click', () => showWindow());

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });
}

app.on('window-all-closed', () => {
  // Keep running in the tray unless explicitly quitting (Windows/Linux).
  if (!isQuitting && process.platform !== 'darwin') {
    // no-op: stay alive in tray
  } else {
    app.quit();
  }
});

app.on('before-quit', () => { isQuitting = true; });
