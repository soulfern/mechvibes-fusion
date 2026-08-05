'use strict';

/**
 * AudioEngine — builds & caches Howler instances from normalized soundpack
 * manifests (soundpack-service) and plays sounds on keyboard/mouse input.
 * Runs in the renderer (howler needs Web Audio) — same model as MechVibes++.
 */
const { Howl, Howler } = require('howler');
const { applicableKeys } = require('../main/services/keycodes');

class AudioEngine {
  constructor() {
    this.manifests = { keyboard: [], mouse: [] };
    this.loaded = { keyboard: null, mouse: null };
    this.loadedId = { keyboard: '', mouse: '' };
    this.options = { splitup: false };
    // Per-kind cached volume (0..200) so the keystroke path never touches
    // the settings object or a live gain node. Volume changes re-cache here.
    this.vol = { keyboard: null, mouse: null };
    // Per-kind howl volume share of the master gain (0..1, see _stageVolumes).
    this.howlVol = { keyboard: null, mouse: null };
  }

  setPacks(keyboardManifests, mouseManifests) {
    this.manifests.keyboard = keyboardManifests;
    this.manifests.mouse = mouseManifests;
    if (this.loadedId.keyboard) this.loadPack('keyboard', this.loadedId.keyboard);
    if (this.loadedId.mouse) this.loadPack('mouse', this.loadedId.mouse);
  }

  setOptions(options) {
    this.options = Object.assign(this.options, options || {});
  }

  selectPack(kind, id) {
    this.loadedId[kind] = id || '';
    this.loadPack(kind, id);
  }

  findManifest(kind, id) {
    return this.manifests[kind].find((m) => m.id === id) || null;
  }

  loadPack(kind, id) {
    const m = this.findManifest(kind, id);
    this.loaded[kind] = m ? this.build(m) : null;
    return this.loaded[kind];
  }

  build(m) {
    if (m.format === 'v2') return buildV2(m);
    if (m.keyType === 'single') return buildSingle(m);
    return buildMulti(m);
  }

  playKey(keycode, phase) {
    const pack = this.loaded.keyboard;
    if (!pack) return;
    const id = String(keycode);
    const vol = this.vol.keyboard == null ? 90 : this.vol.keyboard;
    const m = pack.manifest;

    if (m.format === 'v2') {
      if (pack.single && pack.downSprites[id]) {
        const sprite = (phase === 'up' && pack.upSprites[id]) ? pack.upSprites[id] : id;
        applyVolume(pack.single, vol, m.randomPitch);
        pack.single.play(sprite);
      }
      return;
    }
    if (m.keyType === 'single') {
      if (pack.single && (pack.sprites[id] || pack.sprites[keyNameFor(id)])) {
        const sprite = pack.sprites[id] || pack.sprites[keyNameFor(id)];
        applyVolume(pack.single, vol, false);
        // split at the midpoint so down plays the tail, up the front half —
        // identical to MechVibesPlusPlus for non-compat single packs
        playHalved(pack.single, sprite, phase);
      }
      return;
    }
    // multi — down and up both split the key's own sprite at its midpoint
    // (MechVibesPlusPlus model): down plays the first half, up the second.
    if (phase === 'up') {
      if (pack.up[id]) { applyVolume(pack.up[id], vol, false); pack.up[id].play(); }
      else if (pack.key[id]) playHalved(pack.key[id], '__default', 'up');
      return;
    }
    if (pack.key[id]) { applyVolume(pack.key[id], vol, false); playHalved(pack.key[id], '__default', 'down'); }
  }

