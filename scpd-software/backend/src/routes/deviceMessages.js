import { Router } from 'express';
import { authenticate } from '../auth.js';
import { validateQuery } from '../middleware/validation.js';
import { listDeviceMessages } from '../deviceMessages.js';

const router = Router();

router.get('/', authenticate, validateQuery('deviceMessages'), (req, res) => {
  const limit = req.query.limit || 50;
  res.json({ messages: listDeviceMessages(limit) });
});

export default router;
