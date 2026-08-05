'use strict';
// Small dev helper: print how the bundled soundpacks are parsed.
const path = require('node:path');
const { loadPacks } = require('../src/main/services/soundpack-service');

const root = path.join(__dirname, '..', 'src', 'soundpacks');
const res = loadPacks({
  keyboardBundledDirs: [path.join(root, 'keyboard')],
  keyboardCustomDirs: [],
  mouseBundledDirs: [path.join(root, 'mouse')],
  mouseCustomDirs: []
});

for (const kind of ['keyboard', 'mouse']) {
  console.log(`== ${kind} ==`);
  for (const m of res[kind]) {
    console.log(JSON.stringify({
      id: m.id,
      name: m.name,
      format: m.format,
      group: m.group,
      keyType: m.keyType,
      keys: Object.keys(m.keyFiles || {}).length,
      ups: Object.keys(m.upFiles || {}).length,
      sprites: Object.keys(m.sprites || {}).length,
      regions: Object.keys(m.regions || {}).length,
      audio: m.audioFile ? path.basename(m.audioFile) : null
    }));
  }
}
