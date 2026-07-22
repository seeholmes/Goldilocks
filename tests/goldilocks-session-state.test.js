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
    durationMinutes: 240,
    actualDrinks: [2, null, null, null],
    plan: [3, 1, 1, 0],
    replanFlags: [false, false, false, false],
    bacMin: 0.04,
    bacMax: 0.08,
    ag: core.STD_DRINK_G,
    sessionComplete: false,
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

test('inspects canonical active, completed, and expired Zone sessions without a planned start field', () => {
  const fixture = zoneFixture();
  assert.equal(Object.hasOwn(fixture, 'startTime'), false);
  const active = sessions.inspectZone(fixture, NOW);
  assert.equal(active.health, 'valid');
  assert.equal(active.state, 'active');
  assert.equal(active.currentStep, 2);
  assert.equal(active.totalSteps, 4);
  assert.equal(active.durationMinutes, 240);
  assert.equal(active.loggedDrinks, 2);
  assert.equal(active.needsReconciliation, false);

  const completeStart = NOW - 4 * HOUR;
  const complete = sessions.inspectZone(zoneFixture({
    sessionStartTs: completeStart,
    actualDrinks: [2, 1, 1, 0],
    sessionComplete: true,
  }), NOW);
  assert.equal(complete.state, 'complete');

  const expired = sessions.inspectZone(zoneFixture({ sessionStartTs: NOW - 6 * HOUR }), NOW);
  assert.equal(expired.health, 'expired');
});

test('reports unresolved Zone periods without confusing an explicit zero', () => {
  const unresolved = sessions.inspectZone(zoneFixture({
    sessionStartTs: NOW - 2 * HOUR,
    actualDrinks: [2, null, null, null],
  }), NOW);
  assert.equal(unresolved.health, 'valid');
  assert.equal(unresolved.unresolvedPeriods, 1);
  assert.equal(unresolved.needsReconciliation, true);

  const resolved = sessions.inspectZone(zoneFixture({
    sessionStartTs: NOW - 2 * HOUR,
    actualDrinks: [2, 0, null, null],
  }), NOW);
  assert.equal(resolved.unresolvedPeriods, 0);
  assert.equal(resolved.needsReconciliation, false);
});

test('accepts an early completed Zone session only when elapsed hours are reconciled', () => {
  const complete = sessions.inspectZone(zoneFixture({
    completedAt: NOW,
    actualDrinks: [2, null, null, null],
    sessionComplete: true,
  }), NOW);
  assert.equal(complete.health, 'valid');
  assert.equal(complete.state, 'complete');
  assert.equal(complete.completedAt, NOW);

  const invalid = sessions.inspectZone(zoneFixture({
    completedAt: NOW,
    actualDrinks: [null, null, null, null],
    sessionComplete: true,
  }), NOW);
  assert.equal(invalid.health, 'corrupt');
  assert.equal(invalid.reason, 'invalid-completion-progress');
});

test('inspects a canonical 75-minute Zone session across its partial final bucket', () => {
  const start = NOW - 70 * MINUTE;
  const active = sessions.inspectZone(zoneFixture({
    sessionStartTs: start,
    durationMinutes: 75,
    actualDrinks: [2, null],
    plan: [3, 1],
    replanFlags: [false, false],
  }), NOW);
  assert.equal(active.health, 'valid');
  assert.equal(active.state, 'active');
  assert.equal(active.durationMinutes, 75);
  assert.equal(active.currentStep, 2);
  assert.equal(active.totalSteps, 2);
  assert.equal(active.scheduledEndAt, start + 75 * MINUTE);
  assert.equal(active.needsReconciliation, false);

  const endedStart = NOW - 75 * MINUTE;
  const needsFinalize = sessions.inspectZone(zoneFixture({
    sessionStartTs: endedStart,
    durationMinutes: 75,
    actualDrinks: [2, null],
    plan: [3, 1],
    replanFlags: [false, false],
  }), NOW);
  assert.equal(needsFinalize.health, 'valid');
  assert.equal(needsFinalize.state, 'needs-finalize');
  assert.equal(needsFinalize.currentStep, null);
  assert.equal(needsFinalize.totalSteps, 2);
  assert.equal(needsFinalize.unresolvedPeriods, 1);
  assert.equal(needsFinalize.needsReconciliation, true);
});

test('normalizes legacy Zone hours without mutating the stored object', () => {
  const legacy = zoneFixture({
    sessionStartTs: NOW - HOUR,
    startTime: '19:00',
  });
  delete legacy.durationMinutes;
  legacy.hours = 4;

  const inspected = sessions.inspectZone(legacy, NOW);
  assert.equal(inspected.health, 'valid');
  assert.equal(inspected.durationMinutes, 240);
  assert.equal(inspected.totalSteps, 4);
  assert.equal(legacy.durationMinutes, undefined);
  assert.equal(legacy.hours, 4);
});

