'use strict';

/**
 * Keyboard virtual-key codes as reported by libuiohook / iohook — the exact
 * numeric scheme used by classic Mechvibes soundpack `defines` entries.
 * uiohook-napi reports the same codes, which is what guarantees classic
 * Mechvibes soundpack compatibility.
 *
 * The "standard" table is the canonical layout. OS-specific variants are
 * derived from it (mirroring MechVibes++'s keycodes.js).
 */
const standard = {
  1: 'Esc',
  59: 'F1', 60: 'F2', 61: 'F3', 62: 'F4', 63: 'F5', 64: 'F6',
  65: 'F7', 66: 'F8', 67: 'F9', 68: 'F10', 87: 'F11', 88: 'F12',
  91: 'F13', 92: 'F14', 93: 'F15',

  41: '`',
  2: '1', 3: '2', 4: '3', 5: '4', 6: '5', 7: '6', 8: '7', 9: '8', 10: '9', 11: '0',
  12: '-', 13: '=', 14: 'Backspace',
  15: 'Tab', 58: 'CapsLock',

  30: 'A', 48: 'B', 46: 'C', 32: 'D', 18: 'E', 33: 'F', 34: 'G', 35: 'H', 23: 'I',
  36: 'J', 37: 'K', 38: 'L', 50: 'M', 49: 'N', 24: 'O', 25: 'P', 16: 'Q', 19: 'R',
  31: 'S', 20: 'T', 22: 'U', 47: 'V', 17: 'W', 45: 'X', 21: 'Y', 44: 'Z',

  26: '[', 27: ']', 43: '\\',
  39: ';', 40: "'", 28: 'Enter',
  51: ',', 52: '.', 53: '/',
  57: 'Space',

  3639: 'PrtSc', 70: 'ScrLk', 3653: 'Pause',
  3666: 'Ins', 3667: 'Del', 3655: 'Home', 3663: 'End', 3657: 'PgUp', 3665: 'PgDn',

  57416: 'Up', 57419: 'Left', 57421: 'Right', 57424: 'Down',

  42: 'Shift', 54: 'Shift', 29: 'Ctrl', 3613: 'Ctrl', 56: 'Alt', 3640: 'Alt',
  3675: 'Meta', 3676: 'Meta', 3677: 'Menu',

  // Numpad
  69: 'NumLock', 3637: 'Num/', 55: 'Num*', 74: 'Num-', 3597: 'Num=', 78: 'Num+',
  3612: 'NumEnter', 83: 'Num.', 79: 'Num1', 80: 'Num2', 81: 'Num3', 75: 'Num4',
  76: 'Num5', 77: 'Num6', 71: 'Num7', 72: 'Num8', 73: 'Num9', 82: 'Num0'
};

// OS-specific remaps (from MechVibes++). The "standard" table is what classic
// packs use; on a given OS uiohook reports a mix, so we merge the active
// platform's aliases for lookup robustness.
const darwin = Object.assign({}, standard, {
  28: 'Return', 56: 'Option', 69: 'Clear', 3640: 'Option', 3666: 'Fn',
  3675: 'Command', 3676: 'Command'
});

const win32 = Object.assign({}, standard, {
  3675: 'Win', 3676: 'Win',
  61010: 'Ins', 61011: 'Del', 60999: 'Home', 61007: 'End',
  61001: 'PgUp', 61009: 'PgDn', 61000: 'Up', 61003: 'Left',
  61005: 'Right', 61008: 'Down'
});

const linux = Object.assign({}, standard);

// Keys that randomization should pick from (printable / meaningful), matching
// MechVibes++'s `applicablekeys` list.
const applicableKeys = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 46,
  47, 48, 49, 50, 51, 52, 53, 54, 55, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83
];

// Modifier / editing keys that are never randomized (space, ctrl, shift, etc.)
const nonApplicableKeys = [57, 29, 3613, 42, 54, 58, 28, 15, 14, 56, 3640];

function platformKeycodes(platform) {
  if (platform === 'darwin') return darwin;
  if (platform === 'win32') return win32;
  return linux;
}

module.exports = {
  standard,
  darwin,
  win32,
  linux,
  applicableKeys,
  nonApplicableKeys,
  platformKeycodes
};
