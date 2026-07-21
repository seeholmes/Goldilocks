'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.join(__dirname, '..', 'goldilocks-session-flow.js');
const flow = require(modulePath);

test('publishes the session-flow API as a browser global', () => {
  assert.equal(globalThis.GoldilocksSessionFlow, flow);
});

test('keeps unresolved Zone hours distinct from an explicit zero', () => {
  assert.deepEqual(flow.zoneUnresolvedHours([null, 0, undefined, 2], 3), [0, 2]);
  assert.deepEqual(flow.zoneUnresolvedHours([0, 0], 1), []);
  assert.deepEqual(flow.zoneUnresolvedHours([null, null], -1), []);
});

test('finds the next and latest logged Pace entries', () => {
  assert.equal(flow.paceNextIndex([100, 200, null, null]), 2);
  assert.equal(flow.paceNextIndex([100, 200]), -1);
  assert.equal(flow.paceLastLoggedIndex([100, 200, null]), 1);
  assert.equal(flow.paceLastLoggedIndex([null, null]), -1);
});

test('describes upcoming, due, overdue, and missing deadlines', () => {
  const now = 1_000_000;
  assert.deepEqual(flow.describeDeadline(now + 45 * 60_000, now), {
    state: 'upcoming', deltaMinutes: 45, label: 'in 45m',
  });
  assert.equal(flow.describeDeadline(now + 10_000, now).state, 'due');
  assert.deepEqual(flow.describeDeadline(now - 75 * 60_000, now), {
    state: 'overdue', deltaMinutes: -75, label: 'overdue by 1h 15m',
  });
  assert.equal(flow.describeDeadline(null, now).state, 'none');
});

test('validates edited Pace log timestamps against session and neighboring logs', () => {
  const bounds = { startAt: 1_000, endAt: 10_000, now: 8_000 };
  const actuals = [2_000, 4_000, 6_000, null];
  assert.equal(flow.validatePaceTimestamp(actuals, 1, 5_000, bounds).valid, true);
  assert.match(flow.validatePaceTimestamp(actuals, 1, 1_500, bounds).reason, /prior drink/i);
  assert.match(flow.validatePaceTimestamp(actuals, 1, 6_500, bounds).reason, /next drink/i);
  assert.match(flow.validatePaceTimestamp(actuals, 2, 9_000, bounds).reason, /elapsed session/i);
  assert.equal(flow.validatePaceTimestamp(actuals, 0, 1_000, bounds).valid, true);
});

test('calculates rounded elapsed minutes without returning negative time', () => {
  assert.equal(flow.elapsedMinutes(0, 89_999), 1);
  assert.equal(flow.elapsedMinutes(100, 99), 0);
  assert.equal(flow.elapsedMinutes(NaN, 100), 0);
});
