/**
 * Middleware exports
 * Centralized export for all middleware components
 */

const {
  AppError,
  errorHandlerMiddleware,
  asyncErrorHandler,
  apiNotFoundHandler,
  notFoundHandler,
  sanitizeErrorData,
  logError,
} = require('./errorHandler');

const {
  validators,
  validateRequest,
  sanitizeRequest,
  basicRateLimit,
  schemas,
} = require('./validation');

const {
  validateExternalServiceAuth,
  securityHeaders,
  secureRequestLogger,
  fileUploadSecurity,
  configureCORS,
  initializeSecurity,
  requestTracing,
  secureHealthCheck,
} = require('./security');

module.exports = {
  // Error handling
  AppError,
  errorHandlerMiddleware,
  asyncErrorHandler,
  apiNotFoundHandler,
  notFoundHandler,
  sanitizeErrorData,
  logError,

  // Validation
  validators,
  validateRequest,
  sanitizeRequest,
  basicRateLimit,
  schemas,

  // Security
  validateExternalServiceAuth,
  securityHeaders,
  secureRequestLogger,
  fileUploadSecurity,
  configureCORS,
  initializeSecurity,
  requestTracing,
  secureHealthCheck,
};
