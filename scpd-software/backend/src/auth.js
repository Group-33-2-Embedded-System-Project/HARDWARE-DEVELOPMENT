import jwt from 'jsonwebtoken';
import { config } from './config.js';
import logger from './logger.js';

// Token expiry constants
const ACCESS_TOKEN_TTL  = '8h';   // Shorter-lived access token
const REFRESH_TOKEN_TTL = '7d';   // Longer-lived refresh token

/**
 * Express middleware — verifies Bearer JWT on every protected route.
 */
export function authenticate(req, res, next) {
  const header = req.get('authorization');

  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const token = header.slice(7);

  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.warn('Expired token rejected', {
        expiredAt: error.expiredAt,
        path: req.path,
      });
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid token rejected', {
        reason: error.message,
        path: req.path,
        ip: req.ip,
      });
      return res.status(401).json({ error: 'Invalid session token.' });
    }

    logger.error('Unexpected JWT error', error, { path: req.path });
    return res.status(401).json({ error: 'Authentication failed.' });
  }
}

/**
 * Create a short-lived access token.
 */
export function createToken(user) {
  return jwt.sign(
    {
      sub:      user.id,
      username: user.username,
      iat:      Math.floor(Date.now() / 1000),
    },
    config.jwtSecret,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

/**
 * Create a long-lived refresh token.
 * Stored client-side (e.g., in localStorage) and exchanged for a new
 * access token at /api/auth/refresh.
 */
export function createRefreshToken(user) {
  return jwt.sign(
    {
      sub:      user.id,
      username: user.username,
      type:     'refresh',
    },
    config.jwtSecret,
    { expiresIn: REFRESH_TOKEN_TTL }
  );
}

/**
 * Verify a refresh token and return its payload.
 * Throws if the token is invalid, expired, or not a refresh token.
 */
export function verifyRefreshToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);

  if (payload.type !== 'refresh') {
    throw new Error('Not a refresh token.');
  }

  return payload;
}

/**
 * Decode token without verifying — for logging/diagnostics only.
 * Never use for authorization decisions.
 */
export function decodeToken(token) {
  return jwt.decode(token);
}
