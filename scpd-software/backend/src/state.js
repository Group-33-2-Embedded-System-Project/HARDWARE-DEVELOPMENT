import { db } from './db/index.js';
import { config } from './config.js';
import logger from './logger.js';

const DEVICE_FIELDS = ['pir', 'light', 'armed', 'online', 'radar'];

let deviceStateCache = {
  pir: false,
  light: false,
  armed: false,
  online: false,
  radar: false,
  threat_level: 0,
  reportedAt: null,
  receivedAt: null,
  updatedAt: null,
  lastDeviceMessageAt: null,
};

let isInitialized = false;

function nowIso() {
  return new Date().toISOString();
}

function coerceTimestamp(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function deriveFreshness(lastDeviceMessageAt = deviceStateCache.lastDeviceMessageAt) {
  if (!lastDeviceMessageAt) {
    return {
      lastDeviceMessageAt: null,
      staleAfterMs: config.deviceStateStaleAfterMs,
      ageMs: null,
      isStale: true,
    };
  }

  const ageMs = Math.max(0, Date.now() - new Date(lastDeviceMessageAt).getTime());
  return {
    lastDeviceMessageAt,
    staleAfterMs: config.deviceStateStaleAfterMs,
    ageMs,
    isStale: ageMs > config.deviceStateStaleAfterMs,
  };
}

function persistProjection(field, value, changedAt, oldValue, newValue, { writeHistory }) {
  // Boolean-style fields (0/1) are handled here
  const updateProjection = db.prepare(`
    UPDATE system_state
    SET ${field} = ?, updated_at = ?
    WHERE id = 1
  `);

  const insertHistory = db.prepare(`
    INSERT INTO state_history (field, old_value, new_value, changed_at)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    updateProjection.run(value ? 1 : 0, changedAt);

    if (writeHistory) {
      insertHistory.run(field, String(oldValue), String(newValue), changedAt);
    }
  });

  transaction();
}

function persistNumericProjection(field, numericValue, changedAt, oldValue, newValue, { writeHistory }) {
  // Use this for numeric fields like threat_level where exact value must be stored
  const updateProjection = db.prepare(`
    UPDATE system_state
    SET ${field} = ?, updated_at = ?
    WHERE id = 1
  `);

  const insertHistory = db.prepare(`
    INSERT INTO state_history (field, old_value, new_value, changed_at)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    updateProjection.run(numericValue, changedAt);

    if (writeHistory) {
      insertHistory.run(field, String(oldValue), String(newValue), changedAt);
    }
  });

  transaction();
}

export function initializeState() {
  if (isInitialized) return;

  try {
    const row = db.prepare('SELECT * FROM system_state WHERE id = 1').get();
    if (row) {
      const timestamp = coerceTimestamp(row.updated_at);
      deviceStateCache = {
        pir: Boolean(row.pir),
        light: Boolean(row.light),
        armed: Boolean(row.armed),
        online: Boolean(row.online),
        radar: Boolean(row.radar),
        threat_level: Number.isInteger(row.threat_level) ? row.threat_level : 0,
        reportedAt: timestamp,
        receivedAt: timestamp,
        updatedAt: timestamp,
        lastDeviceMessageAt: timestamp,
      };
      logger.info('State initialized from database', deviceStateCache);
    }
  } catch (error) {
    logger.error('Failed to initialize state from database', error);
  } finally {
    isInitialized = true;
  }
}

export function recordDeviceContact(receivedAt = nowIso()) {
  const timestamp = coerceTimestamp(receivedAt, nowIso());
  deviceStateCache.receivedAt = timestamp;
  deviceStateCache.updatedAt = timestamp;
  deviceStateCache.lastDeviceMessageAt = timestamp;
  return timestamp;
}

