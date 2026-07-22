'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../goldilocks-core.js');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function closeTo(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

const calibratedProfile = Object.freeze({
  weightKg: 80,
  r: 0.68,
  risePerStd: 0.02,
  metab: 0.015,
  useWidmark: false,
});

const widmarkProfile = Object.freeze({
  weightKg: 80,
  r: 0.68,
  risePerStd: 0.5,
  metab: 0.015,
  useWidmark: true,
});

function planFromTiming(result, hours) {
  const bucketCount = Math.ceil(hours);
  const plan = new Array(bucketCount).fill(0);
  for (let drink = 0; drink < result.n; drink += 1) {
    const offset = result.offsetHours + drink * result.spacing;
    const hour = Math.max(0, Math.min(bucketCount - 1, Math.floor(offset)));
    plan[hour] += 1;
  }
  return plan;
}

function assertCruiseInvariant(result, alcoholGrams, profile, hours, target) {
  const trace = core.simulateDuration(result.plan, alcoholGrams, profile, hours);
  const endpoint = trace.at(-1) || 0;
  assert.equal(result.endpoint, endpoint);
  assert.ok(
    endpoint <= target + core.CRUISE_ENDPOINT_TOLERANCE + 1e-12,
    `endpoint ${endpoint} exceeds target ${target}`
  );
  assert.equal(
    result.achievable,
    Math.abs(endpoint - target) <= core.CRUISE_ENDPOINT_TOLERANCE + 1e-12
  );
  assert.deepEqual(planFromTiming(result, hours), result.plan);
}

test('publishes the same API as a browser global', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'goldilocks-core.js'),
    'utf8'
  );
  const browser = {};
  vm.createContext(browser);
  vm.runInContext(source, browser);
  assert.equal(typeof browser.GoldilocksCore, 'object');
  assert.equal(typeof browser.GoldilocksCore.buildZoneSchedule, 'function');
  assert.equal(typeof browser.GoldilocksCore.simulateDuration, 'function');
  assert.equal(typeof browser.GoldilocksCore.buildCruiseCapacityPlan, 'function');
  closeTo(browser.GoldilocksCore.STD_DRINK_G, core.STD_DRINK_G);
});

test('exports the US standard-drink alcohol mass', () => {
  closeTo(core.STD_DRINK_G, 0.6 * 29.5735 * 0.789);
  closeTo(core.STD_DRINK_G, 14, 0.001);
  assert.equal(core.CALIBRATION_MIN_R2, 0.8);
});

test('computes Widmark rise per standard drink', () => {
  const expected = (core.STD_DRINK_G / (80 * 1000 * 0.68)) * 100;
  closeTo(core.widmarkRisePerStd(80, 0.68), expected);
});

test('uses calibrated rise when useWidmark is false', () => {
  closeTo(core.bacPerDrink(core.STD_DRINK_G * 1.5, calibratedProfile), 0.03);
});

test('uses weight and r when useWidmark is true, even if calibrated rise exists', () => {
  const expected = (core.STD_DRINK_G / (80 * 1000 * 0.68)) * 100;
  closeTo(core.bacPerDrink(core.STD_DRINK_G, widmarkProfile), expected);
  assert.notEqual(core.bacPerDrink(core.STD_DRINK_G, widmarkProfile), 0.5);
});

test('simulates hourly drinking, metabolism, floor at zero, and an initial BAC', () => {
  assert.deepEqual(
    core.simulate([1, 0, 2], core.STD_DRINK_G, calibratedProfile),
    [0.005, 0, 0.025]
  );
  assert.deepEqual(
    core.simulate([1], core.STD_DRINK_G, calibratedProfile, 0.01),
    [0.015]
  );
});

test('simulates proportional metabolism in a partial final Cruise hour', () => {
  assert.deepEqual(
    core.simulateDuration(
      [1, 1],
      core.STD_DRINK_G,
      calibratedProfile,
      1.25
    ),
    [0.005, 0.021]
  );
  assert.throws(
    () => core.simulateDuration([1], core.STD_DRINK_G, calibratedProfile, 1.25),
    /schedule must contain 2 hourly buckets/
  );
});

test('keeps very large finite BAC calculations finite', () => {
  const result = core.simulate([1], core.STD_DRINK_G, {
    risePerStd: 1e307,
    metab: 1,
    useWidmark: false,
  });
  assert.equal(Number.isFinite(result[0]), true);
  assert.equal(result[0], 1e307);
});