  playMouse(code, phase) {
    const pack = this.loaded.mouse;
    if (!pack) return;
    const id = String(code);
    const vol = this.vol.mouse == null ? 90 : this.vol.mouse;
    const m = pack.manifest;

    if (m.format === 'v2') {
      if (pack.single && pack.downSprites[id]) {
        const sprite = (phase === 'up' && pack.upSprites[id]) ? pack.upSprites[id] : id;
        applyVolume(pack.single, vol, false);
        pack.single.play(sprite);
      }
      return;
    }
    if (m.keyType === 'single') {
      if (pack.single && pack.sprites[id]) {
        applyVolume(pack.single, vol, false);
        pack.single.play(id);
      }
      return;
    }
    if (phase === 'up') {
      if (pack.up[id]) { applyVolume(pack.up[id], vol, false); pack.up[id].play(); }
      return;
    }
    if (pack.key[id]) { applyVolume(pack.key[id], vol, false); pack.key[id].play(); }
  }

  playRandomKey() {
    const pack = this.loaded.keyboard;
    if (!pack) return;
    const pool = applicableKeys.filter((kc) => this.hasKey(String(kc)));
    if (!pool.length) return;
    this.playKey(pool[Math.floor(Math.random() * pool.length)], 'down');
  }

  hasKey(id) {
    const pack = this.loaded.keyboard;
    if (!pack) return false;
    const m = pack.manifest;
    if (m.format === 'v2') return !!pack.downSprites[id];
    if (m.keyType === 'single') return !!pack.sprites[id];
    return !!pack.key[id];
  }

  setMuted(kind, muted) {
    const pack = this.loaded[kind];
    if (!pack) return;
    const list = [];
    if (pack.single) list.push(pack.single);
    if (pack.key) list.push(...Object.values(pack.key));
    if (pack.up) list.push(...Object.values(pack.up));
    for (const h of list) h.mute(muted);
  }

  /**
   * Cache a kind's volume (0..200) once at startup and on slider change so
   * the per-keystroke path is a cached lookup — never a settings read.
   * Headroom above 100% is staged on the shared master gain (howler's own
   * setter refuses >1, so we poke the gain node directly — once per change,
   * never per keystroke). Each kind's howl volume is normalized by the max
   * effective volume so the two kinds stay independent at any slider mix.
   */
  setVolume(kind, value) {
    const v = Number(value);
    this.vol[kind] = Number.isNaN(v) ? 90 : Math.max(0, Math.min(200, v));
    this._stageVolumes();
  }

  _eff(kind) {
    const v = this.vol[kind];
    return v == null ? 0 : Math.max(0, Math.min(2, v / 100));
  }

  _stageVolumes() {
    const eff = { keyboard: this._eff('keyboard'), mouse: this._eff('mouse') };
    // Master covers the loudest kind; each kind's howl volume is its share
    // of that master, so effective per-kind volume stays exact (<=1 howl,
    // master may reach 2.0 for 200% headroom — same as the old gain poke).
    const master = Math.max(eff.keyboard, eff.mouse, 1e-3);
    try {
      if (Howler.usingWebAudio && Howler.ctx && Howler.masterGain) {
        Howler.masterGain.gain.setValueAtTime(master, Howler.ctx.currentTime);
      } else {
        Howler.volume(Math.min(1, master));
      }
    } catch (e) { /* audio context not ready yet — howler defaults are fine */ }
    for (const kind of ['keyboard', 'mouse']) {
      this.howlVol[kind] = eff[kind] / master; // 0..1
      this._howls(kind).forEach((h) => { if (h._volume !== this.howlVol[kind]) h.volume(this.howlVol[kind]); });
    }
  }

  _howls(kind) {
    const pack = this.loaded[kind];
    if (!pack) return [];
    const list = [];
    if (pack.single) list.push(pack.single);
    if (pack.key) list.push(...Object.values(pack.key));
    if (pack.up) list.push(...Object.values(pack.up));
    return list;
  }
}

// ---- builders -----------------------------------------------------------

function buildMulti(m) {
  const key = {};
  const up = {};
  for (const [k, file] of Object.entries(m.keyFiles)) key[k] = new Howl({ src: [file] });
  for (const [k, file] of Object.entries(m.upFiles)) up[k] = new Howl({ src: [file] });
  return { manifest: m, key, up, single: null, sprites: null, downSprites: null, upSprites: null };
}

