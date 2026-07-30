import { Router } from 'express';
import { listEvents, deleteEvent, clearEvents } from '../db/index.js';
import { authenticate } from '../auth.js';
import { validateQuery } from '../middleware/validation.js';

const router = Router();

router.get('/', authenticate, validateQuery('events'), (req, res) => {
  const limit = req.query.limit || 50;
  res.json({ events: listEvents(limit) });
});

router.delete('/:id', authenticate, (req, res) => {
  try {
    const result = deleteEvent(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/', authenticate, (req, res) => {
  try {
    clearEvents();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
