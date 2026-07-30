import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Log levels
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

// Color codes for console output
const COLORS = {
  error: '\x1b[31m', // Red
  warn: '\x1b[33m',  // Yellow
  info: '\x1b[36m',  // Cyan
  debug: '\x1b[35m', // Magenta
  trace: '\x1b[90m', // Gray
  reset: '\x1b[0m'
};

class Logger {
  constructor(options = {}) {
    this.level = options.level || process.env.LOG_LEVEL || 'info';
    this.enableConsole = options.console ?? true;
    this.enableFile = options.file ?? true;
    this.logDir = options.logDir || path.resolve(process.cwd(), 'logs');
    this.serviceName = options.serviceName || 'smart-coop';
    this.requestId = null; // For request correlation

    // Create logs directory if file logging is enabled
    if (this.enableFile) {
      try {
        fs.mkdirSync(this.logDir, { recursive: true });
      } catch (error) {
        console.error('Failed to create log directory:', error.message);
        this.enableFile = false;
      }
    }
  }

  /**
   * Check if a log level should be logged
   */
  shouldLog(level) {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.level];
  }

  /**
   * Format log entry as JSON
   */
  formatJson(level, message, meta = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      ...meta
    };

    if (this.requestId) {
      entry.requestId = this.requestId;
    }

    return entry;
  }

  /**
   * Format log entry for console
   */
  formatConsole(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const color = COLORS[level] || '';
    const reset = COLORS.reset;
    const levelStr = level.toUpperCase().padEnd(5);
    
    let output = `${color}[${timestamp}] ${levelStr}${reset} ${message}`;
    
    if (this.requestId) {
      output += ` ${color}[req:${this.requestId}]${reset}`;
    }

    if (Object.keys(meta).length > 0) {
      output += `\n${color}${JSON.stringify(meta, null, 2)}${reset}`;
    }

    return output;
  }

  /**
   * Write log to file
   */
  writeToFile(level, entry) {
    if (!this.enableFile) return;

    try {
      const date = new Date().toISOString().split('T')[0];
      const logFile = path.join(this.logDir, `${this.serviceName}-${date}.log`);
      const logLine = JSON.stringify(entry) + '\n';
      
      fs.appendFileSync(logFile, logLine);
    } catch (error) {
      console.error('Failed to write log to file:', error.message);
    }
  }

  /**
   * Core log method
   */
  log(level, message, meta = {}) {
    if (!this.shouldLog(level)) return;

    const entry = this.formatJson(level, message, meta);

    // Console output
    if (this.enableConsole) {
      const consoleMsg = this.formatConsole(level, message, meta);
      
      if (level === 'error') {
        console.error(consoleMsg);
      } else if (level === 'warn') {
        console.warn(consoleMsg);
      } else {
        console.log(consoleMsg);
      }
    }

    // File output
    this.writeToFile(level, entry);
  }

  /**
   * Log error with stack trace
   */
  error(message, error = null, meta = {}) {
    const errorMeta = { ...meta };
    
    if (error instanceof Error) {
      errorMeta.error = {
        message: error.message,
        stack: error.stack,
        code: error.code
      };
    } else if (error) {
      errorMeta.error = error;
    }

    this.log('error', message, errorMeta);
  }

  /**
   * Log warning
   */
  warn(message, meta = {}) {
    this.log('warn', message, meta);
  }

  /**
   * Log info
   */
  info(message, meta = {}) {
    this.log('info', message, meta);
  }

  /**
   * Log debug
   */
  debug(message, meta = {}) {
    this.log('debug', message, meta);
  }

  /**
   * Log trace (very detailed)
   */
  trace(message, meta = {}) {
    this.log('trace', message, meta);
  }

  /**
   * Create child logger with additional context
   */
  child(meta = {}) {
    const childLogger = Object.create(this);
    childLogger.defaultMeta = { ...this.defaultMeta, ...meta };
    return childLogger;
  }

  /**
   * Set request ID for correlation
   */
  setRequestId(requestId) {
    this.requestId = requestId;
  }

  /**
   * Clear request ID
   */
  clearRequestId() {
    this.requestId = null;
  }
}

// Create default logger instance
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  console: true,
  file: process.env.NODE_ENV === 'production',
  serviceName: 'smart-coop-api'
});

/**
 * Express middleware for request logging
 */
export function requestLogger(req, res, next) {
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  req.requestId = requestId;
  req.logger = logger.child({ requestId });

  const startTime = Date.now();
  
  // Log incoming request
  req.logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  // Log response
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - startTime;
    
    req.logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });

    return originalSend.call(this, data);
  };

  next();
}

/**
 * Express middleware for error logging
 */
export function errorLogger(error, req, res, next) {
  const requestLogger = req.logger || logger;
  
  requestLogger.error('Request error', error, {
    method: req.method,
    path: req.path,
    statusCode: res.statusCode
  });

  next(error);
}

export default logger;
