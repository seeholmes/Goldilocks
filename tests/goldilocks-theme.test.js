'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const themes = require('../goldilocks-theme.js');

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

test('publishes the theme API as a browser global', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'goldilocks-theme.js'), 'utf8');
  const browser = {};
  vm.createContext(browser);
  vm.runInContext(source, browser);
  assert.equal(browser.GoldilocksTheme.STORAGE_KEY, 'goldilocks_theme');
  assert.equal(typeof browser.GoldilocksTheme.init, 'function');
  assert.equal(typeof browser.GoldilocksTheme.bootstrap, 'function');
});

test('provides one curated four-theme catalog for the original logo', () => {
  assert.deepEqual(Object.keys(themes.THEMES), [
    'cosmos', 'navy', 'parchment', 'slate',
  ]);
  assert.equal(themes.DEFAULT_THEME, 'cosmos');
});

test('resolves accessible mode accents in dark and light themes', () => {
  const zone = themes.resolve('cosmos', 'zone');
  const pace = themes.resolve('cosmos', 'pace');
  const training = themes.resolve('cosmos', 'training');
  const history = themes.resolve('cosmos', 'history');
  const lightPace = themes.resolve('parchment', 'pace');

  assert.equal(zone.colors.accent, '#f5c842');
  assert.equal(pace.colors.accent, '#7eb8ff');
  assert.equal(training.colors.accent, '#52e09c');
  assert.equal(history.colors.accent, '#ff8c3a');
  assert.equal(lightPace.colors.accent, '#245f9e');
  assert.equal(lightPace.variables['--green'], '#1f6b4f');
  assert.equal(themes.resolve('parchment', 'history').colors.accent, '#8a3f00');
  assert.notDeepEqual(pace.colors.logo, zone.colors.logo);
});

test('loads a valid stored theme and falls back safely', () => {
  assert.equal(themes.load(new MemoryStorage({ goldilocks_theme: 'navy' })), 'navy');
  assert.equal(themes.load(new MemoryStorage({ goldilocks_theme: 'espresso' })), 'cosmos');
  assert.equal(themes.load(new MemoryStorage({ goldilocks_theme: 'honey' })), 'parchment');
  assert.equal(themes.load(new MemoryStorage({ goldilocks_theme: 'unknown' })), 'cosmos');
  assert.equal(themes.load({ getItem() { throw new Error('blocked'); } }), 'cosmos');
});

test('persists a normalized selection without requiring a DOM', () => {
  const storage = new MemoryStorage();
  const selected = themes.apply('navy', { mode: 'pace', storage });
  assert.equal(selected.id, 'navy');
  assert.equal(selected.mode, 'pace');
  assert.equal(storage.getItem(themes.STORAGE_KEY), 'navy');
});