test('keeps a legacy scheduled Zone session resumable', () => {
  const legacy = zoneFixture({
    sessionStartTs: NOW + HOUR,
    actualDrinks: [null, null, null, null],
    startTime: '21:00',
  });
  delete legacy.durationMinutes;
  legacy.hours = 4;

  const scheduled = sessions.inspectZone(legacy, NOW);
  assert.equal(scheduled.health, 'valid');
  assert.equal(scheduled.state, 'scheduled');
  assert.equal(scheduled.durationMinutes, 240);
  assert.equal(scheduled.startAt, NOW + HOUR);
});

test('rejects invalid Zone duration increments and duration bucket shapes', () => {
  for (const durationMinutes of [45, 70, 495]) {
    const result = sessions.inspectZone(zoneFixture({ durationMinutes }), NOW);
    assert.equal(result.health, 'corrupt', `${durationMinutes} minutes must be invalid`);
    assert.equal(result.reason, 'invalid-session');
  }

  const partialSession = {
    durationMinutes: 75,
    actualDrinks: [2, null],
    plan: [3, 1],
    replanFlags: [false, false],
  };
  const mismatches = [
    { ...partialSession, plan: [3] },
    { ...partialSession, actualDrinks: [2] },
    { ...partialSession, replanFlags: [false] },
    { ...partialSession, initialPlan: [3] },
  ];
  for (const overrides of mismatches) {
    const result = sessions.inspectZone(zoneFixture(overrides), NOW);
    assert.equal(result.health, 'corrupt');
    assert.equal(result.reason, 'invalid-session');
  }
});

test('inspects Pace progress and normalizes legacy whole-hour duration in memory', () => {
  const current = sessions.inspectPace(paceFixture({ initialPlannedDrinks: 10, initialPeakBac: 0.06 }), NOW);
  assert.equal(current.health, 'valid');
  assert.equal(current.state, 'active');
  assert.equal(current.plannedDrinks, 3);
  assert.equal(current.initialPlannedDrinks, 10);
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

test('accepts immutable Pace cadence after an active duration reduction', () => {
  const start = NOW - 30 * MINUTE;
  const shortened = sessions.inspectPace(paceFixture({
    sessionStartTs: start,
    durationMinutes: 60,
    plan: [2],
    drinkSchedule: [start + 10 * MINUTE, start + 50 * MINUTE],
    actualDrinkTimes: [start + 10 * MINUTE, null],
    planSpacing: 2,
    sessionCadenceHours: 2,
    initialPlannedDrinks: 2,
  }), NOW);
  assert.equal(shortened.health, 'valid');
  assert.equal(shortened.remainingDrinks, 1);

  const invalidCadence = sessions.inspectPace(paceFixture({ sessionCadenceHours: 9 }), NOW);
  assert.equal(invalidCadence.health, 'corrupt');
  assert.equal(invalidCadence.reason, 'invalid-cadence');
});

test('rejects invalid persisted Pace preview estimates', () => {
  const result = sessions.inspectPace(paceFixture({ initialPeakBac: Number.NaN }), NOW);
  assert.equal(result.health, 'corrupt');
  assert.equal(result.reason, 'invalid-session');
});

test('rejects a Pace schedule whose persisted hourly plan does not match', () => {
  const result = sessions.inspectPace(paceFixture({ plan: [1, 2] }), NOW);
  assert.equal(result.health, 'corrupt');
  assert.equal(result.reason, 'plan-mismatch');
});

test('accepts early Pace completion and preserves the original planned count', () => {
  const start = NOW - 30 * MINUTE;
  const complete = sessions.inspectPace(paceFixture({
    completedAt: NOW,
    sessionComplete: true,
    initialPlannedDrinks: 3,
    plan: [1, 0],
    drinkSchedule: [start + 10 * MINUTE, start + 50 * MINUTE, start + 90 * MINUTE],
    actualDrinkTimes: [start + 10 * MINUTE, null, null],
  }), NOW);
  assert.equal(complete.health, 'valid');
  assert.equal(complete.state, 'complete');
  assert.equal(complete.plannedDrinks, 3);
  assert.equal(complete.loggedDrinks, 1);
  assert.equal(complete.remainingDrinks, 0);
  assert.equal(complete.nextAt, null);
});

test('accepts a persisted one-step Pace log snapshot', () => {
  const current = paceFixture();
  const inspected = sessions.inspectPace({
    ...current,
    lastPaceLogChange: {
      index: 0,
      changedAt: current.actualDrinkTimes[0],
      drinkSchedule: current.drinkSchedule.slice(),
      actualDrinkTimes: [null, null, null],
    },
  }, NOW);
  assert.equal(inspected.health, 'valid');
  assert.equal(inspected.loggedDrinks, 1);
  assert.equal(inspected.remainingDrinks, 2);
});

test('distinguishes an active Calibration session from a valid ready-to-finish curve', () => {
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
