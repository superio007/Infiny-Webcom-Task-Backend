const { ErrorResponse } = require('../types');

/**
 * Centralized error handling middleware
 * Implements consistent HTTP status codes and error messages
 * Requirements: 7.1, 8.2, 8.3
 */

/**
 * Custom error class for application-specific errors
 */
class AppError extends Error {
  constructor(message, statusCode, code = null, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Sanitize error data to prevent sensitive information exposure
 * Requirements: 8.2 - Sensitive data protection
 */
function sanitizeErrorData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeErrorData(item));
  }

  const sensitiveFields = [
    'password',
    'token',
    'apikey',
    'secret',
    'authorization',
    'cookie',
    'session',
    'accountnumber',
    'balance',
    'debit',
    'credit',
    'openingbalance',
    'closingbalance',
  ];

  const sanitized = { ...data };

  // Recursively sanitize nested objects
  Object.keys(sanitized).forEach((key) => {
    const lowerKey = key.toLowerCase();

    // Remove sensitive fields - exact match only
    if (sensitiveFields.includes(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeErrorData(sanitized[key]);
    }
  });

  return sanitized;
}

/**
 * Log error with sensitive data protection
 * Requirements: 8.2 - Never log raw financial information
 */
function logError(error, req = null, additionalContext = {}) {
  const timestamp = new Date().toISOString();
  const sanitizedContext = sanitizeErrorData(additionalContext);

  const logData = {
    timestamp,
    error: {
      message: error.message,
      code: error.code || 'UNKNOWN_ERROR',
      statusCode: error.statusCode || 500,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    },
    request: req
      ? {
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        jobId: req.params?.jobId || req.body?.jobId || null,
      }
      : null,
    context: sanitizedContext,
  };

  // Remove sensitive data from request body/query
  if (req) {
    logData.request.body = sanitizeErrorData(req.body);
    logData.request.query = sanitizeErrorData(req.query);
  }

  console.error('Application Error:', JSON.stringify(logData, null, 2));
}

/**
 * Handle different types of errors and map to appropriate HTTP responses
 */
function handleError(error, req) {
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred';
  let details = null;

  // Handle operational errors (known application errors)
  if (error.isOperational) {
    statusCode = error.statusCode;
    code = error.code || 'APPLICATION_ERROR';
    message = error.message;
    details = error.details;
  }
  // Handle validation errors (Joi, custom validation)
  else if (error.name === 'ValidationError' || error.isJoi) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Input validation failed';
    details = {
      validationErrors: error.details?.map((detail) => ({
        field: detail.path?.join('.'),
        message: detail.message,
      })) || [{ message: error.message }],
    };
  }
  // Handle multer errors (file upload)
  else if (error.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    code = 'FILE_TOO_LARGE';
    message = 'File size exceeds the maximum limit of 10MB';
  } else if (error.code === 'LIMIT_FILE_COUNT') {
    statusCode = 400;
    code = 'TOO_MANY_FILES';
    message = 'Only one file can be uploaded at a time';
  } else if (error.code === 'INVALID_FILE_TYPE') {
    statusCode = 400;
    code = 'INVALID_FILE_TYPE';
    message = error.message || 'Invalid file type';
  }
  // Handle AWS SDK errors
  else if (error.name?.includes('S3') || error.$metadata) {
    statusCode = 500;
    code = 'EXTERNAL_SERVICE_ERROR';
    message = 'External service temporarily unavailable';
    details = {
      service: 'AWS',
      retryable: error.$retryable || false,
    };
  }
  // Handle Google Gemini API errors
  else if (error.message?.includes('Gemini') || error.status) {
    statusCode = 500;
    code = 'AI_SERVICE_ERROR';
    message = 'AI service temporarily unavailable';
    details = {
      service: 'Gemini',
      retryable: true,
    };
  }
  // Handle database errors
  else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    statusCode = 503;
    code = 'SERVICE_UNAVAILABLE';
    message = 'Service temporarily unavailable';
  }
  // Handle timeout errors
  else if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
    statusCode = 408;
    code = 'REQUEST_TIMEOUT';
    message = 'Request timeout';
  }
  // Handle JSON parsing errors
  else if (error instanceof SyntaxError && error.message.includes('JSON')) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Invalid JSON in request body';
  }

  return {
    statusCode,
    errorResponse: new ErrorResponse({
      code,
      message,
      details: sanitizeErrorData(details),
      jobId: req.params?.jobId || req.body?.jobId || null,
    }),
  };
}

/**
 * Express error handling middleware
 * Requirements: 7.1 - Appropriate HTTP status codes and error messages
 */
function errorHandlerMiddleware(error, req, res, next) {
  // Log the error with context
  logError(error, req);

  // Handle the error and get appropriate response
  const { statusCode, errorResponse } = handleError(error, req);

  // Send error response
  res.status(statusCode).json(errorResponse);
}

/**
 * Async error wrapper to catch async errors in route handlers
 */
function asyncErrorHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 404 Not Found handler for API routes
 */
function apiNotFoundHandler(req, res) {
  res.status(404).json({
    error: 'API endpoint not found',
  });
}

/**
 * 404 Not Found handler for general routes
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Route not found',
  });
}

module.exports = {
  AppError,
  errorHandlerMiddleware,
  asyncErrorHandler,
  apiNotFoundHandler,
  notFoundHandler,
  sanitizeErrorData,
  logError,
};