export function updateState(field, value, metadata = {}) {
  if (!DEVICE_FIELDS.includes(field)) {
    throw new Error(`Invalid state field: ${field}`);
  }

  const oldValue = deviceStateCache[field];
  const newValue = Boolean(value);
  const receivedAt = recordDeviceContact(metadata.receivedAt);
  const reportedAt = coerceTimestamp(metadata.reportedAt, receivedAt);

  deviceStateCache.reportedAt = reportedAt;

  const changed = oldValue !== newValue;
  deviceStateCache[field] = newValue;

  try {
    persistProjection(field, newValue, receivedAt, oldValue, newValue, { writeHistory: changed });
    if (changed) {
      logger.debug('State updated', { field, oldValue, newValue, receivedAt, reportedAt });
    }
    return changed;
  } catch (error) {
    logger.error('Failed to persist state update', error, { field, oldValue, newValue });
    deviceStateCache[field] = oldValue;
    throw error;
  }
}

/**
 * Update numeric threat level (0..3)
 */
export function updateThreatLevel(level, metadata = {}) {
  const parsed = Number(level);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Invalid threat level');
  }

  const oldValue = deviceStateCache.threat_level;
  const newValue = parsed;
  const receivedAt = recordDeviceContact(metadata.receivedAt);
  const reportedAt = coerceTimestamp(metadata.reportedAt, receivedAt);

  deviceStateCache.reportedAt = reportedAt;
  deviceStateCache.threat_level = newValue;

  const changed = oldValue !== newValue;
  try {
    persistNumericProjection('threat_level', newValue, receivedAt, oldValue, newValue, { writeHistory: changed });
    if (changed) {
      logger.debug('Threat level updated', { oldValue, newValue, receivedAt, reportedAt });
    }
    return changed;
  } catch (error) {
    logger.error('Failed to persist threat level', error, { oldValue, newValue });
    deviceStateCache.threat_level = oldValue;
    throw error;
  }
}

export function updateStateFields(updates, metadata = {}) {
  const receivedAt = recordDeviceContact(metadata.receivedAt);
  const reportedAt = coerceTimestamp(metadata.reportedAt, receivedAt);
  const changes = [];
  const rollback = [];

  try {
    const transaction = db.transaction(() => {
      for (const [field, value] of Object.entries(updates)) {
        if (!DEVICE_FIELDS.includes(field)) continue;

        const oldValue = deviceStateCache[field];
        const newValue = Boolean(value);
        const changed = oldValue !== newValue;

        rollback.push({ field, oldValue });
        deviceStateCache[field] = newValue;

        persistProjection(field, newValue, receivedAt, oldValue, newValue, { writeHistory: changed });

        if (changed) {
          changes.push({ field, oldValue, newValue });
        }
      }
    });

    transaction();
    deviceStateCache.reportedAt = reportedAt;

    if (changes.length > 0) {
      logger.info('Bulk state update', {
        changedFields: changes.length,
        changes,
        receivedAt,
        reportedAt,
      });
    }

    return changes.length > 0;
  } catch (error) {
    logger.error('Failed to persist bulk state update', error);
    rollback.forEach(({ field, oldValue }) => {
      deviceStateCache[field] = oldValue;
    });
    throw error;
  }
}

export function snapshot() {
  const freshness = deriveFreshness();

  return {
    ...deviceStateCache,
    freshness,
  };
}

export function snapshotLegacy() {
  return {
    pir: deviceStateCache.pir,
    light: deviceStateCache.light,
    armed: deviceStateCache.armed,
    online: deviceStateCache.online,
    radar: deviceStateCache.radar,
    threat_level: deviceStateCache.threat_level,
    updatedAt: deviceStateCache.updatedAt,
  };
}

export function syncStateFromSource(updates, metadata = {}) {
  return updateStateFields(updates, metadata);
}

export function getStateHistory(field = null, limit = 100) {
  try {
    let query = 'SELECT * FROM state_history';
    const params = [];

    if (field) {
      query += ' WHERE field = ?';
      params.push(field);
    }

    query += ' ORDER BY changed_at DESC LIMIT ?';
    params.push(limit);

    return db.prepare(query).all(...params);
  } catch (error) {
    logger.error('Failed to fetch state history', error, { field, limit });
    return [];
  }
}

export const status = new Proxy(deviceStateCache, {
  get(target, prop) {
    return target[prop];
  },
  set(target, prop, value) {
    if (DEVICE_FIELDS.includes(prop)) {
      logger.warn('Direct state mutation detected', { field: prop });
      updateState(prop, value);
      return true;
    }
    target[prop] = value;
    return true;
  }
});
