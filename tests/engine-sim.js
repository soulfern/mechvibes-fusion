'use strict';
// Diagnostic: verify the AudioEngine actually calls howl.play() for a
// keyboard/mouse event, using a fake Howl so no real audio/WebAudio is needed.
const Module = require('node:module');
const origLoad = Module._load;

const calls = { play: [], volume: [], master: [] };

class FakeHowl {
  constructor(opts) { this.opts = opts; this._sprite = { __default: [0, null] }; this._sounds = [{ _node: { gain: { value: 1 } } }]; this._loaded = false; this._vol = 1; }
  volume(v) {
    if (v === undefined) return this._vol; // getter
    calls.volume.push(v);
    this._vol = v;
    return this;
  }
  play(sprite) { calls.play.push(sprite === undefined ? '__default' : sprite); return this; }
  once(ev, fn) { return this; }
  duration() { return 0.1; }
  rate(v) { return v === undefined ? 1 : this; }
  mute() { return this; }
}

// Fake Howler global — engine stages headroom via Howler.masterGain/ctx.
const FakeHowler = {
  usingWebAudio: true,
  ctx: { currentTime: 0 },
  masterGain: { gain: { setValueAtTime(v) { calls.master.push(v); } } },
  volume: (v) => { calls.master.push(v); },
  _muted: false
};

Module._load = function (request, parent, isMain) {
  if (request === 'howler') return { Howl: FakeHowl, Howler: FakeHowler };
  return origLoad.apply(this, arguments);
};

const { AudioEngine } = require('../src/renderer/audio-engine');

// classic MULTI keyboard pack + classic MULTI mouse pack
const kb = {
  id: 'k1', name: 'K Multi', kind: 'keyboard', format: 'classic', keyType: 'multi',
  folder: 'C:/x', group: 'Default', compatibility: false,
  audioFile: null, keyFiles: { '30': 'a.wav', '57': 'space.wav' },
  upFiles: {}, sprites: {}, regions: {}, recommendedVolume: null
};
const ms = {
  id: 'm1', name: 'M Multi', kind: 'mouse', format: 'classic', keyType: 'multi',
  folder: 'C:/y', group: 'Default', compatibility: false,
  audioFile: null, keyFiles: { '1': 'l.wav' }, upFiles: { '1': 'l-up.wav' },
  sprites: {}, regions: {}, recommendedVolume: null
};

const engine = new AudioEngine();
engine.setOptions({ splitup: true });
engine.setPacks([kb], [ms]);
engine.selectPack('keyboard', 'k1');
engine.selectPack('mouse', 'm1');

calls.play.length = 0; calls.volume.length = 0; calls.master.length = 0;
engine.setVolume('keyboard', 70);
engine.setVolume('mouse', 90);

// keyboard key-down for A (30) — must play the FIRST HALF of the sprite
// (MechVibesPlusPlus down-halving), and key-up the SECOND half.
const kbHowl30 = engine.loaded.keyboard.key['30'];
kbHowl30._sprite.__default = [0, 1000];
const seenRegions = [];
const origPlay = kbHowl30.play.bind(kbHowl30);
kbHowl30.play = (name) => { seenRegions.push([...kbHowl30._sprite.__default]); return origPlay(name); };
engine.playKey(30, 'down'); // expect region [0,500] observed inside play
engine.playKey(30, 'up');   // expect region [500,500] observed inside play
const downHalved = seenRegions[0][0] === 0 && seenRegions[0][1] === 500;
const upHalved = seenRegions[1][0] === 500 && seenRegions[1][1] === 500;
const spriteRestored = kbHowl30._sprite.__default[0] === 0 && kbHowl30._sprite.__default[1] === 1000;
console.log('regions seen by play:', JSON.stringify(seenRegions));
console.log('downHalved:', downHalved, 'upHalved:', upHalved, 'restored:', spriteRestored);
// mouse left down — plays plainly
engine.playMouse(1, 'down');
// mouse left up — explicit up file present, must play
engine.playMouse(1, 'up');

console.log('play calls:', JSON.stringify(calls.play));
console.log('volumes:', JSON.stringify(calls.volume));
console.log('master gain:', JSON.stringify(calls.master));

// down must produce a play for keyboard, and mouse down + mouse-up must play;
// staged master gain must be exactly the louder kind's effective volume (0.9)
// with each howl at its share (kb 70/90, ms 1.0). The three play-path volume
// sets (kb down, ms down, ms up) must all be > 0.
let ok =
  calls.play.length >= 3 &&
  calls.volume.slice(-3).every((v) => v > 0) &&
  calls.master.some((v) => Math.abs(v - 0.9) < 1e-9) &&
  downHalved && upHalved && spriteRestored;

console.log(ok ? 'ENGINE-OK: down/up sound routed to howl.play()' : 'ENGINE-BROKEN');

// Also validate a single-type (v2) pack routes to a sprite.
calls.play.length = 0;
const v2 = {
  id: 'v2', name: 'V2', kind: 'keyboard', format: 'v2', keyType: 'single',
  folder: 'C:/z', group: 'Default', compatibility: false,
  audioFile: 's.ogg',
  keyFiles: {}, upFiles: {},
  sprites: {},
  regions: { '30': [[100, 200], [250, 350]] },
  recommendedVolume: null, randomPitch: false
};
engine.setPacks([v2], [ms]);
engine.selectPack('keyboard', 'v2');
engine.playKey(30, 'down');
console.log('v2 play calls:', JSON.stringify(calls.play));

// headroom: mouse at 200% must drive master to 2.0 and clamp howl shares to 1
calls.play.length = 0;
engine.setVolume('mouse', 200);
const msSingle = { id: 'm2', name: 'M Single', kind: 'mouse', format: 'classic', keyType: 'single',
  folder: 'C:/y2', group: 'Default', compatibility: false, audioFile: 'm.ogg',
  keyFiles: {}, upFiles: {}, sprites: { '1': [0, 100] }, regions: {}, recommendedVolume: null };
engine.setPacks([], [msSingle]);
engine.selectPack('mouse', 'm2');
engine.playMouse(1, 'down');
const masterAt200 = calls.master[calls.master.length - 1];
const headroomOk = masterAt200 === 2 && calls.volume.every((v) => v <= 1);
console.log('master at mouse 200%:', masterAt200, '| headroom clamp ok:', headroomOk);
ok = ok && headroomOk;

process.exit(ok ? 0 : 1);