test('estimates live BAC after completed and partial hours', () => {
  assert.equal(
    core.estimateLiveBac(
      [1, 2],
      1,
      0.5,
      core.STD_DRINK_G,
      calibratedProfile
    ),
    0.043
  );
});

test('builds the established hourly zone schedule', () => {
  const schedule = core.buildZoneSchedule(
    core.STD_DRINK_G,
    calibratedProfile,
    0.04,
    0.08,
    4
  );
  assert.deepEqual(schedule, [3, 1, 1, 0]);
  assert.deepEqual(
    core.simulate(schedule, core.STD_DRINK_G, calibratedProfile),
    [0.045, 0.05, 0.055, 0.04]
  );
});

test('builds Zone schedules with proportional metabolism in a partial final hour', () => {
  const quarterHourSchedule = core.buildZoneSchedule(
    core.STD_DRINK_G,
    calibratedProfile,
    0.04,
    0.08,
    1.25
  );
  assert.deepEqual(quarterHourSchedule, [3, 0]);
  assert.deepEqual(
    core.simulateDuration(
      quarterHourSchedule,
      core.STD_DRINK_G,
      calibratedProfile,
      1.25
    ),
    [0.045, 0.041]
  );

  const halfHourSchedule = core.buildZoneSchedule(
    core.STD_DRINK_G,
    calibratedProfile,
    0.04,
    0.08,
    1.5
  );
  assert.deepEqual(halfHourSchedule, [3, 1]);
  assert.deepEqual(
    core.simulateDuration(
      halfHourSchedule,
      core.STD_DRINK_G,
      calibratedProfile,
      1.5
    ),
    [0.045, 0.058]
  );
});

test('rejects an invalid Zone duration', () => {
  assert.throws(
    () => core.buildZoneSchedule(
      core.STD_DRINK_G,
      calibratedProfile,
      0.04,
      0.08,
      0
    ),
    RangeError
  );
});

test('uses the remaining window when rebuilding a zone schedule mid-session', () => {
  const schedule = core.buildZoneSchedule(
    core.STD_DRINK_G,
    calibratedProfile,
    0.04,
    0.08,
    2,
    0.055
  );
  assert.deepEqual(schedule, [1, 0]);
  assert.deepEqual(
    core.simulate(schedule, core.STD_DRINK_G, calibratedProfile, 0.055),
    [0.06, 0.045]
  );
});

test('rejects a reversed target zone', () => {
  assert.throws(
    () => core.buildZoneSchedule(
      core.STD_DRINK_G,
      calibratedProfile,
      0.08,
      0.04,
      4
    ),
    /low must be less than or equal to high/
  );
});

test('returns an all-zero cruise plan for a zero target', () => {
  assert.deepEqual(
    core.buildCruisePlan(core.STD_DRINK_G, calibratedProfile, 4, 0),
    {
      n: 0,
      plan: [0, 0, 0, 0],
      spacing: 0,
      offsetHours: 0,
      endpoint: 0,
      achievable: true,
    }
  );
});

test('returns the correct buckets for a zero-target fractional Cruise', () => {
  assert.deepEqual(
    core.buildCruisePlan(core.STD_DRINK_G, calibratedProfile, 1.25, 0),
    {
      n: 0,
      plan: [0, 0],
      spacing: 0,
      offsetHours: 0,
      endpoint: 0,
      achievable: true,
    }
  );
});

test('scales Cruise capacity for a partial final hour', () => {
  assert.deepEqual(core.buildCruiseCapacityPlan(1.25, 6), [6, 1]);
  assert.deepEqual(core.buildCruiseCapacityPlan(1.5, 6), [6, 3]);
  assert.deepEqual(core.buildCruiseCapacityPlan(1.75, 6), [6, 4]);
});

test('chooses an evenly timed cruise plan matching the target endpoint', () => {
  const cruise = core.buildCruisePlan(
    core.STD_DRINK_G,
    calibratedProfile,
    4,
    0.04
  );
  assert.equal(cruise.n, 5);
  assert.deepEqual(cruise.plan, [2, 1, 1, 1]);
  closeTo(cruise.spacing, 0.8);
  closeTo(cruise.offsetHours, 0);
  assert.equal(cruise.endpoint, 0.04);
  assert.equal(cruise.achievable, true);
  assertCruiseInvariant(cruise, core.STD_DRINK_G, calibratedProfile, 4, 0.04);
});

