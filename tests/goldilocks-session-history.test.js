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

function evidenceRecord(index, overrides = {}) {
  const startedAt = 1_701_000_000_000 + index * 24 * 3600000;
  return paceRecord({
    version: 2,
    id: `pace-evidence-${index}`,
    startedAt,
    completedAt: startedAt + 120 * 60000,
    durationMinutes: 120,
    profileName: 'Expert',
    standardDrinks: 2,
    finalBac: 0.04,
    peakBac: 0.05,
    foodState: index % 2 ? 'light' : 'meal',
    modelRisePerStd: 0.02,
    modelMetabPerHr: 0.015,
    measurement: null,
    ...overrides,
  });
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

test('migrates version-one summaries with unknown evidence fields', () => {
  const normalized = history.normalizeRecord(zoneRecord());
  assert.equal(normalized.version, history.VERSION);
  assert.equal(normalized.foodState, 'unknown');
  assert.equal(normalized.modelRisePerStd, null);
  assert.equal(normalized.modelMetabPerHr, null);
  assert.equal(normalized.measurement, null);
});

test('adds food state and a qualifying timed BAC measurement', () => {
  const storage = new MemoryStorage();
  const record = evidenceRecord(0);
  history.save(storage, record);
  history.setMeasurement(storage, record.id, {
    value: 0.044,
    measuredAt: record.completedAt,
    protocolFollowed: true,
  });
  const updated = history.read(storage)[0];
  assert.equal(updated.foodState, 'meal');
  assert.equal(updated.measurement.value, 0.044);
  assert.equal(updated.measurement.estimatedBac, 0.04);
  assert.equal(updated.measurement.eligibleForRefinement, true);

  history.setMeasurement(storage, record.id, {
    value: 0.045,
    measuredAt: record.completedAt - 500,
    protocolFollowed: true,
  });
  assert.equal(history.read(storage)[0].measurement.measuredAt, record.completedAt);

  history.setFoodState(storage, record.id, 'empty');
  assert.equal(history.read(storage)[0].foodState, 'empty');
  assert.throws(() => history.setFoodState(storage, record.id, 'unknown'), /food state/);
  assert.throws(() => history.setMeasurement(storage, record.id, {
    value: 0.05,
    measuredAt: record.completedAt + history.MEASUREMENT_WINDOW_MS + 1,
    protocolFollowed: true,
  }), /measurement/);
});

test('keeps non-qualifying measurements for comparison without using them as evidence', () => {
  const storage = new MemoryStorage();
  const record = evidenceRecord(0);
  history.save(storage, record);
  history.setMeasurement(storage, record.id, {
    value: 0,
    measuredAt: record.completedAt,
    protocolFollowed: true,
  });
  let measurement = history.read(storage)[0].measurement;
  assert.equal(measurement.eligibleForRefinement, false);
  assert.equal(measurement.eligibilityReason, 'zero-reading');

  history.setMeasurement(storage, record.id, {
    value: 0.044,
    measuredAt: record.completedAt,
    protocolFollowed: false,
  });
  measurement = history.read(storage)[0].measurement;
  assert.equal(measurement.eligibleForRefinement, false);
  assert.equal(measurement.eligibilityReason, 'protocol-not-confirmed');
});

test('suggests a robust BAC-per-drink value only after three eligible readings', () => {
  const storage = new MemoryStorage();
  const measuredValues = [0.044, 0.048, 0.04];
  measuredValues.forEach((value, index) => {
    const record = evidenceRecord(index);
    history.save(storage, record);
    history.setMeasurement(storage, record.id, {
      value,
      measuredAt: record.completedAt,
      protocolFollowed: true,
    });
  });
  const evidence = history.calculateRiseEvidence(history.read(storage), 'expert');
  assert.equal(evidence.eligibleCount, 3);
  assert.equal(evidence.confidence, 'low');
  assert.ok(Math.abs(evidence.meanError - 0.004) < 1e-12);
  assert.ok(Math.abs(evidence.meanAbsoluteError - 0.004) < 1e-12);
  assert.ok(Math.abs(evidence.suggestedRisePerStd - 0.022) < 1e-12);
  assert.equal(evidence.byFoodState.meal.count, 2);
  assert.equal(evidence.byFoodState.light.count, 1);

  const insufficient = history.calculateRiseEvidence(history.read(storage).slice(0, 2), 'Expert');
  assert.equal(insufficient.eligibleCount, 2);
  assert.equal(insufficient.suggestedRisePerStd, null);
});
