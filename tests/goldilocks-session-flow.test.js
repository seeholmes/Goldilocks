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

test('keeps future Pace slots anchored after early logs and shifts only when needed', () => {
  const startAt = 1_000_000;
  const cadenceMs = 45 * 60_000;
  const endAt = startAt + 270 * 60_000;
  const schedule = Array.from({ length: 6 }, (_, index) => startAt + index * cadenceMs);

  const afterTwoEarlyLogs = flow.paceReconcileSchedule(
    schedule,
    [startAt + 1_000, startAt + 2_000, null, null, null, null],
    { cadenceMs, endAt }
  );
  assert.equal(afterTwoEarlyLogs.drinkSchedule[2], startAt + 90 * 60_000);
  assert.equal(afterTwoEarlyLogs.drinkSchedule.length, 6);
  assert.equal(afterTwoEarlyLogs.actualDrinkTimes.filter(value => value === null).length, 4);

  let rapidSchedule = schedule.slice();
  let rapidActuals = new Array(schedule.length).fill(null);
  for (let index = 0; index < schedule.length; index += 1) {
    rapidActuals[index] = startAt + index * 1_000;
    const reconciled = flow.paceReconcileSchedule(rapidSchedule, rapidActuals, { cadenceMs, endAt });
    rapidSchedule = reconciled.drinkSchedule;
    rapidActuals = reconciled.actualDrinkTimes;
    assert.equal(rapidActuals.filter(value => value === null).length, schedule.length - index - 1);
    assert.ok(rapidSchedule.length <= schedule.length);
    if (index + 1 < schedule.length) assert.ok(rapidSchedule[index + 1] >= schedule[index + 1]);
  }

  const afterLateSecondLog = flow.paceReconcileSchedule(
    schedule,
    [startAt, startAt + 100 * 60_000, null, null, null, null],
    { cadenceMs, endAt }
  );
  assert.deepEqual(
    afterLateSecondLog.drinkSchedule.slice(2).map(value => (value - startAt) / 60_000),
    [145, 190, 235]
  );
  assert.equal(afterLateSecondLog.drinkSchedule.length, 5);

  const recalculatedOverdue = flow.paceReconcileSchedule(
    schedule,
    [startAt, null, null, null, null, null],
    { cadenceMs, endAt, fromAt: startAt + 100 * 60_000 }
  );
  assert.deepEqual(
    recalculatedOverdue.drinkSchedule.slice(1).map(value => (value - startAt) / 60_000),
    [100, 145, 190, 235]
  );
  assert.ok(recalculatedOverdue.drinkSchedule.length <= schedule.length);

  const shortenedAfterRapidLogs = flow.paceReconcileSchedule(
    schedule,
    [startAt + 1_000, startAt + 2_000, startAt + 3_000, null, null, null],
    { cadenceMs, endAt: startAt + 60 * 60_000 }
  );
  assert.deepEqual(
    shortenedAfterRapidLogs.drinkSchedule.map(value => (value - startAt) / 60_000),
    [0, 45, 60]
  );
  assert.deepEqual(
    shortenedAfterRapidLogs.actualDrinkTimes,
    [startAt + 1_000, startAt + 2_000, startAt + 3_000]
  );

  const undoActuals = afterLateSecondLog.actualDrinkTimes.slice();
  undoActuals[1] = null;
  while (undoActuals.length < schedule.length) undoActuals.push(null);
  const restoredByUndo = flow.paceReconcileSchedule(
    schedule,
    undoActuals,
    { cadenceMs, endAt }
  );
  assert.deepEqual(restoredByUndo.drinkSchedule, schedule);
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
