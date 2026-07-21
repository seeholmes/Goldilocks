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
    formatMinutes,
    describeDeadline,
    validatePaceTimestamp,
    elapsedMinutes,
  });
});
