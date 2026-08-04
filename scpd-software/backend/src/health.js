import { db } from './db/index.js';
import { getMqttStatus } from './mqtt/client.js';
import { getSocketStats } from './sockets.js';
import { snapshot } from './state.js';
import { getLatestCommandSummary } from './commands.js';
import { getDeviceMessageStats } from './deviceMessages.js';
import logger from './logger.js';

const startTime = Date.now();

/**
 * Check database connectivity and responsiveness.
 */
function checkDatabase() {
  const start = Date.now();
  try {
    db.prepare('SELECT 1').get();
    const latencyMs = Date.now() - start;
    return { status: 'ok', latencyMs };
  } catch (error) {
    logger.error('Health check: database probe failed', error);
    return { status: 'error', error: error.message };
  }
}

/**
 * Check MQTT broker connection status.
 */
function checkMqtt() {
  try {
    const mqtt = getMqttStatus();
    return {
      status: mqtt.connected ? 'ok' : 'degraded',
      connected: mqtt.connected,
      brokerUrl: mqtt.brokerUrl,
      connectionAttempts: mqtt.connectionAttempts,
      lastConnectionTime: mqtt.lastConnectionTime
        ? new Date(mqtt.lastConnectionTime).toISOString()
        : null,
    };
  } catch (error) {
    logger.error('Health check: MQTT probe failed', error);
    return { status: 'error', error: error.message };
  }
}

/**
 * Check WebSocket server status.
 */
function checkWebSocket() {
  try {
    const stats = getSocketStats();
    return {
      status: 'ok',
      connectedClients: stats.connected,
    };
  } catch (error) {
    logger.error('Health check: WebSocket probe failed', error);
    return { status: 'error', error: error.message };
  }
}

/**
 * Check system resource usage.
 */
function checkSystem() {
  const mem   = process.memoryUsage();
  const uptimeS = Math.floor((Date.now() - startTime) / 1000);

  return {
    status: 'ok',
    uptimeSeconds: uptimeS,
    memory: {
      heapUsedMb:  +(mem.heapUsed  / 1024 / 1024).toFixed(2),
      heapTotalMb: +(mem.heapTotal / 1024 / 1024).toFixed(2),
      rssMb:       +(mem.rss       / 1024 / 1024).toFixed(2),
    },
    nodeVersion: process.version,
    pid: process.pid,
  };
}

/**
 * Check current coop device state (online flag).
 */
function checkDevice() {
  const state = snapshot();
  const freshness = state.freshness;
  const stale = freshness.isStale;

  return {
    status: state.online && !stale ? 'ok' : 'degraded',
    online: state.online,
    armed:  state.armed,
    lastUpdated: state.updatedAt,
    lastDeviceMessageAt: freshness.lastDeviceMessageAt,
    staleAfterMs: freshness.staleAfterMs,
    isStale: stale,
  };
}

function checkCommandQueue() {
  const summary = getLatestCommandSummary();
  return {
    status: summary.pendingCount > 0 ? 'degraded' : 'ok',
    pendingCount: summary.pendingCount,
    latest: summary.latest
      ? {
          id: summary.latest.id,
          type: summary.latest.type,
          publishStatus: summary.latest.publish_status,
          ackStatus: summary.latest.ack_status,
          requestedAt: summary.latest.requested_at,
        }
      : null,
  };
}

function checkDeviceMessageIngest() {
  const stats = getDeviceMessageStats();
  return {
    status: stats.parseFailures > 0 ? 'degraded' : 'ok',
    totalMessages: stats.total,
    parseFailures: stats.parseFailures,
    lastReceivedAt: stats.lastReceivedAt,
  };
}

/**
 * Derive overall health from individual checks.
 * - Any 'error'    → overall 'unhealthy'
 * - Any 'degraded' → overall 'degraded'
 * - All 'ok'       → overall 'ok'
 */
function deriveOverall(checks) {
  const statuses = Object.values(checks).map((c) => c.status);
  if (statuses.includes('error'))    return 'unhealthy';
  if (statuses.includes('degraded')) return 'degraded';
  return 'ok';
}

/**
 * Full health report — used by GET /health/detailed
 */
export function getDetailedHealth() {
  const checks = {
    database:  checkDatabase(),
    mqtt:      checkMqtt(),
    websocket: checkWebSocket(),
    device:    checkDevice(),
    commands:  checkCommandQueue(),
    ingest:    checkDeviceMessageIngest(),
    system:    checkSystem(),
  };

  const overall = deriveOverall(checks);

  return {
    status:    overall,
    timestamp: new Date().toISOString(),
    checks,
  };
}

/**
 * Lightweight liveness probe — used by GET /health
 * Only fails if the process itself is critically broken.
 */
export function getLiveness() {
  const db = checkDatabase();
  return {
    ok:        db.status === 'ok',
    timestamp: new Date().toISOString(),
    uptime:    Math.floor((Date.now() - startTime) / 1000),
  };
}
