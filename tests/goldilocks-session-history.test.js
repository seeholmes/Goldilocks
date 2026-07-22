'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const history = require('../goldilocks-session-history.js');

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

function zoneRecord(overrides = {}) {
  const startedAt = 1_700_000_000_000;
  return {
    version: 1,
    id: `zone-${startedAt}`,
    mode: 'zone',
    startedAt,
    completedAt: startedAt + 90 * 60000,
    durationMinutes: 120,
    profileName: 'seeholmes',
    drinkOz: 12,
    drinkAbv: 5,
    plannedDrinks: 3,
    loggedDrinks: 2,
    standardDrinks: 2,
    finalBac: 0.041,
    peakBac: 0.048,
    completionReason: 'manual',
    detail: { type: 'zone', targetMin: 0.04, targetMax: 0.06, matchedPeriods: 1 },
    ...overrides,
  };
}

function paceRecord(overrides = {}) {
  const startedAt = 1_700_100_000_000;
  return {
    version: 1,
    id: `pace-${startedAt}`,
    mode: 'pace',
    startedAt,
    completedAt: startedAt + 180 * 60000,
    durationMinutes: 180,
    profileName: 'custom',
    drinkOz: 5,
    drinkAbv: 12,
    plannedDrinks: 4,
    loggedDrinks: 3,
    standardDrinks: 3,
    finalBac: 0.052,
    peakBac: 0.06,
    completionReason: 'elapsed',
    detail: { type: 'pace', targetEnd: 0.05, initialProjectedEnd: 0.049 },
    ...overrides,
  };
}

test('publishes the session-history API as a browser global', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'goldilocks-session-history.js'), 'utf8');
  const browser = {};
  vm.createContext(browser);
  vm.runInContext(source, browser);
  assert.equal(browser.GoldilocksSessionHistory.STORAGE_KEY, 'goldilocks_session_history');
  assert.equal(typeof browser.GoldilocksSessionHistory.save, 'function');
});

test('saves Zone and Pace summaries newest-first and deduplicates session ids', () => {
  const storage = new MemoryStorage();
  history.save(storage, zoneRecord());
  history.save(storage, paceRecord());
  history.save(storage, zoneRecord({ loggedDrinks: 3, standardDrinks: 3 }));
  const records = history.read(storage);
  assert.equal(records.length, 2);
  assert.equal(records[0].mode, 'pace');
  assert.equal(records[1].loggedDrinks, 3);
});

test('filters malformed records, corrupt JSON, duplicates, and excess entries', () => {
  const records = Array.from({ length: history.MAX_ENTRIES + 5 }, (_, index) => {
    const startedAt = 1_700_000_000_000 + index * 3600000;
    return zoneRecord({
      id: `zone-${startedAt}`,
      startedAt,
      completedAt: startedAt + 60 * 60000,
    });
  });
  records.push(records[0], { ...zoneRecord(), id: '__proto__', finalBac: Infinity });
  const storage = new MemoryStorage({ [history.STORAGE_KEY]: JSON.stringify(records) });
  const safe = history.read(storage);
  assert.equal(safe.length, history.MAX_ENTRIES);
  assert.ok(safe.every((record, index) => index === 0 || safe[index - 1].completedAt >= record.completedAt));
  assert.deepEqual(history.read(new MemoryStorage({ [history.STORAGE_KEY]: '{bad json' })), []);
});

test('rejects invalid summaries before writing', () => {
  const storage = new MemoryStorage();
  assert.throws(() => history.save(storage, paceRecord({ completedAt: 0 })), /invalid/);
  assert.throws(() => history.save(storage, zoneRecord({ detail: { type: 'zone', targetMin: 0.08, targetMax: 0.04, matchedPeriods: 0 } })), /invalid/);
  assert.equal(storage.getItem(history.STORAGE_KEY), null);
});

test('removes individual records and clears history', () => {
  const storage = new MemoryStorage();
  history.save(storage, zoneRecord());
  history.save(storage, paceRecord());
  history.remove(storage, zoneRecord().id);
  assert.deepEqual(history.read(storage).map(record => record.mode), ['pace']);
  history.clear(storage);
  assert.deepEqual(history.read(storage), []);
});
