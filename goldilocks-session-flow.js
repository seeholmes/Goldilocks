'use strict';

(function initGoldilocksSessionFlow(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GoldilocksSessionFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildGoldilocksSessionFlow() {
  const MINUTE_MS = 60 * 1000;

  function unresolved(value) {
    return value === null || value === undefined;
  }

  function zoneUnresolvedHours(actualDrinks, throughHour) {
    if (!Array.isArray(actualDrinks) || !Number.isInteger(throughHour) || throughHour < 0) return [];
    const last = Math.min(throughHour, actualDrinks.length - 1);
    const hours = [];
    for (let hour = 0; hour <= last; hour += 1) {
      if (unresolved(actualDrinks[hour])) hours.push(hour);
    }
    return hours;
  }

  function paceNextIndex(actualDrinkTimes) {
    if (!Array.isArray(actualDrinkTimes)) return -1;
    return actualDrinkTimes.findIndex(unresolved);
  }

  function paceLastLoggedIndex(actualDrinkTimes) {
    if (!Array.isArray(actualDrinkTimes)) return -1;
    for (let index = actualDrinkTimes.length - 1; index >= 0; index -= 1) {
      if (!unresolved(actualDrinkTimes[index])) return index;
    }
    return -1;
  }

  function paceReconcileSchedule(drinkSchedule, actualDrinkTimes, options = {}) {
    if (!Array.isArray(drinkSchedule)
        || !Array.isArray(actualDrinkTimes)
        || drinkSchedule.length !== actualDrinkTimes.length) {
      throw new TypeError('Pace schedule and log must be matching arrays.');
    }
    const cadenceMs = Number(options.cadenceMs);
    const endAt = Number(options.endAt);
    const hasFromAt = options.fromAt !== undefined && options.fromAt !== null;
    const fromAt = hasFromAt ? Number(options.fromAt) : null;
    if (!Number.isFinite(cadenceMs) || cadenceMs < 0 || !Number.isFinite(endAt)
        || (hasFromAt && !Number.isFinite(fromAt))) {
      throw new RangeError('Pace reconciliation requires a valid cadence and session end.');
    }

    let previousSchedule = -Infinity;
    let reachedUnlogged = false;
    for (let index = 0; index < drinkSchedule.length; index += 1) {
      const scheduled = drinkSchedule[index];
      const actual = actualDrinkTimes[index];
      if (!Number.isFinite(scheduled) || scheduled < previousSchedule) {
        throw new RangeError('Pace targets must be finite and ordered.');
      }
      if (unresolved(actual)) {
        reachedUnlogged = true;
      } else if (!Number.isFinite(actual) || reachedUnlogged) {
        throw new RangeError('Pace logs must be a finite completed prefix.');
      }
      previousSchedule = scheduled;
    }

    const nextIndex = paceNextIndex(actualDrinkTimes);
    const completedCount = nextIndex < 0 ? drinkSchedule.length : nextIndex;
    // A shortened session can end before an early-completed slot's original
    // target. Keep the historical slot ordered, but inside the persisted
    // session bounds; the UI displays its actual timestamp once completed.
    const reconciledSchedule = drinkSchedule
      .slice(0, completedCount)
      .map(target => Math.min(target, endAt));
    const reconciledActuals = actualDrinkTimes.slice(0, completedCount);
    if (nextIndex < 0) {
      return {
        drinkSchedule: reconciledSchedule,
        actualDrinkTimes: reconciledActuals,
      };
    }

    let earliest = hasFromAt ? fromAt : -Infinity;
    if (nextIndex > 0) {
      earliest = Math.max(earliest, actualDrinkTimes[nextIndex - 1] + cadenceMs);
    }

    for (let index = nextIndex; index < drinkSchedule.length; index += 1) {
      const target = Math.max(drinkSchedule[index], earliest);
      if (target > endAt) break;
      reconciledSchedule.push(target);
      reconciledActuals.push(null);
      earliest = target + cadenceMs;
    }

    return {
      drinkSchedule: reconciledSchedule,
      actualDrinkTimes: reconciledActuals,
    };
  }

  function formatMinutes(minutes) {
    const rounded = Math.max(0, Math.round(Math.abs(minutes)));
    const hours = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    if (!hours) return `${remainder}m`;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  }

  function describeDeadline(targetAt, now = Date.now()) {
    if (!Number.isFinite(targetAt) || !Number.isFinite(now)) {
      return { state: 'none', deltaMinutes: null, label: 'No scheduled check-in' };
    }
    const deltaMinutes = (targetAt - now) / MINUTE_MS;
    if (deltaMinutes > 0.5) {
      return { state: 'upcoming', deltaMinutes, label: `in ${formatMinutes(deltaMinutes)}` };
    }
    if (deltaMinutes >= -0.5) {
      return { state: 'due', deltaMinutes, label: 'due now' };
    }
    return { state: 'overdue', deltaMinutes, label: `overdue by ${formatMinutes(deltaMinutes)}` };
  }

  function validatePaceTimestamp(actualDrinkTimes, index, candidate, bounds = {}) {
    if (!Array.isArray(actualDrinkTimes)
        || !Number.isInteger(index)
        || index < 0
        || index >= actualDrinkTimes.length
        || !Number.isFinite(candidate)) {
      return { valid: false, reason: 'Enter a valid log time.' };
    }
    const startAt = Number(bounds.startAt);
    const endAt = Number(bounds.endAt);
    const now = Number(bounds.now ?? Date.now());
    const maximum = Math.min(endAt, now);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || !Number.isFinite(now) || candidate < startAt || candidate > maximum) {
      return { valid: false, reason: 'Log time must be inside the elapsed session.' };
    }
    const previous = index > 0 ? actualDrinkTimes[index - 1] : null;
    const next = index + 1 < actualDrinkTimes.length ? actualDrinkTimes[index + 1] : null;
    if (!unresolved(previous) && candidate < previous) {
      return { valid: false, reason: 'Log time cannot be before the prior drink.' };
    }
    if (!unresolved(next) && candidate > next) {
      return { valid: false, reason: 'Log time cannot be after the next drink.' };
    }
    return { valid: true, reason: '' };
  }

  function elapsedMinutes(startAt, finishAt) {
    if (!Number.isFinite(startAt) || !Number.isFinite(finishAt) || finishAt < startAt) return 0;
    return Math.round((finishAt - startAt) / MINUTE_MS);
  }

  return Object.freeze({
    MINUTE_MS,
    unresolved,
    zoneUnresolvedHours,
    paceNextIndex,
    paceLastLoggedIndex,
    paceReconcileSchedule,
    formatMinutes,
    describeDeadline,
    validatePaceTimestamp,
    elapsedMinutes,
  });
});