test('rejects overshooting counts and reports an unachievable endpoint', () => {
  const profile = {
    risePerStd: 0.03,
    metab: 0.01,
    useWidmark: false,
  };
  const cruise = core.buildCruisePlan(core.STD_DRINK_G, profile, 2, 0.055);
  assert.equal(cruise.n, 2);
  assert.deepEqual(cruise.plan, [1, 1]);
  assert.equal(cruise.endpoint, 0.04);
  assert.equal(cruise.achievable, false);
  assertCruiseInvariant(cruise, core.STD_DRINK_G, profile, 2, 0.055);
});

test('does not let floating-point scale enlarge Cruise endpoint tolerance', () => {
  const target = 1e14;
  const cruise = core.buildCruisePlan(core.STD_DRINK_G, {
    risePerStd: target + 0.9,
    metab: 1,
    useWidmark: false,
  }, 1, target);
  assert.ok(Math.abs(cruise.endpoint - target) > core.CRUISE_ENDPOINT_TOLERANCE);
  assert.equal(cruise.achievable, false);
});

test('accounts for BAC flooring when selecting a sparse low-target phase', () => {
  const cruise = core.buildCruisePlan(
    core.STD_DRINK_G,
    calibratedProfile,
    4,
    0.01
  );
  assert.equal(cruise.n, 3);
  assert.deepEqual(cruise.plan, [1, 0, 1, 1]);
  closeTo(cruise.spacing, 4 / 3);
  closeTo(cruise.offsetHours, 5 / 6);
  assert.equal(cruise.endpoint, 0.01);
  assert.equal(cruise.achievable, true);
  assertCruiseInvariant(cruise, core.STD_DRINK_G, calibratedProfile, 4, 0.01);
});

test('does not impose an arbitrary maximum cruise drink count', () => {
  const profile = {
    risePerStd: 0.001,
    metab: 0.001,
    useWidmark: false,
  };
  const cruise = core.buildCruisePlan(core.STD_DRINK_G, profile, 10, 0.1);
  assert.equal(cruise.n, 110);
  assert.equal(cruise.plan.reduce((sum, drinks) => sum + drinks, 0), 110);
  assertCruiseInvariant(cruise, core.STD_DRINK_G, profile, 10, 0.1);
});

test('keeps evenly spaced timestamps on the intended side of hour boundaries', () => {
  const profile = {
    risePerStd: 0.001,
    metab: 0.001,
    useWidmark: false,
  };
  const cruise = core.buildCruisePlan(core.STD_DRINK_G, profile, 2, 0.096);
  assert.equal(cruise.n, 98);
  assert.deepEqual(cruise.plan, [49, 49]);
  assert.deepEqual(planFromTiming(cruise, 2), cruise.plan);
});

test('Cruise endpoint and achievable fields match simulation across scenarios', () => {
  const scenarios = [
    { profile: calibratedProfile, hours: 3, target: 0.025 },
    { profile: calibratedProfile, hours: 6, target: 0.07 },
    { profile: widmarkProfile, hours: 4, target: 0.03 },
  ];
  for (const scenario of scenarios) {
    const result = core.buildCruisePlan(
      core.STD_DRINK_G,
      scenario.profile,
      scenario.hours,
      scenario.target
    );
    assertCruiseInvariant(
      result,
      core.STD_DRINK_G,
      scenario.profile,
      scenario.hours,
      scenario.target
    );
  }
});

test('builds valid Cruise plans at quarter-hour durations', () => {
  for (const duration of [1.25, 1.5, 4.25, 7.75]) {
    const result = core.buildCruiseReplan(
      core.STD_DRINK_G,
      calibratedProfile,
      duration,
      0.04,
      0,
      [],
      6
    );
    assert.equal(result.plan.length, Math.ceil(duration));
    assert.ok(result.futureOffsets.every(offset => offset > 0 && offset < duration));
    assert.deepEqual(planFromTiming(result, duration), result.plan);
    assertCruiseInvariant(
      result,
      core.STD_DRINK_G,
      calibratedProfile,
      duration,
      0.04
    );
  }
});

