'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const waypoint = require('../goldilocks-drink-waypoint.js');

test('publishes the shared drink-waypoint API as a browser global', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'goldilocks-drink-waypoint.js'), 'utf8');
  const browser = {};
  vm.createContext(browser);
  vm.runInContext(source, browser);
  assert.equal(typeof browser.GoldilocksDrinkWaypoint.create, 'function');
  assert.equal(typeof browser.GoldilocksDrinkWaypoint.decorateButton, 'function');
});

test('normalizes only supported visual states', () => {
  assert.equal(waypoint.normalizeState('ready'), 'ready');
  assert.equal(waypoint.normalizeState('logged'), 'logged');
  assert.equal(waypoint.normalizeState('reward'), 'inactive');
  assert.equal(waypoint.normalizeState(null), 'inactive');
});
