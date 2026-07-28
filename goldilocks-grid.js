(function initGoldilocksGrid(root, factory) {
  'use strict';

  const core = typeof module === 'object' && module.exports
    ? require('./goldilocks-core.js')
    : root.GoldilocksCore;
  const grid = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = grid;
  else root.GoldilocksGrid = grid;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildGoldilocksGrid(core) {
  'use strict';

  const STORAGE_KEY = 'goldilocks_grid_session';
  const VERSION = 1;
  const MAX_EVENTS = 200;
  const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
  const COMPLETE_RETENTION_MS = 24 * 60 * 60 * 1000;
  const FUTURE_TOLERANCE_MS = 60 * 1000;
  const ALERT_APPROACHING_DELTA = 0.01;
  const FOOD_STATES = new Set(['empty', 'light', 'meal']);
  const UNSAFE_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteInRange(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  }

  function safeText(value, maxLength) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized
        || normalized.length > maxLength
        || UNSAFE_NAMES.has(normalized.toLowerCase())
        || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
    return normalized;
  }

  function isValidProfile(profile) {
    if (!isRecord(profile)
        || !safeText(profile.name, 64)
        || !finiteInRange(profile.weightKg, 36.28, 226.8)
        || !finiteInRange(profile.r, 0.3, 1)
        || !finiteInRange(profile.metab, 0.001, 0.05)
        || typeof profile.useWidmark !== 'boolean') return false;
    return profile.useWidmark
      ? profile.risePerStd === null
        || profile.risePerStd === undefined
        || finiteInRange(profile.risePerStd, 0.001, 0.2)
      : finiteInRange(profile.risePerStd, 0.001, 0.2);
  }

  function alcoholGrams(oz, abv) {
    if (!finiteInRange(oz, 1, 64) || !finiteInRange(abv, 0.5, 100)) {
      throw new RangeError('drink size or ABV is invalid');
    }
    return oz * (abv / 100) * 29.5735 * 0.789;
  }

  function standardDrinks(oz, abv) {
    if (!core || !finiteInRange(core.STD_DRINK_G, 1, 100)) {
      throw new Error('Goldilocks calculation core is unavailable');
    }
    return alcoholGrams(oz, abv) / core.STD_DRINK_G;
  }

  function normalizeEvent(event, sessionStartTs, latestAt) {
    if (!isRecord(event)
        || !finiteInRange(event.loggedAt, sessionStartTs, latestAt + FUTURE_TOLERANCE_MS)) return null;
    const id = safeText(event.id, 80);
    const name = safeText(event.name, 40);
    if (!id || !name || !finiteInRange(event.oz, 1, 64) || !finiteInRange(event.abv, 0.5, 100)) return null;
    const calculatedStandardDrinks = standardDrinks(event.oz, event.abv);
    if (event.standardDrinks !== undefined
        && (!finiteInRange(event.standardDrinks, 0.01, 100)
          || Math.abs(event.standardDrinks - calculatedStandardDrinks) > 1e-9)) return null;
    return {
      id,
      loggedAt: event.loggedAt,
      name,
      oz: event.oz,
      abv: event.abv,
      standardDrinks: calculatedStandardDrinks,
    };
  }

  function sanitizeEvents(events, sessionStartTs, latestAt) {
    if (!Array.isArray(events) || events.length > MAX_EVENTS) return [];
    const ids = new Set();
    return events
      .map(event => normalizeEvent(event, sessionStartTs, latestAt))
      .filter(event => {
        if (!event || ids.has(event.id)) return false;
        ids.add(event.id);
        return true;
      })
      .sort((left, right) => left.loggedAt - right.loggedAt || left.id.localeCompare(right.id));
  }

  function getProfileRisePerStd(profile) {
    if (!isValidProfile(profile)) throw new RangeError('profile is invalid');
    return profile.useWidmark
      ? core.widmarkRisePerStd(profile.weightKg, profile.r)
      : profile.risePerStd;
  }

  function calculate(events, sessionStartTs, at, profile) {
    if (!finiteInRange(sessionStartTs, 0, Number.MAX_SAFE_INTEGER)
        || !finiteInRange(at, sessionStartTs, sessionStartTs + MAX_SESSION_MS)
        || !isValidProfile(profile)) {
      throw new RangeError('Grid calculation inputs are invalid');
    }
    const safeEvents = sanitizeEvents(events, sessionStartTs, at);
    if (!Array.isArray(events)
        || safeEvents.length !== events.length
        || safeEvents.some(event => event.loggedAt > at)) {
      throw new RangeError('Grid contains an invalid drink event');
    }
    const risePerStd = getProfileRisePerStd(profile);
    let bac = 0;
    let peakBac = 0;
    let peakAt = sessionStartTs;
    let cursor = sessionStartTs;
    let totalStandardDrinks = 0;
    const timeline = [{ at: sessionStartTs, bac: 0, type: 'start' }];

    safeEvents.forEach(event => {
      bac = Math.max(0, bac - profile.metab * ((event.loggedAt - cursor) / 3600000));
      cursor = event.loggedAt;
      bac += event.standardDrinks * risePerStd;
      totalStandardDrinks += event.standardDrinks;
      if (bac > peakBac) {
        peakBac = bac;
        peakAt = event.loggedAt;
      }
      timeline.push({
        at: event.loggedAt,
        bac,
        type: 'drink',
        eventId: event.id,
      });
    });
    bac = Math.max(0, bac - profile.metab * ((at - cursor) / 3600000));
    timeline.push({ at, bac, type: 'current' });
    return {
      currentBac: bac,
      peakBac,
      peakAt,
      totalStandardDrinks,
      totalDrinks: safeEvents.length,
      risePerStd,
      metabPerHr: profile.metab,
      timeline,
    };
  }

  function normalizeAlertBac(value) {
    if (value === null || value === undefined || value === '') return null;
    return finiteInRange(value, 0.01, 0.25) ? value : null;
  }

  function getAlertState(metrics, alertBac) {
    const threshold = normalizeAlertBac(alertBac);
    if (threshold === null) return { state: 'none', threshold: null };
    if (!metrics
        || !finiteInRange(metrics.currentBac, 0, 2)
        || !finiteInRange(metrics.peakBac, 0, 2)) {
      throw new RangeError('Grid alert metrics are invalid');
    }
    if (metrics.currentBac >= threshold) return { state: 'over', threshold };
    if (metrics.peakBac >= threshold) return { state: 'crossed', threshold };
    if (metrics.currentBac >= Math.max(0, threshold - ALERT_APPROACHING_DELTA)) {
      return { state: 'approaching', threshold };
    }
    return { state: 'below', threshold };
  }

  function normalizeSession(session, now = Date.now()) {
    if (!isRecord(session)
        || session.version !== VERSION
        || !finiteInRange(session.sessionStartTs, 0, Number.MAX_SAFE_INTEGER)
        || session.sessionStartTs > now + FUTURE_TOLERANCE_MS
        || typeof session.sessionComplete !== 'boolean'
        || !safeText(session.profileName, 64)
        || !isValidProfile(session.profile)
        || session.profileName !== session.profile.name
        || !FOOD_STATES.has(session.foodState)) return null;
    const completedAt = session.completedAt ?? null;
    if ((session.sessionComplete && !finiteInRange(
      completedAt,
      session.sessionStartTs,
      Math.min(now + FUTURE_TOLERANCE_MS, session.sessionStartTs + MAX_SESSION_MS)
    )) || (!session.sessionComplete && completedAt !== null)) return null;
    const latestAt = completedAt ?? Math.min(now, session.sessionStartTs + MAX_SESSION_MS);
    const drinkEvents = sanitizeEvents(session.drinkEvents, session.sessionStartTs, latestAt);
    if (!Array.isArray(session.drinkEvents) || drinkEvents.length !== session.drinkEvents.length) return null;
    let undoEvents = null;
    if (session.undoEvents !== null && session.undoEvents !== undefined) {
      undoEvents = sanitizeEvents(session.undoEvents, session.sessionStartTs, latestAt);
      if (!Array.isArray(session.undoEvents) || undoEvents.length !== session.undoEvents.length) return null;
    }
    const bacAlert = normalizeAlertBac(session.bacAlert);
    if (session.bacAlert !== null && session.bacAlert !== undefined && session.bacAlert !== '' && bacAlert === null) {
      return null;
    }
    return {
      version: VERSION,
      sessionStartTs: session.sessionStartTs,
      completedAt,
      sessionComplete: session.sessionComplete,
      profileName: session.profileName,
      profile: { ...session.profile },
      foodState: session.foodState,
      bacAlert,
      drinkEvents,
      undoEvents,
    };
  }

  return Object.freeze({
    STORAGE_KEY,
    VERSION,
    MAX_EVENTS,
    MAX_SESSION_MS,
    COMPLETE_RETENTION_MS,
    FUTURE_TOLERANCE_MS,
    ALERT_APPROACHING_DELTA,
    FOOD_STATES,
    isValidProfile,
    alcoholGrams,
    standardDrinks,
    normalizeEvent,
    sanitizeEvents,
    getProfileRisePerStd,
    calculate,
    normalizeAlertBac,
    getAlertState,
    normalizeSession,
  });
}));
