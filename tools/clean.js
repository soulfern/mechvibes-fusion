'use strict';
/** Clean build artifacts. */
const fs = require('node:fs');
const path = require('node:path');

const targets = [
  path.join(__dirname, '..', 'dist'),
  path.join(__dirname, '..', 'release')
];

for (const t of targets) {
  if (fs.existsSync(t)) {
    fs.rmSync(t, { recursive: true, force: true });
    console.log(`Removed ${t}`);
  }
}
console.log('Clean complete.');
