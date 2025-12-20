const request = require('supertest');
const express = require('express');
const ProcessingController = require('./processingController');
const { JobStatus } = require('../types');

// Mock the services
jest.mock('../services', () => ({
  StorageService: jest.fn().mockImplementation(() => ({
    getFile: jest.fn(),
  })),
  TextractService: jest.fn().mockImplementation(() => ({
    analyzeDocument: jest.fn(),
  })),
  GeminiService: jest.fn().mockImplementation(() => ({
    normalizeTextractData: jest.fn(),
  })),
  JobManager: jest.fn().mockImplementation(() => ({
    getJobResult: jest.fn(),
    updateJobStatus: jest.fn(),
  })),
}));

describe('ProcessingController', () => {
  let app;
  let processingController;
  let mockStorageService;
  let mockTextractService;
  let mockGeminiService;
  let mockJobManager;

  beforeEach(() => {
    // Create Express app for testing
    app = express();
    app.use(express.json());

    // Create controller instance
    processingController = new ProcessingController();

    // Get mock instances
    mockStorageService = processingController.storageService;
    mockTextractService = processingController.textractService;
    mockGeminiService = processingController.geminiService;
    mockJobManager = processingController.jobManager;

    // Set up route
    app.post('/api/statements/process/:jobId', (req, res) => {
      processingController.processStatement(req, res);
    });

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('POST /api/statements/process/:jobId', () => {
    const validJobId = 'test-job-id';
    const mockJob = {
      jobId: validJobId,
      fileName: 'test.pdf',
      s3Key: 'test-s3-key',
      status: JobStatus.UPLOADED,
    };

    const mockTextractResponse = {
      Blocks: [
        {
          BlockType: 'LINE',
          Text: 'Sample bank statement text',
          Confidence: 95.5,
        },
      ],
    };

    const mockNormalizedData = {
      fileName: 'test.pdf',
      accounts: [
        {
          bankName: 'Test Bank',
          accountHolderName: 'John Doe',
          accountNumber: '123456789',
          accountType: 'Savings',
          currency: 'USD',
          statementStartDate: '2024-01-01',
          statementEndDate: '2024-01-31',
          openingBalance: 1000.0,
          closingBalance: 1200.0,
          transactions: [
            {
              date: '2024-01-15',
              description: 'Test transaction',
              debit: null,
              credit: 200.0,
              balance: 1200.0,
            },
          ],
        },
      ],
    };

    it('should successfully process a valid job', async () => {
      // Mock successful pipeline
      mockJobManager.getJobResult.mockResolvedValue(mockJob);
      mockJobManager.updateJobStatus.mockResolvedValue();
      mockStorageService.getFile.mockResolvedValue(Buffer.from('pdf content'));
      mockTextractService.analyzeDocument.mockResolvedValue(
        mockTextractResponse
      );
      mockGeminiService.normalizeTextractData.mockResolvedValue(
        mockNormalizedData
      );

      const response = await request(app)
        .post(`/api/statements/process/${validJobId}`)
        .expect(200);

      expect(response.body).toEqual({
        jobId: validJobId,
        status: JobStatus.PROCESSED,
        accountsDetected: 1,
      });

      // Verify the pipeline was called correctly
      expect(mockJobManager.getJobResult).toHaveBeenCalledWith(validJobId);
      expect(mockJobManager.updateJobStatus).toHaveBeenCalledWith(
        validJobId,
        JobStatus.PROCESSING
      );
      expect(mockStorageService.getFile).toHaveBeenCalledWith(mockJob.s3Key);
      expect(mockTextractService.analyzeDocument).toHaveBeenCalledWith(
        mockJob.s3Key
      );
      expect(mockGeminiService.normalizeTextractData).toHaveBeenCalledWith(
        mockTextractResponse,
        mockJob.fileName
      );
      expect(mockJobManager.updateJobStatus).toHaveBeenCalledWith(
        validJobId,
        JobStatus.PROCESSED,
        {
          accountsDetected: 1,
          processedData: mockNormalizedData,
        }
      );
    });

    it('should return 400 for invalid jobId', async () => {
      const response = await request(app)
        .post('/api/statements/process/')
        .expect(404); // Express returns 404 for missing route params

      expect(mockJobManager.getJobResult).not.toHaveBeenCalled();
    });

    it('should return 404 for non-existent job', async () => {
      mockJobManager.getJobResult.mockRejectedValue(new Error('Job not found'));

      const response = await request(app)
        .post(`/api/statements/process/${validJobId}`)
        .expect(404);

      expect(response.body.error.code).toBe('JOB_NOT_FOUND');
      expect(response.body.error.message).toContain('Job not found');
    });

    it('should return 400 for job not in uploaded status', async () => {
      const processingJob = { ...mockJob, status: JobStatus.PROCESSING };
      mockJobManager.getJobResult.mockResolvedValue(processingJob);

      const response = await request(app)
        .post(`/api/statements/process/${validJobId}`)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_JOB_STATUS');
      expect(response.body.error.message).toContain('not in uploaded status');
    });

    it('should handle S3 retrieval errors', async () => {
      mockJobManager.getJobResult.mockResolvedValue(mockJob);
      mockJobManager.updateJobStatus.mockResolvedValue();
      mockStorageService.getFile.mockRejectedValue(new Error('S3 error'));

      const response = await request(app)
        .post(`/api/statements/process/${validJobId}`)
        .expect(500);

      expect(response.body.error.code).toBe('S3_RETRIEVAL_FAILED');
      expect(mockJobManager.updateJobStatus).toHaveBeenCalledWith(
        validJobId,
        JobStatus.PROCESSING
      );
      expect(mockJobManager.updateJobStatus).toHaveBeenCalledWith(
        validJobId,
        JobStatus.FAILED,
        {
          errorMessage: expect.stringContaining(
            'Failed to retrieve PDF from S3'
          ),
        }
      );
    });

    it('should handle Textract analysis errors', async () => {
      mockJobManager.getJobResult.mockResolvedValue(mockJob);
      mockJobManager.updateJobStatus.mockResolvedValue();
      mockStorageService.getFile.mockResolvedValue(Buffer.from('pdf content'));
      mockTextractService.analyzeDocument.mockRejectedValue(
        new Error('Textract error')
      );

      const response = await request(app)
        .post(`/api/statements/process/${validJobId}`)
        .expect(500);

      expect(response.body.error.code).toBe('TEXTRACT_ANALYSIS_FAILED');
      expect(mockJobManager.updateJobStatus).toHaveBeenCalledWith(
        validJobId,
        JobStatus.FAILED,
        {
          errorMessage: expect.stringContaining('Textract analysis failed'),
        }
      );
    });

    it('should handle Gemini normalization errors', async () => {
      mockJobManager.getJobResult.mockResolvedValue(mockJob);
      mockJobManager.updateJobStatus.mockResolvedValue();
      mockStorageService.getFile.mockResolvedValue(Buffer.from('pdf content'));
      mockTextractService.analyzeDocument.mockResolvedValue(
        mockTextractResponse
      );
      mockGeminiService.normalizeTextractData.mockRejectedValue(
        new Error('Gemini error')
      );

      const response = await request(app)
        .post(`/api/statements/process/${validJobId}`)
        .expect(500);

      expect(response.body.error.code).toBe('GEMINI_NORMALIZATION_FAILED');
      expect(mockJobManager.updateJobStatus).toHaveBeenCalledWith(
        validJobId,
        JobStatus.FAILED,
        {
          errorMessage: expect.stringContaining('Gemini normalization failed'),
        }
      );
    });

    it('should handle data validation errors', async () => {
      const invalidNormalizedData = {
        // Missing fileName
        accounts: [],
      };

      mockJobManager.getJobResult.mockResolvedValue(mockJob);
      mockJobManager.updateJobStatus.mockResolvedValue();
      mockStorageService.getFile.mockResolvedValue(Buffer.from('pdf content'));
      mockTextractService.analyzeDocument.mockResolvedValue(
        mockTextractResponse
      );
      mockGeminiService.normalizeTextractData.mockResolvedValue(
        invalidNormalizedData
      );

      const response = await request(app)
        .post(`/api/statements/process/${validJobId}`)
        .expect(500);

      expect(response.body.error.code).toBe('DATA_VALIDATION_FAILED');
      expect(mockJobManager.updateJobStatus).toHaveBeenCalledWith(
        validJobId,
        JobStatus.FAILED,
        {
          errorMessage: expect.stringContaining('Data validation failed'),
        }
      );
    });

    it('should validate debit/credit exclusivity', async () => {
      const invalidTransactionData = {
        fileName: 'test.pdf',
        accounts: [
          {
            bankName: 'Test Bank',
            accountHolderName: 'John Doe',
            accountNumber: '123456789',
            accountType: 'Savings',
            currency: 'USD',
            statementStartDate: '2024-01-01',
            statementEndDate: '2024-01-31',
            openingBalance: 1000.0,
            closingBalance: 1200.0,
            transactions: [
              {
                date: '2024-01-15',
                description: 'Invalid transaction',
                debit: 100.0, // Both debit and credit populated
                credit: 200.0,
                balance: 1200.0,
              },
            ],
          },
        ],
      };

      mockJobManager.getJobResult.mockResolvedValue(mockJob);
      mockJobManager.updateJobStatus.mockResolvedValue();
      mockStorageService.getFile.mockResolvedValue(Buffer.from('pdf content'));
      mockTextractService.analyzeDocument.mockResolvedValue(
        mockTextractResponse
      );
      mockGeminiService.normalizeTextractData.mockResolvedValue(
        invalidTransactionData
      );

      const response = await request(app)
        .post(`/api/statements/process/${validJobId}`)
        .expect(500);

      expect(response.body.error.code).toBe('DATA_VALIDATION_FAILED');
      expect(mockJobManager.updateJobStatus).toHaveBeenCalledWith(
        validJobId,
        JobStatus.FAILED,
        {
          errorMessage: expect.stringContaining(
            'cannot have both debit and credit values'
          ),
        }
      );
    });
  });
});
