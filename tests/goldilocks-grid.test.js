'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const grid = require('../goldilocks-grid.js');

const HOUR = 3600000;
const START = 1_800_000_000_000;
const profile = Object.freeze({
  name: 'Grid Tester',
  weightKg: 80,
  r: 0.68,
  risePerStd: 0.02,
  metab: 0.015,
  useWidmark: false,
});

function event(id, loggedAt, overrides = {}) {
  return {
    id,
    loggedAt,
    name: 'Beer',
    oz: 12,
    abv: 5,
    ...overrides,
  };
}

test('publishes the Grid API as a browser global', () => {
  const coreSource = fs.readFileSync(path.join(__dirname, '..', 'goldilocks-core.js'), 'utf8');
  const gridSource = fs.readFileSync(path.join(__dirname, '..', 'goldilocks-grid.js'), 'utf8');
  const browser = {};
  vm.createContext(browser);
  vm.runInContext(coreSource, browser);
  vm.runInContext(gridSource, browser);
  assert.equal(browser.GoldilocksGrid.STORAGE_KEY, 'goldilocks_grid_session');
  assert.equal(typeof browser.GoldilocksGrid.calculate, 'function');
});

test('calculates exact-time mixed-drink BAC with continuous metabolism', () => {
  const events = [
    event('one', START, { oz: 5, abv: 12, name: 'Wine' }),
    event('two', START + HOUR, { oz: 1.5, abv: 40, name: 'Shot' }),
  ];
  const result = grid.calculate(events, START, START + 2 * HOUR, profile);
  const firstStandard = grid.standardDrinks(5, 12);
  const secondStandard = grid.standardDrinks(1.5, 40);
  const afterFirstHour = Math.max(0, firstStandard * 0.02 - 0.015);
  const afterSecondDrink = afterFirstHour + secondStandard * 0.02;
  const expectedCurrent = Math.max(0, afterSecondDrink - 0.015);
  assert.ok(Math.abs(result.currentBac - expectedCurrent) < 1e-12);
  assert.ok(Math.abs(result.peakBac - Math.max(firstStandard * 0.02, afterSecondDrink)) < 1e-12);
  assert.ok(Math.abs(result.totalStandardDrinks - firstStandard - secondStandard) < 1e-12);
  assert.equal(result.totalDrinks, 2);
});

test('sorts backdated events and floors metabolism at zero between drinks', () => {
  const later = event('later', START + 4 * HOUR);
  const earlier = event('earlier', START);
  const result = grid.calculate([later, earlier], START, START + 5 * HOUR, profile);
  assert.deepEqual(
    result.timeline.filter(point => point.type === 'drink').map(point => point.eventId),
    ['earlier', 'later']
  );
  assert.ok(result.currentBac >= 0);
  assert.equal(result.peakAt, START);
});

test('classifies optional personal BAC alerts without blocking calculations', () => {
  assert.equal(grid.getAlertState({ currentBac: 0.02, peakBac: 0.03 }, null).state, 'none');
  assert.equal(grid.getAlertState({ currentBac: 0.03, peakBac: 0.03 }, 0.05).state, 'below');
  assert.equal(grid.getAlertState({ currentBac: 0.041, peakBac: 0.041 }, 0.05).state, 'approaching');
  assert.equal(grid.getAlertState({ currentBac: 0.04, peakBac: 0.055 }, 0.05).state, 'crossed');
  assert.equal(grid.getAlertState({ currentBac: 0.05, peakBac: 0.055 }, 0.05).state, 'over');
});

test('normalizes complete and active Grid sessions while rejecting malformed event data', () => {
  const active = {
    version: grid.VERSION,
    sessionStartTs: START,
    completedAt: null,
    sessionComplete: false,
    profileName: profile.name,
    profile,
    foodState: 'meal',
    bacAlert: 0.06,
    drinkEvents: [event('one', START)],
    undoEvents: null,
  };
  const normalized = grid.normalizeSession(active, START + HOUR);
  assert.equal(normalized.drinkEvents.length, 1);
  assert.equal(normalized.bacAlert, 0.06);
  assert.equal(grid.normalizeSession({
    ...active,
    drinkEvents: [event('one', START), event('one', START + 1000)],
  }, START + HOUR), null);
  assert.equal(grid.normalizeSession({
    ...active,
    drinkEvents: [event('future', START + 2 * HOUR)],
  }, START + HOUR), null);
  assert.equal(grid.normalizeSession({
    ...active,
    sessionComplete: true,
    completedAt: START + HOUR,
  }, START + HOUR).sessionComplete, true);
});

test('rejects out-of-range drinks, alerts, profiles, and sessions over 24 hours', () => {
  assert.throws(() => grid.standardDrinks(0, 5), /invalid/);
  assert.equal(grid.normalizeAlertBac(0.5), null);
  assert.throws(() => grid.calculate([], START, START + HOUR, { ...profile, metab: 0 }), /invalid/);
  assert.throws(() => grid.calculate([], START, START + grid.MAX_SESSION_MS + 1, profile), /invalid/);
  assert.throws(() => grid.calculate([event('future', START + HOUR)], START, START + HOUR - 1, profile), /invalid/);
});
