'use strict';

// --- node integration (MechVibes++ model) ---
const path = require('node:path');
const { ipcRenderer } = require('electron');

// --- app modules ---
const { loadPacks, toDescriptor } = require('../main/services/soundpack-service');
const { AudioEngine } = require('./audio-engine');
const { InputService } = require('./input-service');

const $ = (sel) => document.querySelector(sel);

let settings = null;
let dirs = null;
let packManifests = { keyboard: [], mouse: [] };
let engine = null;
let input = null;

// ---- helpers ------------------------------------------------------------

function setToggle(id, checked) {
  const el = $(id);
  if (el) el.checked = !!checked;
}

function setSlider(id, value, fillId, valId) {
  const el = $(id);
  if (!el) return;
  el.value = value;
  const pct = (Number(value) / (Number(el.max) - Number(el.min))) * 100;
  el.style.setProperty('--slider-fill', pct + '%');
  if (valId) $(valId).textContent = String(value) + '%';
}

async function updateSetting(dotted, value) {
  settings = await ipcRenderer.invoke('settings:update', dotted, value);
}

// ---- window controls ----------------------------------------------------

function wireWindowControls() {
  $('#minimize-window')?.addEventListener('click', () => ipcRenderer.send('win:minimize'));
  $('#close-window')?.addEventListener('click', () => ipcRenderer.send('win:close'));
  $('#open-packs-btn')?.addEventListener('click', () => ipcRenderer.invoke('packs:openFolder'));
  $('#refresh-packs-btn')?.addEventListener('click', () => reloadAndApplyPacks());
}

// ---- pack dropdown (Hiraganized-style custom dropdown) --------------------

