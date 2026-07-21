'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const presets = require('../goldilocks-presets.js');

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

test('publishes the preset API as a browser global', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'goldilocks-presets.js'),
    'utf8'
  );
  const browser = {};
  vm.createContext(browser);
  vm.runInContext(source, browser);
  assert.equal(browser.GoldilocksPresets.STORAGE_KEY, 'goldilocks_drinks');
  assert.equal(typeof browser.GoldilocksPresets.read, 'function');
});

test('reads the existing Zone preset format without migration', () => {
  const storage = new MemoryStorage({
    goldilocks_drinks: JSON.stringify({
      'House IPA': { oz: '16', abv: '6.5' },
    }),
  });
  const drinks = presets.read(storage);
  assert.deepEqual({ ...drinks }, {
    'House IPA': { oz: 16, abv: 6.5 },
  });
});

test('filters malformed drinks and unsafe names safely', () => {
  const source = JSON.parse('{"Good":{"oz":5,"abv":12},"Bad oz":{"oz":0,"abv":12},"Bad ABV":{"oz":5,"abv":101},"Boolean":{"oz":true,"abv":true},"This preset name is much too long":{"oz":5,"abv":12},"constructor":{"oz":5,"abv":12},"__proto__":{"oz":5,"abv":12}}');
  const drinks = presets.sanitizeDrinkMap(source);
  assert.deepEqual(Object.keys(drinks), ['Good']);
  assert.equal(Object.getPrototypeOf(drinks), null);
});

test('shares save, overwrite, and delete operations through one storage key', () => {
  const storage = new MemoryStorage();
  presets.save(storage, 'Spritz', { oz: 8, abv: 9 });
  presets.save(storage, 'Spritz', { oz: 9, abv: 8.5 });
  presets.save(storage, 'Wine', { oz: 5, abv: 12 });
  assert.deepEqual({ ...presets.read(storage) }, {
    Spritz: { oz: 9, abv: 8.5 },
    Wine: { oz: 5, abv: 12 },
  });

  presets.remove(storage, 'Spritz');
  assert.deepEqual({ ...presets.read(storage) }, {
    Wine: { oz: 5, abv: 12 },
  });
});

test('contains corrupt or unavailable storage failures', () => {
  const corrupt = new MemoryStorage({ goldilocks_drinks: '{not json' });
  assert.deepEqual(Object.keys(presets.read(corrupt)), []);

  const unavailable = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.deepEqual(Object.keys(presets.read(unavailable)), []);
  assert.throws(
    () => presets.save(unavailable, 'Wine', { oz: 5, abv: 12 }),
    /blocked/
  );
});

test('rejects invalid names and drink values before writing', () => {
  const storage = new MemoryStorage();
  assert.throws(
    () => presets.save(storage, '__proto__', { oz: 5, abv: 12 }),
    /drink name/
  );
  assert.throws(
    () => presets.save(storage, 'Too strong', { oz: 5, abv: 101 }),
    /drink values/
  );
  assert.equal(storage.getItem(presets.STORAGE_KEY), null);
});
