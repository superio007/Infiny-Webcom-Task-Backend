// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const {
  UploadController,
  ProcessingController,
  ResultsController,
  CleanupController,
} = require('./controllers');
const {
  errorHandlerMiddleware,
  asyncErrorHandler,
  apiNotFoundHandler,
  notFoundHandler,
  securityHeaders,
  secureRequestLogger,
  fileUploadSecurity,
  configureCORS,
  initializeSecurity,
  requestTracing,
  secureHealthCheck,
  validators,
  sanitizeRequest,
  basicRateLimit,
} = require('./middleware');
const { cleanup } = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize security configuration
if (process.env.NODE_ENV !== 'test') {
  try {
    initializeSecurity();
  } catch (error) {
    console.error('Failed to initialize security:', error.message);
    process.exit(1);
  }
}

// Security middleware (applied first)
app.use(requestTracing);

// Helmet for additional security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ['\'self\''],
        scriptSrc: ['\'self\''],
        styleSrc: ['\'self\'', '\'unsafe-inline\''],
        imgSrc: ['\'self\'', 'data:'],
        connectSrc: ['\'self\''],
        fontSrc: ['\'self\''],
        objectSrc: ['\'none\''],
        mediaSrc: ['\'self\''],
        frameSrc: ['\'none\''],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow file uploads
  })
);

// Custom security headers (additional to helmet)
app.use(securityHeaders);

// Compression middleware for better performance
app.use(
  compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
    threshold: 1024, // Only compress responses larger than 1KB
  })
);

// Request logging with Morgan (production-ready logging)
if (process.env.NODE_ENV === 'production') {
  app.use(
    morgan('combined', {
      skip: (req, res) => res.statusCode < 400, // Only log errors in production
    })
  );
} else {
  app.use(morgan('dev'));
}

// Custom secure request logger (for additional security logging)
app.use(secureRequestLogger);

// CORS configuration
app.use(cors(configureCORS()));

// Basic rate limiting
app.use(basicRateLimit(100, 15 * 60 * 1000)); // 100 requests per 15 minutes

// Body parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request sanitization
app.use(sanitizeRequest);

// Secure health check endpoint
app.get('/health', asyncErrorHandler(secureHealthCheck));

// API documentation endpoint (development only)
if (process.env.NODE_ENV !== 'production') {
  app.get('/api', (req, res) => {
    res.json({
      name: 'Bank Statement API Backend',
      version: process.env.npm_package_version || '1.0.0',
      description:
        'Production-grade API backend for processing bank statement PDFs',
      endpoints: {
        upload: 'POST /api/statements/upload - Upload PDF file',
        process: 'POST /api/statements/process/:jobId - Process uploaded PDF',
        result: 'GET /api/statements/result/:jobId - Get processing results',
        health: 'GET /health - Health check',
        admin: {
          cleanup_status: 'GET /api/admin/cleanup/status - Get cleanup status',
          run_cleanup: 'POST /api/admin/cleanup/run - Run cleanup manually',
          cleanup_job:
            'DELETE /api/admin/cleanup/job/:jobId - Cleanup specific job',
          cleanup_failed:
            'POST /api/admin/cleanup/failed-jobs - Cleanup failed jobs',
          cleanup_completed:
            'POST /api/admin/cleanup/completed-jobs - Cleanup completed jobs',
        },
      },
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });
}

// Upload endpoint with comprehensive validation and security
app.post(
  '/api/statements/upload',
  UploadController.getUploadMiddleware(),
  fileUploadSecurity,
  validators.uploadStatement,
  asyncErrorHandler(UploadController.uploadStatement)
);

// Processing endpoint with validation
app.post(
  '/api/statements/process/:jobId',
  validators.processStatement,
  asyncErrorHandler(async (req, res) => {
    const processingController = new ProcessingController();
    await processingController.processStatement(req, res);
  })
);

// Results endpoint with validation
app.get(
  '/api/statements/result/:jobId',
  validators.getResult,
  asyncErrorHandler(async (req, res) => {
    const resultsController = new ResultsController();
    await resultsController.getResult(req, res);
  })
);

// Admin cleanup endpoints (for monitoring and manual cleanup)
app.get(
  '/api/admin/cleanup/status',
  asyncErrorHandler(CleanupController.getStatus)
);

app.post(
  '/api/admin/cleanup/run',
  asyncErrorHandler(CleanupController.runCleanup)
);

app.delete(
  '/api/admin/cleanup/job/:jobId',
  asyncErrorHandler(CleanupController.cleanupJob)
);

app.post(
  '/api/admin/cleanup/failed-jobs',
  asyncErrorHandler(CleanupController.cleanupFailedJobs)
);

app.post(
  '/api/admin/cleanup/completed-jobs',
  asyncErrorHandler(CleanupController.cleanupCompletedJobs)
);

// 404 handler for unknown API routes
app.use('/api', apiNotFoundHandler);

// Global 404 handler
app.use(notFoundHandler);

// Centralized error handling middleware (must be last)
app.use(errorHandlerMiddleware);

// Start server only if this file is run directly
if (require.main === module) {
  const server = app.listen(PORT, async () => {
    console.log('🚀 Bank Statement API Backend started successfully');
    console.log(`📍 Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);

    if (process.env.NODE_ENV !== 'production') {
      console.log(`📖 API documentation: http://localhost:${PORT}/api`);
    }

    // Initialize cleanup service
    try {
      await cleanup.initializeCleanup();
      console.log('🧹 Cleanup service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize cleanup service:', error.message);
    }
  });

  // Configure server timeouts for long-running operations
  server.timeout = parseInt(process.env.REQUEST_TIMEOUT_MS) || 180000; // 3 minutes
  server.keepAliveTimeout = 65000; // 65 seconds
  server.headersTimeout = 66000; // 66 seconds (must be greater than keepAliveTimeout)
  
  console.log(`⏱️ Server timeout configured: ${server.timeout}ms`);

  // Setup graceful shutdown handlers
  cleanup.setupGracefulShutdown();

  // Handle server shutdown
  const originalClose = server.close.bind(server);
  server.close = function (callback) {
    console.log('🔄 Shutting down server gracefully...');

    cleanup
      .shutdownCleanup()
      .then(() => {
        console.log('✅ Cleanup service shutdown completed');
        originalClose(callback);
      })
      .catch((error) => {
        console.error('❌ Error during cleanup shutdown:', error.message);
        originalClose(callback);
      });
  };
}

module.exports = app;
