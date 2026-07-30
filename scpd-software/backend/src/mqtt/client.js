import mqtt from 'mqtt';
import { config } from '../config.js';
import { handleMqttMessage } from './handlers.js';
import { updateState } from '../state.js';
import logger from '../logger.js';

let client;
let connectionAttempts = 0;
let isConnected = false;
let lastConnectionTime = null;
let reconnectTimeout = null;

const MQTT_CONFIG = {
  clientId: config.mqttClientId,
  username: config.mqttUsername,
  password: config.mqttPassword,
  clean: true,
  reconnectPeriod: 2000,
  connectTimeout: 30000,
  keepalive: 60,
  qos: 1,
  will: {
    topic: 'coop/status/online',
    payload: '0',
    qos: 1,
    retain: true
  }
};

/**
 * Subscribe to MQTT topics with error handling
 */
function subscribeToTopics() {
  const topics = ['coop/status/#', 'coop/alert/#'];
  
  client.subscribe(topics, { qos: 1 }, (error, granted) => {
    if (error) {
      logger.error('MQTT subscription failed', error);
      return;
    }
    
    logger.info('MQTT subscriptions established', {
      topics: granted.map(g => g.topic)
    });
  });
}

/**
 * Handle successful connection
 */
function handleConnect() {
  isConnected = true;
  connectionAttempts = 0;
  lastConnectionTime = Date.now();
  
  logger.info('Connected to MQTT broker', {
    brokerUrl: config.mqttUrl,
    clientId: config.mqttClientId
  });
  
  // Subscribe to topics
  subscribeToTopics();

  // Publish online status
  try {
    updateState('online', true);
    client.publish('coop/status/online', '1', { qos: 1, retain: true });
  } catch (error) {
    logger.error('Failed to publish backend online status', error);
  }
}

/**
 * Handle connection close
 */
function handleClose() {
  if (isConnected) {
    logger.warn('MQTT connection closed');
    isConnected = false;
    
    // Update internal state
    try {
      updateState('online', false);
    } catch (error) {
      logger.error('Failed to update online state', error);
    }
  }
}

/**
 * Handle reconnection
 */
function handleReconnect() {
  connectionAttempts++;
  logger.info('MQTT reconnecting', { attempt: connectionAttempts });
  
  // Exponential backoff with max delay of 30 seconds
  if (connectionAttempts > 5) {
    const delay = Math.min(30000, 2000 * Math.pow(2, connectionAttempts - 5));
    logger.debug('Using exponential backoff', { delayMs: delay });
  }
}

/**
 * Handle connection errors
 */
function handleError(error) {
  logger.error('MQTT error', error, {
    code: error.code,
    brokerUrl: config.mqttUrl
  });
  
  // Log specific error types
  if (error.code === 'ECONNREFUSED') {
    logger.error('MQTT broker connection refused. Check broker URL and credentials.');
  } else if (error.code === 'ETIMEDOUT') {
    logger.error('MQTT broker connection timed out. Check network connectivity.');
  } else if (error.code === 'ENOTFOUND') {
    logger.error('MQTT broker host not found. Check broker URL.');
  }
  
  isConnected = false;
}

/**
 * Handle offline event
 */
function handleOffline() {
  logger.warn('MQTT client went offline');
  isConnected = false;
}

/**
 * Handle incoming MQTT messages with error boundary
 */
function handleMessage(topic, payload) {
  try {
    const payloadStr = payload.toString();
    handleMqttMessage(topic, payloadStr);
  } catch (error) {
    logger.error('Critical error in MQTT message handler', error, {
      topic,
      payload: payload.toString().substring(0, 100)
    });
  }
}

/**
 * Start MQTT client with comprehensive error handling
 */
export function startMqtt() {
  if (client) {
    logger.warn('MQTT client already started');
    return client;
  }

  logger.info('Connecting to MQTT broker', {
    brokerUrl: config.mqttUrl,
    clientId: config.mqttClientId
  });
  
  try {
    client = mqtt.connect(config.mqttUrl, MQTT_CONFIG);
    
    // Register event handlers
    client.on('connect', handleConnect);
    client.on('close', handleClose);
    client.on('reconnect', handleReconnect);
    client.on('error', handleError);
    client.on('offline', handleOffline);
    client.on('message', handleMessage);
    
    return client;
  } catch (error) {
    logger.error('Failed to initialize MQTT client', error);
    throw error;
  }
}

/**
 * Publish message with validation and error handling
 */
export function publish(topic, message, options = {}) {
  if (!client) {
    throw new Error('MQTT client not initialized.');
  }

  if (!isConnected) {
    throw new Error('MQTT broker is unavailable.');
  }

  // Validate inputs
  if (!topic || typeof topic !== 'string') {
    throw new Error('Invalid topic format.');
  }

  if (message === null || message === undefined) {
    throw new Error('Message payload is required.');
  }

  const publishOptions = {
    qos: options.qos ?? 1,
    retain: options.retain ?? false
  };

  return new Promise((resolve, reject) => {
    client.publish(topic, String(message), publishOptions, (error) => {
      if (error) {
        logger.error('Failed to publish MQTT message', error, { topic, message });
        reject(error);
      } else {
        logger.debug('Published MQTT message', { topic, message });
        resolve();
      }
    });
  });
}

/**
 * Get MQTT connection status
 */
export function getMqttStatus() {
  return {
    connected: isConnected,
    connectionAttempts,
    lastConnectionTime,
    clientId: config.mqttClientId,
    brokerUrl: config.mqttUrl
  };
}

/**
 * Gracefully close MQTT connection
 */
export function closeMqtt() {
  if (!client) return Promise.resolve();

  return new Promise((resolve) => {
    logger.info('Closing MQTT connection');
    
    // Publish offline status
    if (isConnected) {
      client.publish('coop/status/backend', '0', { qos: 1, retain: true }, () => {
        client.end(false, {}, () => {
          logger.info('MQTT connection closed');
          client = null;
          isConnected = false;
          resolve();
        });
      });
    } else {
      client.end(false, {}, () => {
        client = null;
        resolve();
      });
    }
  });
}
