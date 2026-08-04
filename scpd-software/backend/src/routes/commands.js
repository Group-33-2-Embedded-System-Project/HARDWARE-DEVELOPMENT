import { Router } from 'express';
import { authenticate } from '../auth.js';
import { createEvent } from '../db/index.js';
import { publish } from '../mqtt/client.js';
import { validateBody, validateQuery } from '../middleware/validation.js';
import { commandLimiter } from '../middleware/rateLimiter.js';
import logger from '../logger.js';
import {
  createCommandRecord,
  getCommandById,
  listCommands,
  markCommandFailed,
  markCommandPublished,
  deleteCommand,
  deleteAllCommands,
} from '../commands.js';

const router = Router();
router.use(authenticate);
router.use(commandLimiter);

router.get('/', validateQuery('commands'), (req, res) => {
  const limit = req.query.limit || 20;
  res.json({ commands: listCommands(limit) });
});

router.get('/:id', (req, res) => {
  const command = getCommandById(req.params.id);
  if (!command) {
    return res.status(404).json({ error: 'Command not found.' });
  }
  res.json({ command });
});

router.post('/deterrent', validateBody('deterrent'), async (req, res) => {
  const requestLogger = req.logger || logger;
  const command = createCommandRecord('deterrent', { action: 'trigger' }, req.user.username);
  
  try {
    await publish('coop/cmd/deterrent', 'trigger');
    const publishedCommand = markCommandPublished(command.id);
    const event = createEvent(
      'manual_trigger',
      { requestedBy: req.user.username, commandId: publishedCommand.id },
      {
        source: 'user',
        severity: 'info',
        backendReceivedAt: new Date().toISOString(),
        correlationId: publishedCommand.correlation_id,
      }
    );
    
    requestLogger.info('Deterrent triggered', {
      username: req.user.username,
      eventId: event.id,
      commandId: publishedCommand.id,
    });
    
    res.status(202).json({ accepted: true, event, command: publishedCommand });
  } catch (error) {
    markCommandFailed(command.id, error.message);
    requestLogger.error('Deterrent command failed', error, {
      username: req.user.username,
      commandId: command.id,
    });
    res.status(503).json({ error: error.message }); 
  }
});

router.post('/arm', validateBody('arm'), async (req, res) => {
  const { mode } = req.body;
  const requestLogger = req.logger || logger;
  const command = createCommandRecord('arm', { mode }, req.user.username);
  
  try {
    await publish('coop/cmd/arm', mode);
    const publishedCommand = markCommandPublished(command.id);
    const event = createEvent(
      'arm_change',
      { mode, requestedBy: req.user.username, commandId: publishedCommand.id },
      {
        source: 'user',
        severity: 'info',
        backendReceivedAt: new Date().toISOString(),
        correlationId: publishedCommand.correlation_id,
      }
    );
    
    requestLogger.info('Arm mode changed', {
      username: req.user.username,
      mode,
      eventId: event.id,
      commandId: publishedCommand.id,
    });
    
    res.status(202).json({ accepted: true, event, command: publishedCommand });
  } catch (error) {
    markCommandFailed(command.id, error.message);
    requestLogger.error('Arm command failed', error, {
      username: req.user.username,
      mode,
      commandId: command.id,
    });
    res.status(503).json({ error: error.message }); 
  }
});

// Delete a command by id (authorized)
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = getCommandById(id);
  if (!existing) return res.status(404).json({ error: 'Command not found.' });

  const ok = deleteCommand(id);
  if (!ok) return res.status(500).json({ error: 'Failed to delete command.' });
  return res.status(204).end();
});

// Mass delete all commands in the database (authorized)
router.delete('/', (req, res) => {
  // Intentional destructive operation — protected by authentication middleware on this router
  try {
    const deleted = deleteAllCommands();
    return res.status(200).json({ deleted });
  } catch (err) {
    logger.error('Failed to delete all commands', err);
    return res.status(500).json({ error: 'Failed to delete commands.' });
  }
});

export default router;
