(function initGoldilocksBackup(root, factory) {
  'use strict';

  const dependencies = typeof module === 'object' && module.exports
    ? {
      sessionHistory: require('./goldilocks-session-history.js'),
      presets: require('./goldilocks-presets.js'),
    }
    : {
      sessionHistory: root.GoldilocksSessionHistory,
      presets: root.GoldilocksPresets,
    };
  const backup = factory(dependencies);
  if (typeof module === 'object' && module.exports) module.exports = backup;
  else root.GoldilocksBackup = backup;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildGoldilocksBackup(dependencies) {
  'use strict';

  const FORMAT = 'goldilocks-device-backup';
  const SCHEMA_VERSION = 1;
  const MAX_BACKUP_BYTES = 4 * 1024 * 1024;
  const MAX_PROFILES = 200;
  const MAX_DRINKS = 200;
  const MAX_SESSION_HISTORY = 1000;
  const MAX_CALIBRATION_HISTORY = 500;
  const LAST_BACKUP_KEY = 'goldilocks_last_backup_at';
  const LAST_RESTORE_KEY = 'goldilocks_last_restore_at';
  const STORAGE_KEYS = Object.freeze({
    profiles: 'goldilocks_profiles',
    theme: 'goldilocks_theme',
    drinks: 'goldilocks_drinks',
    zoneSession: 'goldilocks_v2_session',
    paceSession: 'goldilocks_cruise_session',
    gridSession: 'goldilocks_grid_session',
    calibrationSession: 'goldilocks_training_session',
    calibrationHistory: 'goldilocks_training_history',
    sessionHistory: 'goldilocks_session_history',
  });
  const DATA_STORAGE_KEYS = Object.freeze(Object.values(STORAGE_KEYS));
  const OWNED_STORAGE_KEYS = Object.freeze([
    ...DATA_STORAGE_KEYS,
    LAST_BACKUP_KEY,
    LAST_RESTORE_KEY,
  ]);
  const THEMES = new Set(['cosmos', 'navy', 'parchment', 'slate']);
  const MODES = new Set(['zone', 'pace', 'grid']);
  const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isFiniteInRange(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  }

  function safeText(value, maxLength) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
    return normalized;
  }

  function isUnsafeKey(value) {
    return typeof value === 'string' && UNSAFE_KEYS.has(value.trim().toLowerCase());
  }

  function cloneSafeJson(value, depth = 0) {
    if (depth > 20) throw new RangeError('backup data is nested too deeply');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RangeError('backup data contains a non-finite number');
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > 100000) throw new RangeError('backup data contains an oversized string');
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > 5000) throw new RangeError('backup data contains an oversized array');
      return value.map(item => cloneSafeJson(item, depth + 1));
    }
    if (!isRecord(value)) throw new RangeError('backup data contains an unsupported value');
    const entries = Object.entries(value);
    if (entries.length > 500) throw new RangeError('backup data contains an oversized object');
    const safe = {};
    for (const [key, item] of entries) {
      if (isUnsafeKey(key)) throw new RangeError('backup data contains an unsafe key');
      safe[key] = cloneSafeJson(item, depth + 1);
    }
    return safe;
  }

  function readJson(storage, key, fallback) {
    try {
      const raw = storage?.getItem?.(key);
      if (raw === null || raw === undefined || raw === '') return fallback;
      if (raw.length > MAX_BACKUP_BYTES) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function normalizeProfiles(value, strict = false) {
    if (!isRecord(value)) {
      if (strict) throw new RangeError('backup profiles are invalid');
      return {};
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_PROFILES) throw new RangeError('backup contains too many profiles');
    const profiles = {};
    for (const [key, candidate] of entries) {
      const keyName = safeText(key, 64);
      const name = safeText(candidate?.name, 64);
      const useWidmark = typeof candidate?.useWidmark === 'boolean'
        ? candidate.useWidmark
        : candidate?.risePerStd == null;
      const riseValid = useWidmark
        ? candidate?.risePerStd === null
          || candidate?.risePerStd === undefined
          || isFiniteInRange(candidate.risePerStd, 0.001, 0.2)
        : isFiniteInRange(candidate?.risePerStd, 0.001, 0.2);
      const valid = keyName
        && name
        && !isUnsafeKey(keyName)
        && !isUnsafeKey(name)
        && isFiniteInRange(candidate?.weightKg, 36.28, 226.8)
        && isFiniteInRange(candidate?.r, 0.3, 1)
        && isFiniteInRange(candidate?.metab, 0.001, 0.05)
        && riseValid;
      if (!valid) {
        if (strict) throw new RangeError(`backup profile "${key}" is invalid`);
        continue;
      }
      profiles[keyName] = cloneSafeJson({ ...candidate, name, useWidmark });
    }
    return profiles;
  }

  function normalizeDrinks(value, strict = false) {
    if (!isRecord(value)) {
      if (strict) throw new RangeError('backup custom drinks are invalid');
      return {};
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_DRINKS) throw new RangeError('backup contains too many custom drinks');
    if (dependencies.presets?.sanitizeDrinkMap) {
      const drinks = dependencies.presets.sanitizeDrinkMap(value);
      if (strict && Object.keys(drinks).length !== entries.length) {
        throw new RangeError('backup contains an invalid custom drink');
      }
      return cloneSafeJson(drinks);
    }
    const drinks = {};
    for (const [key, candidate] of entries) {
      const name = safeText(key, 28);
      const oz = typeof candidate?.oz === 'string' ? Number(candidate.oz) : candidate?.oz;
      const abv = typeof candidate?.abv === 'string' ? Number(candidate.abv) : candidate?.abv;
      if (!name || isUnsafeKey(name)
          || !isFiniteInRange(oz, 1, 64)
          || !isFiniteInRange(abv, 0.5, 100)) {
        if (strict) throw new RangeError(`backup custom drink "${key}" is invalid`);
        continue;
      }
      drinks[name] = { oz, abv };
    }
    return drinks;
  }

  function isSessionHistoryRecord(candidate) {
    return isRecord(candidate)
      && safeText(candidate.id, 80)
      && MODES.has(candidate.mode)
      && isFiniteInRange(candidate.startedAt, 0, Number.MAX_SAFE_INTEGER)
      && isFiniteInRange(candidate.completedAt, candidate.startedAt, Number.MAX_SAFE_INTEGER)
      && safeText(candidate.profileName, 64);
  }

  function normalizeSessionHistory(value, strict = false) {
    if (!Array.isArray(value)) {
      if (strict) throw new RangeError('backup session history is invalid');
      return [];
    }
    if (value.length > MAX_SESSION_HISTORY) throw new RangeError('backup contains too many historical sessions');
    if (dependencies.sessionHistory?.sanitize) {
      const records = dependencies.sessionHistory.sanitize(value);
      if (strict && records.length !== value.length) {
        throw new RangeError('backup contains an invalid historical session');
      }
      return records.map(record => cloneSafeJson(record));
    }
    const records = [];
    for (const candidate of value) {
      if (!isSessionHistoryRecord(candidate)) {
        if (strict) throw new RangeError('backup contains an invalid historical session');
        continue;
      }
      records.push(cloneSafeJson(candidate));
    }
    return records;
  }

  function isCalibrationHistoryRecord(candidate) {
    return isRecord(candidate)
      && typeof candidate.date === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(candidate.date)
      && safeText(candidate.profile, 64)
      && isFiniteInRange(candidate.metab, 0.001, 0.05)
      && (candidate.rise === null || isFiniteInRange(candidate.rise, 0.001, 0.1))
      && isFiniteInRange(candidate.r2, 0, 1.000001);
  }

  function normalizeCalibrationHistory(value, strict = false) {
    if (!Array.isArray(value)) {
      if (strict) throw new RangeError('backup calibration history is invalid');
      return [];
    }
    if (value.length > MAX_CALIBRATION_HISTORY) throw new RangeError('backup contains too many calibration sessions');
    const records = [];
    for (const candidate of value) {
      if (!isCalibrationHistoryRecord(candidate)) {
        if (strict) throw new RangeError('backup contains an invalid calibration session');
        continue;
      }
      records.push(cloneSafeJson(candidate));
    }
    return records;
  }

  function normalizeActiveSession(value, label, strict = false) {
    if (value === null || value === undefined) return null;
    if (!isRecord(value)) {
      if (strict) throw new RangeError(`backup ${label} session is invalid`);
      return null;
    }
    return cloneSafeJson(value);
  }

  function normalizeIsoTimestamp(value, label) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
      throw new RangeError(`${label} is invalid`);
    }
    return new Date(value).toISOString();
  }

  function normalizeDocument(value) {
    if (!isRecord(value) || value.format !== FORMAT || value.schemaVersion !== SCHEMA_VERSION) {
      throw new RangeError('This is not a supported Goldilocks backup');
    }
    const data = value.data;
    if (!isRecord(data) || !isRecord(data.preferences) || !isRecord(data.activeSessions)) {
      throw new RangeError('Goldilocks backup data is incomplete');
    }
    const theme = THEMES.has(data.preferences.theme) ? data.preferences.theme : null;
    if (!theme) throw new RangeError('backup theme is invalid');
    const normalized = {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      appVersion: safeText(value.appVersion, 24) || 'unknown',
      exportedAt: normalizeIsoTimestamp(value.exportedAt, 'backup export time'),
      data: {
        profiles: normalizeProfiles(data.profiles, true),
        drinks: normalizeDrinks(data.drinks, true),
        sessionHistory: normalizeSessionHistory(data.sessionHistory, true),
        calibrationHistory: normalizeCalibrationHistory(data.calibrationHistory, true),
        preferences: { theme },
        activeSessions: {
          zone: normalizeActiveSession(data.activeSessions.zone, 'Zone', true),
          pace: normalizeActiveSession(data.activeSessions.pace, 'Pace', true),
          grid: normalizeActiveSession(data.activeSessions.grid, 'Grid', true),
          calibration: normalizeActiveSession(data.activeSessions.calibration, 'Calibration', true),
        },
      },
    };
    const serialized = JSON.stringify(normalized);
    if (serialized.length > MAX_BACKUP_BYTES) throw new RangeError('Goldilocks backup is too large');
    return normalized;
  }

  function create(storage, options = {}) {
    if (!storage || typeof storage.getItem !== 'function') {
      throw new TypeError('storage must provide getItem');
    }
    const exportedAt = new Date(options.now ?? Date.now()).toISOString();
    const rawTheme = storage.getItem(STORAGE_KEYS.theme);
    const theme = THEMES.has(rawTheme) ? rawTheme : 'cosmos';
    const document = {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      appVersion: safeText(options.appVersion, 24) || 'unknown',
      exportedAt,
      data: {
        profiles: normalizeProfiles(readJson(storage, STORAGE_KEYS.profiles, {})),
        drinks: normalizeDrinks(readJson(storage, STORAGE_KEYS.drinks, {})),
        sessionHistory: normalizeSessionHistory(readJson(storage, STORAGE_KEYS.sessionHistory, [])),
        calibrationHistory: normalizeCalibrationHistory(readJson(storage, STORAGE_KEYS.calibrationHistory, [])),
        preferences: { theme },
        activeSessions: {
          zone: normalizeActiveSession(readJson(storage, STORAGE_KEYS.zoneSession, null), 'Zone'),
          pace: normalizeActiveSession(readJson(storage, STORAGE_KEYS.paceSession, null), 'Pace'),
          grid: normalizeActiveSession(readJson(storage, STORAGE_KEYS.gridSession, null), 'Grid'),
          calibration: normalizeActiveSession(readJson(storage, STORAGE_KEYS.calibrationSession, null), 'Calibration'),
        },
      },
    };
    return normalizeDocument(document);
  }

  function serialize(document) {
    return `${JSON.stringify(normalizeDocument(document), null, 2)}\n`;
  }

  function parse(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_BACKUP_BYTES) {
      throw new RangeError('Goldilocks backup file is empty or too large');
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new RangeError('Goldilocks backup is not valid JSON');
    }
    return normalizeDocument(parsed);
  }

  function summarize(document) {
    const normalized = normalizeDocument(document);
    const activeSessions = Object.values(normalized.data.activeSessions).filter(Boolean).length;
    const measuredSessions = normalized.data.sessionHistory
      .filter(record => isRecord(record.measurement)).length;
    return {
      profiles: Object.keys(normalized.data.profiles).length,
      drinks: Object.keys(normalized.data.drinks).length,
      sessions: normalized.data.sessionHistory.length,
      measuredSessions,
      calibrationSessions: normalized.data.calibrationHistory.length,
      activeSessions,
      theme: normalized.data.preferences.theme,
      exportedAt: normalized.exportedAt,
      appVersion: normalized.appVersion,
    };
  }

  function buildStorageWrites(document) {
    const data = document.data;
    return new Map([
      [STORAGE_KEYS.profiles, JSON.stringify(data.profiles)],
      [STORAGE_KEYS.theme, data.preferences.theme],
      [STORAGE_KEYS.drinks, JSON.stringify(data.drinks)],
      [STORAGE_KEYS.sessionHistory, JSON.stringify(data.sessionHistory)],
      [STORAGE_KEYS.calibrationHistory, JSON.stringify(data.calibrationHistory)],
      [STORAGE_KEYS.zoneSession, data.activeSessions.zone === null ? null : JSON.stringify(data.activeSessions.zone)],
      [STORAGE_KEYS.paceSession, data.activeSessions.pace === null ? null : JSON.stringify(data.activeSessions.pace)],
      [STORAGE_KEYS.gridSession, data.activeSessions.grid === null ? null : JSON.stringify(data.activeSessions.grid)],
      [STORAGE_KEYS.calibrationSession, data.activeSessions.calibration === null ? null : JSON.stringify(data.activeSessions.calibration)],
      [LAST_BACKUP_KEY, document.exportedAt],
    ]);
  }

  function restore(storage, document, options = {}) {
    if (!storage
        || typeof storage.getItem !== 'function'
        || typeof storage.setItem !== 'function'
        || typeof storage.removeItem !== 'function') {
      throw new TypeError('storage must provide getItem, setItem, and removeItem');
    }
    const normalized = typeof document === 'string' ? parse(document) : normalizeDocument(document);
    const restoredAt = new Date(options.now ?? Date.now()).toISOString();
    const writes = buildStorageWrites(normalized);
    writes.set(LAST_RESTORE_KEY, restoredAt);
    const original = new Map();
    for (const key of writes.keys()) original.set(key, storage.getItem(key));
    try {
      for (const [key, value] of writes) {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      }
    } catch (error) {
      for (const [key, value] of original) {
        try {
          if (value === null) storage.removeItem(key);
          else storage.setItem(key, value);
        } catch (rollbackError) {}
      }
      throw new Error('Goldilocks could not restore the backup; existing data was preserved');
    }
    return { document: normalized, restoredAt };
  }

  function markExported(storage, timestamp = Date.now()) {
    if (!storage || typeof storage.setItem !== 'function') {
      throw new TypeError('storage must provide setItem');
    }
    const exportedAt = new Date(timestamp).toISOString();
    storage.setItem(LAST_BACKUP_KEY, exportedAt);
    return exportedAt;
  }

  function getTimestamp(storage, key) {
    try {
      const value = storage?.getItem?.(key);
      return typeof value === 'string' && Number.isFinite(Date.parse(value))
        ? new Date(value).toISOString()
        : null;
    } catch (error) {
      return null;
    }
  }

  function erase(storage) {
    if (!storage || typeof storage.removeItem !== 'function') {
      throw new TypeError('storage must provide removeItem');
    }
    OWNED_STORAGE_KEYS.forEach(key => storage.removeItem(key));
  }

  return Object.freeze({
    FORMAT,
    SCHEMA_VERSION,
    MAX_BACKUP_BYTES,
    STORAGE_KEYS,
    DATA_STORAGE_KEYS,
    OWNED_STORAGE_KEYS,
    LAST_BACKUP_KEY,
    LAST_RESTORE_KEY,
    create,
    serialize,
    parse,
    summarize,
    restore,
    markExported,
    getLastBackupAt: storage => getTimestamp(storage, LAST_BACKUP_KEY),
    getLastRestoreAt: storage => getTimestamp(storage, LAST_RESTORE_KEY),
    erase,
  });
}));
