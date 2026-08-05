'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Soundpack discovery + parsing.
 *
 * Supports BOTH Mechvibes soundpack formats so existing packs "just work":
 *
 * 1) CLASSIC format (mechvibes.com / MechVibes++):
 *    {
 *      "name": "...",
 *      "key_define_type": "single" | "multi",
 *      "sound": "file",              // default / sprite audio file
 *      "defines": {
 *         "30": "a.wav",             // multi: keycode -> file
 *         "001": "a-up.wav",         // multi: leading-zero key = RELEASE sound for key "1"
 *         "30": [1203, 192]          // single: keycode -> [startMs, lengthMs] sprite
 *      },
 *      "compatibility": bool         // legacy flag, tolerated
 *    }
 *
 * 2) DX v2 format (MechVibesDX bundled packs):
 *    {
 *      "config_version": "2",
 *      "audio_file": "sound.ogg",
 *      "definition_method": "single",
 *      "definitions": { "KeyA": { "timing": [[startMs,endMs], ...] }, ... },
 *      "options": { "random_pitch": bool, "recommended_volume": 1.0 }
 *    }
 *
 * Both are normalized into a single internal Pack manifest consumed by the
 * audio engine.
 */

const MOUSE_DOWN = { MouseLeft: 1, MouseRight: 2, MouseMiddle: 3, MouseSide5: 4, MouseSide6: 5 };
const MOUSE_UP = { MouseLeft: '01', MouseRight: '02', MouseMiddle: '03', MouseSide5: '04', MouseSide6: '05' };

// rdev key name -> classic numeric keycode (used to route v2 packs)
const RDEV_TO_KEYCODE = {
  Escape: 1, F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64,
  F7: 65, F8: 66, F9: 67, F10: 68, F11: 87, F12: 88,
  Backquote: 41, Digit1: 2, Digit2: 3, Digit3: 4, Digit4: 5, Digit5: 6,
  Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11,
  Minus: 12, Equal: 13, Backspace: 14, Tab: 15, CapsLock: 58,
  KeyA: 30, KeyB: 48, KeyC: 46, KeyD: 32, KeyE: 18, KeyF: 33, KeyG: 34, KeyH: 35,
  KeyI: 23, KeyJ: 36, KeyK: 37, KeyL: 38, KeyM: 50, KeyN: 49, KeyO: 24, KeyP: 25,
  KeyQ: 16, KeyR: 19, KeyS: 31, KeyT: 20, KeyU: 22, KeyV: 47, KeyW: 17, KeyX: 45,
  KeyY: 21, KeyZ: 44,
  BracketLeft: 26, BracketRight: 27, Backslash: 43,
  Semicolon: 39, Quote: 40, Enter: 28,
  Comma: 51, Period: 52, Slash: 53, Space: 57,
  PrintScreen: 3639, ScrollLock: 70, Pause: 3653,
  Insert: 3666, Delete: 3667, Home: 3655, End: 3663, PageUp: 3657, PageDown: 3665,
  ArrowUp: 57416, ArrowLeft: 57419, ArrowRight: 57421, ArrowDown: 57424,
  ShiftLeft: 42, ShiftRight: 54, ControlLeft: 29, ControlRight: 3613,
  AltLeft: 56, AltRight: 3640, MetaLeft: 3675, MetaRight: 3676, ContextMenu: 3677,
  NumLock: 69, NumpadDivide: 3637, NumpadMultiply: 55, NumpadSubtract: 74,
  NumpadAdd: 78, NumpadEnter: 3612, NumpadDecimal: 83,
  Numpad0: 82, Numpad1: 79, Numpad2: 80, Numpad3: 81, Numpad4: 75,
  Numpad5: 76, Numpad6: 77, Numpad7: 71, Numpad8: 72, Numpad9: 73
};

const RDEV_MOUSE = {
  MouseLeft: 1, MouseRight: 2, MouseMiddle: 3, MouseSide5: 4, MouseSide6: 5
};

// ---- discovery ----------------------------------------------------------

