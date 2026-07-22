(function initGoldilocksSessionHistory(root, factory) {
  'use strict';

  const history = factory();
  if (typeof module === 'object' && module.exports) module.exports = history;
  else root.GoldilocksSessionHistory = history;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildGoldilocksSessionHistory() {
  'use strict';

  const STORAGE_KEY = 'goldilocks_session_history';
  const VERSION = 1;
  const MAX_ENTRIES = 50;
  const MODES = new Set(['zone', 'pace']);
  const REASONS = new Set(['manual', 'elapsed']);

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

  function normalizeRecord(record) {
    if (!isRecord(record) || record.version !== VERSION || !MODES.has(record.mode)) return null;
    const id = safeText(record.id, 80);
    const profileName = safeText(record.profileName, 40);
    const completionReason = REASONS.has(record.completionReason) ? record.completionReason : null;
    const detail = normalizeDetail(record.mode, record.detail);
    if (!id || !profileName || !completionReason || !detail) return null;
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

    return {
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
      detail,
    };
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

  return Object.freeze({
    STORAGE_KEY,
    VERSION,
    MAX_ENTRIES,
    normalizeRecord,
    sanitize,
    read,
    write,
    save,
    remove,
    clear,
  });
}));
