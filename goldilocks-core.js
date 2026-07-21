(function (root, factory) {
  'use strict';

  const core = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = core;
  } else {
    root.GoldilocksCore = core;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STD_DRINK_G = 0.6 * 29.5735 * 0.789;
  const CRUISE_ENDPOINT_TOLERANCE = 0.002;
  const CALIBRATION_MIN_R2 = 0.80;
  const BAC_COMPARISON_EPSILON = 1e-12;

  function requireFinite(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${name} must be a finite number`);
    }
    return value;
  }

  function requirePositive(value, name) {
    requireFinite(value, name);
    if (value <= 0) throw new RangeError(`${name} must be greater than zero`);
    return value;
  }

  function requireNonNegative(value, name) {
    requireFinite(value, name);
    if (value < 0) throw new RangeError(`${name} must be zero or greater`);
    return value;
  }

  function requirePositiveInteger(value, name) {
    requirePositive(value, name);
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
    return value;
  }

  function requireProfile(profile) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      throw new TypeError('profile must be an object');
    }
    if (typeof profile.useWidmark !== 'boolean') {
      throw new TypeError('profile.useWidmark must be a boolean');
    }
    return profile;
  }

  function requireMetabolism(profile) {
    requireProfile(profile);
    return requirePositive(profile.metab, 'profile.metab');
  }

  function requireSchedule(schedule, name) {
    if (!Array.isArray(schedule)) throw new TypeError(`${name} must be an array`);
    for (let i = 0; i < schedule.length; i += 1) {
      requireNonNegative(schedule[i], `${name}[${i}]`);
    }
    return schedule;
  }

  function requireFiniteResult(value, name) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`${name} is outside the supported numeric range`);
    }
    return value;
  }

  function roundBac(bac) {
    requireFiniteResult(bac, 'BAC before rounding');
    // Above this magnitude a binary64 value cannot represent thousandths, and
    // multiplying by 1000 can overflow an otherwise finite result.
    if (Math.abs(bac) >= 1e21) return bac;
    return requireFiniteResult(Math.round(bac * 1000) / 1000, 'rounded BAC');
  }

  function widmarkRisePerStd(weightKg, r) {
    requirePositive(weightKg, 'weightKg');
    requirePositive(r, 'r');
    const result = (STD_DRINK_G / (weightKg * 1000 * r)) * 100;
    requirePositive(result, 'Widmark rise per standard drink');
    return result;
  }

  function bacPerDrink(alcoholGrams, profile) {
    requirePositive(alcoholGrams, 'alcoholGrams');
    requireProfile(profile);

    let result;
    if (profile.useWidmark) {
      requirePositive(profile.weightKg, 'profile.weightKg');
      requirePositive(profile.r, 'profile.r');
      result = (alcoholGrams / (profile.weightKg * 1000 * profile.r)) * 100;
    } else {
      requirePositive(profile.risePerStd, 'profile.risePerStd');
      result = (alcoholGrams / STD_DRINK_G) * profile.risePerStd;
    }

    requirePositive(result, 'BAC rise per drink');
    return result;
  }

  function simulate(schedule, alcoholGrams, profile, startBac = 0) {
    requireSchedule(schedule, 'schedule');
    const rise = bacPerDrink(alcoholGrams, profile);
    const metabolism = requireMetabolism(profile);
    let bac = requireNonNegative(startBac, 'startBac');

    return schedule.map((drinks, hour) => {
      bac = Math.max(0, bac + drinks * rise - metabolism);
      requireFiniteResult(bac, `BAC at hour ${hour + 1}`);
      return roundBac(bac);
    });
  }

  function estimateLiveBac(
    completedSchedule,
    currentDrinks,
    fraction,
    alcoholGrams,
    profile
  ) {
    requireSchedule(completedSchedule, 'completedSchedule');
    requireNonNegative(currentDrinks, 'currentDrinks');
    requireNonNegative(fraction, 'fraction');
    if (fraction > 1) throw new RangeError('fraction must not be greater than one');

    const rise = bacPerDrink(alcoholGrams, profile);
    const metabolism = requireMetabolism(profile);
    let bac = 0;

    for (let hour = 0; hour < completedSchedule.length; hour += 1) {
      bac = Math.max(0, bac + completedSchedule[hour] * rise - metabolism);
      requireFiniteResult(bac, `BAC at completed hour ${hour + 1}`);
    }

    bac = Math.max(0, bac + currentDrinks * rise - metabolism * fraction);
    requireFiniteResult(bac, 'live BAC');
    return roundBac(bac);
  }

  function buildZoneSchedule(
    alcoholGrams,
    profile,
    low,
    high,
    hours,
    startBac = 0
  ) {
    requireNonNegative(low, 'low');
    requireNonNegative(high, 'high');
    if (low > high) throw new RangeError('low must be less than or equal to high');
    requirePositiveInteger(hours, 'hours');
    requireNonNegative(startBac, 'startBac');

    const rise = bacPerDrink(alcoholGrams, profile);
    const metabolism = requireMetabolism(profile);
    const schedule = [];
    let bac = startBac;

    for (let hour = 0; hour < hours; hour += 1) {
      const bacAfterMetabolism = Math.max(0, bac - metabolism);
      const maximumDrinks = Math.max(
        0,
        Math.floor((high - bac + metabolism) / rise)
      );
      let drinks = 0;

      if (bacAfterMetabolism < low) {
        const needed = Math.ceil((low - bac + metabolism) / rise);
        drinks = Math.max(0, Math.min(maximumDrinks, needed));
      } else {
        const nextHourBac = Math.max(0, bacAfterMetabolism - metabolism);
        if (nextHourBac < low && hour < hours - 1) {
          const needed = Math.ceil((low - bacAfterMetabolism + metabolism) / rise);
          drinks = Math.max(0, Math.min(maximumDrinks, needed));
        }
      }

      schedule.push(drinks);
      bac = Math.max(0, bac + drinks * rise - metabolism);
      requireFiniteResult(bac, `BAC at hour ${hour + 1}`);
    }

    return schedule;
  }

  function ceilNearInteger(value) {
    const nearest = Math.round(value);
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 8;
    return Math.abs(value - nearest) <= tolerance ? nearest : Math.ceil(value);
  }

  // `phase` is the fraction of one drink-spacing interval before the first
  // drink. Moving it through [0, 1) enumerates every hourly bin pattern that
  // can result from evenly spaced timestamps.
  function buildEvenlySpacedPlan(drinkCount, hours, phase) {
    const plan = new Array(hours).fill(0);
    let previousCount = 0;

    for (let boundary = 1; boundary <= hours; boundary += 1) {
      const beforeBoundary = Math.max(
        0,
        Math.min(
          drinkCount,
          ceilNearInteger(boundary * drinkCount / hours - phase)
        )
      );
      plan[boundary - 1] = beforeBoundary - previousCount;
      previousCount = beforeBoundary;
    }

    return plan;
  }

  function endingBac(plan, rise, metabolism) {
    let bac = 0;
    for (let hour = 0; hour < plan.length; hour += 1) {
      bac = Math.max(0, bac + plan[hour] * rise - metabolism);
      requireFiniteResult(bac, `BAC at hour ${hour + 1}`);
    }
    return roundBac(bac);
  }

  function isBetterCruiseCandidate(candidate, best, targetBac) {
    const epsilon = 1e-12;
    if (candidate.error < best.error - epsilon) return true;
    if (Math.abs(candidate.error - best.error) > epsilon) return false;

    const candidateDoesNotOvershoot = candidate.endpoint <= targetBac;
    const bestDoesNotOvershoot = best.endpoint <= targetBac;
    if (candidateDoesNotOvershoot !== bestDoesNotOvershoot) {
      return candidateDoesNotOvershoot;
    }
    if (candidate.n !== best.n) return candidate.n < best.n;
    return candidate.offsetHours < best.offsetHours;
  }

  function buildCruisePlan(alcoholGrams, profile, hours, targetBac) {
    requirePositiveInteger(hours, 'hours');
    requireNonNegative(targetBac, 'targetBac');
    const rise = bacPerDrink(alcoholGrams, profile);
    const metabolism = requireMetabolism(profile);

    if (targetBac === 0) {
      return {
        n: 0,
        plan: new Array(hours).fill(0),
        spacing: 0,
        offsetHours: 0,
        endpoint: 0,
        achievable: true,
      };
    }

    // Flooring BAC at zero can make the continuous drink-count formula wrong.
    // Search every count that could still round to an allowed endpoint, and
    // every distinct hourly phase cell for evenly spaced drink timestamps.
    const roundingAllowance = 0.0005;
    const rawMaximumCount = (
      targetBac
      + CRUISE_ENDPOINT_TOLERANCE
      + roundingAllowance
      + hours * metabolism
    ) / rise;
    requireFiniteResult(rawMaximumCount, 'maximum cruise drink count');
    const maximumCount = Math.ceil(rawMaximumCount);
    if (!Number.isSafeInteger(maximumCount)) {
      throw new RangeError('maximum cruise drink count must be a safe integer');
    }

    let best = {
      n: 0,
      plan: new Array(hours).fill(0),
      spacing: 0,
      offsetHours: 0,
      endpoint: 0,
      error: targetBac,
    };
    const maximumEndpoint = targetBac + CRUISE_ENDPOINT_TOLERANCE;
    const comparisonEpsilon = BAC_COMPARISON_EPSILON;

    for (let drinkCount = 1; drinkCount <= maximumCount; drinkCount += 1) {
      const timingSpacing = hours / drinkCount;
      const phases = [0];
      for (let phaseCell = 0; phaseCell < hours; phaseCell += 1) {
        phases.push((phaseCell + 0.5) / hours);
      }

      for (const phase of phases) {
        const plan = buildEvenlySpacedPlan(drinkCount, hours, phase);
        const endpoint = endingBac(plan, rise, metabolism);
        if (endpoint > maximumEndpoint + comparisonEpsilon) continue;

        const candidate = {
          n: drinkCount,
          plan,
          spacing: drinkCount > 1 ? timingSpacing : 0,
          // The first timestamp is start + offsetHours; each later timestamp
          // adds `spacing` hours. A machine-epsilon nudge keeps timestamps
          // that are mathematically on a boundary from rounding backward.
          offsetHours: phase * timingSpacing
            + Number.EPSILON * Math.max(1, hours) * 8,
          endpoint,
          error: Math.abs(endpoint - targetBac),
        };
        if (isBetterCruiseCandidate(candidate, best, targetBac)) best = candidate;
      }
    }

    return {
      n: best.n,
      plan: best.plan,
      spacing: best.spacing,
      offsetHours: best.offsetHours,
      endpoint: best.endpoint,
      achievable: best.error <= CRUISE_ENDPOINT_TOLERANCE + comparisonEpsilon,
    };
  }

  function buildCruiseReplan(
    alcoholGrams,
    profile,
    hours,
    targetBac,
    elapsedHours,
    actualDrinkOffsets,
    maximumDrinksPerHour = 6
  ) {
    requirePositiveInteger(hours, 'hours');
    requireNonNegative(targetBac, 'targetBac');
    requireNonNegative(elapsedHours, 'elapsedHours');
    if (elapsedHours > hours) {
      throw new RangeError('elapsedHours must not exceed hours');
    }
    requireSchedule(actualDrinkOffsets, 'actualDrinkOffsets');
    requirePositiveInteger(maximumDrinksPerHour, 'maximumDrinksPerHour');

    const rise = bacPerDrink(alcoholGrams, profile);
    const metabolism = requireMetabolism(profile);
    const timingEpsilon = 1e-9;
    const basePlan = new Array(hours).fill(0);

    for (let index = 0; index < actualDrinkOffsets.length; index += 1) {
      const offset = actualDrinkOffsets[index];
      if (offset > elapsedHours + timingEpsilon || offset > hours + timingEpsilon) {
        throw new RangeError(`actualDrinkOffsets[${index}] must not be in the future`);
      }
      const hour = Math.max(0, Math.min(hours - 1, Math.floor(offset)));
      basePlan[hour] += 1;
    }

    const baseEndpoint = endingBac(basePlan, rise, metabolism);
    let best = {
      n: 0,
      plan: basePlan,
      spacing: 0,
      offsetHours: 0,
      endpoint: baseEndpoint,
      error: Math.abs(baseEndpoint - targetBac),
      futureOffsets: [],
    };

    const remainingHours = hours - elapsedHours;
    if (remainingHours <= timingEpsilon) {
      return {
        n: 0,
        plan: best.plan,
        spacing: 0,
        offsetHours: 0,
        endpoint: best.endpoint,
        achievable: best.error <= CRUISE_ENDPOINT_TOLERANCE,
        futureOffsets: [],
      };
    }

    const currentHour = Math.min(hours - 1, Math.floor(elapsedHours));
    let maximumFutureCount = 0;
    for (let hour = currentHour; hour < hours; hour += 1) {
      maximumFutureCount += Math.max(0, maximumDrinksPerHour - basePlan[hour]);
    }
    const maximumTotalCount = hours * maximumDrinksPerHour;
    if (!Number.isSafeInteger(maximumFutureCount) || !Number.isSafeInteger(maximumTotalCount)) {
      throw new RangeError('maximum future drink count must be a safe integer');
    }
    maximumFutureCount = Math.min(
      maximumFutureCount,
      Math.max(0, maximumTotalCount - actualDrinkOffsets.length)
    );

    const maximumEndpoint = targetBac + CRUISE_ENDPOINT_TOLERANCE;
    const comparisonEpsilon = BAC_COMPARISON_EPSILON;

    for (let drinkCount = 1; drinkCount <= maximumFutureCount; drinkCount += 1) {
      const timingSpacing = remainingHours / drinkCount;
      const phaseBoundaries = [0, 1];

      // A phase only changes the discrete plan when a future timestamp crosses
      // an hourly boundary. Test one midpoint from every distinct phase cell.
      for (let drink = 0; drink < drinkCount; drink += 1) {
        for (let boundary = Math.floor(elapsedHours) + 1; boundary < hours; boundary += 1) {
          const phase = (boundary - elapsedHours) / timingSpacing - drink;
          if (phase > timingEpsilon && phase < 1 - timingEpsilon) {
            phaseBoundaries.push(phase);
          }
        }
      }
      phaseBoundaries.sort((left, right) => left - right);
      const uniqueBoundaries = phaseBoundaries.filter(
        (phase, index) => index === 0 || phase - phaseBoundaries[index - 1] > timingEpsilon
      );

      for (let cell = 0; cell < uniqueBoundaries.length - 1; cell += 1) {
        const phase = (uniqueBoundaries[cell] + uniqueBoundaries[cell + 1]) / 2;
        const futureOffsets = Array.from(
          { length: drinkCount },
          (_, index) => elapsedHours + (phase + index) * timingSpacing
        );
        const candidatePlan = basePlan.slice();
        let respectsHourlyLimit = true;
        for (const offset of futureOffsets) {
          const hour = Math.max(0, Math.min(hours - 1, Math.floor(offset)));
          if (candidatePlan[hour] >= maximumDrinksPerHour) {
            respectsHourlyLimit = false;
            break;
          }
          candidatePlan[hour] += 1;
        }
        if (!respectsHourlyLimit) continue;

        const endpoint = endingBac(candidatePlan, rise, metabolism);
        if (endpoint > maximumEndpoint + comparisonEpsilon) continue;
        const candidate = {
          n: drinkCount,
          plan: candidatePlan,
          spacing: drinkCount > 1 ? timingSpacing : 0,
          offsetHours: futureOffsets[0],
          endpoint,
          error: Math.abs(endpoint - targetBac),
          futureOffsets,
        };
        if (isBetterCruiseCandidate(candidate, best, targetBac)) best = candidate;
      }
    }

    return {
      n: best.n,
      plan: best.plan,
      spacing: best.spacing,
      offsetHours: best.offsetHours,
      endpoint: best.endpoint,
      achievable: best.error <= CRUISE_ENDPOINT_TOLERANCE + comparisonEpsilon,
      futureOffsets: best.futureOffsets,
    };
  }

  function requirePoints(points, minimumLength, name) {
    if (!Array.isArray(points)) throw new TypeError(`${name} must be an array`);
    if (points.length < minimumLength) {
      throw new RangeError(`${name} must contain at least ${minimumLength} points`);
    }

    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      if (!point || typeof point !== 'object' || Array.isArray(point)) {
        throw new TypeError(`${name}[${i}] must be an object`);
      }
      requireFinite(point.x, `${name}[${i}].x`);
      requireFinite(point.y, `${name}[${i}].y`);
    }
    return points;
  }

  function fitLine(points) {
    requirePoints(points, 2, 'points');
    const count = points.length;
    const sumX = points.reduce((sum, point) => sum + point.x, 0);
    const sumY = points.reduce((sum, point) => sum + point.y, 0);
    const meanX = sumX / count;
    const meanY = sumY / count;
    const xVariance = points.reduce(
      (sum, point) => sum + Math.pow(point.x - meanX, 2),
      0
    );
    const covariance = points.reduce(
      (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
      0
    );

    if (!Number.isFinite(xVariance) || xVariance === 0) {
      throw new RangeError('point x values must have nonzero variance');
    }

    const slope = covariance / xVariance;
    const intercept = meanY - slope * meanX;
    requireFiniteResult(slope, 'line slope');
    requireFiniteResult(intercept, 'line intercept');

    const totalSquares = points.reduce(
      (sum, point) => sum + Math.pow(point.y - meanY, 2),
      0
    );
    const residualSquares = points.reduce(
      (sum, point) => sum + Math.pow(point.y - (slope * point.x + intercept), 2),
      0
    );
    const r2 = totalSquares > 0 ? 1 - residualSquares / totalSquares : 1;
    requireFiniteResult(r2, 'line r2');

    return { slope, intercept, r2 };
  }

  function calculateCalibration(readings, alcoholGrams) {
    if (!Array.isArray(readings)) throw new TypeError('readings must be an array');
    if (readings.length < 3) {
      throw new RangeError('readings must contain at least 3 readings');
    }
    requirePositive(alcoholGrams, 'alcoholGrams');

    const points = readings.map((reading, index) => {
      if (!reading || typeof reading !== 'object' || Array.isArray(reading)) {
        throw new TypeError(`readings[${index}] must be an object`);
      }
      const tMin = requireNonNegative(reading.tMin, `readings[${index}].tMin`);
      const bac = requireNonNegative(reading.bac, `readings[${index}].bac`);
      return { x: tMin, y: bac };
    });
    for (let index = 1; index < points.length; index += 1) {
      if (points[index].x <= points[index - 1].x) {
        throw new RangeError('reading times must be strictly increasing and distinct');
      }
    }

    const { slope, intercept, r2 } = fitLine(points);
    if (slope >= 0) {
      throw new RangeError('readings must have a negative elimination slope');
    }
    if (r2 < CALIBRATION_MIN_R2) {
      throw new RangeError(`calibration R-squared must be at least ${CALIBRATION_MIN_R2}`);
    }

    const metabolismPerHour = -slope * 60;
    const bacAt45 = slope * 45 + intercept;
    const standardDrinks = alcoholGrams / STD_DRINK_G;
    const risePerStd = bacAt45 / standardDrinks;
    requirePositive(metabolismPerHour, 'calculated metabolism per hour');
    requirePositive(bacAt45, 'calculated BAC at 45 minutes');
    requirePositive(risePerStd, 'calculated rise per standard drink');

    return {
      metabPerHr: metabolismPerHour,
      risePerStd,
      bacAt45,
      r2,
      slope,
      intercept,
      stdDrinks: standardDrinks,
    };
  }

  return Object.freeze({
    STD_DRINK_G,
    CRUISE_ENDPOINT_TOLERANCE,
    CALIBRATION_MIN_R2,
    widmarkRisePerStd,
    bacPerDrink,
    simulate,
    estimateLiveBac,
    buildZoneSchedule,
    buildCruisePlan,
    buildCruiseReplan,
    fitLine,
    calculateCalibration,
  });
}));
