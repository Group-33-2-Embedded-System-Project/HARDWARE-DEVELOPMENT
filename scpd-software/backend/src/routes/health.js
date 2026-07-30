import { Router } from 'express';
import { getLiveness, getDetailedHealth } from '../health.js';
import { authenticate } from '../auth.js';

const router = Router();

/**
 * GET /health
 * Liveness probe — used by load balancers / process managers.
 * Returns 200 if the process is alive and the DB responds, 503 otherwise.
 * No authentication required — monitoring tools need unrestricted access.
 */
router.get('/', (_req, res) => {
  const result = getLiveness();
  res.status(result.ok ? 200 : 503).json(result);
});

/**
 * GET /health/detailed
 * Full dependency check — MQTT, WebSocket, device, system memory.
 * Authenticated so internal details aren't publicly exposed.
 */
router.get('/detailed', authenticate, (_req, res) => {
  const report = getDetailedHealth();
  const httpStatus = report.status === 'unhealthy' ? 503 : 200;
  res.status(httpStatus).json(report);
});

export default router;
