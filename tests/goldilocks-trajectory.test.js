'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const trajectory = require('../goldilocks-trajectory.js');

test('publishes the projected-trajectory API as a browser global', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'goldilocks-trajectory.js'), 'utf8');
  const browser = {};
  vm.createContext(browser);
  vm.runInContext(source, browser);
  assert.equal(typeof browser.GoldilocksTrajectory.buildModel, 'function');
  assert.equal(typeof browser.GoldilocksTrajectory.render, 'function');
  assert.equal(typeof browser.GoldilocksTrajectory.clear, 'function');
});

test('builds period-end points for fractional sessions and sorts drink markers', () => {
  const model = trajectory.buildModel({
    durationMinutes: 75,
    startBac: 0.01,
    trace: [0.04, 0.038],
    drinks: [{ minute: 62, count: 1 }, { minute: 20, count: 2 }],
    range: { low: 0.03, high: 0.05 },
  });
  assert.deepEqual(model.points, [
    { minute: 0, bac: 0.01 },
    { minute: 60, bac: 0.04 },
    { minute: 75, bac: 0.038 },
  ]);
  assert.deepEqual(model.drinks, [{ minute: 20, count: 2 }, { minute: 62, count: 1 }]);
  assert.deepEqual(model.range, { low: 0.03, high: 0.05 });
});

test('validates trajectory duration, trace shape, and drink markers', () => {
  assert.throws(() => trajectory.buildModel({ durationMinutes: 75, trace: [0.04] }), /one period-end BAC/);
  assert.throws(() => trajectory.buildModel({ durationMinutes: 60, trace: [-0.01] }), /finite non-negative/);
  assert.throws(() => trajectory.buildModel({
    durationMinutes: 60,
    trace: [0.02],
    drinks: [{ minute: 61, count: 1 }],
  }), /inside the session/);
});

test('formats chart time labels without implying clock times', () => {
  assert.equal(trajectory.formatMinutes(0), 'Start');
  assert.equal(trajectory.formatMinutes(45), '45m');
  assert.equal(trajectory.formatMinutes(90), '1h 30m');
});
