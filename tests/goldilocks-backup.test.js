'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const backup = require('../goldilocks-backup.js');

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
    this.failOnceFor = null;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (this.failOnceFor === key) {
      this.failOnceFor = null;
      throw new Error('quota failure');
    }
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function sessionRecord(overrides = {}) {
  const startedAt = 1_700_000_000_000;
  return {
    version: 3,
    id: `zone-${startedAt}`,
    mode: 'zone',
    startedAt,
    completedAt: startedAt + 90 * 60000,
    durationMinutes: 120,
    profileName: 'Test User',
    drinkOz: 12,
    drinkAbv: 5,
    plannedDrinks: 3,
    loggedDrinks: 2,
    standardDrinks: 2,
    finalBac: 0.041,
    peakBac: 0.048,
    completionReason: 'manual',
    foodState: 'meal',
    modelRisePerStd: 0.02,
    modelMetabPerHr: 0.015,
    modelSnapshotSource: 'session',
    measurement: {
      value: 0.043,
      measuredAt: startedAt + 90 * 60000,
      protocolFollowed: true,
      estimatedBac: 0.041,
    },
    recoveryRating: 2,
    recoveryRatedAt: startedAt + 12 * 3600000,
    detail: { type: 'zone', targetMin: 0.04, targetMax: 0.06, matchedPeriods: 1 },
    ...overrides,
  };
}

function populatedStorage() {
  return new MemoryStorage({
    goldilocks_profiles: JSON.stringify({
      'Test User': {
        name: 'Test User',
        weightKg: 80,
        r: 0.68,
        risePerStd: 0.02,
        metab: 0.015,
        useWidmark: false,
        confidence: 'medium',
      },
    }),
    goldilocks_theme: 'navy',
    goldilocks_drinks: JSON.stringify({
      'House pour': { oz: 5, abv: 12 },
    }),
    goldilocks_session_history: JSON.stringify([sessionRecord()]),
    goldilocks_training_history: JSON.stringify([{
      sessionId: 'training-1',
      date: '2026-07-20',
      profile: 'Test User',
      metab: 0.014,
      rise: 0.021,
      r2: 0.96,
      readings: 3,
      foodState: 'meal',
    }]),
    goldilocks_v2_session: JSON.stringify({ sessionStartTs: 1_700_000_000_000, sessionActive: true }),
    goldilocks_cruise_session: JSON.stringify({ sessionStartTs: 1_700_100_000_000, sessionActive: false }),
    goldilocks_grid_session: JSON.stringify({ version: 1, sessionStartTs: 1_700_200_000_000, drinkEvents: [] }),
    unrelated_key: 'keep me',
  });
}

test('publishes the backup API as a browser global', () => {
  const historySource = fs.readFileSync(path.join(__dirname, '..', 'goldilocks-session-history.js'), 'utf8');
  const presetsSource = fs.readFileSync(path.join(__dirname, '..', 'goldilocks-presets.js'), 'utf8');
  const backupSource = fs.readFileSync(path.join(__dirname, '..', 'goldilocks-backup.js'), 'utf8');
  const browser = {};
  vm.createContext(browser);
  vm.runInContext(historySource, browser);
  vm.runInContext(presetsSource, browser);
  vm.runInContext(backupSource, browser);
  assert.equal(browser.GoldilocksBackup.FORMAT, 'goldilocks-device-backup');
  assert.equal(typeof browser.GoldilocksBackup.restore, 'function');
});

test('creates a versioned full-device backup and summarizes its contents', () => {
  const storage = populatedStorage();
  const document = backup.create(storage, { appVersion: '1.1.0', now: 1_800_000_000_000 });
  const summary = backup.summarize(document);

  assert.equal(document.format, backup.FORMAT);
  assert.equal(document.schemaVersion, backup.SCHEMA_VERSION);
  assert.equal(document.appVersion, '1.1.0');
  assert.equal(summary.profiles, 1);
  assert.equal(summary.drinks, 1);
  assert.equal(summary.sessions, 1);
  assert.equal(summary.measuredSessions, 1);
  assert.equal(summary.calibrationSessions, 1);
  assert.equal(summary.activeSessions, 3);
  assert.equal(summary.theme, 'navy');
  assert.equal(document.data.activeSessions.calibration, null);
  assert.doesNotMatch(backup.serialize(document), /unrelated_key/);
});

test('parses its own JSON and rejects unsupported, malformed, unsafe, and oversized backups', () => {
  const document = backup.create(populatedStorage(), { appVersion: '1.1.0' });
  assert.deepEqual(backup.parse(backup.serialize(document)), document);
  assert.throws(() => backup.parse('{bad'), /valid JSON/);
  assert.throws(() => backup.parse(JSON.stringify({ ...document, schemaVersion: 99 })), /supported/);
  assert.throws(() => backup.parse(JSON.stringify({
    ...document,
    data: {
      ...document.data,
      drinks: { bad: { oz: 0, abv: 200 } },
    },
  })), /custom drink/);
  assert.throws(() => backup.parse('x'.repeat(backup.MAX_BACKUP_BYTES + 1)), /too large/);
});

test('restores the complete whitelist, removes absent active sessions, and preserves unrelated storage', () => {
  const source = populatedStorage();
  const document = backup.create(source, { appVersion: '1.1.0', now: 1_800_000_000_000 });
  const target = new MemoryStorage({
    goldilocks_theme: 'parchment',
    goldilocks_training_session: JSON.stringify({ stale: true }),
    unrelated_key: 'keep me',
  });
  backup.restore(target, document, { now: 1_800_100_000_000 });

  assert.equal(target.getItem('goldilocks_theme'), 'navy');
  assert.equal(JSON.parse(target.getItem('goldilocks_session_history')).length, 1);
  assert.equal(JSON.parse(target.getItem('goldilocks_grid_session')).version, 1);
  assert.equal(target.getItem('goldilocks_training_session'), null);
  assert.equal(target.getItem('unrelated_key'), 'keep me');
  assert.equal(target.getItem(backup.LAST_BACKUP_KEY), document.exportedAt);
  assert.equal(target.getItem(backup.LAST_RESTORE_KEY), new Date(1_800_100_000_000).toISOString());
});

test('rolls back every touched key when a restore write fails', () => {
  const original = new MemoryStorage({
    goldilocks_profiles: JSON.stringify({}),
    goldilocks_theme: 'cosmos',
    goldilocks_drinks: JSON.stringify({ Original: { oz: 12, abv: 5 } }),
  });
  const before = new Map(original.values);
  original.failOnceFor = 'goldilocks_session_history';
  const document = backup.create(populatedStorage(), { appVersion: '1.1.0' });

  assert.throws(() => backup.restore(original, document), /existing data was preserved/);
  for (const key of backup.OWNED_STORAGE_KEYS) {
    assert.equal(original.getItem(key), before.has(key) ? before.get(key) : null);
  }
});

test('tracks exports and erases only Goldilocks-owned data', () => {
  const storage = populatedStorage();
  const exportedAt = backup.markExported(storage, 1_800_000_000_000);
  assert.equal(backup.getLastBackupAt(storage), exportedAt);
  backup.erase(storage);
  backup.OWNED_STORAGE_KEYS.forEach(key => assert.equal(storage.getItem(key), null));
  assert.equal(storage.getItem('unrelated_key'), 'keep me');
});
