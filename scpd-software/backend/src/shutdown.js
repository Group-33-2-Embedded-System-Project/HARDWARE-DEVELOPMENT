import { db } from './db/index.js';
import { closeMqtt } from './mqtt/client.js';
import { closeSocketServer } from './sockets.js';
import logger from './logger.js';

// Maximum time in ms we allow for a clean shutdown before forcing exit
const SHUTDOWN_TIMEOUT_MS = 10_000;

let isShuttingDown = false;

/**
 * Run a single shutdown step, catching and logging any error without
 * letting it abort the remaining steps.
 */
async function step(name, fn) {
  try {
    logger.info(`Shutdown: ${name}…`);
    await fn();
    logger.info(`Shutdown: ${name} done`);
  } catch (error) {
    logger.error(`Shutdown: ${name} failed`, error);
  }
}

/**
 * Orchestrate a clean shutdown.
 *
 * Order matters:
 *  1. Stop accepting new HTTP connections
 *  2. Close WebSocket connections (notifies clients)
 *  3. Disconnect MQTT (publishes last-will / offline status)
 *  4. Close the database (flushes WAL)
 *  5. Exit
 */
async function shutdown(signal, server) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, ignoring duplicate signal');
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal} — starting graceful shutdown`);

  // Hard-kill safety net
  const killer = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  killer.unref();

  // 1. Stop accepting new HTTP connections but finish in-flight requests
  await step('HTTP server close', () =>
    new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    )
  );

  // 2. Notify WebSocket clients and close connections
  await step('Socket.io close', closeSocketServer);

  // 3. Publish offline status and disconnect from broker
  await step('MQTT disconnect', closeMqtt);

  // 4. Flush WAL and close SQLite
  await step('Database close', () => {
    db.close();
  });

  logger.info('Graceful shutdown complete — exiting');
  clearTimeout(killer);
  process.exit(0);
}

/**
 * Register shutdown handlers on the given HTTP server.
 * Call this once after server.listen().
 */
export function registerShutdownHandlers(server) {
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => shutdown(signal, server));
  }

  // Catch unhandled promise rejections — log but don't crash in production
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)));
    // In development surface it immediately
    if (process.env.NODE_ENV !== 'production') {
      throw reason;
    }
  });

  // Catch uncaught synchronous exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — initiating emergency shutdown', error);
    shutdown('uncaughtException', server);
  });

  logger.info('Shutdown handlers registered (SIGTERM, SIGINT, SIGHUP)');
}