function populatePackSelect(containerId, manifests, selectedId, onChange) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = '';
  const dd = document.createElement('div');
  dd.className = 'dropdown';
  dd.innerHTML =
    '<button type="button" class="dropdown-trigger" aria-haspopup="listbox" aria-expanded="false">' +
      '<span class="dropdown-display"></span><span class="dropdown-caret" aria-hidden="true"></span>' +
    '</button>' +
    '<ul class="dropdown-menu" role="listbox"></ul>';
  const trigger = dd.querySelector('.dropdown-trigger');
  const display = dd.querySelector('.dropdown-display');
  const menu = dd.querySelector('.dropdown-menu');

  function close() {
    dd.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  function render() {
    menu.innerHTML = '';
    const groups = {};
    for (const m of manifests) (groups[m.group] = groups[m.group] || []).push(m);
    for (const g of Object.keys(groups)) {
      const sep = document.createElement('li');
      sep.className = 'dropdown-group-label';
      sep.textContent = g;
      menu.appendChild(sep);
      for (const m of groups[g]) {
        const item = document.createElement('li');
        item.setAttribute('role', 'option');
        item.dataset.value = m.id;
        item.textContent = m.name;
        if (m.id === selectedId) item.classList.add('active');
        item.addEventListener('click', () => {
          selectedId = m.id;
          display.textContent = m.name;
          close();
          menu.querySelectorAll('li[role=option]').forEach((li) => li.classList.remove('active'));
          item.classList.add('active');
          if (typeof onChange === 'function') onChange(m.id);
        });
        menu.appendChild(item);
      }
    }
    const active = manifests.find((m) => m.id === selectedId);
    display.textContent = active ? active.name : 'No packs found';
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = dd.classList.toggle('open');
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  render();
  container.appendChild(dd);
}

// Close any open dropdown on outside click or Escape (registered once).
function wireDropdownGlobalClose() {
  const closeAll = () => {
    document.querySelectorAll('.dropdown.open').forEach((dd) => dd.classList.remove('open'));
    document.querySelectorAll('.dropdown-trigger[aria-expanded="true"]').forEach((t) => t.setAttribute('aria-expanded', 'false'));
  };
  document.addEventListener('click', (event) => {
    document.querySelectorAll('.dropdown.open').forEach((dd) => {
      if (!dd.contains(event.target)) closeAll();
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAll();
  });
}

async function applyPacks() {
  // Bundled packs are extracted to userData by main on startup (fs + howler
  // can't read inside asar), so they're scanned exactly like custom ones.
  const { keyboard, mouse } = loadPacks({
    keyboardBundledDirs: [dirs.keyboardBundled],
    keyboardCustomDirs: [dirs.keyboardCustom],
    mouseBundledDirs: [dirs.mouseBundled],
    mouseCustomDirs: [dirs.mouseCustom]
  });
  console.log('[packs] kbBundled=', dirs.keyboardBundled, 'found keyboard=', keyboard.length, 'mouse=', mouse.length);
  console.log('[packs] ids:', keyboard.map((m) => m.id).join('|'));
  packManifests.keyboard = keyboard.map(toDescriptor);
  packManifests.mouse = mouse.map(toDescriptor);

  // First run: pick the first available pack so sounds work out of the box.
  const kbId = settings.sound.keyboardPack || (keyboard[0] && keyboard[0].id) || '';
  const msId = settings.sound.mousePack || (mouse[0] && mouse[0].id) || '';
  if (kbId && kbId !== settings.sound.keyboardPack) updateSetting('sound.keyboardPack', kbId);
  if (msId && msId !== settings.sound.mousePack) updateSetting('sound.mousePack', msId);

  engine.setPacks(keyboard, mouse);
  engine.selectPack('keyboard', kbId);
  engine.selectPack('mouse', msId);
  applyEngineSettings();

  populatePackSelect('#keyboard-pack-dd', packManifests.keyboard, kbId, (id) => {
    updateSetting('sound.keyboardPack', id);
    engine.selectPack('keyboard', id);
  });
  populatePackSelect('#mouse-pack-dd', packManifests.mouse, msId, (id) => {
    updateSetting('sound.mousePack', id);
    engine.selectPack('mouse', id);
  });
}

async function reloadAndApplyPacks() {
  await applyPacks();
  showToast('Soundpacks reloaded');
}

// ---- engine + input ------------------------------------------------------

function buildEngine() {
  engine = new AudioEngine();
  applyEngineSettings();
}

function applyEngineSettings() {
  if (!engine) return;
  engine.setVolume('keyboard', settings.sound.keyboardVolume);
  engine.setVolume('mouse', settings.sound.mouseVolume);
  engine.setMuted('keyboard', !settings.sound.keyboardEnabled);
  engine.setMuted('mouse', !settings.sound.mouseEnabled);
  updateDeviceDisabledState();
}

function updateDeviceDisabledState() {
  const kbDisabled = !settings.sound.keyboardEnabled;
  const msDisabled = !settings.sound.mouseEnabled;
  const kbPack = $('#keyboard-pack-dd');
  const kbSlider = $('#slider-keyboardVolume');
  const msPack = $('#mouse-pack-dd');
  const msSlider = $('#slider-mouseVolume');
  if (kbPack) kbPack.classList.toggle('disabled', kbDisabled);
  if (kbSlider) kbSlider.classList.toggle('disabled', kbDisabled);
  if (msPack) msPack.classList.toggle('disabled', msDisabled);
  if (msSlider) msSlider.classList.toggle('disabled', msDisabled);
}

function wireInput() {
  input = new InputService();
  const keycap = $('#keycap-title');
  // Keycap icon: fetch as a data URL from main (fs reads files inside
  // app.asar, which a renderer file:// URL cannot). Works dev AND packaged.
  (async () => {
    try {
      const dataUrl = await ipcRenderer.invoke('app:icon');
      if (dataUrl) keycap.style.backgroundImage = `url('${dataUrl}')`;
    } catch (e) { /* no icon — box alone is fine */ }
  })();
  let keyPressed = false;
  input.on('key', ({ keycode, phase }) => {
    // keycap press feedback — reacts to every keystroke (like DX's logo).
    // Only touch the DOM when the pressed state actually flips (a fast typist
    // holds nothing between keys, so most keystrokes toggle nothing).
    if (keycap && keyPressed !== (phase === 'down')) {
      keyPressed = phase === 'down';
      keycap.classList.toggle('pressed', keyPressed);
    }
    if (!settings.sound.keyboardEnabled) return;
    if (phase === 'down') {
      if (settings.sound.random) engine.playRandomKey();
      else engine.playKey(keycode, 'down');
    } else if (settings.sound.keyup) {
      engine.playKey(keycode, 'up');
    }
  });
  input.on('mouse', ({ button, phase }) => {
    if (!settings.sound.mouseEnabled) return;
    engine.playMouse(button, phase);
  });
  input.on('wheel', ({ dir }) => {
    if (!settings.sound.mouseEnabled) return;
    // pseudo button code 3 = scroll; up = release sound
    engine.playMouse(3, dir === 'up' ? 'up' : 'down');
  });
  input.start();
}

// ---- settings bindings ---------------------------------------------------

function bindControls() {
  // Keyboard/Mouse toggles were removed from the UI (muting lives in the
  // tray menu), so all bindings are null-safe — a missing element must never
  // crash the renderer at startup.
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };

  on('#set-keyup', 'change', (e) => updateSetting('sound.keyup', e.target.checked));
  on('#set-random', 'change', (e) => updateSetting('sound.random', e.target.checked));
  on('#set-keyboardEnabled', 'change', (e) => {
    updateSetting('sound.keyboardEnabled', e.target.checked);
    updateDeviceDisabledState();
    applyEngineSettings();
  });
  on('#set-mouseEnabled', 'change', (e) => {
    updateSetting('sound.mouseEnabled', e.target.checked);
    updateDeviceDisabledState();
    applyEngineSettings();
  });
  on('#set-startAtLogin', 'change', (e) => updateSetting('system.startAtLogin', e.target.checked));

  // Volume sliders update the label live but persist via a trailing debounce
  // so dragging doesn't spam the main process.
  const persist = debounce((dotted, value) => updateSetting(dotted, value), 60);
  on('#slider-keyboardVolume', 'input', (e) => {
    setSlider('#slider-keyboardVolume', e.target.value, null, '#value-keyboardVolume');
    engine.setVolume('keyboard', Number(e.target.value));
    persist('sound.keyboardVolume', Number(e.target.value));
  });
  on('#slider-mouseVolume', 'input', (e) => {
    setSlider('#slider-mouseVolume', e.target.value, null, '#value-mouseVolume');
    engine.setVolume('mouse', Number(e.target.value));
    persist('sound.mouseVolume', Number(e.target.value));
  });

  on('#profile-link', 'click', () => {
    ipcRenderer.invoke('open:external', 'https://github.com/soulfern');
  });

  on('#support-link', 'click', () => {
    ipcRenderer.invoke('open:external', 'https://mechvibes.com/');
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
}

let toastTimer = null;
function showToast(message, duration = 2200) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    toastTimer = null;
  }, duration);
}

function syncUiFromSettings() {
  setToggle('#set-keyup', settings.sound.keyup);
  setToggle('#set-random', settings.sound.random);
  setToggle('#set-keyboardEnabled', settings.sound.keyboardEnabled);
  setToggle('#set-mouseEnabled', settings.sound.mouseEnabled);
  setToggle('#set-startAtLogin', settings.system.startAtLogin);
  setSlider('#slider-keyboardVolume', settings.sound.keyboardVolume, null, '#value-keyboardVolume');
  setSlider('#slider-mouseVolume', settings.sound.mouseVolume, null, '#value-mouseVolume');
  updateDeviceDisabledState();
}

// ---- IPC from main (tray toggles, refresh) --------------------------------

function wireMainIpc() {
  ipcRenderer.on('settings:changed', async (_e, dotted, value) => {
    // refresh authoritative settings from main, then re-sync
    settings = await ipcRenderer.invoke('settings:get');
    syncUiFromSettings();
    applyEngineSettings();
    if (dotted === 'sound.keyboardPack' || dotted === 'sound.mousePack') {
      engine.selectPack('keyboard', settings.sound.keyboardPack);
      engine.selectPack('mouse', settings.sound.mousePack);
      await applyPacks();
    }
  });
  ipcRenderer.on('packs:refresh', async () => {
    await reloadAndApplyPacks();
  });
}

async function init() {
  // Load the bundled font (data URL from main — works in asar too) so the UI
  // renders in Lexend Deca from the first paint.
  try {
    const fontData = await ipcRenderer.invoke('app:font');
    if (fontData) {
      const style = document.createElement('style');
      style.textContent = `@font-face{font-family:'Lexend Deca';src:url('${fontData}') format('truetype');font-weight:400;font-style:normal;font-display:swap;}`;
      document.head.appendChild(style);
    }
  } catch (e) { /* fall back to system font */ }

  dirs = await ipcRenderer.invoke('app:dirs');
  settings = await ipcRenderer.invoke('settings:get');
  const info = await ipcRenderer.invoke('app:info');
  const vtag = $('#version-tag');
  if (vtag) vtag.textContent = 'v' + info.version;

  wireDropdownGlobalClose();
  buildEngine();
  syncUiFromSettings();

  wireWindowControls();
  bindControls();
  wireMainIpc();

  await reloadAndApplyPacks();
  wireInput();
}

init().catch((err) => {
  console.error('Mechvibes Fusion failed to start:', err);
});


