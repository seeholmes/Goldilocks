(function (root, factory) {
  'use strict';

  const presets = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = presets;
  } else {
    root.GoldilocksPresets = presets;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'goldilocks_drinks';
  const UNSAFE_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

  function isUnsafeName(name) {
    return typeof name === 'string' && UNSAFE_NAMES.has(name.trim().toLowerCase());
  }

  function parseStoredNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) return Number(value);
    return NaN;
  }

  function normalizeDrink(drink) {
    const oz = parseStoredNumber(drink?.oz);
    const abv = parseStoredNumber(drink?.abv);
    if (!Number.isFinite(oz) || oz < 1 || oz > 64) return null;
    if (!Number.isFinite(abv) || abv < 0.5 || abv > 100) return null;
    return { oz, abv };
  }

  function sanitizeDrinkMap(value) {
    const safe = Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return safe;

    Object.entries(value).forEach(([name, drink]) => {
      const normalized = normalizeDrink(drink);
      if (name.trim() && name.length <= 28 && !isUnsafeName(name) && normalized) {
        safe[name] = normalized;
      }
    });
    return safe;
  }

  function read(storage) {
    if (!storage || typeof storage.getItem !== 'function') return Object.create(null);
    try {
      return sanitizeDrinkMap(JSON.parse(storage.getItem(STORAGE_KEY) || '{}'));
    } catch (error) {
      return Object.create(null);
    }
  }

  function write(storage, drinks) {
    if (!storage || typeof storage.setItem !== 'function') {
      throw new TypeError('storage must provide setItem');
    }
    const safe = sanitizeDrinkMap(drinks);
    storage.setItem(STORAGE_KEY, JSON.stringify(safe));
    return safe;
  }

  function save(storage, name, drink) {
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    if (!normalizedName || normalizedName.length > 28 || isUnsafeName(normalizedName)) {
      throw new RangeError('drink name must be safe and between 1 and 28 characters');
    }
    const normalizedDrink = normalizeDrink(drink);
    if (!normalizedDrink) throw new RangeError('drink values are outside the supported range');

    const drinks = read(storage);
    drinks[normalizedName] = normalizedDrink;
    return write(storage, drinks);
  }

  function remove(storage, name) {
    const drinks = read(storage);
    delete drinks[name];
    return write(storage, drinks);
  }

  return Object.freeze({
    STORAGE_KEY,
    isUnsafeName,
    sanitizeDrinkMap,
    read,
    write,
    save,
    remove,
  });
}));