test('replans Cruise from actual logged drinks instead of the original count', () => {
  const result = core.buildCruiseReplan(
    core.STD_DRINK_G,
    calibratedProfile,
    4,
    0.04,
    1.25,
    [0.1, 1.2],
    6
  );
  const reconstructed = [0.1, 1.2, ...result.futureOffsets]
    .reduce((plan, offset) => {
      plan[Math.max(0, Math.min(3, Math.floor(offset)))] += 1;
      return plan;
    }, [0, 0, 0, 0]);

  assert.deepEqual(result.plan, reconstructed);
  assert.ok(result.futureOffsets.every(offset => offset > 1.25 && offset < 4));
  assert.ok(result.plan.every(drinks => drinks <= 6));
  assert.equal(
    result.endpoint,
    core.simulate(result.plan, core.STD_DRINK_G, calibratedProfile).at(-1)
  );
  assert.equal(
    result.achievable,
    Math.abs(result.endpoint - 0.04) <= core.CRUISE_ENDPOINT_TOLERANCE
  );
});

test('Cruise replan preserves a full cadence after a just-logged drink', () => {
  const durationHours = 4.5;
  const targetBac = 0.06;
  const initial = core.buildCruisePlan(
    core.STD_DRINK_G,
    calibratedProfile,
    durationHours,
    targetBac
  );
  assert.equal(initial.n, 6);
  closeTo(initial.spacing, 0.75);

  const loggedAt = 2 / 3600;
  const nextDrinkNotBefore = loggedAt + initial.spacing;
  const replanned = core.buildCruiseReplan(
    core.STD_DRINK_G,
    calibratedProfile,
    durationHours,
    targetBac,
    loggedAt,
    [loggedAt],
    6,
    nextDrinkNotBefore,
    initial.spacing
  );

  assert.equal(replanned.n, 5);
  closeTo(replanned.futureOffsets[0], nextDrinkNotBefore, 1e-9);
  for (let index = 1; index < replanned.futureOffsets.length; index += 1) {
    assert.ok(replanned.futureOffsets[index] > replanned.futureOffsets[index - 1]);
    closeTo(
      replanned.futureOffsets[index] - replanned.futureOffsets[index - 1],
      initial.spacing,
      1e-9
    );
  }
});

test('Cruise replan drops drinks instead of compressing the established cadence', () => {
  const cadenceHours = 0.75;
  const replanned = core.buildCruiseReplan(
    core.STD_DRINK_G,
    calibratedProfile,
    1,
    0.06,
    0,
    [0],
    6,
    cadenceHours,
    cadenceHours
  );

  assert.equal(replanned.n, 1);
  closeTo(replanned.futureOffsets[0], cadenceHours, 1e-9);
});

test('Cruise replan recommends no future drinks after actuals overshoot', () => {
  const result = core.buildCruiseReplan(
    core.STD_DRINK_G,
    calibratedProfile,
    2,
    0.01,
    0.5,
    [0.1, 0.2, 0.3],
    6
  );
  assert.equal(result.n, 0);
  assert.deepEqual(result.futureOffsets, []);
  assert.deepEqual(result.plan, [3, 0]);
  assert.equal(result.endpoint, 0.03);
  assert.equal(result.achievable, false);
});

test('Cruise replan stays inside a fractional session after elapsed time', () => {
  const result = core.buildCruiseReplan(
    core.STD_DRINK_G,
    calibratedProfile,
    1.5,
    0.04,
    1.1,
    [0.1],
    6
  );

  assert.deepEqual(result.plan, [1, 2]);
  assert.ok(result.futureOffsets.every(offset => offset > 1.1 && offset < 1.5));
  assert.equal(result.endpoint, 0.038);
  assert.equal(
    result.endpoint,
    core.simulateDuration(result.plan, core.STD_DRINK_G, calibratedProfile, 1.5).at(-1)
  );
});

test('Cruise replan keeps future recommendations within the persisted session capacity', () => {
  const profile = {
    risePerStd: 0.001,
    metab: 0.001,
    useWidmark: false,
  };
  const actualOffsets = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const result = core.buildCruiseReplan(
    core.STD_DRINK_G,
    profile,
    2,
    0.011,
    1.1,
    actualOffsets,
    6
  );

  assert.equal(result.n, 5);
  assert.equal(actualOffsets.length + result.futureOffsets.length, 12);
  assert.deepEqual(result.plan, [7, 5]);
});

