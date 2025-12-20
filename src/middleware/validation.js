const Joi = require('joi');
const { AppError } = require('./errorHandler');

/**
 * Input validation middleware for comprehensive request validation
 * Requirements: 8.3 - Validate all input parameters and file types
 */

/**
 * Common validation schemas
 */

// Define jobId schema separately to avoid circular reference
const jobIdSchema = Joi.string()
  .uuid({ version: 'uuidv4' })
  .required()
  .messages({
    'string.guid': 'jobId must be a valid UUID',
    'any.required': 'jobId is required',
  });

const schemas = {
  // UUID validation for jobId parameters
  jobId: jobIdSchema,

  // File upload validation
  fileUpload: {
    body: Joi.object({
      // Allow any additional fields that multer might add
    }).unknown(true),
    file: Joi.object({
      fieldname: Joi.string().valid('file').required(),
      originalname: Joi.string().required(),
      encoding: Joi.string().required(),
      mimetype: Joi.string().valid('application/pdf').required().messages({
        'any.only': 'Only PDF files are allowed',
      }),
      size: Joi.number()
        .max(10 * 1024 * 1024)
        .required()
        .messages({
          'number.max': 'File size must not exceed 10MB',
        }),
      buffer: Joi.binary().required(),
    })
      .required()
      .messages({
        'any.required': 'File is required',
      }),
  },

  // Processing request validation
  processRequest: {
    params: Joi.object({
      jobId: jobIdSchema,
    }),
    body: Joi.object({}).unknown(false), // No body expected
    query: Joi.object({}).unknown(false), // No query params expected
  },

  // Results request validation
  resultsRequest: {
    params: Joi.object({
      jobId: jobIdSchema,
    }),
    body: Joi.object({}).unknown(false), // No body expected
    query: Joi.object({}).unknown(false), // No query params expected
  },
};

/**
 * Generic validation middleware factory
 */
function validateRequest(schema) {
  return (req, res, next) => {
    const validationErrors = [];

    // Validate params
    if (schema.params) {
      const { error } = schema.params.validate(req.params);
      if (error) {
        validationErrors.push({
          location: 'params',
          details: error.details,
        });
      }
    }

    // Validate query
    if (schema.query) {
      const { error } = schema.query.validate(req.query);
      if (error) {
        validationErrors.push({
          location: 'query',
          details: error.details,
        });
      }
    }

    // Validate body
    if (schema.body) {
      const { error } = schema.body.validate(req.body);
      if (error) {
        validationErrors.push({
          location: 'body',
          details: error.details,
        });
      }
    }

    // Validate file (for upload endpoints)
    if (schema.file && req.file) {
      const { error } = schema.file.validate(req.file);
      if (error) {
        validationErrors.push({
          location: 'file',
          details: error.details,
        });
      }
    } else if (schema.file && !req.file) {
      validationErrors.push({
        location: 'file',
        details: [{ message: 'File is required' }],
      });
    }

    // If there are validation errors, throw an error
    if (validationErrors.length > 0) {
      const errorDetails = validationErrors.flatMap((error) =>
        error.details.map((detail) => ({
          location: error.location,
          field: detail.path?.join('.') || detail.context?.key,
          message: detail.message,
        }))
      );

      throw new AppError('Request validation failed', 400, 'VALIDATION_ERROR', {
        validationErrors: errorDetails,
      });
    }

    next();
  };
}

/**
 * Specific validation middleware for different endpoints
 */
const validators = {
  // Upload endpoint validation
  uploadStatement: validateRequest(schemas.fileUpload),

  // Processing endpoint validation
  processStatement: validateRequest(schemas.processRequest),

  // Results endpoint validation
  getResult: validateRequest(schemas.resultsRequest),
};

/**
 * Sanitize request data to prevent injection attacks
 * Requirements: 8.3 - Input validation and sanitization
 */
function sanitizeRequest(req, res, next) {
  // Sanitize string inputs to prevent basic injection attacks
  const sanitizeString = (str) => {
    if (typeof str !== 'string') {return str;}

    // Remove potentially dangerous characters
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .trim();
  };

  // Recursively sanitize object properties
  const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') {return obj;}

    const sanitized = Array.isArray(obj) ? [] : {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];

        if (typeof value === 'string') {
          sanitized[key] = sanitizeString(value);
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  };

  // Sanitize request body, query, and params
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
}

/**
 * Rate limiting validation (basic implementation)
 * Can be enhanced with Redis for production use
 */
const requestCounts = new Map();

function basicRateLimit(maxRequests = 100, windowMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    const clientId = req.ip || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    for (const [id, requests] of requestCounts.entries()) {
      const filteredRequests = requests.filter((time) => time > windowStart);
      if (filteredRequests.length === 0) {
        requestCounts.delete(id);
      } else {
        requestCounts.set(id, filteredRequests);
      }
    }

    // Check current client's requests
    const clientRequests = requestCounts.get(clientId) || [];
    const recentRequests = clientRequests.filter((time) => time > windowStart);

    if (recentRequests.length >= maxRequests) {
      throw new AppError('Too many requests', 429, 'RATE_LIMIT_EXCEEDED', {
        limit: maxRequests,
        windowMs,
        retryAfter: Math.ceil(windowMs / 1000),
      });
    }

    // Add current request
    recentRequests.push(now);
    requestCounts.set(clientId, recentRequests);

    next();
  };
}

module.exports = {
  validators,
  validateRequest,
  sanitizeRequest,
  basicRateLimit,
  schemas,
};
