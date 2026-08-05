'use strict';

/**
 * Default application settings. Mirrors Hiraganized's `defaults.js` pattern:
 * a flat-ish nested object with dotted paths used by the renderer and the
 * ConfigStore merge logic.
 */
const defaults = {
  sound: {
    keyboardPack: '',
    mousePack: '',
    keyboardVolume: 90,
    mouseVolume: 90,
    keyup: true,
    random: false,
    keyboardEnabled: true,
    mouseEnabled: true
  },
  system: {
    startAtLogin: false
  }
};

module.exports = { defaults };