test('cap-aware Cruise planning accepts an in-tolerance six-drink plan', () => {
  const profile = {
    risePerStd: 0.00375,
    metab: 0.015,
    useWidmark: false,
  };
  const result = core.buildCruiseReplan(
    core.STD_DRINK_G,
    profile,
    1,
    0.01,
    0,
    [],
    6
  );
  assert.equal(result.n, 6);
  assert.deepEqual(result.plan, [6]);
  assert.equal(result.endpoint, 0.008);
  assert.equal(result.achievable, true);
});

test('Cruise replan rejects future actual timestamps', () => {
  assert.throws(
    () => core.buildCruiseReplan(
      core.STD_DRINK_G,
      calibratedProfile,
      4,
      0.04,
      1,
      [1.1],
      6
    ),
    /must not be in the future/
  );
});

test('fits a line independent of point order and reports r-squared', () => {
  const result = core.fitLine([
    { x: 2, y: 5 },
    { x: 0, y: 1 },
    { x: 1, y: 3 },
  ]);
  closeTo(result.slope, 2);
  closeTo(result.intercept, 1);
  closeTo(result.r2, 1);
});

test('calculates calibration from three ordered declining readings', () => {
  const result = core.calculateCalibration([
    { tMin: 45, bac: 0.08 },
    { tMin: 65, bac: 0.075 },
    { tMin: 85, bac: 0.07 },
  ], core.STD_DRINK_G * 2);

  closeTo(result.slope, -0.00025);
  closeTo(result.metabPerHr, 0.015);
  closeTo(result.bacAt45, 0.08);
  closeTo(result.risePerStd, 0.04);
  closeTo(result.stdDrinks, 2);
  closeTo(result.r2, 1);
});

test('rejects too few, duplicate, unordered, flat, and rising calibration readings', () => {
  assert.throws(
    () => core.calculateCalibration([
      { tMin: 45, bac: 0.08 },
      { tMin: 65, bac: 0.07 },
    ], core.STD_DRINK_G),
    /at least 3 readings/
  );
  assert.throws(
    () => core.calculateCalibration([
      { tMin: 45, bac: 0.08 },
      { tMin: 45, bac: 0.07 },
      { tMin: 85, bac: 0.06 },
    ], core.STD_DRINK_G),
    /strictly increasing/
  );
  assert.throws(
    () => core.calculateCalibration([
      { tMin: 45, bac: 0.08 },
      { tMin: 85, bac: 0.06 },
      { tMin: 65, bac: 0.07 },
    ], core.STD_DRINK_G),
    /strictly increasing/
  );
  assert.throws(
    () => core.calculateCalibration([
      { tMin: 45, bac: 0.08 },
      { tMin: 65, bac: 0.08 },
      { tMin: 85, bac: 0.08 },
    ], core.STD_DRINK_G),
    /negative elimination slope/
  );
  assert.throws(
    () => core.calculateCalibration([
      { tMin: 45, bac: 0.06 },
      { tMin: 65, bac: 0.07 },
      { tMin: 85, bac: 0.08 },
    ], core.STD_DRINK_G),
    /negative elimination slope/
  );
});

test('rejects a declining calibration with R-squared below 0.80', () => {
  assert.throws(
    () => core.calculateCalibration([
      { tMin: 45, bac: 0.10 },
      { tMin: 65, bac: 0.02 },
      { tMin: 85, bac: 0.09 },
      { tMin: 105, bac: 0.01 },
    ], core.STD_DRINK_G * 2),
    /R-squared must be at least 0.8/
  );
});

test('rejects non-finite and non-positive model inputs', () => {
  assert.throws(() => core.widmarkRisePerStd(0, 0.68), /greater than zero/);
  assert.throws(
    () => core.bacPerDrink(Number.NaN, calibratedProfile),
    /finite number/
  );
  assert.throws(
    () => core.simulate([-1], core.STD_DRINK_G, calibratedProfile),
    /zero or greater/
  );
  assert.throws(
    () => core.estimateLiveBac([], 0, 1.1, core.STD_DRINK_G, calibratedProfile),
    /not be greater than one/
  );
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    failures += 1;
    process.stderr.write(`not ok - ${name}\n`);
    process.stderr.write(`${error.stack || error}\n`);
  }
}

process.stdout.write(`\n${tests.length - failures}/${tests.length} tests passed\n`);
if (failures > 0) process.exitCode = 1;
