import { Router } from 'express';
import { authenticate } from '../auth.js';
import { db } from '../db/index.js';
import { pushPublicKey } from '../push.js';
import { validateBody } from '../middleware/validation.js';
import logger from '../logger.js';

const router = Router();

router.get('/public-key', (_req, res) => res.json({ publicKey: pushPublicKey }));

router.post('/subscribe', authenticate, validateBody('pushSubscription'), (req, res) => {
  const subscription = req.body;
  
  try {
    // Additional validation for push subscription structure
    if (!subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      logger.warn('Invalid push subscription structure', {
        username: req.user.username,
        hasKeys: !!subscription?.keys
      });
      return res.status(400).json({ error: 'Invalid push subscription structure.' });
    }
    
    db.prepare(`INSERT INTO push_subscriptions (user_id, subscription_json) VALUES (?, ?)
      ON CONFLICT(subscription_json) DO UPDATE SET user_id = excluded.user_id`)
      .run(req.user.sub, JSON.stringify(subscription));
    
    logger.info('Push subscription registered', {
      username: req.user.username,
      userId: req.user.sub
    });
    
    res.status(201).json({ subscribed: true });
  } catch (error) {
    logger.error('Failed to register push subscription', error, {
      username: req.user.username
    });
    res.status(500).json({ error: 'Failed to register push subscription' });
  }
});

export default router;
