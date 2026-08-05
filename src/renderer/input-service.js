'use strict';

const { EventEmitter } = require('node:events');

/**
 * InputService — thin wrapper around uiohook-napi (a maintained libuiohook
 * binding) that normalizes low-level events.
 *
 * uiohook-napi reports the SAME virtual key codes as the iohook line used by
 * classic Mechvibes/MechVibes++ soundpacks, so `keycode` here can be used
 * directly to look up a pack's `defines` entries.
 *
 * Mouse buttons are 1=left, 2=right, 3=middle (same as MechVibes++ mouse
 * soundpack definitions). Scroll is surfaced as a pseudo button code 3 with
 * phase 'down'/'up' for wheel down/up.
 */
class InputService extends EventEmitter {
  constructor() {
    super();
    this.hook = null;
    this.running = false;
    this.pressed = new Set();
    this.mouseDown = false;
    this._handlers = null;
  }

  start() {
    if (this.running) return;
    // uiohook-napi exports a singleton event emitter ("uIOhook").
    const { uIOhook } = require('uiohook-napi');
    this.hook = uIOhook;
    this._handlers = {
      keydown: (e) => this._onKeyDown(e),
      keyup: (e) => this._onKeyUp(e),
      mousedown: (e) => this._onMouseDown(e),
      mouseup: (e) => this._onMouseUp(e),
      wheel: (e) => this._onWheel(e)
    };
    for (const [ev, fn] of Object.entries(this._handlers)) this.hook.on(ev, fn);
    try {
      this.hook.start();
      this.running = true;
    } catch (err) {
      // Hook startup can fail if the native lib is missing/unloaded or
      // another hook is already running — never let that take the app down.
      console.error('InputService: failed to start input hook:', err);
      this.stop();
    }
  }

  stop() {
    if (!this.running) return;
    try { this.hook.stop(); } catch (e) { /* ignore */ }
    if (this._handlers) {
      for (const [ev, fn] of Object.entries(this._handlers)) this.hook.removeListener(ev, fn);
      this._handlers = null;
    }
    this.running = false;
  }

  _onKeyDown(e) {
    const keycode = e && (e.keycode != null ? e.keycode : e.keycode2);
    if (keycode == null) return;
    // ignore OS-level auto-repeat while a key is held
    if (this.pressed.has(keycode)) return;
    this.pressed.add(keycode);
    this.emit('key', { keycode, phase: 'down', rawcode: e.rawcode });
  }

  _onKeyUp(e) {
    const keycode = e && (e.keycode != null ? e.keycode : e.keycode2);
    if (keycode == null) return;
    this.pressed.delete(keycode);
    this.emit('key', { keycode, phase: 'up', rawcode: e.rawcode });
  }

  _onMouseDown(e) {
    const button = normalizeButton(e && e.button);
    if (button == null || this.mouseDown) return;
    this.mouseDown = true;
    this.emit('mouse', { button, phase: 'down' });
  }

  _onMouseUp(e) {
    const button = normalizeButton(e && e.button);
    this.mouseDown = false;
    if (button == null) return;
    this.emit('mouse', { button, phase: 'up' });
  }

  _onWheel(e) {
    // uiohook wheel: negative rotation = scroll up, positive = down
    if (!e) return;
    const dir = e.rotation < 0 ? 'up' : 'down';
    this.emit('wheel', { dir });
  }
}

function normalizeButton(button) {
  // uiohook button codes: 1=left, 2=right, 3=middle, 4/5=side
  if (button == null) return null;
  if (button === 1 || button === 2 || button === 3 || button === 4 || button === 5) return button;
  return null;
}

module.exports = { InputService };
