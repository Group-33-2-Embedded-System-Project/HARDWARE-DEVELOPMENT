import logger from '../logger.js';

/**
 * Validation schemas for different request types
 */
const schemas = {
  login: {
    username: { type: 'string', minLength: 3, maxLength: 50, pattern: /^[a-zA-Z0-9_-]+$/ },
    password: { type: 'string', minLength: 8, maxLength: 100 }
  },
  refresh: {
    refreshToken: { type: 'string', minLength: 10, maxLength: 1024 }
  },
  deterrent: {
    action: { type: 'string', enum: ['trigger'] }
  },
  arm: {
    mode: { type: 'string', enum: ['auto', 'on', 'off'] }
  },
  commands: {
    limit: { type: 'number', min: 1, max: 100, optional: true }
  },
  deviceMessages: {
    limit: { type: 'number', min: 1, max: 200, optional: true }
  },
  events: {
    limit: { type: 'number', min: 1, max: 1000, optional: true }
  },
  statusHistory: {
    field: { type: 'string', enum: ['pir', 'light', 'armed', 'online'], optional: true },
    limit: { type: 'number', min: 1, max: 1000, optional: true }
  },
  pushSubscription: {
    endpoint: { type: 'string', maxLength: 500 },
    keys: { type: 'object' }
  }
};

/**
 * Sanitize string input
 */
function sanitizeString(value, maxLength = 1000) {
  if (typeof value !== 'string') return null;
  
  // Remove null bytes
  let sanitized = value.replace(/\0/g, '');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

/**
 * Validate field against schema
 */
function validateField(fieldName, value, schema) {
  const errors = [];
  
  // Check if field is optional and undefined
  if (schema.optional && (value === undefined || value === null)) {
    return { valid: true, sanitized: value };
  }
  
  // Check required fields
  if (!schema.optional && (value === undefined || value === null)) {
    errors.push(`${fieldName} is required`);
    return { valid: false, errors };
  }
  
  // Type validation
  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${fieldName} must be a string`);
      return { valid: false, errors };
    }
    
    const sanitized = sanitizeString(value, schema.maxLength);
    
    if (schema.minLength && sanitized.length < schema.minLength) {
      errors.push(`${fieldName} must be at least ${schema.minLength} characters`);
    }
    
    if (schema.maxLength && sanitized.length > schema.maxLength) {
      errors.push(`${fieldName} must be at most ${schema.maxLength} characters`);
    }
    
    if (schema.pattern && !schema.pattern.test(sanitized)) {
      errors.push(`${fieldName} contains invalid characters`);
    }
    
    if (schema.enum && !schema.enum.includes(sanitized)) {
      errors.push(`${fieldName} must be one of: ${schema.enum.join(', ')}`);
    }
    
    return errors.length === 0 
      ? { valid: true, sanitized } 
      : { valid: false, errors };
  }
  
  if (schema.type === 'number') {
    const num = Number(value);
    
    if (isNaN(num)) {
      errors.push(`${fieldName} must be a number`);
      return { valid: false, errors };
    }
    
    if (schema.min !== undefined && num < schema.min) {
      errors.push(`${fieldName} must be at least ${schema.min}`);
    }
    
    if (schema.max !== undefined && num > schema.max) {
      errors.push(`${fieldName} must be at most ${schema.max}`);
    }
    
    return errors.length === 0 
      ? { valid: true, sanitized: num } 
      : { valid: false, errors };
  }
  
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${fieldName} must be an object`);
      return { valid: false, errors };
    }
    
    return { valid: true, sanitized: value };
  }
  
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${fieldName} must be an array`);
      return { valid: false, errors };
    }
    
    if (schema.maxItems && value.length > schema.maxItems) {
      errors.push(`${fieldName} must have at most ${schema.maxItems} items`);
    }
    
    return { valid: true, sanitized: value };
  }
  
  return { valid: true, sanitized: value };
}

/**
 * Validate request body against schema
 */
export function validateBody(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    
    if (!schema) {
      logger.error('Unknown validation schema', null, { schemaName });
      return res.status(500).json({ error: 'Internal validation error' });
    }
    
    const errors = [];
    const sanitized = {};
    
    // Validate each field in schema
    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
      const value = req.body?.[fieldName];
      const result = validateField(fieldName, value, fieldSchema);
      
      if (!result.valid) {
        errors.push(...result.errors);
      } else if (result.sanitized !== undefined) {
        sanitized[fieldName] = result.sanitized;
      }
    }
    
    // Check for unexpected fields
    if (req.body) {
      for (const fieldName of Object.keys(req.body)) {
        if (!schema[fieldName]) {
          logger.warn('Unexpected field in request body', {
            field: fieldName,
            schema: schemaName
          });
        }
      }
    }
    
    if (errors.length > 0) {
      logger.warn('Request validation failed', {
        schema: schemaName,
        errors,
        path: req.path
      });
      return res.status(400).json({ error: errors[0], details: errors });
    }
    
    // Replace body with sanitized version
    req.body = sanitized;
    next();
  };
}

/**
 * Validate query parameters
 */
export function validateQuery(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    
    if (!schema) {
      logger.error('Unknown validation schema', null, { schemaName });
      return res.status(500).json({ error: 'Internal validation error' });
    }
    
    const errors = [];
    const sanitized = {};
    
    // Validate each field in schema
    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
      const value = req.query?.[fieldName];
      const result = validateField(fieldName, value, fieldSchema);
      
      if (!result.valid) {
        errors.push(...result.errors);
      } else if (result.sanitized !== undefined) {
        sanitized[fieldName] = result.sanitized;
      }
    }
    
    if (errors.length > 0) {
      logger.warn('Query validation failed', {
        schema: schemaName,
        errors,
        path: req.path
      });
      return res.status(400).json({ error: errors[0], details: errors });
    }
    
    // Replace query with sanitized version
    req.query = sanitized;
    next();
  };
}

/**
 * Sanitize all string fields in request body recursively
 */
export function sanitizeBody(req, res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return next();
  }
  
  function sanitizeObject(obj, depth = 0) {
    // Prevent deep recursion
    if (depth > 10) return obj;
    
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        obj[key] = sanitizeString(obj[key]);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key], depth + 1);
      }
    }
    
    return obj;
  }
  
  req.body = sanitizeObject(req.body);
  next();
}

/**
 * Content-Type validation middleware
 */
export function requireJson(req, res, next) {
  const contentType = req.get('content-type');
  
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (!contentType || !contentType.includes('application/json')) {
      logger.warn('Invalid Content-Type', {
        contentType,
        method: req.method,
        path: req.path
      });
      return res.status(415).json({ error: 'Content-Type must be application/json' });
    }
  }
  
  next();
}

/**
 * Request size validation
 */
export function validateRequestSize(maxSize = 32 * 1024) { // 32KB default
  return (req, res, next) => {
    const contentLength = req.get('content-length');
    
    if (contentLength && parseInt(contentLength) > maxSize) {
      logger.warn('Request too large', {
        contentLength: parseInt(contentLength),
        maxSize,
        path: req.path
      });
      return res.status(413).json({ error: 'Request body too large' });
    }
    
    next();
  };
}

/**
 * Prevent parameter pollution
 */
export function preventParameterPollution(req, res, next) {
  // Check for duplicate query parameters
  const queryKeys = Object.keys(req.query);
  const seen = new Set();
  
  for (const key of queryKeys) {
    if (seen.has(key)) {
      logger.warn('Parameter pollution detected', {
        parameter: key,
        path: req.path
      });
      return res.status(400).json({ error: 'Duplicate parameters not allowed' });
    }
    seen.add(key);
  }
  
  next();
}
