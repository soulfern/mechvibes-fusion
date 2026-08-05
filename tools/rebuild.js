'use strict';
/**
 * Verifies the native input hook (uiohook-napi) is loadable by the current
 * Electron runtime.
 *
 * uiohook-napi ships prebuilt Node-API binaries via `node-gyp-build`
 * (`prebuilds/win32-x64/uiohook-napi.node`). Node-API is ABI-stable across
 * Node and Electron versions, so the prebuild never needs recompiling when
 * Electron updates — a node-gyp source rebuild is only necessary on platforms
 * without a prebuild (and requires an MSVC/VS toolchain). This script checks
 * the prebuild loads and fails loudly if it doesn't (e.g. the module was
 * reinstalled without its prebuilds).
 *
 * Run: npm run rebuild
 */
const { execSync } = require('node:child_process');
const path = require('node:path');

const electron = require('electron/package.json').version;
console.log(`Electron version: ${electron}`);

const prebuilt = path.join(__dirname, '..', 'node_modules', 'uiohook-napi', 'prebuilds', `win32-${process.arch}`, 'uiohook-napi.node');
const fs = require('node:fs');
if (!fs.existsSync(prebuilt)) {
  console.error(`No prebuilt binary found at ${prebuilt}`);
  console.error('Fall back to a source rebuild: npx electron-rebuild -f -w uiohook-napi');
  process.exit(1);
}

// Force-load the native binding through node-gyp-build's resolver and touch
// its API surface so a stale/corrupt binary fails here instead of at runtime.
const { uIOhook } = require('uiohook-napi');
if (typeof uIOhook.start !== 'function' || typeof uIOhook.stop !== 'function') {
  console.error('uiohook-napi binary loaded but its API is missing (stale build?)');
  process.exit(1);
}

console.log(`uiohook-napi OK (prebuilt ${process.arch} binary loads under Node ${process.version})`);
console.log('Done. Start with: npm start');
