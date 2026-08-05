# ⌨️ Mechvibes Fusion

A mechanical-keyboard sound simulator that combines the best of two open-source
projects:

- **[MechVibesDX](https://github.com/hainguyents13/mechvibes-dx)** — a modern, rewritten-from-scratch core and the newer **DX v2** soundpack format.
- **[MechVibes++](https://github.com/PyroCalzone/MechVibesPlusPlus)** — adds the features people love: **key-up sounds**, **key-down sounds**, **randomized sounds**, and **mouse sounds**.

The front-end is a fresh UI styled after the author's
[Hiraganized](https://github.com/soulfern/Hiraganized) project — it is **not**
taken from either MechVibes source.

> This project is MIT licensed. It is in no way affiliated with or endorsed by
> the original Mechvibes projects.

---

## Features

- 🔉 **Keyboard sounds** — play a sound on every keystroke.
- 🔃 **Key-up sounds** — play a release sound when a key pops back up
  (with smart support for packs that ship separate up-sounds).
- 🎲 **Random sounds** — play a random key's sound instead of the one you pressed.
- 🖱️ **Mouse sounds** — click (left/right/middle) and scroll sounds.
- 🎛️ **Separate volume** sliders for keyboard and mouse.
- 🔇 **Mute all** from the window or the tray.
- 🧩 **Full Mechvibes soundpack compatibility** — drop in any
  [Mechvibes.com](https://mechvibes.com) pack (a folder with a `config.json`).
- 🎨 **Themes** — six Hiraganized-style color schemes.
- ⚙️ **Tray app** — runs quietly in the system tray; close-to-tray, start-at-login.

---

## Getting started

Requires Node.js 18+.

```bash
npm install
npm run rebuild     # compiles the native input hook for Electron
npm start
```

**Writing a build / portable exe:**

```bash
npm run package     # unpacked app in ./dist
npm run dist        # portable .exe
```

---

## Soundpack compatibility

The app understands **both** Mechvibes formats, so your existing packs keep
working:

### 1. Classic format (Mechvibes.com / MechVibes++)
```jsonc
{
  "name": "NK Cream",
  "key_define_type": "multi",          // or "single"
  "sound": "sound.ogg",                // default/sprite audio (single type)
  "defines": {
    "30": "a-down.wav",                // keycode 30 = A, key-down sound
    "001": "a-up.wav",                 // leading-zero key = release sound for key "1"
    "57": "space.wav"
  }
}
```
- `multi`: `defines` maps **keycode → file**. A leading-zero key (`01`, `001`)
  is treated as the **key-up** sound for the stripped key (`001` → key `1`).
- `single`: `defines` maps keycode → `[startMs, lengthMs]` sprite timing on
  `sound`.

Keycodes are the standard **iohook / libuiohook** codes used by Mechvibes
(`30` = `A`, `57` = `Space`, `57416` = `Up`, …), which is exactly what the
built-in global hook reports.

### 2. DX v2 format (MechVibesDX)
```jsonc
{
  "config_version": "2",
  "audio_file": "sound.ogg",
  "definitions": { "KeyA": { "timing": [[startMs, endMs], [upStart, upEnd]] } }
}
```
- One audio file; each key names a set of timing regions. The first region is
  the key-down sound, the second (if present) the key-up sound.
- GNU/Linux-style key names (`KeyA`, `Space`, `Digit1`, `ArrowUp`, `MouseLeft`) are
  auto-mapped onto the classic keycodes.

### Where packs live
- **Bundled** packs ship inside `src/soundpacks/`.
- **Custom** packs: drop pack folders into
  `%APPDATA%/Mechvibes Fusion/soundpacks/keyboard` and
  `.../mouse` (use the **Open soundpack folder** button in the app to find them).

To add a pack: copy the whole pack folder (the one containing `config.json`
plus its audio files) into the appropriate custom folder, then press
**Reload soundpacks**.

---

## Project layout

```
src/
  main/
    main.js                 # window, tray, single-instance, start-at-login
    config-store.js         # persisted settings (Hiraganized-style, no deps)
    defaults.js
    services/
      keycodes.js           # ioHook/uiohook keycode tables + random pools
      soundpack-service.js  # parse classic + DX v2 formats (unit-tested)
  renderer/
    index.html / app.js     # Hiraganized-style settings UI (orchestrator)
    styles.css / themes.css # glassmorphism UI + theme palettes
    audio-engine.js         # Howler playback (down/up/split/random/mouse)
    input-service.js        # uiohook-napi global keyboard + mouse capture
  soundpacks/               # bundled packs (both formats)
tests/                      # soundpack-compatibility unit tests
tools/                      # build helpers + verify-packs.js
```

**How it fits together:** the renderer (which has node access, the same model
MechVibes++ uses) owns the input hook and the audio engine. Key/mouse events
are normalized to classic keycodes, matched against the loaded pack, and
`howler` plays the resulting file/sprite. All UI settings round-trip through
the main-process config store so the tray and the window stay in sync.

---

## Tests

```bash
npm test
```
Covers format detection, classic multi/single parsing (including key-up
leading-zero decoding), DX v2 name→keycode mapping, and directory scanning.