function safeSubdirs(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function discoverFolders(bundledDirs, customDirs) {
  const folders = [];
  for (const dir of bundledDirs || []) {
    for (const f of safeSubdirs(dir)) folders.push({ folder: f, isCustom: false });
  }
  for (const dir of customDirs || []) {
    for (const f of safeSubdirs(dir)) folders.push({ folder: f, isCustom: true });
  }
  return folders;
}

function readConfig(folder) {
  const cfg = path.join(folder, 'config.json');
  try {
    if (!fs.existsSync(cfg)) return null;
    return JSON.parse(fs.readFileSync(cfg, 'utf8'));
  } catch {
    return null;
  }
}

function detectFormat(cfg) {
  if (!cfg) return 'classic';
  if (cfg.config_version === '2' || (cfg.audio_file && cfg.definitions)) return 'v2';
  return 'classic';
}

function packId(folder, isCustom, cfg) {
  const base = path.basename(folder);
  if (cfg && cfg.id) {
    const safe = String(cfg.id).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    if (safe) return `${isCustom ? 'custom' : 'default'}-${safe}`;
  }
  return `${isCustom ? 'custom' : 'default'}-${base}`;
}

function groupFor(isCustom) {
  return isCustom ? 'Custom' : 'Default';
}

// ---- preparse markers ----------------------------------------------------
/**
 * Parse a CLASSIC pack into the normalized manifest.
 */
function parseClassic(cfg, folder, isCustom, kind) {
  const keyType = cfg.key_define_type === 'multi' ? 'multi' : 'single';

  const manifest = {
    id: packId(folder, isCustom, cfg),
    folder,
    name: cfg.name || path.basename(folder),
    group: groupFor(isCustom),
    kind,
    format: 'classic',
    keyType,
    compatibility: !!cfg.compatibility,
    audioFile: cfg.sound ? path.join(folder, cfg.sound) : null,
    keyFiles: {},      // keycode(str) -> absolute file (multi)
    upFiles: {},       // keycode(str) -> absolute release file (multi, 0-prefixed)
    sprites: {},       // keycode(str) -> [startMs, lengthMs] (single)
    regions: {},       // keycode(str) -> [[s,e], ...] (v2 only)
    recommendedVolume: null,
    includesNumpad: !!cfg.includes_numpad
  };

  const defines = (cfg.defines && typeof cfg.defines === 'object') ? cfg.defines : {};

  if (keyType === 'multi') {
    for (const [k, v] of Object.entries(defines)) {
      if (v == null || typeof v !== 'string') continue;
      const abs = path.join(folder, v);
      if (/^0+\d+$/.test(k)) {
        const base = String(Number(k)); // "001" -> "1", "01" -> "1"
        manifest.upFiles[base] = abs;
      } else {
        manifest.keyFiles[String(k)] = abs;
      }
    }
  } else {
    for (const [k, v] of Object.entries(defines)) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
        manifest.sprites[String(k)] = [v[0], v[1]];
      }
    }
  }

  return manifest;
}

/**
 * Parse a DX v2 pack into a normalized manifest (keyed by classic keycodes).
 */
function parseV2(cfg, folder, isCustom, kind) {
  const defs = (cfg.definitions && typeof cfg.definitions === 'object') ? cfg.definitions : {};
  const options = cfg.options || {};

  const manifest = {
    id: packId(folder, isCustom, cfg),
    folder,
    name: cfg.name || path.basename(folder),
    group: groupFor(isCustom),
    kind,
    format: 'v2',
    keyType: 'single',
    compatibility: false,
    audioFile: cfg.audio_file ? path.join(folder, cfg.audio_file) : null,
    keyFiles: {},
    upFiles: {},
    sprites: {},
    regions: {},
    recommendedVolume: options.recommended_volume != null ? options.recommended_volume : null,
    randomPitch: !!options.random_pitch,
    includesNumpad: false
  };

  const nameToCode = kind === 'mouse' ? RDEV_MOUSE : RDEV_TO_KEYCODE;

  for (const [name, def] of Object.entries(defs)) {
    const timing = def && Array.isArray(def.timing) ? def.timing : [];
    const flat = timing
      .filter((t) => Array.isArray(t) && t.length === 2)
      .map((t) => [t[0], t[1]]);
    if (!flat.length) continue;
    const code = String(nameToCode[name] != null ? nameToCode[name] : name);
    manifest.regions[code] = flat;
  }

  return manifest;
}

/**
 * Scan bundled + custom directories and return normalized pack manifests.
 */
function loadPacks({ keyboardBundledDirs, keyboardCustomDirs, mouseBundledDirs, mouseCustomDirs }) {
  const keyboard = [];
  const mouse = [];

  for (const { folder, isCustom } of discoverFolders(keyboardBundledDirs, keyboardCustomDirs)) {
    const cfg = readConfig(folder);
    if (!cfg) continue;
    const m = detectFormat(cfg) === 'v2'
      ? parseV2(cfg, folder, isCustom, 'keyboard')
      : parseClassic(cfg, folder, isCustom, 'keyboard');
    if (m && hasSounds(m)) keyboard.push(m);
  }

  for (const { folder, isCustom } of discoverFolders(mouseBundledDirs, mouseCustomDirs)) {
    const cfg = readConfig(folder);
    if (!cfg) continue;
    const m = detectFormat(cfg) === 'v2'
      ? parseV2(cfg, folder, isCustom, 'mouse')
      : parseClassic(cfg, folder, isCustom, 'mouse');
    if (m && hasSounds(m)) mouse.push(m);
  }

  return { keyboard, mouse };
}

function hasSounds(m) {
  if (m.format === 'v2') return Object.keys(m.regions).length > 0 && !!m.audioFile;
  if (m.keyType === 'multi') return Object.keys(m.keyFiles).length > 0;
  return Object.keys(m.sprites).length > 0 && !!m.audioFile;
}

/**
 * Serialize a manifest into a renderer-friendly (lightweight) description.
 */
function toDescriptor(m) {
  const hasUp = m.format === 'classic'
    ? Object.keys(m.upFiles).length > 0
    : Object.keys(m.regions).length > 0;
  const count = m.format === 'classic'
    ? Object.keys(m.keyFiles).length || Object.keys(m.sprites).length
    : Object.keys(m.regions).length;
  return {
    id: m.id,
    name: m.name,
    group: m.group,
    kind: m.kind,
    format: m.format,
    compatibility: m.compatibility,
    hasUpSounds: hasUp,
    count
  };
}

module.exports = {
  loadPacks,
  parseClassic,
  parseV2,
  detectFormat,
  toDescriptor,
  RDEV_TO_KEYCODE,
  RDEV_MOUSE
};


