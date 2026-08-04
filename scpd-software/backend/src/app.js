import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { ensureAdminUser } from './db/index.js';
import { initializeState } from './state.js';
import { createSocketServer } from './sockets.js';
import { startMqtt } from './mqtt/client.js';
import logger, { requestLogger, errorLogger } from './logger.js';
import { sanitizeBody, validateRequestSize, preventParameterPollution } from './middleware/validation.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { registerShutdownHandlers } from './shutdown.js';
import authRoutes    from './routes/auth.js';
import statusRoutes  from './routes/status.js';
import eventRoutes   from './routes/events.js';
import commandRoutes from './routes/commands.js';
import pushRoutes    from './routes/push.js';
import healthRoutes  from './routes/health.js';
import deviceMessagesRoutes from './routes/deviceMessages.js';

const app = express();

// ── Security headers ─────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.removeHeader('X-Powered-By');
  next();
});

app.use(cors({ origin: config.frontendOrigins }));
app.use(express.json({ limit: '32kb' }));

// ── Global middleware stack ──────────────────────────────────────────────────
app.use(requestLogger);
app.use(validateRequestSize(32 * 1024));
app.use(preventParameterPollution);
app.use(sanitizeBody);
app.use(apiLimiter);

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/health',       healthRoutes);
app.use('/api/auth',     authRoutes);
app.use('/api/status',   statusRoutes);
app.use('/api/events',   eventRoutes);
app.use('/api/command',  commandRoutes);
app.use('/api/push',     pushRoutes);
app.use('/api/device-messages', deviceMessagesRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/status', statusRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/commands', commandRoutes);
app.use('/api/v1/push', pushRoutes);
app.use('/api/v1/device-messages', deviceMessagesRoutes);

// ── Error handling ────────────────────────────────────────────────────────────
app.use(errorLogger);
app.use((error, req, res, _next) => {
  res.status(500).json({ error: 'Unexpected server error.' });
});

const server = http.createServer(app);
createSocketServer(server);

logger.info('Starting Smart Coop API server...');
await ensureAdminUser();
initializeState();
startMqtt();

server.listen(config.port, () => {
  logger.info(`Smart Coop API listening on port ${config.port}`, {
    environment: process.env.NODE_ENV || 'development',
    port: config.port,
  });

  // Register shutdown handlers only after the server is fully up
  registerShutdownHandlers(server);
});
