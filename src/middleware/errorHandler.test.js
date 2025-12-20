const request = require('supertest');
const express = require('express');
const {
  AppError,
  errorHandlerMiddleware,
  asyncErrorHandler,
  notFoundHandler,
  sanitizeErrorData,
} = require('./errorHandler');

describe('Error Handling Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('AppError', () => {
    it('should create an operational error', () => {
      const error = new AppError('Test error', 400, 'TEST_ERROR');

      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('TEST_ERROR');
      expect(error.isOperational).toBe(true);
    });
  });

  describe('sanitizeErrorData', () => {
    it('should redact sensitive fields', () => {
      const data = {
        username: 'john',
        password: 'secret123',
        accountNumber: '123456789',
        balance: 1000,
        normalField: 'safe data',
      };

      const sanitized = sanitizeErrorData(data);

      expect(sanitized.username).toBe('john');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.accountNumber).toBe('[REDACTED]');
      expect(sanitized.balance).toBe('[REDACTED]');
      expect(sanitized.normalField).toBe('safe data');
    });

    it('should handle nested objects', () => {
      const data = {
        user: {
          name: 'john',
          password: 'secret',
        },
        transaction: {
          amount: 100,
          debit: 50,
        },
      };

      const sanitized = sanitizeErrorData(data);

      expect(sanitized.user.name).toBe('john');
      expect(sanitized.user.password).toBe('[REDACTED]');
      expect(sanitized.transaction.amount).toBe(100);
      expect(sanitized.transaction.debit).toBe('[REDACTED]');
    });
  });

  describe('errorHandlerMiddleware', () => {
    it('should handle AppError correctly', async () => {
      app.get('/test', (req, res, next) => {
        next(new AppError('Test error', 400, 'TEST_ERROR'));
      });
      app.use(errorHandlerMiddleware);

      const response = await request(app).get('/test').expect(400);

      expect(response.body).toMatchObject({
        error: {
          code: 'TEST_ERROR',
          message: 'Test error',
          timestamp: expect.any(String),
        },
      });
    });

    it('should handle validation errors', async () => {
      app.get('/test', (req, res, next) => {
        const error = new Error('Validation failed');
        error.isJoi = true;
        error.details = [
          {
            path: ['field'],
            message: 'Field is required',
          },
        ];
        next(error);
      });
      app.use(errorHandlerMiddleware);

      const response = await request(app).get('/test').expect(400);

      expect(response.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Input validation failed',
          details: {
            validationErrors: [
              {
                field: 'field',
                message: 'Field is required',
              },
            ],
          },
        },
      });
    });

    it('should handle multer file size errors', async () => {
      app.get('/test', (req, res, next) => {
        const error = new Error('File too large');
        error.code = 'LIMIT_FILE_SIZE';
        next(error);
      });
      app.use(errorHandlerMiddleware);

      const response = await request(app).get('/test').expect(400);

      expect(response.body).toMatchObject({
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'File size exceeds the maximum limit of 10MB',
        },
      });
    });

    it('should handle generic errors', async () => {
      app.get('/test', (req, res, next) => {
        next(new Error('Generic error'));
      });
      app.use(errorHandlerMiddleware);

      const response = await request(app).get('/test').expect(500);

      expect(response.body).toMatchObject({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    });
  });

  describe('asyncErrorHandler', () => {
    it('should catch async errors', async () => {
      const asyncRoute = asyncErrorHandler(async (req, res, next) => {
        throw new AppError('Async error', 400, 'ASYNC_ERROR');
      });

      app.get('/test', asyncRoute);
      app.use(errorHandlerMiddleware);

      const response = await request(app).get('/test').expect(400);

      expect(response.body).toMatchObject({
        error: {
          code: 'ASYNC_ERROR',
          message: 'Async error',
        },
      });
    });
  });

  describe('notFoundHandler', () => {
    it('should return 404 for unknown routes', async () => {
      app.use(notFoundHandler);

      const response = await request(app).get('/unknown').expect(404);

      expect(response.body).toMatchObject({
        error: 'Route not found',
      });
    });
  });
});
