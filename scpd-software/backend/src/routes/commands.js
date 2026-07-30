import { Router } from 'express';
import { authenticate } from '../auth.js';
import { createEvent } from '../db/index.js';
import { publish } from '../mqtt/client.js';
import { validateBody } from '../middleware/validation.js';
import { commandLimiter } from '../middleware/rateLimiter.js';
import logger from '../logger.js';

const router = Router();
router.use(authenticate);
router.use(commandLimiter);

router.post('/deterrent', validateBody('deterrent'), async (req, res) => {
  const requestLogger = req.logger || logger;
  
  try {
    await publish('coop/cmd/deterrent', 'trigger');
    const event = createEvent('manual_trigger', { requestedBy: req.user.username });
    
    requestLogger.info('Deterrent triggered', {
      username: req.user.username,
      eventId: event.id
    });
    
    res.status(202).json({ accepted: true, event });
  } catch (error) {
    requestLogger.error('Deterrent command failed', error, {
      username: req.user.username
    });
    res.status(503).json({ error: error.message }); 
  }
});

router.post('/arm', validateBody('arm'), async (req, res) => {
  const { mode } = req.body;
  const requestLogger = req.logger || logger;
  
  try {
    await publish('coop/cmd/arm', mode);
    const event = createEvent('arm_change', { mode, requestedBy: req.user.username });
    
    requestLogger.info('Arm mode changed', {
      username: req.user.username,
      mode,
      eventId: event.id
    });
    
    res.status(202).json({ accepted: true, event });
  } catch (error) {
    requestLogger.error('Arm command failed', error, {
      username: req.user.username,
      mode
    });
    res.status(503).json({ error: error.message }); 
  }
});

export default router;
