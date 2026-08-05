'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseClassic,
  parseV2,
  detectFormat,
  loadPacks
} = require('../src/main/services/soundpack-service');

test('detectFormat distinguishes classic vs v2', () => {
  assert.equal(detectFormat({ key_define_type: 'multi', defines: {} }), 'classic');
  assert.equal(detectFormat({ config_version: '2', audio_file: 'a.ogg', definitions: {} }), 'v2');
  assert.equal(detectFormat({ audio_file: 'a.ogg', definitions: {} }), 'v2');
  assert.equal(detectFormat(null), 'classic');
});

test('parseClassic multi: splits key-down from key-up (leading-zero) defines', () => {
  const cfg = {
    name: 'NK Cream',
    key_define_type: 'multi',
    sound: 'fallback.ogg',
    defines: {
      '30': 'a-down.wav',
      '01': 'one-up.wav',
      '1': 'one-down.wav',
      '001': 'one-up-padded.wav',
      '57': 'space.wav'
    }
  };
  const m = parseClassic(cfg, 'C:/packs/nk', false, 'keyboard');
  assert.equal(m.format, 'classic');
  assert.equal(m.keyType, 'multi');
  // down files
  assert.equal(m.keyFiles['30'], path.join('C:/packs/nk', 'a-down.wav'));
  assert.equal(m.keyFiles['1'], path.join('C:/packs/nk', 'one-down.wav'));
  assert.equal(m.keyFiles['57'], path.join('C:/packs/nk', 'space.wav'));
  // up files: "01" and "001" both resolve to base key "1"
  assert.equal(m.upFiles['1'], path.join('C:/packs/nk', 'one-up-padded.wav'));
  // no "30" up
  assert.ok(!m.upFiles['30']);
});

test('parseClassic single: reads sprite timing map', () => {
  const cfg = {
    name: 'Cherry',
    key_define_type: 'single',
    sound: 'sound.ogg',
    defines: { '30': [1203, 192], '57': [500, 120] }
  };
  const m = parseClassic(cfg, 'C:/packs/cherry', true, 'keyboard');
  assert.equal(m.keyType, 'single');
  assert.deepEqual(m.sprites['30'], [1203, 192]);
  assert.equal(m.audioFile, path.join('C:/packs/cherry', 'sound.ogg'));
});

test('parseV2: maps rdev names to classic keycodes with down/up regions', () => {
  const cfg = {
    config_version: '2',
    audio_file: 'sound.ogg',
    name: 'Ocean',
    definitions: {
      KeyA: { timing: [[100, 200], [250, 350]] },
      Space: { timing: [[400, 500]] },
      Digit1: { timing: [[600, 650], [660, 700]] }
    }
  };
  const m = parseV2(cfg, 'C:/packs/v2', false, 'keyboard');
  assert.equal(m.format, 'v2');
  assert.deepEqual(m.regions['30'], [[100, 200], [250, 350]]);   // KeyA -> 30
  assert.deepEqual(m.regions['57'], [[400, 500]]);               // Space -> 57
  assert.deepEqual(m.regions['2'], [[600, 650], [660, 700]]);    // Digit1 -> 2
});

test('loadPacks scans bundled + custom dirs for both formats', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mvf-'));
  const kbBundled = path.join(root, 'bundled', 'keyboard');
  const kbCustom = path.join(root, 'custom', 'keyboard');
  const msBundled = path.join(root, 'bundled', 'mouse');
  const msCustom = path.join(root, 'custom', 'mouse');
  for (const d of [kbBundled, kbCustom, msBundled, msCustom]) fs.mkdirSync(d, { recursive: true });
  for (const d of ['classic1', 'v2pack', 'mous1', 'empty']) {
    fs.mkdirSync(path.join(kbBundled, d), { recursive: true });
    fs.mkdirSync(path.join(msBundled, d), { recursive: true });
  }
  fs.mkdirSync(path.join(kbCustom, 'v2pack'), { recursive: true });
  fs.mkdirSync(path.join(msCustom, 'dummy'), { recursive: true });

  fs.writeFileSync(path.join(kbBundled, 'classic1', 'config.json'), JSON.stringify({
    name: 'Classic Multi',
    key_define_type: 'multi',
    defines: { '30': 'a.wav', '01': 'a-up.wav' }
  }));
  fs.writeFileSync(path.join(kbBundled, 'classic1', 'a.wav'), 'x');
  fs.writeFileSync(path.join(kbBundled, 'classic1', 'a-up.wav'), 'x');

  fs.writeFileSync(path.join(kbCustom, 'v2pack', 'config.json'), JSON.stringify({
    config_version: '2', name: 'DX V2', audio_file: 'o.ogg',
    definitions: { KeyB: { timing: [[0, 10]] } }
  }));
  fs.writeFileSync(path.join(kbCustom, 'v2pack', 'o.ogg'), 'x');

  fs.writeFileSync(path.join(msBundled, 'mous1', 'config.json'), JSON.stringify({
    name: 'Mouse Classic', key_define_type: 'multi',
    defines: { '1': 'left.wav', '01': 'left-up.wav', '2': 'right.wav' }
  }));
  fs.writeFileSync(path.join(msBundled, 'mous1', 'left.wav'), 'x');
  fs.writeFileSync(path.join(msBundled, 'mous1', 'left-up.wav'), 'x');
  fs.writeFileSync(path.join(msBundled, 'mous1', 'right.wav'), 'x');

  // a folder with no config.json must be ignored
  fs.mkdirSync(path.join(kbBundled, 'empty'), { recursive: true });

  const res = loadPacks({
    keyboardBundledDirs: [kbBundled],
    keyboardCustomDirs: [kbCustom],
    mouseBundledDirs: [msBundled],
    mouseCustomDirs: [msCustom]
  });

  assert.equal(res.keyboard.length, 2);
  assert.equal(res.mouse.length, 1);
  const classic = res.keyboard.find((m) => m.name === 'Classic Multi');
  const v2p = res.keyboard.find((m) => m.name === 'DX V2');
  assert.ok(classic && v2p);
  assert.equal(classic.group, 'Default');
  assert.equal(classic.keyType, 'multi');
  assert.equal(classic.upFiles['1'], path.join(kbBundled, 'classic1', 'a-up.wav'));
  assert.equal(v2p.group, 'Custom');
  assert.equal(v2p.format, 'v2');
  assert.equal(v2p.audioFile, path.join(kbCustom, 'v2pack', 'o.ogg'));
  assert.deepEqual(v2p.regions['48'], [[0, 10]]); // KeyB -> 48
  assert.equal(res.mouse[0].keyFiles['1'], path.join(msBundled, 'mous1', 'left.wav'));
  assert.equal(res.mouse[0].upFiles['1'], path.join(msBundled, 'mous1', 'left-up.wav'));
});
