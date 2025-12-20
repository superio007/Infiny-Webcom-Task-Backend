/**
 * Security middleware for secure authentication and data protection
 * Requirements: 8.4 - Secure authentication for external services
 * Requirements: 8.2 - Sensitive data protection
 */

/**
 * Validate environment variables for external service authentication
 * Requirements: 8.4 - Secure external authentication
 */
function validateExternalServiceAuth() {
  const requiredEnvVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'S3_BUCKET_NAME',
    'GEMINI_API_KEY',
  ];

  const missing = requiredEnvVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for external service authentication: ${missing.join(
        ', '
      )}`
    );
  }

  // Validate AWS credentials format
  if (
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_ACCESS_KEY_ID.length < 16
  ) {
    throw new Error('AWS_ACCESS_KEY_ID appears to be invalid');
  }

  if (
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_SECRET_ACCESS_KEY.length < 32
  ) {
    throw new Error('AWS_SECRET_ACCESS_KEY appears to be invalid');
  }

  // Validate Gemini API key format
  if (
    process.env.GEMINI_API_KEY &&
    !process.env.GEMINI_API_KEY.startsWith('AIza')
  ) {
    console.warn(
      'GEMINI_API_KEY format may be incorrect - expected to start with \'AIza\''
    );
  }
}

/**
 * Security headers middleware
 * Adds security headers to all responses
 */
function securityHeaders(req, res, next) {
  // Remove server information
  res.removeHeader('X-Powered-By');

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=()'
  );

  // Content Security Policy
  res.setHeader(
    'Content-Security-Policy',
    'default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'self\''
  );

  next();
}

/**
 * Request logging middleware with sensitive data protection
 * Requirements: 8.2 - Never log sensitive information
 */
function secureRequestLogger(req, res, next) {
  const startTime = Date.now();

  // Sanitize request data for logging
  const sanitizeForLogging = (obj) => {
    if (!obj || typeof obj !== 'object') {return obj;}

    const sensitiveFields = [
      'password',
      'token',
      'apiKey',
      'secret',
      'authorization',
      'cookie',
      'accountNumber',
      'balance',
      'debit',
      'credit',
      'openingBalance',
      'closingBalance',
    ];

    const sanitized = { ...obj };

    Object.keys(sanitized).forEach((key) => {
      const lowerKey = key.toLowerCase();
      if (sensitiveFields.some((field) => lowerKey.includes(field))) {
        sanitized[key] = '[REDACTED]';
      } else if (
        typeof sanitized[key] === 'object' &&
        sanitized[key] !== null
      ) {
        sanitized[key] = sanitizeForLogging(sanitized[key]);
      }
    });

    return sanitized;
  };

  // Log request (without sensitive data)
  const requestLog = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    jobId: req.params?.jobId || null,
    body: req.body ? sanitizeForLogging(req.body) : undefined,
    query:
      Object.keys(req.query).length > 0
        ? sanitizeForLogging(req.query)
        : undefined,
  };

  console.log('Request:', JSON.stringify(requestLog));

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const responseLog = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      jobId: req.params?.jobId || null,
    };

    console.log('Response:', JSON.stringify(responseLog));
  });

  next();
}

/**
 * File upload security middleware
 * Additional security checks for file uploads
 */
function fileUploadSecurity(req, res, next) {
  if (req.file) {
    // Check file size again (defense in depth)
    if (req.file.size > 10 * 1024 * 1024) {
      const error = new Error('File size exceeds maximum limit');
      error.code = 'LIMIT_FILE_SIZE';
      return next(error);
    }

    // Verify PDF magic bytes (additional validation)
    if (req.file.buffer && req.file.buffer.length >= 4) {
      const magicBytes = req.file.buffer.slice(0, 4).toString();
      if (!magicBytes.startsWith('%PDF')) {
        const error = new Error('File does not appear to be a valid PDF');
        error.code = 'INVALID_FILE_TYPE';
        return next(error);
      }
    }

    // Sanitize filename
    if (req.file.originalname) {
      req.file.originalname = req.file.originalname
        .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace special chars with underscore
        .substring(0, 255); // Limit length
    }
  }

  next();
}

/**
 * CORS configuration for production security
 */
function configureCORS() {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:5173']; // Default for development

  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) {return callback(null, true);}

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // 24 hours
  };
}

/**
 * Initialize security middleware and validate configuration
 */
function initializeSecurity() {
  try {
    validateExternalServiceAuth();
    console.log('External service authentication validated successfully');
  } catch (error) {
    console.error('Security initialization failed:', error.message);
    throw error;
  }
}

/**
 * Middleware to add request ID for tracing
 */
function requestTracing(req, res, next) {
  // Generate a unique request ID for tracing
  req.requestId = `req_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

/**
 * Health check security - limit information exposure
 */
async function secureHealthCheck(req, res) {
  const startTime = Date.now();

  // Basic health status
  const healthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime: Math.floor(process.uptime()),
  };

  // In production, don't expose detailed system info
  if (process.env.NODE_ENV !== 'production') {
    healthStatus.environment = process.env.NODE_ENV;
    healthStatus.nodeVersion = process.version;
    healthStatus.memory = {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    };
  }

  // Check external service connectivity (basic checks)
  const services = {};

  try {
    // Check AWS credentials are configured
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      services.aws = 'configured';
    } else {
      services.aws = 'not_configured';
    }

    // Check Gemini API key is configured
    if (process.env.GEMINI_API_KEY) {
      services.gemini = 'configured';
    } else {
      services.gemini = 'not_configured';
    }

    // Check S3 bucket is configured
    if (process.env.S3_BUCKET_NAME) {
      services.s3_bucket = 'configured';
    } else {
      services.s3_bucket = 'not_configured';
    }

    healthStatus.services = services;
  } catch (error) {
    healthStatus.status = 'degraded';
    healthStatus.services = { error: 'service_check_failed' };
  }

  // Calculate response time
  healthStatus.responseTime = Date.now() - startTime;

  // Set appropriate status code
  const statusCode = healthStatus.status === 'healthy' ? 200 : 503;

  res.status(statusCode).json(healthStatus);
}

module.exports = {
  validateExternalServiceAuth,
  securityHeaders,
  secureRequestLogger,
  fileUploadSecurity,
  configureCORS,
  initializeSecurity,
  requestTracing,
  secureHealthCheck,
};
