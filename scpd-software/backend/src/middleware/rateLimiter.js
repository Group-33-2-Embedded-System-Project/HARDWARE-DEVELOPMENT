import logger from '../logger.js';

/**
 * In-process sliding-window rate limiter (no external dependency).
 *
 * Each limiter tracks a Map of  ip → [timestamp, …]  where only entries
 * within the current window are kept.
 */
class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.windowMs  - Window length in milliseconds
   * @param {number} opts.max       - Max requests per window per key
   * @param {string} opts.name      - Name used in log messages
   * @param {string} [opts.message] - Error message sent to the client
   * @param {boolean} [opts.skipSuccessfulRequests] - Skip counting 2xx responses
   */
  constructor({ windowMs, max, name, message, skipSuccessfulRequests = false }) {
    this.windowMs = windowMs;
    this.max = max;
    this.name = name;
    this.message = message || 'Too many requests, please try again later.';
    this.skipSuccessfulRequests = skipSuccessfulRequests;
    this.store = new Map(); // ip → number[]  (timestamps)

    // Periodically purge stale entries to prevent memory growth
    this._pruneInterval = setInterval(() => this._prune(), Math.min(windowMs, 60_000));
    this._pruneInterval.unref(); // Don't keep the process alive
  }

  /** Remove all timestamp arrays that are entirely outside the window */
  _prune() {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, hits] of this.store) {
      const fresh = hits.filter((t) => t > cutoff);
      if (fresh.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, fresh);
      }
    }
  }

  /** Return current hit count for a key (within window) */
  _count(key) {
    const cutoff = Date.now() - this.windowMs;
    const hits = (this.store.get(key) || []).filter((t) => t > cutoff);
    this.store.set(key, hits);
    return hits.length;
  }

  /** Record a hit for a key */
  _hit(key) {
    const cutoff = Date.now() - this.windowMs;
    const hits = (this.store.get(key) || []).filter((t) => t > cutoff);
    hits.push(Date.now());
    this.store.set(key, hits);
    return hits.length;
  }

  /** Express middleware */
  middleware() {
    return (req, res, next) => {
      // Prefer X-Forwarded-For if behind a trusted proxy, fall back to socket IP
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const count = this._count(ip);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', this.max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, this.max - count));
      res.setHeader(
        'X-RateLimit-Reset',
        Math.ceil((Date.now() + this.windowMs) / 1000)
      );

      if (count >= this.max) {
        logger.warn('Rate limit exceeded', {
          limiter: this.name,
          ip,
          count,
          max: this.max,
          path: req.path,
        });

        res.setHeader('Retry-After', Math.ceil(this.windowMs / 1000));
        return res.status(429).json({ error: this.message });
      }

      if (this.skipSuccessfulRequests) {
        // Only count the hit after the response if it was not 2xx
        const originalEnd = res.end.bind(res);
        res.end = (...args) => {
          if (res.statusCode >= 400) this._hit(ip);
          return originalEnd(...args);
        };
      } else {
        this._hit(ip);
      }

      next();
    };
  }
}

// ─── Pre-configured limiters ─────────────────────────────────────────────────

/**
 * Strict limiter for the login endpoint.
 * 10 attempts per 15 minutes per IP — failed attempts only.
 */
export const loginLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  name: 'login',
  message: 'Too many login attempts, please try again in 15 minutes.',
  skipSuccessfulRequests: true,
}).middleware();

/**
 * Command limiter — deterrent + arm endpoints.
 * 30 commands per minute per IP.
 */
export const commandLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  name: 'command',
  message: 'Too many commands, please slow down.',
}).middleware();

/**
 * General API limiter for all other routes.
 * 200 requests per minute per IP.
 */
export const apiLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 200,
  name: 'api',
  message: 'Too many requests, please try again shortly.',
}).middleware();
