const ResultsController = require('./resultsController');
const JobManager = require('../services/jobManager');
const {
  JobStatus,
  BankStatementData,
  BankAccount,
  Transaction,
} = require('../types');

// Mock JobManager
jest.mock('../services/jobManager');

describe('ResultsController', () => {
  let resultsController;
  let mockJobManager;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock JobManager instance
    mockJobManager = {
      getJobResult: jest.fn(),
    };
    JobManager.mockImplementation(() => mockJobManager);

    // Create controller instance
    resultsController = new ResultsController();

    // Mock request and response objects
    mockReq = {
      params: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe('getResult', () => {
    it('should return processed data for valid jobId', async () => {
      // Arrange
      const jobId = 'test-job-id';
      const mockProcessedData = new BankStatementData({
        fileName: 'test-statement.pdf',
        accounts: [
          new BankAccount({
            bankName: 'Test Bank',
            accountHolderName: 'John Doe',
            accountNumber: '123456789',
            accountType: 'Savings',
            currency: 'USD',
            statementStartDate: '2024-01-01',
            statementEndDate: '2024-01-31',
            openingBalance: 1000.0,
            closingBalance: 1500.0,
            transactions: [
              new Transaction({
                date: '2024-01-15',
                description: 'Salary deposit',
                debit: null,
                credit: 500.0,
                balance: 1500.0,
              }),
            ],
          }),
        ],
      });

      const mockJob = {
        jobId,
        fileName: 'test-statement.pdf',
        status: JobStatus.PROCESSED,
        processedData: mockProcessedData,
      };

      mockReq.params.jobId = jobId;
      mockJobManager.getJobResult.mockResolvedValue(mockJob);

      // Act
      await resultsController.getResult(mockReq, mockRes);

      // Assert
      expect(mockJobManager.getJobResult).toHaveBeenCalledWith(jobId);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        fileName: 'test-statement.pdf',
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
            closingBalance: 1500.0,
            transactions: [
              {
                date: '2024-01-15',
                description: 'Salary deposit',
                debit: null,
                credit: 500.0,
                balance: 1500.0,
              },
            ],
          },
        ],
      });
    });

    it('should return 400 error for missing jobId', async () => {
      // Arrange
      mockReq.params = {}; // No jobId

      // Act
      await resultsController.getResult(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: 'INVALID_JOB_ID',
          message: 'jobId parameter is required and must be a valid string',
          details: null,
        },
        jobId: null,
        timestamp: expect.any(String),
      });
    });

    it('should return 404 error for non-existent job', async () => {
      // Arrange
      const jobId = 'non-existent-job';
      mockReq.params.jobId = jobId;
      mockJobManager.getJobResult.mockRejectedValue(
        new Error('Job not found: non-existent-job')
      );

      // Act
      await resultsController.getResult(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'No job found with ID: non-existent-job',
          details: null,
        },
        jobId: 'non-existent-job',
        timestamp: expect.any(String),
      });
    });

    it('should return 400 error for job not processed', async () => {
      // Arrange
      const jobId = 'processing-job';
      const mockJob = {
        jobId,
        fileName: 'test-statement.pdf',
        status: JobStatus.PROCESSING,
        processedData: null,
      };

      mockReq.params.jobId = jobId;
      mockJobManager.getJobResult.mockResolvedValue(mockJob);

      // Act
      await resultsController.getResult(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: 'JOB_NOT_PROCESSED',
          message:
            'Job processing-job has not been processed successfully. Current status: processing',
          details: {
            currentStatus: 'processing',
            errorMessage: null,
          },
        },
        jobId: 'processing-job',
        timestamp: expect.any(String),
      });
    });

    it('should return 500 error for processed job with missing data', async () => {
      // Arrange
      const jobId = 'processed-job-no-data';
      const mockJob = {
        jobId,
        fileName: 'test-statement.pdf',
        status: JobStatus.PROCESSED,
        processedData: null, // Missing processed data
      };

      mockReq.params.jobId = jobId;
      mockJobManager.getJobResult.mockResolvedValue(mockJob);

      // Act
      await resultsController.getResult(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: 'MISSING_PROCESSED_DATA',
          message: 'Job marked as processed but no data available',
          details: null,
        },
        jobId: 'processed-job-no-data',
        timestamp: expect.any(String),
      });
    });

    it('should handle multiple accounts correctly', async () => {
      // Arrange
      const jobId = 'multi-account-job';
      const mockProcessedData = new BankStatementData({
        fileName: 'multi-account-statement.pdf',
        accounts: [
          new BankAccount({
            bankName: 'Bank A',
            accountNumber: '111111111',
            accountType: 'Savings',
            transactions: [],
          }),
          new BankAccount({
            bankName: 'Bank B',
            accountNumber: '222222222',
            accountType: 'Current',
            transactions: [],
          }),
        ],
      });

      const mockJob = {
        jobId,
        fileName: 'multi-account-statement.pdf',
        status: JobStatus.PROCESSED,
        processedData: mockProcessedData,
      };

      mockReq.params.jobId = jobId;
      mockJobManager.getJobResult.mockResolvedValue(mockJob);

      // Act
      await resultsController.getResult(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(200);
      const responseCall = mockRes.json.mock.calls[0][0];
      expect(responseCall.accounts).toHaveLength(2);
      expect(responseCall.accounts[0].bankName).toBe('Bank A');
      expect(responseCall.accounts[1].bankName).toBe('Bank B');
    });

    it('should sanitize data and never expose raw Textract data', async () => {
      // Arrange
      const jobId = 'sanitization-test';
      const mockProcessedData = {
        fileName: 'test-statement.pdf',
        accounts: [
          {
            bankName: 'Test Bank',
            accountNumber: '123456789',
            // Simulate potential raw Textract data that should be filtered out
            rawTextractBlocks: [{ blockType: 'LINE', text: 'sensitive data' }],
            textractMetadata: { confidence: 0.95 },
            transactions: [
              {
                date: '2024-01-15',
                description: 'Test transaction',
                debit: null,
                credit: 100.0,
                balance: 100.0,
                // Simulate raw data that should be filtered out
                rawTextractData: { blockId: '123', confidence: 0.98 },
              },
            ],
          },
        ],
      };

      const mockJob = {
        jobId,
        fileName: 'test-statement.pdf',
        status: JobStatus.PROCESSED,
        processedData: mockProcessedData,
      };

      mockReq.params.jobId = jobId;
      mockJobManager.getJobResult.mockResolvedValue(mockJob);

      // Act
      await resultsController.getResult(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(200);
      const responseCall = mockRes.json.mock.calls[0][0];

      // Verify raw Textract data is not exposed
      expect(responseCall.accounts[0]).not.toHaveProperty('rawTextractBlocks');
      expect(responseCall.accounts[0]).not.toHaveProperty('textractMetadata');
      expect(responseCall.accounts[0].transactions[0]).not.toHaveProperty(
        'rawTextractData'
      );

      // Verify only expected fields are present
      expect(responseCall.accounts[0]).toEqual({
        bankName: 'Test Bank',
        accountHolderName: null,
        accountNumber: '123456789',
        accountType: null,
        currency: null,
        statementStartDate: null,
        statementEndDate: null,
        openingBalance: null,
        closingBalance: null,
        transactions: [
          {
            date: '2024-01-15',
            description: 'Test transaction',
            debit: null,
            credit: 100.0,
            balance: 100.0,
          },
        ],
      });
    });
  });
});
