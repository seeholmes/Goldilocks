'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../goldilocks-core.js');
const sessions = require('../goldilocks-session-state.js');

const NOW = Date.UTC(2026, 6, 21, 20, 0, 0);
const MINUTE = 60000;
const HOUR = 60 * MINUTE;

const profile = Object.freeze({
  name: 'Test Profile',
  weightKg: 83.9,
  r: 0.68,
  risePerStd: 0.02,
  metab: 0.015,
  useWidmark: false,
});

function zoneFixture(overrides = {}) {
  return {
    sessionStartTs: NOW - HOUR,
    actualDrinks: [2, null, null, null],
    plan: [3, 1, 1, 0],
    replanFlags: [false, false, false, false],
    hours: 4,
    bacMin: 0.04,
    bacMax: 0.08,
    ag: core.STD_DRINK_G,
    sessionComplete: false,
    profileName: profile.name,
    drinkOz: '12',
    drinkAbv: '5',
    startTime: '19:00',
    weight: '185',
    units: 'imperial',
    sex: 'male',
    profile: { ...profile },
    ...overrides,
  };
}

function paceFixture(overrides = {}) {
  const start = NOW - 30 * MINUTE;
  return {
    sessionStartTs: start,
    durationMinutes: 120,
    plan: [2, 1],
    drinkSchedule: [start + 10 * MINUTE, start + 50 * MINUTE, start + 90 * MINUTE],
    actualDrinkTimes: [start + 10 * MINUTE, null, null],
    bacEnd: 0.04,
    ag: core.STD_DRINK_G,
    sessionComplete: false,
    planSpacing: 2 / 3,
    planOffsetHours: 1 / 6,
    plannedEndpoint: 0.04,
    planAchievable: true,
    profileName: profile.name,
    drinkOz: '12',
    drinkAbv: '5',
    weight: '185',
    units: 'imperial',
    sex: 'male',
    profile: { ...profile },
    ...overrides,
  };
}

function trainingFixture(overrides = {}) {
  const weight = 185;
  const drinkOz = 12;
  const drinkAbv = 5;
  return {
    t0: NOW - 10 * MINUTE,
    readings: [],
    fasted: false,
    currentStep: 0,
    sessionAlcGrams: drinkOz * (drinkAbv / 100) * 29.5735 * 0.789,
    sessionWeightKg: weight * 0.453592,
    sessionR: 0.68,
    completedProtocolId: null,
    savedProtocolId: null,
    weight: String(weight),
    units: 'imperial',
    sex: 'male',
    drinkOz: String(drinkOz),
    drinkAbv: String(drinkAbv),
    ...overrides,
  };
}

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.writes = 0;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem() { this.writes += 1; }
  removeItem() { this.writes += 1; }
  clear() { this.writes += 1; }
}

test('publishes the session inspector as a browser global', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'goldilocks-session-state.js'), 'utf8');
  const browser = {};
  vm.createContext(browser);
  vm.runInContext(source, browser);
  assert.equal(browser.GoldilocksSessionState.KEYS.pace, 'goldilocks_cruise_session');
  assert.equal(typeof browser.GoldilocksSessionState.inspectStorage, 'function');
});

test('inspects scheduled, active, completed, and expired Zone sessions', () => {
  const scheduled = sessions.inspectZone(zoneFixture({
    sessionStartTs: NOW + HOUR,
    actualDrinks: [null, null, null, null],
    startTime: '21:00',
  }), NOW);
  assert.equal(scheduled.health, 'valid');
  assert.equal(scheduled.state, 'scheduled');

  const active = sessions.inspectZone(zoneFixture(), NOW);
  assert.equal(active.state, 'active');
  assert.equal(active.currentStep, 2);
  assert.equal(active.loggedDrinks, 2);

  const completeStart = NOW - 4 * HOUR;
  const complete = sessions.inspectZone(zoneFixture({
    sessionStartTs: completeStart,
    actualDrinks: [2, 1, 1, 0],
    sessionComplete: true,
    startTime: '16:00',
  }), NOW);
  assert.equal(complete.state, 'complete');

  const expired = sessions.inspectZone(zoneFixture({ sessionStartTs: NOW - 6 * HOUR }), NOW);
  assert.equal(expired.health, 'expired');
});

