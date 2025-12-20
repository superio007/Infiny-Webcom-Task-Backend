const request = require('supertest');
const express = require('express');
const { UploadController } = require('./index');

// Mock the services
jest.mock('../services', () => ({
  StorageService: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn(),
  })),
  JobManager: jest.fn().mockImplementation(() => ({
    createJob: jest.fn(),
  })),
}));

const { StorageService, JobManager } = require('../services');

describe('UploadController', () => {
  let app;
  let mockStorageService;
  let mockJobManager;

  beforeEach(() => {
    // Create Express app for testing
    app = express();
    app.use(express.json());

    // Set up the upload route
    app.post(
      '/api/statements/upload',
      UploadController.getUploadMiddleware(),
      UploadController.uploadStatement
    );

    // Error handling middleware
    app.use((err, req, res, next) => {
      if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({
          error: {
            code: 'INVALID_FILE_TYPE',
            message: err.message,
            timestamp: new Date().toISOString(),
          },
        });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'File size exceeds the maximum limit of 10MB',
            timestamp: new Date().toISOString(),
          },
        });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          error: {
            code: 'TOO_MANY_FILES',
            message: 'Only one file can be uploaded at a time',
            timestamp: new Date().toISOString(),
          },
        });
      }
      res.status(500).json({ error: 'Something went wrong!' });
    });

    // Reset mocks
    jest.clearAllMocks();

    // Set up mock instances
    mockStorageService = {
      uploadFile: jest.fn(),
    };
    mockJobManager = {
      createJob: jest.fn(),
    };

    StorageService.mockImplementation(() => mockStorageService);
    JobManager.mockImplementation(() => mockJobManager);
  });

  describe('POST /api/statements/upload', () => {
    test('should successfully upload a PDF file', async () => {
      // Mock successful upload and job creation
      mockStorageService.uploadFile.mockResolvedValue('test-uuid.pdf');
      mockJobManager.createJob.mockResolvedValue({
        jobId: 'test-job-id',
        fileName: 'test.pdf',
        s3Key: 'test-uuid.pdf',
        status: 'uploaded',
      });

      // Create a mock PDF buffer
      const pdfBuffer = Buffer.from('PDF content');

      const response = await request(app)
        .post('/api/statements/upload')
        .attach('file', pdfBuffer, {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        })
        .expect(200);

      expect(response.body).toEqual({
        jobId: 'test-job-id',
        fileName: 'test.pdf',
        status: 'uploaded',
      });

      expect(mockStorageService.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        'application/pdf',
        'test.pdf'
      );
      expect(mockJobManager.createJob).toHaveBeenCalledWith(
        'test.pdf',
        'test-uuid.pdf'
      );
    });

    test('should reject non-PDF files', async () => {
      const textBuffer = Buffer.from('Text content');

      const response = await request(app)
        .post('/api/statements/upload')
        .attach('file', textBuffer, {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(400);

      expect(response.body).toEqual({
        error: {
          code: 'INVALID_FILE_TYPE',
          message: 'Only PDF files are allowed',
          timestamp: expect.any(String),
        },
      });

      expect(mockStorageService.uploadFile).not.toHaveBeenCalled();
      expect(mockJobManager.createJob).not.toHaveBeenCalled();
    });

    test('should return error when no file is uploaded', async () => {
      const response = await request(app)
        .post('/api/statements/upload')
        .expect(400);

      expect(response.body).toEqual({
        error: {
          code: 'NO_FILE_UPLOADED',
          message: 'No file was uploaded',
          timestamp: expect.any(String),
        },
      });

      expect(mockStorageService.uploadFile).not.toHaveBeenCalled();
      expect(mockJobManager.createJob).not.toHaveBeenCalled();
    });

    test('should handle S3 upload errors', async () => {
      mockStorageService.uploadFile.mockRejectedValue(
        new Error('S3 upload failed')
      );

      const pdfBuffer = Buffer.from('PDF content');

      const response = await request(app)
        .post('/api/statements/upload')
        .attach('file', pdfBuffer, {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        })
        .expect(500);

      expect(response.body).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred during file upload',
          timestamp: expect.any(String),
        },
      });

      expect(mockStorageService.uploadFile).toHaveBeenCalled();
      expect(mockJobManager.createJob).not.toHaveBeenCalled();
    });

    test('should handle job creation errors', async () => {
      mockStorageService.uploadFile.mockResolvedValue('test-uuid.pdf');
      mockJobManager.createJob.mockRejectedValue(
        new Error('Job creation failed')
      );

      const pdfBuffer = Buffer.from('PDF content');

      const response = await request(app)
        .post('/api/statements/upload')
        .attach('file', pdfBuffer, {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        })
        .expect(500);

      expect(response.body).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred during file upload',
          timestamp: expect.any(String),
        },
      });

      expect(mockStorageService.uploadFile).toHaveBeenCalled();
      expect(mockJobManager.createJob).toHaveBeenCalled();
    });
  });

  describe('getUploadMiddleware', () => {
    test('should return multer middleware', () => {
      const middleware = UploadController.getUploadMiddleware();
      expect(typeof middleware).toBe('function');
    });
  });
});
