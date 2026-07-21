'use strict';

(function initGoldilocksSessionState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GoldilocksSessionState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildGoldilocksSessionState() {
  const KEYS = Object.freeze({
    zone: 'goldilocks_v2_session',
    pace: 'goldilocks_cruise_session',
    training: 'goldilocks_training_session',
    profiles: 'goldilocks_profiles',
  });
  const MODE_META = Object.freeze({
    zone: Object.freeze({ label: 'Zone', href: 'goldilocks-zone.html' }),
    pace: Object.freeze({ label: 'Pace', href: 'goldilocks-cruise.html' }),
    training: Object.freeze({ label: 'Training', href: 'goldilocks-training.html' }),
  });
  const HOUR_MS = 60 * 60 * 1000;
  const MINUTE_MS = 60 * 1000;
  const TRAINING_TIMES = Object.freeze([45, 65, 85, 105]);
  const UNSAFE_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

  function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isFiniteInRange(value, minimum, maximum) {
    return Number.isFinite(value) && value >= minimum && value <= maximum;
  }

  function modeResult(mode, health, reason = '') {
    return { mode, ...MODE_META[mode], health, reason };
  }

  function parseValue(value, mode) {
    if (value === null || value === undefined || value === '') {
      return { result: modeResult(mode, 'missing'), value: null };
    }
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (!isRecord(parsed)) return { result: modeResult(mode, 'corrupt', 'not-an-object'), value: null };
      return { result: null, value: parsed };
    } catch (error) {
      return { result: modeResult(mode, 'corrupt', 'invalid-json'), value: null };
    }
  }

  function validProfile(profile) {
    if (!isRecord(profile)
        || typeof profile.name !== 'string'
        || !profile.name.trim()
        || profile.name.length > 64
        || UNSAFE_NAMES.has(profile.name.trim().toLowerCase())
        || !isFiniteInRange(profile.weightKg, 36.28, 226.8)
        || !isFiniteInRange(profile.r, 0.3, 1)
        || !Number.isFinite(profile.metab)
        || profile.metab <= 0
        || profile.metab > 0.05
        || typeof profile.useWidmark !== 'boolean') {
      return false;
    }
    const rise = profile.useWidmark && profile.risePerStd === undefined
      ? null
      : profile.risePerStd;
    return profile.useWidmark
      ? rise === null || isFiniteInRange(rise, 0.001, 0.2)
      : isFiniteInRange(rise, 0.001, 0.2);
  }

  function validSharedConfiguration(session) {
    if (!Number.isFinite(Number(session.drinkOz))
        || Number(session.drinkOz) < 1
        || Number(session.drinkOz) > 64
        || !Number.isFinite(Number(session.drinkAbv))
        || Number(session.drinkAbv) < 0.5
        || Number(session.drinkAbv) > 100
        || !['imperial', 'metric'].includes(session.units)
        || !['male', 'female'].includes(session.sex)) {
      return false;
    }
    if (session.profileName === 'custom') {
      const weight = Number(session.weight);
      if (!Number.isFinite(weight)) return false;
      if (session.units === 'imperial' && (weight < 80 || weight > 500)) return false;
      if (session.units === 'metric' && (weight < 36.3 || weight > 226.8)) return false;
    }
    return true;
  }

  function inspectZone(value, now = Date.now()) {
    const parsed = parseValue(value, 'zone');
    if (parsed.result) return parsed.result;
    const session = parsed.value;
    const complete = session.sessionComplete === true;

    if (!Number.isInteger(session.hours) || session.hours < 1 || session.hours > 8
        || (session.sessionComplete !== undefined && typeof session.sessionComplete !== 'boolean')
        || !Number.isFinite(session.sessionStartTs)
        || session.sessionStartTs > now + 24 * HOUR_MS
        || !isFiniteInRange(session.bacMin, 0.01, 0.15)
        || !isFiniteInRange(session.bacMax, 0.01, 0.25)
        || session.bacMin >= session.bacMax
        || !Number.isFinite(session.ag)
        || session.ag <= 0
        || session.ag > 1600
        || !validProfile(session.profile)
        || typeof session.profileName !== 'string'
        || session.profileName !== session.profile.name
        || (session.profileName.toLowerCase() === 'custom' && session.profileName !== 'custom')
        || !Array.isArray(session.plan)
        || session.plan.length !== session.hours
        || session.plan.some((count) => !Number.isInteger(count) || count < 0 || count > 6)
        || !Array.isArray(session.actualDrinks)
        || session.actualDrinks.length !== session.hours
        || session.actualDrinks.some((count) => count !== null && (!Number.isInteger(count) || count < 0 || count > 6))
        || !Array.isArray(session.replanFlags)
        || session.replanFlags.length !== session.hours
        || session.replanFlags.some((flag) => typeof flag !== 'boolean')
        || !validSharedConfiguration(session)
        || !/^([01]\d|2[0-3]):[0-5]\d$/.test(session.startTime || '')) {
      return modeResult('zone', 'corrupt', 'invalid-session');
    }

    const endAt = session.sessionStartTs + session.hours * HOUR_MS;
    if (now > endAt + HOUR_MS) return modeResult('zone', 'expired');
    const elapsedHours = (now - session.sessionStartTs) / HOUR_MS;
    const currentHour = elapsedHours < 0 ? -1 : Math.min(session.hours - 1, Math.floor(elapsedHours));
    if ((complete && elapsedHours < session.hours)
        || session.actualDrinks.some((count, hour) => count !== null && hour > currentHour)
        || (complete && session.actualDrinks.some((count) => count === null))) {
      return modeResult('zone', 'corrupt', 'invalid-progress');
    }

    const state = now < session.sessionStartTs
      ? 'scheduled'
      : complete
        ? 'complete'
        : now >= endAt
          ? 'needs-finalize'
          : 'active';
    return {
      ...modeResult('zone', 'valid'),
      state,
      startAt: session.sessionStartTs,
      endAt,
      durationMinutes: session.hours * 60,
      currentStep: state === 'active' ? currentHour + 1 : null,
      totalSteps: session.hours,
      plannedDrinks: session.plan.reduce((sum, count) => sum + count, 0),
      loggedDrinks: session.actualDrinks.reduce((sum, count) => sum + (count || 0), 0),
      bacMin: session.bacMin,
      bacMax: session.bacMax,
    };
  }

  function inspectPace(value, now = Date.now()) {
    const parsed = parseValue(value, 'pace');
    if (parsed.result) return parsed.result;
    const session = parsed.value;
    const durationMinutes = session.durationMinutes === undefined && Number.isInteger(session.hours)
      ? session.hours * 60
      : session.durationMinutes;
    const complete = session.sessionComplete === true;
    const bucketCount = Math.ceil(durationMinutes / 60);

    if (!Number.isInteger(durationMinutes)
        || durationMinutes < 60
        || durationMinutes > 480
        || durationMinutes % 15 !== 0
        || (session.sessionComplete !== undefined && typeof session.sessionComplete !== 'boolean')
        || !Number.isFinite(session.sessionStartTs)
        || session.sessionStartTs > now + 5 * MINUTE_MS
        || !isFiniteInRange(session.bacEnd, 0, 0.2)
        || !Number.isFinite(session.ag)
        || session.ag <= 0
        || session.ag > 1600
        || !validProfile(session.profile)
        || typeof session.profileName !== 'string'
        || session.profileName !== session.profile.name
        || (session.profileName.toLowerCase() === 'custom' && session.profileName !== 'custom')
        || !Array.isArray(session.plan)
        || session.plan.length !== bucketCount
        || session.plan.some((count) => !Number.isInteger(count) || count < 0 || count > 48)
        || !Array.isArray(session.drinkSchedule)
        || session.drinkSchedule.length > 48
        || session.drinkSchedule.some((timestamp) => !Number.isFinite(timestamp))
        || !Array.isArray(session.actualDrinkTimes)
        || session.actualDrinkTimes.length !== session.drinkSchedule.length
        || session.actualDrinkTimes.some((timestamp) => timestamp !== null && !Number.isFinite(timestamp))
        || !validSharedConfiguration(session)) {
      return modeResult('pace', 'corrupt', 'invalid-session');
    }

    const endAt = session.sessionStartTs + durationMinutes * MINUTE_MS;
    if (now > endAt + HOUR_MS) return modeResult('pace', 'expired');
    if (complete && now < endAt) return modeResult('pace', 'corrupt', 'invalid-completion');
    if (session.planSpacing !== undefined
        && (!Number.isFinite(session.planSpacing) || session.planSpacing < 0 || session.planSpacing > durationMinutes / 60 + 1e-6)) {
      return modeResult('pace', 'corrupt', 'invalid-spacing');
    }
    if (session.planOffsetHours !== undefined
        && (!Number.isFinite(session.planOffsetHours) || session.planOffsetHours < 0 || session.planOffsetHours > durationMinutes / 60 + 1e-6)) {
      return modeResult('pace', 'corrupt', 'invalid-offset');
    }
    if (session.plannedEndpoint !== undefined
        && (!Number.isFinite(session.plannedEndpoint) || session.plannedEndpoint < 0)) {
      return modeResult('pace', 'corrupt', 'invalid-endpoint');
    }
    if (session.planAchievable !== undefined && typeof session.planAchievable !== 'boolean') {
      return modeResult('pace', 'corrupt', 'invalid-achievable');
    }

    let previousScheduled = -Infinity;
    let previousActual = -Infinity;
    let reachedUnlogged = false;
    for (let index = 0; index < session.drinkSchedule.length; index += 1) {
      const scheduled = session.drinkSchedule[index];
      const actual = session.actualDrinkTimes[index];
      if (scheduled < session.sessionStartTs || scheduled > endAt || scheduled < previousScheduled) {
        return modeResult('pace', 'corrupt', 'invalid-schedule');
      }
      previousScheduled = scheduled;
      if (actual === null) {
        reachedUnlogged = true;
        continue;
      }
      if (reachedUnlogged
          || actual < session.sessionStartTs
          || actual > endAt
          || actual > now + MINUTE_MS
          || actual < previousActual) {
        return modeResult('pace', 'corrupt', 'invalid-log');
      }
      previousActual = actual;
    }

    const reconstructedPlan = new Array(bucketCount).fill(0);
    session.drinkSchedule.forEach((scheduled, index) => {
      const actual = session.actualDrinkTimes[index];
      if (complete && actual === null) return;
      const timestamp = actual === null ? scheduled : actual;
      const bucket = Math.max(0, Math.min(bucketCount - 1, Math.floor((timestamp - session.sessionStartTs) / HOUR_MS)));
      reconstructedPlan[bucket] += 1;
    });
    if (reconstructedPlan.some((count, index) => count !== session.plan[index])) {
      return modeResult('pace', 'corrupt', 'plan-mismatch');
    }

    const loggedDrinks = session.actualDrinkTimes.filter((timestamp) => timestamp !== null).length;
    const state = now < session.sessionStartTs
      ? 'scheduled'
      : complete
        ? 'complete'
        : now >= endAt
          ? 'needs-finalize'
          : 'active';
    return {
      ...modeResult('pace', 'valid'),
      state,
      startAt: session.sessionStartTs,
      endAt,
      durationMinutes,
      plannedDrinks: session.drinkSchedule.length,
      loggedDrinks,
      remainingDrinks: session.drinkSchedule.length - loggedDrinks,
      nextAt: session.drinkSchedule[loggedDrinks] ?? null,
      bacEnd: session.bacEnd,
    };
  }

  function plausibleTraining(results, fasted, core) {
    if (!results || !core) return false;
    const finite = ['metabPerHr', 'risePerStd', 'bacAt45', 'r2', 'slope', 'intercept', 'stdDrinks']
      .every((key) => Number.isFinite(results[key]));
    return finite
      && results.slope < 0
      && isFiniteInRange(results.metabPerHr, 0.001, 0.05)
      && isFiniteInRange(results.bacAt45, 0.001, 0.4)
      && isFiniteInRange(results.r2, core.CALIBRATION_MIN_R2, 1.000001)
      && isFiniteInRange(results.stdDrinks, 0.05, 50)
      && (fasted || isFiniteInRange(results.risePerStd, 0.001, 0.1));
  }

  function inspectTraining(value, now = Date.now(), core) {
    const parsed = parseValue(value, 'training');
    if (parsed.result) return parsed.result;
    const session = parsed.value;

    if (!Number.isFinite(session.t0)
        || session.t0 > now
        || typeof session.fasted !== 'boolean'
        || !Array.isArray(session.readings)
        || session.readings.length > TRAINING_TIMES.length
        || !Number.isInteger(session.currentStep)
        || session.currentStep !== session.readings.length
        || !isFiniteInRange(session.sessionAlcGrams, 1, 300)
        || !isFiniteInRange(session.sessionWeightKg, 80 * 0.453592, 226.8)
        || ![0.68, 0.55].includes(session.sessionR)
        || !['imperial', 'metric'].includes(session.units)
        || !['male', 'female'].includes(session.sex)
        || !isFiniteInRange(Number(session.weight), session.units === 'imperial' ? 80 : 36.3, session.units === 'imperial' ? 500 : 226.8)
        || !isFiniteInRange(Number(session.drinkOz), 1, 32)
        || !isFiniteInRange(Number(session.drinkAbv), 0.5, 100)) {
      return modeResult('training', 'corrupt', 'invalid-session');
    }

    const expectedWeightKg = session.units === 'imperial'
      ? Number(session.weight) * 0.453592
      : Number(session.weight);
    const expectedR = session.sex === 'male' ? 0.68 : 0.55;
    const expectedAlcoholGrams = Number(session.drinkOz) * (Number(session.drinkAbv) / 100) * 29.5735 * 0.789;
    if (Math.abs(session.sessionWeightKg - expectedWeightKg) > 0.01
        || session.sessionR !== expectedR
        || Math.abs(session.sessionAlcGrams - expectedAlcoholGrams) > 0.01) {
      return modeResult('training', 'corrupt', 'configuration-mismatch');
    }

    const expectedProtocolId = `${session.t0}:${session.readings.map((reading) => reading.ts).join('-')}`;
    const completedId = session.completedProtocolId ?? null;
    const savedId = session.savedProtocolId ?? null;
    if ((completedId !== null && completedId !== expectedProtocolId)
        || (savedId !== null && savedId !== completedId)
        || (completedId !== null && session.readings.length < 3)) {
      return modeResult('training', 'corrupt', 'invalid-result-id');
    }

    const readingsAreValid = session.readings.every((reading, index) => {
      if (!isRecord(reading)
          || !isFiniteInRange(reading.tMin, TRAINING_TIMES[index], 130)
          || !isFiniteInRange(reading.bac, 0, 0.4)
          || !Number.isFinite(reading.ts)
          || reading.ts < Math.max(
            session.t0 + TRAINING_TIMES[index] * MINUTE_MS,
            index === 0 ? 0 : session.readings[index - 1].ts + 20 * MINUTE_MS
          )
          || reading.ts > now + 5000
          || Math.abs(reading.tMin - (reading.ts - session.t0) / MINUTE_MS) > 0.01) {
        return false;
      }
      return index === 0
        || (reading.tMin > session.readings[index - 1].tMin && reading.ts > session.readings[index - 1].ts);
    });
    if (!readingsAreValid) return modeResult('training', 'corrupt', 'invalid-readings');

    let hasValidCalibration = false;
    if (session.readings.length >= 3 && core && typeof core.calculateCalibration === 'function') {
      try {
        const results = core.calculateCalibration(session.readings, session.sessionAlcGrams);
        hasValidCalibration = plausibleTraining(results, session.fasted, core);
      } catch (error) {
        hasValidCalibration = false;
      }
    }
    if (completedId !== null && !hasValidCalibration) {
      return modeResult('training', 'corrupt', 'invalid-calibration');
    }

    const elapsedMinutes = (now - session.t0) / MINUTE_MS;
    const maxAgeMinutes = completedId !== null || hasValidCalibration ? 24 * 60 : 130;
    if (elapsedMinutes > maxAgeMinutes) return modeResult('training', 'expired');

    let state;
    let nextAt = null;
    if (completedId !== null) {
      state = savedId === completedId ? 'results-saved' : 'results-unsaved';
    } else if (hasValidCalibration && session.readings.length >= 3) {
      state = 'ready-to-finish';
    } else {
      const index = session.readings.length;
      if (index < TRAINING_TIMES.length) {
        nextAt = Math.max(
          session.t0 + TRAINING_TIMES[index] * MINUTE_MS,
          index === 0 ? 0 : session.readings[index - 1].ts + 20 * MINUTE_MS
        );
      }
      state = nextAt !== null && now >= nextAt ? 'reading-ready' : 'active-waiting';
    }

    return {
      ...modeResult('training', 'valid'),
      state,
      startAt: session.t0,
      endAt: session.t0 + maxAgeMinutes * MINUTE_MS,
      readings: session.readings.length,
      requiredReadings: 3,
      nextAt,
      profileSaved: state === 'results-saved',
    };
  }

  function readKey(storage, key, mode) {
    try {
      return { value: storage?.getItem(key) ?? null, error: null };
    } catch (error) {
      return { value: null, error: modeResult(mode, 'unavailable', 'storage-error') };
    }
  }

  function inspectStorage(storage, now = Date.now(), core) {
    const zoneRaw = readKey(storage, KEYS.zone, 'zone');
    const paceRaw = readKey(storage, KEYS.pace, 'pace');
    const trainingRaw = readKey(storage, KEYS.training, 'training');
    const zone = zoneRaw.error || inspectZone(zoneRaw.value, now);
    const pace = paceRaw.error || inspectPace(paceRaw.value, now);
    const training = trainingRaw.error || inspectTraining(trainingRaw.value, now, core);
    return {
      zone,
      pace,
      training,
      valid: [zone, pace, training].filter((entry) => entry.health === 'valid'),
    };
  }

  function inspectProfiles(value) {
    if (value === null || value === undefined || value === '') {
      return { health: 'missing', count: 0, sessions: 0, latest: null };
    }
    let profiles;
    try {
      profiles = typeof value === 'string' ? JSON.parse(value) : value;
    } catch (error) {
      return { health: 'corrupt', count: 0, sessions: 0, latest: null };
    }
    if (!isRecord(profiles)) return { health: 'corrupt', count: 0, sessions: 0, latest: null };
    const calibrated = Object.values(profiles).filter((profile) => (
      isRecord(profile)
      && Number.isInteger(profile.sessions)
      && profile.sessions > 0
      && validProfile(profile)
    ));
    const dates = calibrated
      .map((profile) => profile.calibratedAt)
      .filter((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort();
    return {
      health: 'valid',
      count: calibrated.length,
      sessions: calibrated.reduce((sum, profile) => sum + profile.sessions, 0),
      latest: dates.at(-1) || null,
    };
  }

  function inspectStoredProfiles(storage) {
    try {
      return inspectProfiles(storage?.getItem(KEYS.profiles) ?? null);
    } catch (error) {
      return { health: 'unavailable', count: 0, sessions: 0, latest: null };
    }
  }

  return Object.freeze({
    KEYS,
    MODE_META,
    inspectZone,
    inspectPace,
    inspectTraining,
    inspectStorage,
    inspectProfiles,
    inspectStoredProfiles,
  });
});
