'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { defaults } = require('./defaults');

/**
 * Deep-merge `source` onto a copy of `base`, returning the merged object.
 * Missing keys in source are filled from base; extra keys in source are kept.
 */
function deepMerge(base, source) {
  const out = {};
  for (const key of Object.keys(base)) {
    const bv = base[key];
    const sv = source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
    if (bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[key] = deepMerge(bv, sv && typeof sv === 'object' ? sv : {});
    } else {
      out[key] = sv !== undefined ? sv : bv;
    }
  }
  // carry over any keys the user added beyond defaults
  if (source) {
    for (const key of Object.keys(source)) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = source[key];
    }
  }
  return out;
}

function getNested(obj, dotted) {
  return dotted.split('.').reduce((v, k) => (v == null ? undefined : v[k]), obj);
}

function setNested(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Persisted settings store. Uses a plain JSON file in the app's userData
 * directory (same philosophy as Hiraganized's ConfigStore — no external deps).
 */
class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.backupPath = `${filePath}.bak`;
    this.defaults = defaults;
    this.settings = deepMerge(defaults, {});
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.settings = deepMerge(this.defaults, saved);
      } else if (fs.existsSync(this.backupPath)) {
        const saved = JSON.parse(fs.readFileSync(this.backupPath, 'utf8'));
        this.settings = deepMerge(this.defaults, saved);
      }
    } catch (error) {
      this.lastError = error;
      try {
        if (fs.existsSync(this.backupPath)) {
          this.settings = deepMerge(this.defaults, JSON.parse(fs.readFileSync(this.backupPath, 'utf8')));
        } else {
          this.settings = deepMerge(this.defaults, {});
        }
      } catch (backupError) {
        this.lastError = backupError;
        this.settings = deepMerge(this.defaults, {});
      }
    }
    return this.get();
  }

  get() {
    return this.settings;
  }

  getValue(dotted) {
    return getNested(this.settings, dotted);
  }

  setValue(dotted, value) {
    setNested(this.settings, dotted, value);
    this.save();
    return this.settings;
  }

  save() {
    try {
      const json = JSON.stringify(this.settings, null, 2);
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, json, 'utf8');
      if (fs.existsSync(this.filePath)) {
        // keep a crash-safe backup
        try { fs.copyFileSync(this.filePath, this.backupPath); } catch (e) { /* ignore */ }
      }
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      this.lastError = error;
    }
    return this.settings;
  }

  reset(dotted) {
    if (dotted) {
      setNested(this.settings, dotted, getNested(this.defaults, dotted));
    } else {
      this.settings = deepMerge(this.defaults, {});
    }
    this.save();
    return this.settings;
  }
}

module.exports = { ConfigStore, deepMerge, getNested, setNested };
