import { Router } from 'express';
import { getStateHistory } from '../state.js';
import { authenticate } from '../auth.js';
import { validateQuery } from '../middleware/validation.js';
import { buildStatusView } from '../statusView.js';

const router = Router();

router.get('/', (_req, res) => res.json(buildStatusView()));

// State history endpoint (authenticated)
router.get('/history', authenticate, validateQuery('statusHistory'), (req, res) => {
  const field = req.query.field || null;
  const limit = req.query.limit || 100;
  
  try {
    const history = getStateHistory(field, limit);
    res.json({ history, count: history.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve state history.' });
  }
});

export default router;
