const CleanupService = require('./cleanupService');
const { Job, JobStatus } = require('../types');

describe('CleanupService', () => {
  let cleanupService;
  let mockStorageService;
  let mockJobManager;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset environment variables
    delete process.env.COMPLETED_JOB_RETENTION_MS;
    delete process.env.FAILED_JOB_RETENTION_MS;
    delete process.env.CLEANUP_INTERVAL_MS;
    delete process.env.MAX_JOBS_PER_CLEANUP;

    // Create mock instances
    mockStorageService = {
      deleteFile: jest.fn().mockResolvedValue(),
    };

    mockJobManager = {
      getAllJobs: jest.fn().mockResolvedValue([]),
      deleteJob: jest.fn().mockResolvedValue(true),
      getJobResult: jest.fn(),
    };

    // Create CleanupService with mocked dependencies
    cleanupService = new CleanupService(mockStorageService, mockJobManager);
  });

  afterEach(async () => {
    // Clean up any running intervals
    await cleanupService.stopScheduledCleanup();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      expect(cleanupService.config.completedJobRetentionMs).toBe(
        24 * 60 * 60 * 1000
      ); // 24 hours
      expect(cleanupService.config.failedJobRetentionMs).toBe(
        7 * 24 * 60 * 60 * 1000
      ); // 7 days
      expect(cleanupService.config.cleanupIntervalMs).toBe(60 * 60 * 1000); // 1 hour
      expect(cleanupService.config.maxJobsPerCleanup).toBe(100);
    });

    it('should use environment variables for configuration', () => {
      process.env.COMPLETED_JOB_RETENTION_MS = '3600000'; // 1 hour
      process.env.FAILED_JOB_RETENTION_MS = '7200000'; // 2 hours
      process.env.CLEANUP_INTERVAL_MS = '1800000'; // 30 minutes
      process.env.MAX_JOBS_PER_CLEANUP = '50';

      const service = new CleanupService(mockStorageService, mockJobManager);

      expect(service.config.completedJobRetentionMs).toBe(3600000);
      expect(service.config.failedJobRetentionMs).toBe(7200000);
      expect(service.config.cleanupIntervalMs).toBe(1800000);
      expect(service.config.maxJobsPerCleanup).toBe(50);
    });
  });

  describe('performCleanup', () => {
    it('should cleanup expired completed jobs', async () => {
      const now = new Date();
      const expiredJob = new Job({
        jobId: 'expired-job-id',
        fileName: 'expired.pdf',
        s3Key: 'expired-s3-key',
        status: JobStatus.PROCESSED,
        updatedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000), // 25 hours ago
      });

      mockJobManager.getAllJobs.mockResolvedValue([expiredJob]);

      const stats = await cleanupService.performCleanup();

      expect(stats.jobsProcessed).toBe(1);
      expect(stats.jobsDeleted).toBe(1);
      expect(stats.filesDeleted).toBe(1);
      expect(mockStorageService.deleteFile).toHaveBeenCalledWith(
        'expired-s3-key'
      );
      expect(mockJobManager.deleteJob).toHaveBeenCalledWith('expired-job-id');
    });

    it('should not cleanup active jobs', async () => {
      const activeJobs = [
        new Job({
          jobId: 'uploaded-job',
          fileName: 'uploaded.pdf',
          s3Key: 'uploaded-s3-key',
          status: JobStatus.UPLOADED,
          updatedAt: new Date(),
        }),
        new Job({
          jobId: 'processing-job',
          fileName: 'processing.pdf',
          s3Key: 'processing-s3-key',
          status: JobStatus.PROCESSING,
          updatedAt: new Date(),
        }),
      ];

      mockJobManager.getAllJobs.mockResolvedValue(activeJobs);

      const stats = await cleanupService.performCleanup();

      expect(stats.jobsProcessed).toBe(2);
      expect(stats.jobsDeleted).toBe(0);
      expect(mockStorageService.deleteFile).not.toHaveBeenCalled();
      expect(mockJobManager.deleteJob).not.toHaveBeenCalled();
    });
  });

  describe('cleanupJobById', () => {
    it('should cleanup a specific job successfully', async () => {
      const job = new Job({
        jobId: 'test-job-id',
        fileName: 'test.pdf',
        s3Key: 'test-s3-key',
        status: JobStatus.PROCESSED,
      });

      mockJobManager.getJobResult.mockResolvedValue(job);

      const result = await cleanupService.cleanupJobById('test-job-id');

      expect(result).toBe(true);
      expect(mockStorageService.deleteFile).toHaveBeenCalledWith('test-s3-key');
      expect(mockJobManager.deleteJob).toHaveBeenCalledWith('test-job-id');
    });

    it('should return false for non-existent job', async () => {
      mockJobManager.getJobResult.mockRejectedValue(
        new Error('Job not found: test-job-id')
      );

      const result = await cleanupService.cleanupJobById('test-job-id');

      expect(result).toBe(false);
      expect(mockStorageService.deleteFile).not.toHaveBeenCalled();
      expect(mockJobManager.deleteJob).not.toHaveBeenCalled();
    });
  });

  describe('getCleanupStatus', () => {
    it('should return comprehensive cleanup status', async () => {
      const jobs = [
        new Job({
          jobId: '1',
          fileName: '1.pdf',
          s3Key: 'key1',
          status: JobStatus.UPLOADED,
        }),
        new Job({
          jobId: '2',
          fileName: '2.pdf',
          s3Key: 'key2',
          status: JobStatus.PROCESSING,
        }),
        new Job({
          jobId: '3',
          fileName: '3.pdf',
          s3Key: 'key3',
          status: JobStatus.PROCESSED,
        }),
        new Job({
          jobId: '4',
          fileName: '4.pdf',
          s3Key: 'key4',
          status: JobStatus.FAILED,
        }),
      ];

      mockJobManager.getAllJobs.mockResolvedValue(jobs);

      const status = await cleanupService.getCleanupStatus();

      expect(status.totalJobs).toBe(4);
      expect(status.jobsByStatus[JobStatus.UPLOADED]).toBe(1);
      expect(status.jobsByStatus[JobStatus.PROCESSING]).toBe(1);
      expect(status.jobsByStatus[JobStatus.PROCESSED]).toBe(1);
      expect(status.jobsByStatus[JobStatus.FAILED]).toBe(1);
      expect(status.schedulerRunning).toBe(false);
      expect(status.config).toBeDefined();
    });
  });

  describe('_shouldCleanupJob', () => {
    it('should identify expired completed jobs for cleanup', () => {
      const now = new Date();
      const expiredJob = new Job({
        jobId: 'expired',
        fileName: 'expired.pdf',
        s3Key: 'expired-key',
        status: JobStatus.PROCESSED,
        updatedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000), // 25 hours ago
      });

      const result = cleanupService._shouldCleanupJob(expiredJob, now);
      expect(result).toBe(true);
    });

    it('should not cleanup recent completed jobs', () => {
      const now = new Date();
      const recentJob = new Job({
        jobId: 'recent',
        fileName: 'recent.pdf',
        s3Key: 'recent-key',
        status: JobStatus.PROCESSED,
        updatedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1 hour ago
      });

      const result = cleanupService._shouldCleanupJob(recentJob, now);
      expect(result).toBe(false);
    });

    it('should not cleanup active jobs', () => {
      const now = new Date();
      const activeJob = new Job({
        jobId: 'active',
        fileName: 'active.pdf',
        s3Key: 'active-key',
        status: JobStatus.PROCESSING,
        updatedAt: now,
      });

      const result = cleanupService._shouldCleanupJob(activeJob, now);
      expect(result).toBe(false);
    });
  });
});
