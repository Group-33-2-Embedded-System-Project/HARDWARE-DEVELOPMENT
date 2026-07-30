import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db/index.js';
import { createToken, createRefreshToken, verifyRefreshToken } from '../auth.js';
import { validateBody } from '../middleware/validation.js';
import { loginLimiter } from '../middleware/rateLimiter.js';
import logger from '../logger.js';

const router = Router();

// POST /api/auth/login
router.post('/login', loginLimiter, validateBody('login'), async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      logger.warn('Failed login attempt', { username, ip: req.ip });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token        = createToken(user);
    const refreshToken = createRefreshToken(user);

    logger.info('User logged in', { username, userId: user.id });

    res.json({
      token,
      refreshToken,
      user: { id: user.id, username: user.username },
    });
  } catch (error) {
    logger.error('Login error', error, { username });
    res.status(500).json({ error: 'Login failed.' });
  }
});

// POST /api/auth/refresh  — exchange a valid refresh token for a new access token
router.post('/refresh', validateBody('refresh'), (req, res) => {
  const { refreshToken } = req.body;

  try {
    const payload = verifyRefreshToken(refreshToken);
    const user    = db.prepare('SELECT id, username FROM users WHERE id = ?').get(payload.sub);

    if (!user) {
      return res.status(401).json({ error: 'User no longer exists.' });
    }

    const newToken = createToken(user);
    logger.info('Token refreshed', { username: user.username, userId: user.id });

    res.json({ token: newToken });
  } catch (error) {
    logger.warn('Token refresh failed', { reason: error.message });
    res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }
});

export default router;
