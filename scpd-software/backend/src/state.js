import { db } from './db/index.js';
import logger from './logger.js';

// In-memory cache of current state
let statusCache = { pir: false, light: false, armed: false, online: false, updatedAt: null };
let isInitialized = false;

/**
 * Initialize state from database on startup
 */
export function initializeState() {
  if (isInitialized) return;
  
  try {
    const row = db.prepare('SELECT * FROM system_state WHERE id = 1').get();
    if (row) {
      statusCache = {
        pir: Boolean(row.pir),
        light: Boolean(row.light),
        armed: Boolean(row.armed),
        online: Boolean(row.online),
        updatedAt: row.updated_at
      };
      logger.info('State initialized from database', statusCache);
    }
    isInitialized = true;
  } catch (error) {
    logger.error('Failed to initialize state from database', error);
    // Continue with default state
    isInitialized = true;
  }
}

/**
 * Update a state field with persistence and history tracking
 */
export function updateState(field, value) {
  if (!['pir', 'light', 'armed', 'online'].includes(field)) {
    throw new Error(`Invalid state field: ${field}`);
  }

  const oldValue = statusCache[field];
  const newValue = Boolean(value);
  
  // No change, skip update
  if (oldValue === newValue) return false;

  const now = new Date().toISOString();
  statusCache[field] = newValue;
  statusCache.updatedAt = now;

  try {
    // Use transaction for atomicity
    const updateState = db.prepare(`
      UPDATE system_state 
      SET ${field} = ?, updated_at = ? 
      WHERE id = 1
    `);
    
    const insertHistory = db.prepare(`
      INSERT INTO state_history (field, old_value, new_value, changed_at)
      VALUES (?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      updateState.run(newValue ? 1 : 0, now);
      insertHistory.run(field, String(oldValue), String(newValue), now);
    });

    transaction();
    
    logger.debug('State updated', {
      field,
      oldValue,
      newValue
    });
    return true;
  } catch (error) {
    logger.error('Failed to persist state update', error, { field, oldValue, newValue });
    // Rollback in-memory state on failure
    statusCache[field] = oldValue;
    throw error;
  }
}

/**
 * Bulk update multiple state fields
 */
export function updateStateFields(updates) {
  const changes = [];
  const now = new Date().toISOString();
  
  try {
    const transaction = db.transaction(() => {
      for (const [field, value] of Object.entries(updates)) {
        if (!['pir', 'light', 'armed', 'online'].includes(field)) continue;
        
        const oldValue = statusCache[field];
        const newValue = Boolean(value);
        
        if (oldValue === newValue) continue;
        
        statusCache[field] = newValue;
        changes.push({ field, oldValue, newValue });
        
        db.prepare(`UPDATE system_state SET ${field} = ?, updated_at = ? WHERE id = 1`)
          .run(newValue ? 1 : 0, now);
        
        db.prepare(`INSERT INTO state_history (field, old_value, new_value, changed_at) VALUES (?, ?, ?, ?)`)
          .run(field, String(oldValue), String(newValue), now);
      }
      
      statusCache.updatedAt = now;
    });

    transaction();
    
    if (changes.length > 0) {
      logger.info('Bulk state update', {
        changedFields: changes.length,
        changes
      });
    }
    
    return changes.length > 0;
  } catch (error) {
    logger.error('Failed to persist bulk state update', error);
    // Rollback all changes
    changes.forEach(({ field, oldValue }) => {
      statusCache[field] = oldValue;
    });
    throw error;
  }
}

/**
 * Get current state snapshot
 */
export function snapshot() {
  return { ...statusCache };
}

/**
 * Update state directly from MQTT or startup synchronization.
 */
export function syncStateFromSource(updates) {
  return updateStateFields(updates);
}

/**
 * Get state history for a specific field
 */
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

/**
 * Legacy access to status object (for backwards compatibility)
 */
export const status = new Proxy(statusCache, {
  get(target, prop) {
    return target[prop];
  },
  set(target, prop, value) {
    if (['pir', 'light', 'armed', 'online'].includes(prop)) {
      logger.warn('Direct state mutation detected', { field: prop });
      updateState(prop, value);
      return true;
    }
    target[prop] = value;
    return true;
  }
});
