const JobManager = require('./jobManager');
const { Job, JobStatus } = require('../types');

// Mock UUID to ensure consistent test results
jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

const { v4: uuidv4 } = require('uuid');

describe('JobManager', () => {
  let jobManager;

  beforeEach(() => {
    jobManager = new JobManager();
  });

  describe('createJob', () => {
    beforeEach(() => {
      // Reset UUID mock counter
      let counter = 0;
      uuidv4.mockImplementation(() => `test-job-uuid-${++counter}`);
    });

    it('should create a new job with valid parameters', async () => {
      const fileName = 'test-statement.pdf';
      const s3Key = 'uuid-key.pdf';

      const job = await jobManager.createJob(fileName, s3Key);

      expect(job).toBeInstanceOf(Job);
      expect(job.jobId).toBeDefined();
      expect(job.fileName).toBe(fileName);
      expect(job.s3Key).toBe(s3Key);
      expect(job.status).toBe(JobStatus.UPLOADED);
      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.updatedAt).toBeInstanceOf(Date);
    });

    it('should throw error for missing fileName', async () => {
      await expect(jobManager.createJob(null, 's3-key')).rejects.toThrow(
        'fileName is required and must be a string'
      );
    });

    it('should throw error for missing s3Key', async () => {
      await expect(jobManager.createJob('file.pdf', null)).rejects.toThrow(
        's3Key is required and must be a string'
      );
    });

    it('should generate unique job IDs', async () => {
      const job1 = await jobManager.createJob('file1.pdf', 'key1');
      const job2 = await jobManager.createJob('file2.pdf', 'key2');

      expect(job1.jobId).not.toBe(job2.jobId);
    });
  });

  describe('updateJobStatus', () => {
    let job;

    beforeEach(async () => {
      job = await jobManager.createJob('test.pdf', 'test-key');
    });

    it('should update job status successfully', async () => {
      const originalUpdatedAt = job.updatedAt;

      // Add a small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await jobManager.updateJobStatus(job.jobId, JobStatus.PROCESSING);

      const updatedJob = await jobManager.getJobResult(job.jobId);
      expect(updatedJob.status).toBe(JobStatus.PROCESSING);
      expect(updatedJob.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime()
      );
    });

    it('should update job with additional data', async () => {
      const additionalData = {
        accountsDetected: 2,
        errorMessage: 'Test error',
      };

      await jobManager.updateJobStatus(
        job.jobId,
        JobStatus.FAILED,
        additionalData
      );

      const updatedJob = await jobManager.getJobResult(job.jobId);
      expect(updatedJob.status).toBe(JobStatus.FAILED);
      expect(updatedJob.accountsDetected).toBe(2);
      expect(updatedJob.errorMessage).toBe('Test error');
    });

    it('should throw error for invalid jobId', async () => {
      await expect(
        jobManager.updateJobStatus('invalid-id', JobStatus.PROCESSING)
      ).rejects.toThrow('Job not found: invalid-id');
    });

    it('should throw error for invalid status', async () => {
      await expect(
        jobManager.updateJobStatus(job.jobId, 'invalid-status')
      ).rejects.toThrow('Invalid status: invalid-status');
    });

    it('should validate status transitions', async () => {
      // Valid transition: UPLOADED -> PROCESSING
      await jobManager.updateJobStatus(job.jobId, JobStatus.PROCESSING);

      // Valid transition: PROCESSING -> PROCESSED
      await jobManager.updateJobStatus(job.jobId, JobStatus.PROCESSED);

      // Invalid transition: PROCESSED -> PROCESSING (terminal state)
      await expect(
        jobManager.updateJobStatus(job.jobId, JobStatus.PROCESSING)
      ).rejects.toThrow(
        'Invalid status transition from processed to processing'
      );
    });
  });

  describe('getJobResult', () => {
    let job;

    beforeEach(async () => {
      job = await jobManager.createJob('test.pdf', 'test-key');
    });

    it('should retrieve job successfully', async () => {
      const retrievedJob = await jobManager.getJobResult(job.jobId);

      expect(retrievedJob).toBeInstanceOf(Job);
      expect(retrievedJob.jobId).toBe(job.jobId);
      expect(retrievedJob.fileName).toBe(job.fileName);
      expect(retrievedJob.s3Key).toBe(job.s3Key);
      expect(retrievedJob.status).toBe(job.status);
    });

    it('should throw error for non-existent job', async () => {
      await expect(jobManager.getJobResult('non-existent-id')).rejects.toThrow(
        'Job not found: non-existent-id'
      );
    });

    it('should return a copy to prevent external modification', async () => {
      const retrievedJob = await jobManager.getJobResult(job.jobId);

      // Modify the retrieved job
      retrievedJob.status = JobStatus.FAILED;

      // Original job should remain unchanged
      const originalJob = await jobManager.getJobResult(job.jobId);
      expect(originalJob.status).toBe(JobStatus.UPLOADED);
    });

    it('should throw error for invalid jobId parameter', async () => {
      await expect(jobManager.getJobResult(null)).rejects.toThrow(
        'jobId is required and must be a string'
      );
    });
  });

  describe('getAllJobs', () => {
    beforeEach(() => {
      // Reset UUID mock counter for this test suite
      let counter = 0;
      uuidv4.mockImplementation(() => `test-job-uuid-${++counter}`);
    });

    it('should return empty array when no jobs exist', async () => {
      const jobs = await jobManager.getAllJobs();
      expect(jobs).toEqual([]);
    });

    it('should return all created jobs', async () => {
      const job1 = await jobManager.createJob('file1.pdf', 'key1');
      const job2 = await jobManager.createJob('file2.pdf', 'key2');

      const jobs = await jobManager.getAllJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs.map((j) => j.jobId)).toContain(job1.jobId);
      expect(jobs.map((j) => j.jobId)).toContain(job2.jobId);
    });
  });

  describe('deleteJob', () => {
    let job;

    beforeEach(async () => {
      job = await jobManager.createJob('test.pdf', 'test-key');
    });

    it('should delete existing job', async () => {
      const deleted = await jobManager.deleteJob(job.jobId);
      expect(deleted).toBe(true);

      await expect(jobManager.getJobResult(job.jobId)).rejects.toThrow(
        'Job not found'
      );
    });

    it('should return false for non-existent job', async () => {
      const deleted = await jobManager.deleteJob('non-existent-id');
      expect(deleted).toBe(false);
    });

    it('should throw error for invalid jobId parameter', async () => {
      await expect(jobManager.deleteJob(null)).rejects.toThrow(
        'jobId is required and must be a string'
      );
    });
  });

  describe('status transition validation', () => {
    let job;

    beforeEach(async () => {
      job = await jobManager.createJob('test.pdf', 'test-key');
    });

    it('should allow valid transitions from UPLOADED', async () => {
      // UPLOADED -> PROCESSING
      await expect(
        jobManager.updateJobStatus(job.jobId, JobStatus.PROCESSING)
      ).resolves.not.toThrow();

      // Reset job
      job = await jobManager.createJob('test2.pdf', 'test-key2');

      // UPLOADED -> FAILED
      await expect(
        jobManager.updateJobStatus(job.jobId, JobStatus.FAILED)
      ).resolves.not.toThrow();
    });

    it('should allow valid transitions from PROCESSING', async () => {
      await jobManager.updateJobStatus(job.jobId, JobStatus.PROCESSING);

      // PROCESSING -> PROCESSED
      await expect(
        jobManager.updateJobStatus(job.jobId, JobStatus.PROCESSED)
      ).resolves.not.toThrow();

      // Reset job
      job = await jobManager.createJob('test2.pdf', 'test-key2');
      await jobManager.updateJobStatus(job.jobId, JobStatus.PROCESSING);

      // PROCESSING -> FAILED
      await expect(
        jobManager.updateJobStatus(job.jobId, JobStatus.FAILED)
      ).resolves.not.toThrow();
    });

    it('should reject invalid transitions from terminal states', async () => {
      // Move to PROCESSED (terminal state)
      await jobManager.updateJobStatus(job.jobId, JobStatus.PROCESSING);
      await jobManager.updateJobStatus(job.jobId, JobStatus.PROCESSED);

      // Try to transition from PROCESSED
      await expect(
        jobManager.updateJobStatus(job.jobId, JobStatus.PROCESSING)
      ).rejects.toThrow('Invalid status transition');

      // Reset job and move to FAILED (terminal state)
      const job2 = await jobManager.createJob('test2.pdf', 'test-key2');
      await jobManager.updateJobStatus(job2.jobId, JobStatus.FAILED);

      // Try to transition from FAILED
      await expect(
        jobManager.updateJobStatus(job2.jobId, JobStatus.PROCESSING)
      ).rejects.toThrow('Invalid status transition');
    });
  });
});