function buildSingle(m) {
  const sprites = {};
  for (const [k, t] of Object.entries(m.sprites)) sprites[`s-${k}`] = [t[0], t[1]];
  const howl = new Howl({ src: [m.audioFile], sprite: sprites });
  const nameByCode = {};
  for (const k of Object.keys(m.sprites)) nameByCode[k] = `s-${k}`;
  return { manifest: m, key: null, up: {}, single: howl, sprites: nameByCode, downSprites: null, upSprites: null };
}

function buildV2(m) {
  const downSprites = {};
  const upSprites = {};
  const spriteDef = {};
  for (const [k, regions] of Object.entries(m.regions)) {
    const [s1, e1] = regions[0];
    spriteDef[k] = [s1, Math.max(1, e1 - s1)];
    downSprites[k] = k;
    if (regions.length > 1) {
      const [s2, e2] = regions[1];
      spriteDef[`${k}-up`] = [s2, Math.max(1, e2 - s2)];
      upSprites[k] = `${k}-up`;
    }
  }
  const howl = new Howl({ src: [m.audioFile], sprite: spriteDef });
  return { manifest: m, key: null, up: {}, single: howl, sprites: null, downSprites, upSprites };
}

// ---- key-up helper (MechVibesPlusPlus model) ------------------------------

/**
 * Play a release sound derived from the key's own audio: temporarily split
 * the sprite at its midpoint, play the second half for the release, then
 * restore the original region. Same technique MechVibesPlusPlus's playSound()
 * uses for non-compat packs — the release always starts at the sound's
 * natural mid-point, so it never repeats the attack, and the sprite data is
 * mutated in place on the cached Howl then restored synchronously (one
 * play() call, no seek juggling that can drift under load).
 */
/**
 * Play `spriteName` restricted to half of its region around the midpoint.
 * `mode` 'down' plays the first half, 'up' the second half — the exact
 * split MechVibesPlusPlus's playSound() applies for non-compat packs. The
 * sprite region is mutated in place, played once, then restored.
 */
function playHalved(howl, spriteName, mode) {
  const sprite = howl._sprite && howl._sprite[spriteName];
  // If the sprite isn't loaded yet (duration unknown) the Howl's default
  // region is [0, null] — playing it would emit the WHOLE audio file, which
  // layers on top of the real sound and ignores nothing (it just sounds
  // wrong). Never play a full file as a fallback: stay silent until loaded.
  if (!sprite || sprite.length !== 2 || !(sprite[1] > 0)) return;
  const [start, len] = sprite;
  const half = Math.floor(len / 2);
  if (half <= 0) return;
  let a = start;
  let b = len;
  if (mode === 'up') { a = start + half; b = len - half; }
  else { b = half; }
  sprite[0] = a;
  sprite[1] = b;
  try {
    howl.play(spriteName);
  } finally {
    sprite[0] = start;
    sprite[1] = len;
  }
}

function applyVolume(howl, vol, randomPitch) {
  // vol is the cached 0..200 slider value; staging above 100% happens on the
  // shared master gain (see setVolume). Volume only changes on slider drag,
  // so skip the Howler write entirely when it hasn't — keeps the keystroke
  // path to a single play() call, no internal volume event per key.
  const factor = clampFactor(vol); // 0..2
  if (howl.volume() !== Math.min(1, factor)) howl.volume(Math.min(1, factor));
  if (randomPitch) {
    howl.rate(0.95 + Math.random() * 0.1);
  } else if (howl.rate() !== 1) {
    howl.rate(1);
  }
}

function clampFactor(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 1;
  return Math.max(0, Math.min(2, n / 100));
}

function keyNameFor(keycode) {
  try {
    const codes = require('../main/services/keycodes');
    return codes.platformKeycodes(process.platform)[keycode] || null;
  } catch {
    return null;
  }
}

module.exports = { AudioEngine };

