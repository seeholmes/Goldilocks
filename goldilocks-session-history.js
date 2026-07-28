(function initGoldilocksSessionHistory(root, factory) {
  'use strict';

  const history = factory();
  if (typeof module === 'object' && module.exports) module.exports = history;
  else root.GoldilocksSessionHistory = history;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildGoldilocksSessionHistory() {
  'use strict';

  const STORAGE_KEY = 'goldilocks_session_history';
  const VERSION = 3;
  const LEGACY_VERSION = 1;
  const EVIDENCE_VERSION = 2;
  const MAX_ENTRIES = 50;
  const MODES = new Set(['zone', 'pace']);
  const REASONS = new Set(['manual', 'elapsed']);
  const FOOD_STATES = new Set(['empty', 'light', 'meal', 'unknown']);
  const MEASUREMENT_WINDOW_MS = 4 * 60 * 60 * 1000;
  const MIN_REFINEMENT_SESSIONS = 3;
  const RECOVERY_LEVELS = Object.freeze({
    1: Object.freeze({ title: 'All Systems Go', summary: 'Great' }),
    2: Object.freeze({ title: 'Rough Ascent', summary: 'Manageable' }),
    3: Object.freeze({ title: 'Apollo 13', summary: 'Bad' }),
    4: Object.freeze({ title: 'Event Horizon', summary: 'Terrible' }),
  });

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteInRange(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  }

  function integerInRange(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }

  function safeText(value, maxLength) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
    return normalized;
  }

  function normalizeDetail(mode, detail) {
    if (!isRecord(detail) || detail.type !== mode) return null;
    if (mode === 'zone') {
      if (!finiteInRange(detail.targetMin, 0, 1)
          || !finiteInRange(detail.targetMax, 0, 1)
          || detail.targetMin >= detail.targetMax
          || !integerInRange(detail.matchedPeriods, 0, 96)) return null;
      return {
        type: 'zone',
        targetMin: detail.targetMin,
        targetMax: detail.targetMax,
        matchedPeriods: detail.matchedPeriods,
      };
    }
    if (!finiteInRange(detail.targetEnd, 0, 1)
        || !finiteInRange(detail.initialProjectedEnd, 0, 2)) return null;
    return {
      type: 'pace',
      targetEnd: detail.targetEnd,
      initialProjectedEnd: detail.initialProjectedEnd,
    };
  }

  function normalizeOptionalNumber(value, min, max) {
    if (value === null || value === undefined) return null;
    return finiteInRange(value, min, max) ? value : null;
  }

  function getMeasurementEligibility(record, measurement) {
    if (!measurement.protocolFollowed) return { eligible: false, reason: 'protocol-not-confirmed' };
    if (record.foodState === 'unknown') return { eligible: false, reason: 'food-state-unknown' };
    if (!finiteInRange(record.modelRisePerStd, 0.001, 0.2)
        || !finiteInRange(record.modelMetabPerHr, 0.001, 0.05)) {
      return { eligible: false, reason: 'model-snapshot-unavailable' };
    }
    if (!finiteInRange(record.standardDrinks, 0.05, 200)) {
      return { eligible: false, reason: 'no-standard-drinks' };
    }
    if (measurement.value === 0) return { eligible: false, reason: 'zero-reading' };
    if (measurement.estimatedBac === 0) return { eligible: false, reason: 'estimate-at-floor' };
    return { eligible: true, reason: null };
  }

  function normalizeMeasurement(record, measurement) {
    if (measurement === null || measurement === undefined) return null;
    if (!isRecord(measurement)
        || !finiteInRange(measurement.value, 0, 1)
        || !finiteInRange(measurement.measuredAt, record.completedAt, record.completedAt + MEASUREMENT_WINDOW_MS)
        || typeof measurement.protocolFollowed !== 'boolean'
        || !finiteInRange(measurement.estimatedBac, 0, 2)) return null;
    const normalized = {
      value: measurement.value,
      measuredAt: measurement.measuredAt,
      protocolFollowed: measurement.protocolFollowed,
      estimatedBac: measurement.estimatedBac,
      eligibleForRefinement: false,
      eligibilityReason: null,
    };
    const eligibility = getMeasurementEligibility(record, normalized);
    normalized.eligibleForRefinement = eligibility.eligible;
    normalized.eligibilityReason = eligibility.reason;
    return normalized;
  }

  function normalizeRecord(record) {
    if (!isRecord(record)
        || ![LEGACY_VERSION, EVIDENCE_VERSION, VERSION].includes(record.version)
        || !MODES.has(record.mode)) return null;
    const id = safeText(record.id, 80);
    const profileName = safeText(record.profileName, 40);
    const completionReason = REASONS.has(record.completionReason) ? record.completionReason : null;
    const detail = normalizeDetail(record.mode, record.detail);
    const foodState = record.version < EVIDENCE_VERSION
      ? 'unknown'
      : FOOD_STATES.has(record.foodState) ? record.foodState : null;
    const modelRisePerStd = record.version < EVIDENCE_VERSION
      ? null
      : normalizeOptionalNumber(record.modelRisePerStd, 0.001, 0.2);
    const modelMetabPerHr = record.version < EVIDENCE_VERSION
      ? null
      : normalizeOptionalNumber(record.modelMetabPerHr, 0.001, 0.05);
    if (!id || !profileName || !completionReason || !detail || !foodState) return null;
    if (!finiteInRange(record.startedAt, 0, Number.MAX_SAFE_INTEGER)
        || !finiteInRange(record.completedAt, record.startedAt, Number.MAX_SAFE_INTEGER)
        || !integerInRange(record.durationMinutes, 15, 24 * 60)
        || record.durationMinutes % 15 !== 0
        || record.completedAt > record.startedAt + record.durationMinutes * 60000 + 60000
        || !finiteInRange(record.drinkOz, 1, 64)
        || !finiteInRange(record.drinkAbv, 0.5, 100)
        || !integerInRange(record.plannedDrinks, 0, 100)
        || !integerInRange(record.loggedDrinks, 0, 100)
        || !finiteInRange(record.standardDrinks, 0, 200)
        || !finiteInRange(record.finalBac, 0, 2)
        || !finiteInRange(record.peakBac, 0, 2)) return null;

    const normalized = {
      version: VERSION,
      id,
      mode: record.mode,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      durationMinutes: record.durationMinutes,
      profileName,
      drinkOz: record.drinkOz,
      drinkAbv: record.drinkAbv,
      plannedDrinks: record.plannedDrinks,
      loggedDrinks: record.loggedDrinks,
      standardDrinks: record.standardDrinks,
      finalBac: record.finalBac,
      peakBac: record.peakBac,
      completionReason,
      foodState,
      modelRisePerStd,
      modelMetabPerHr,
      detail,
    };
    normalized.measurement = normalizeMeasurement(normalized, record.measurement);
    const recoveryRating = record.version >= VERSION && integerInRange(record.recoveryRating, 1, 4)
      ? record.recoveryRating
      : null;
    const recoveryRatedAt = recoveryRating
      ? normalizeOptionalNumber(record.recoveryRatedAt, record.completedAt, Number.MAX_SAFE_INTEGER)
      : null;
    normalized.recoveryRating = recoveryRatedAt === null ? null : recoveryRating;
    normalized.recoveryRatedAt = recoveryRatedAt;
    return normalized;
  }

  function sanitize(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value
      .map(normalizeRecord)
      .filter(record => {
        if (!record || seen.has(record.id)) return false;
        seen.add(record.id);
        return true;
      })
      .sort((left, right) => right.completedAt - left.completedAt)
      .slice(0, MAX_ENTRIES);
  }

  function read(storage) {
    if (!storage || typeof storage.getItem !== 'function') return [];
    try {
      return sanitize(JSON.parse(storage.getItem(STORAGE_KEY) || '[]'));
    } catch (error) {
      return [];
    }
  }

  function write(storage, records) {
    if (!storage || typeof storage.setItem !== 'function') throw new TypeError('storage must provide setItem');
    const safe = sanitize(records);
    storage.setItem(STORAGE_KEY, JSON.stringify(safe));
    return safe;
  }

  function save(storage, record) {
    const normalized = normalizeRecord(record);
    if (!normalized) throw new RangeError('session history record is invalid');
    const records = read(storage).filter(item => item.id !== normalized.id);
    records.unshift(normalized);
    return write(storage, records);
  }

  function remove(storage, id) {
    return write(storage, read(storage).filter(record => record.id !== id));
  }

  function clear(storage) {
    return write(storage, []);
  }

  function setFoodState(storage, id, foodState) {
    if (!FOOD_STATES.has(foodState) || foodState === 'unknown') {
      throw new RangeError('food state is invalid');
    }
    const records = read(storage);
    const index = records.findIndex(record => record.id === id);
    if (index < 0) throw new RangeError('session history record was not found');
    records[index] = { ...records[index], foodState };
    return write(storage, records);
  }

  function setMeasurement(storage, id, measurement) {
    const records = read(storage);
    const index = records.findIndex(record => record.id === id);
    if (index < 0) throw new RangeError('session history record was not found');
    if (measurement === null) {
      records[index] = { ...records[index], measurement: null };
      return write(storage, records);
    }
    const record = records[index];
    const measuredAt = Number.isFinite(measurement?.measuredAt)
      && measurement.measuredAt < record.completedAt
      && record.completedAt - measurement.measuredAt < 1000
      ? record.completedAt
      : measurement?.measuredAt;
    if (!isRecord(measurement)
        || !finiteInRange(measurement.value, 0, 1)
        || !finiteInRange(
          measuredAt,
          record.completedAt,
          record.completedAt + MEASUREMENT_WINDOW_MS
        )
        || typeof measurement.protocolFollowed !== 'boolean') {
      throw new RangeError('BAC measurement is invalid');
    }
    const elapsedHours = (measuredAt - record.completedAt) / 3600000;
    const estimatedBac = record.modelMetabPerHr === null
      ? record.finalBac
      : Math.max(0, record.finalBac - record.modelMetabPerHr * elapsedHours);
    records[index] = {
      ...record,
      measurement: {
        value: measurement.value,
        measuredAt,
        protocolFollowed: measurement.protocolFollowed,
        estimatedBac,
      },
    };
    return write(storage, records);
  }

  function setRecoveryRating(storage, id, recoveryRating, recoveryRatedAt = Date.now()) {
    const records = read(storage);
    const index = records.findIndex(record => record.id === id);
    if (index < 0) throw new RangeError('session history record was not found');
    if (recoveryRating === null) {
      records[index] = {
        ...records[index],
        recoveryRating: null,
        recoveryRatedAt: null,
      };
      return write(storage, records);
    }
    if (!integerInRange(recoveryRating, 1, 4)
        || !finiteInRange(recoveryRatedAt, records[index].completedAt, Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('next-day recovery rating is invalid');
    }
    records[index] = {
      ...records[index],
      recoveryRating,
      recoveryRatedAt,
    };
    return write(storage, records);
  }

  function getSessionImpliedRise(record) {
    const normalized = normalizeRecord(record);
    if (!normalized?.measurement?.eligibleForRefinement) return null;
    const error = normalized.measurement.value - normalized.measurement.estimatedBac;
    const impliedRise = normalized.modelRisePerStd + error / normalized.standardDrinks;
    return finiteInRange(impliedRise, 0.001, 0.1) ? impliedRise : null;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function calculateRiseEvidence(records, profileName) {
    const normalizedName = safeText(profileName, 40)?.toLowerCase();
    if (!normalizedName) throw new RangeError('profile name is invalid');
    const evidence = sanitize(records)
      .filter(record => record.profileName.toLowerCase() === normalizedName
        && record.measurement?.eligibleForRefinement)
      .map(record => {
        const error = record.measurement.value - record.measurement.estimatedBac;
        const candidateRise = getSessionImpliedRise(record);
        if (candidateRise === null) return null;
        return {
          id: record.id,
          foodState: record.foodState,
          error,
          absoluteError: Math.abs(error),
          candidateRise,
        };
      })
      .filter(Boolean);
    const eligibleCount = evidence.length;
    const candidateRisePerStd = median(evidence.map(item => item.candidateRise));
    const meanError = eligibleCount
      ? evidence.reduce((sum, item) => sum + item.error, 0) / eligibleCount
      : null;
    const meanAbsoluteError = eligibleCount
      ? evidence.reduce((sum, item) => sum + item.absoluteError, 0) / eligibleCount
      : null;
    const byFoodState = {};
    for (const foodState of ['empty', 'light', 'meal']) {
      const matches = evidence.filter(item => item.foodState === foodState);
      byFoodState[foodState] = {
        count: matches.length,
        meanError: matches.length
          ? matches.reduce((sum, item) => sum + item.error, 0) / matches.length
          : null,
      };
    }
    return {
      eligibleCount,
      minimumRequired: MIN_REFINEMENT_SESSIONS,
      candidateRisePerStd,
      suggestedRisePerStd: eligibleCount >= MIN_REFINEMENT_SESSIONS ? candidateRisePerStd : null,
      meanError,
      meanAbsoluteError,
      confidence: eligibleCount >= 8 ? 'high' : eligibleCount >= 5 ? 'medium' : eligibleCount >= 3 ? 'low' : 'insufficient',
      byFoodState,
    };
  }

  function findRecoveryWarning(records, profileName, standardDrinks, peakBac) {
    const normalizedName = safeText(profileName, 40)?.toLowerCase();
    if (!normalizedName) return null;
    const comparableStandardDrinks = finiteInRange(standardDrinks, 0, 200) ? standardDrinks : 0;
    const comparablePeakBac = finiteInRange(peakBac, 0, 2) ? peakBac : 0;
    const matches = sanitize(records)
      .filter(record => record.profileName.toLowerCase() === normalizedName
        && integerInRange(record.recoveryRating, 3, 4)
        && ((record.standardDrinks > 0 && comparableStandardDrinks >= record.standardDrinks)
          || (record.peakBac > 0 && comparablePeakBac >= record.peakBac)))
      .sort((left, right) => right.recoveryRating - left.recoveryRating
        || left.standardDrinks - right.standardDrinks
        || left.peakBac - right.peakBac
        || right.completedAt - left.completedAt);
    if (!matches.length) return null;
    const match = matches[0];
    return {
      id: match.id,
      recoveryRating: match.recoveryRating,
      title: RECOVERY_LEVELS[match.recoveryRating].title,
      summary: RECOVERY_LEVELS[match.recoveryRating].summary,
      standardDrinks: match.standardDrinks,
      peakBac: match.peakBac,
      completedAt: match.completedAt,
    };
  }

  return Object.freeze({
    STORAGE_KEY,
    VERSION,
    LEGACY_VERSION,
    EVIDENCE_VERSION,
    MAX_ENTRIES,
    FOOD_STATES,
    MEASUREMENT_WINDOW_MS,
    MIN_REFINEMENT_SESSIONS,
    RECOVERY_LEVELS,
    normalizeRecord,
    sanitize,
    read,
    write,
    save,
    remove,
    clear,
    setFoodState,
    setMeasurement,
    setRecoveryRating,
    getSessionImpliedRise,
    calculateRiseEvidence,
    findRecoveryWarning,
  });
}));
