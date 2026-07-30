import { createEvent } from '../db/index.js';
import { sendAlertPush } from '../push.js';
import { emitAlert, emitStatus } from '../sockets.js';
import { updateState, snapshot } from '../state.js';
import logger from '../logger.js';

const statusFields = {
  'coop/status/pir': 'pir',
  'coop/status/light': 'light',
  'coop/status/armed': 'armed',
  'coop/status/online': 'online',
};

// Message validation schemas
const messageSchemas = {
  'coop/alert/predator': {
    validate: (payload) => payload === '0' || payload === '1',
    allowedValues: ['0', '1']
  },
  'coop/status/pir': {
    validate: (payload) => payload === '0' || payload === '1',
    allowedValues: ['0', '1']
  },
  'coop/status/light': {
    validate: (payload) => payload === '0' || payload === '1',
    allowedValues: ['0', '1']
  },
  'coop/status/armed': {
    validate: (payload) => payload === '0' || payload === '1',
    allowedValues: ['0', '1']
  },
  'coop/status/online': {
    validate: (payload) => payload === '0' || payload === '1',
    allowedValues: ['0', '1']
  }
};

// Rate limiting for alerts (prevent spam)
const alertRateLimit = {
  lastAlertTime: 0,
  minIntervalMs: 5000, // Minimum 5 seconds between alerts
  alertCount: 0,
  resetIntervalMs: 60000 // Reset counter every minute
};

/**
 * Validate MQTT topic and payload
 */
function validateMessage(topic, payload) {
  // Check if topic is recognized
  if (!topic || typeof topic !== 'string') {
    return { valid: false, error: 'Invalid topic format' };
  }

  // Check payload length
  if (typeof payload !== 'string' || payload.length > 100) {
    return { valid: false, error: 'Invalid payload length' };
  }

  // Validate against schema if available
  const schema = messageSchemas[topic];
  if (schema && !schema.validate(payload)) {
    return { 
      valid: false, 
      error: `Invalid payload for ${topic}. Expected: ${schema.allowedValues.join(', ')}` 
    };
  }

  return { valid: true };
}

/**
 * Check alert rate limiting
 */
function checkAlertRateLimit() {
  const now = Date.now();
  
  // Reset counter if interval has passed
  if (now - alertRateLimit.lastAlertTime > alertRateLimit.resetIntervalMs) {
    alertRateLimit.alertCount = 0;
  }

  // Check if minimum interval has passed
  if (now - alertRateLimit.lastAlertTime < alertRateLimit.minIntervalMs) {
    logger.warn('Alert rate limit exceeded', {
      timeSinceLastAlert: now - alertRateLimit.lastAlertTime,
      minInterval: alertRateLimit.minIntervalMs
    });
    return false;
  }

  // Check alert count (max 10 per minute)
  if (alertRateLimit.alertCount >= 10) {
    logger.warn('Alert count limit exceeded', {
      alertCount: alertRateLimit.alertCount,
      maxPerMinute: 10
    });
    return false;
  }

  alertRateLimit.lastAlertTime = now;
  alertRateLimit.alertCount++;
  return true;
}

/**
 * Handle predator alert with validation and rate limiting
 */
function handlePredatorAlert() {
  if (!checkAlertRateLimit()) {
    createEvent('alert_rate_limited', { reason: 'Too many alerts' });
    return;
  }

  try {
    const event = createEvent('predator_alert', { status: snapshot() });
    const alert = { timestamp: event.created_at, eventId: event.id };
    
    emitAlert(alert);
    sendAlertPush(alert).catch((error) => {
      logger.error('Failed to send push notification', error);
    });
    
    logger.info('Predator alert triggered', { eventId: event.id });
  } catch (error) {
    logger.error('Failed to handle predator alert', error);
    createEvent('alert_processing_error', { error: error.message });
  }
}

/**
 * Handle status update with validation
 */
function handleStatusUpdate(topic, field, payload) {
  try {
    const changed = updateState(field, payload === '1');
    if (changed) {
      emitStatus();
      logger.debug('Status updated', { field, value: payload === '1' });
    }
  } catch (error) {
    logger.error('Failed to update state', error, { field, payload });
    createEvent('state_update_error', { 
      field, 
      payload, 
      error: error.message 
    });
  }
}

/**
 * Main MQTT message handler with comprehensive validation and error handling
 */
export function handleMqttMessage(topic, payload) {
  // Validate message format
  const validation = validateMessage(topic, payload);
  if (!validation.valid) {
    logger.warn('MQTT validation failed', {
      topic,
      payload: typeof payload === 'string' ? payload.substring(0, 50) : null,
      error: validation.error
    });
    createEvent('mqtt_validation_error', { 
      topic, 
      payload: typeof payload === 'string' ? payload.substring(0, 50) : null,
      error: validation.error 
    });
    return;
  }

  try {
    // Handle predator alerts
    if (topic === 'coop/alert/predator' && payload === '1') {
      handlePredatorAlert();
      return;
    }

    // Handle status updates
    const field = statusFields[topic];
    if (field) {
      handleStatusUpdate(topic, field, payload);
      return;
    }

    // Unknown topic (after wildcard subscription)
    if (topic.startsWith('coop/')) {
      logger.debug('Received message for unhandled topic', { topic, payload });
      createEvent('mqtt_unknown_topic', { topic, payload });
    }
  } catch (error) {
    logger.error('Unexpected error in MQTT handler', error, { topic, payload });
    createEvent('mqtt_handler_error', { 
      topic, 
      error: error.message,
      stack: error.stack?.substring(0, 500)
    });
  }
}

/**
 * Get rate limit status (for monitoring)
 */
export function getAlertRateLimitStatus() {
  return {
    alertCount: alertRateLimit.alertCount,
    lastAlertTime: alertRateLimit.lastAlertTime,
    timeSinceLastAlert: Date.now() - alertRateLimit.lastAlertTime
  };
}
