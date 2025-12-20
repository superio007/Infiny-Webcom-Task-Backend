const CleanupController = require('./cleanupController');
const { cleanup } = require('../utils');
const { ErrorResponse } = require('../types');

// Mock the cleanup utilities
jest.mock('../utils', () => ({
  cleanup: {
    getCleanupStatus: jest.fn(),
    performManualCleanup: jest.fn(),
    cleanupJob: jest.fn(),
    getCleanupService: jest.fn(),
  },
}));

describe('CleanupController', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      params: {},
      body: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe('getStatus', () => {
    it('should return cleanup status successfully', async () => {
      const mockStatus = {
        totalJobs: 10,
        jobsByStatus: { uploaded: 2, processing: 1, processed: 5, failed: 2 },
        schedulerRunning: true,
      };

      cleanup.getCleanupStatus.mockResolvedValue(mockStatus);

      await CleanupController.getStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockStatus,
        timestamp: expect.any(String),
      });
    });

    it('should handle errors when getting status', async () => {
      cleanup.getCleanupStatus.mockRejectedValue(
        new Error('Status retrieval failed')
      );

      await CleanupController.getStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'CLEANUP_STATUS_ERROR',
            message: 'Failed to retrieve cleanup status',
          }),
        })
      );
    });
  });

  describe('runCleanup', () => {
    it('should run cleanup successfully', async () => {
      const mockStats = {
        jobsProcessed: 10,
        jobsDeleted: 5,
        filesDeleted: 5,
        errors: [],
        duration: 1500,
      };

      cleanup.performManualCleanup.mockResolvedValue(mockStats);

      await CleanupController.runCleanup(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Cleanup cycle completed successfully',
        data: mockStats,
        timestamp: expect.any(String),
      });
    });

    it('should handle cleanup execution errors', async () => {
      cleanup.performManualCleanup.mockRejectedValue(
        new Error('Cleanup execution failed')
      );

      await CleanupController.runCleanup(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'CLEANUP_EXECUTION_ERROR',
            message: 'Failed to execute cleanup cycle',
          }),
        })
      );
    });
  });

  describe('cleanupJob', () => {
    it('should cleanup specific job successfully', async () => {
      req.params.jobId = 'test-job-id';
      cleanup.cleanupJob.mockResolvedValue(true);

      await CleanupController.cleanupJob(req, res);

      expect(cleanup.cleanupJob).toHaveBeenCalledWith('test-job-id');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Job test-job-id cleaned up successfully',
        jobId: 'test-job-id',
        timestamp: expect.any(String),
      });
    });

    it('should return 404 when job not found', async () => {
      req.params.jobId = 'non-existent-job';
      cleanup.cleanupJob.mockResolvedValue(false);

      await CleanupController.cleanupJob(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'JOB_NOT_FOUND',
            message: 'Job not found: non-existent-job',
          }),
          jobId: 'non-existent-job',
        })
      );
    });

    it('should return 400 when jobId is missing', async () => {
      req.params = {}; // No jobId

      await CleanupController.cleanupJob(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'MISSING_JOB_ID',
            message: 'Job ID is required',
          }),
        })
      );
    });

    it('should handle job cleanup errors', async () => {
      req.params.jobId = 'error-job-id';
      cleanup.cleanupJob.mockRejectedValue(new Error('Job cleanup failed'));

      await CleanupController.cleanupJob(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'JOB_CLEANUP_ERROR',
            message: 'Failed to cleanup job',
          }),
          jobId: 'error-job-id',
        })
      );
    });
  });

  describe('cleanupFailedJobs', () => {
    it('should cleanup failed jobs successfully', async () => {
      const mockCleanupService = {
        cleanupFailedJobs: jest.fn().mockResolvedValue(3),
      };

      cleanup.getCleanupService.mockReturnValue(mockCleanupService);

      await CleanupController.cleanupFailedJobs(req, res);

      expect(mockCleanupService.cleanupFailedJobs).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Cleaned up 3 failed jobs',
        data: { jobsDeleted: 3 },
        timestamp: expect.any(String),
      });
    });

    it('should handle failed jobs cleanup errors', async () => {
      const mockCleanupService = {
        cleanupFailedJobs: jest
          .fn()
          .mockRejectedValue(new Error('Failed jobs cleanup failed')),
      };

      cleanup.getCleanupService.mockReturnValue(mockCleanupService);

      await CleanupController.cleanupFailedJobs(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'FAILED_JOBS_CLEANUP_ERROR',
            message: 'Failed to cleanup failed jobs',
          }),
        })
      );
    });
  });

  describe('cleanupCompletedJobs', () => {
    it('should cleanup completed jobs successfully', async () => {
      const mockCleanupService = {
        cleanupCompletedJobs: jest.fn().mockResolvedValue(7),
      };

      cleanup.getCleanupService.mockReturnValue(mockCleanupService);

      await CleanupController.cleanupCompletedJobs(req, res);

      expect(mockCleanupService.cleanupCompletedJobs).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Cleaned up 7 completed jobs',
        data: { jobsDeleted: 7 },
        timestamp: expect.any(String),
      });
    });

    it('should handle completed jobs cleanup errors', async () => {
      const mockCleanupService = {
        cleanupCompletedJobs: jest
          .fn()
          .mockRejectedValue(new Error('Completed jobs cleanup failed')),
      };

      cleanup.getCleanupService.mockReturnValue(mockCleanupService);

      await CleanupController.cleanupCompletedJobs(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'COMPLETED_JOBS_CLEANUP_ERROR',
            message: 'Failed to cleanup completed jobs',
          }),
        })
      );
    });
  });
});