test('inspects Pace progress and normalizes legacy whole-hour duration in memory', () => {
  const current = sessions.inspectPace(paceFixture(), NOW);
  assert.equal(current.health, 'valid');
  assert.equal(current.state, 'active');
  assert.equal(current.loggedDrinks, 1);
  assert.equal(current.remainingDrinks, 2);

  const legacy = paceFixture();
  delete legacy.durationMinutes;
  legacy.hours = 2;
  const legacyResult = sessions.inspectPace(legacy, NOW);
  assert.equal(legacyResult.health, 'valid');
  assert.equal(legacyResult.durationMinutes, 120);
  assert.equal(legacy.durationMinutes, undefined);
});

test('rejects a Pace schedule whose persisted hourly plan does not match', () => {
  const result = sessions.inspectPace(paceFixture({ plan: [1, 2] }), NOW);
  assert.equal(result.health, 'corrupt');
  assert.equal(result.reason, 'plan-mismatch');
});

test('distinguishes an active Training protocol from a valid ready-to-finish curve', () => {
  const active = sessions.inspectTraining(trainingFixture(), NOW, core);
  assert.equal(active.health, 'valid');
  assert.equal(active.state, 'active-waiting');
  assert.equal(active.readings, 0);

  const t0 = NOW - 90 * MINUTE;
  const readings = [
    { tMin: 45, bac: 0.08, ts: t0 + 45 * MINUTE },
    { tMin: 65, bac: 0.075, ts: t0 + 65 * MINUTE },
    { tMin: 85, bac: 0.07, ts: t0 + 85 * MINUTE },
  ];
  const ready = sessions.inspectTraining(trainingFixture({
    t0,
    readings,
    currentStep: readings.length,
  }), NOW, core);
  assert.equal(ready.health, 'valid');
  assert.equal(ready.state, 'ready-to-finish');

  const protocolId = `${t0}:${readings.map((reading) => reading.ts).join('-')}`;
  const saved = sessions.inspectTraining(trainingFixture({
    t0,
    readings,
    currentStep: readings.length,
    completedProtocolId: protocolId,
    savedProtocolId: protocolId,
  }), NOW, core);
  assert.equal(saved.state, 'results-saved');
});

test('contains malformed JSON and performs no storage writes while inspecting', () => {
  const storage = new MemoryStorage({
    [sessions.KEYS.zone]: '{bad json',
    [sessions.KEYS.pace]: JSON.stringify(paceFixture()),
  });
  const snapshot = sessions.inspectStorage(storage, NOW, core);
  assert.equal(snapshot.zone.health, 'corrupt');
  assert.equal(snapshot.pace.health, 'valid');
  assert.equal(snapshot.training.health, 'missing');
  assert.equal(storage.writes, 0);
});

test('contains a storage failure to its individual mode', () => {
  const storage = {
    getItem(key) {
      if (key === sessions.KEYS.zone) throw new Error('blocked');
      if (key === sessions.KEYS.pace) return JSON.stringify(paceFixture());
      return null;
    },
  };
  const snapshot = sessions.inspectStorage(storage, NOW, core);
  assert.equal(snapshot.zone.health, 'unavailable');
  assert.equal(snapshot.pace.health, 'valid');
});

test('summarizes calibrated profiles without exposing profile names', () => {
  const status = sessions.inspectProfiles({
    Craig: { ...profile, sessions: 2, calibratedAt: '2026-07-20' },
    Estimate: { ...profile, name: 'Estimate' },
  });
  assert.deepEqual(status, {
    health: 'valid',
    count: 1,
    sessions: 2,
    latest: '2026-07-20',
  });
});
