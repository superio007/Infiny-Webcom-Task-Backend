const { v4: uuidv4 } = require('uuid');
const { Job, JobStatus } = require('../types');

/**
 * JobManager handles job lifecycle management and persistence
 * Tracks processing job status throughout the pipeline
 * Implemented as a singleton to ensure shared state across all controllers
 */
class JobManager {
  constructor() {
    // Return existing instance if it exists (singleton pattern)
    if (JobManager.instance) {
      return JobManager.instance;
    }

    // In-memory storage for jobs (replace with database in production)
    this.jobs = new Map();
    
    // Store the instance
    JobManager.instance = this;
  }

  /**
   * Get the singleton instance of JobManager
   * @returns {JobManager} - The singleton instance
   */
  static getInstance() {
    if (!JobManager.instance) {
      JobManager.instance = new JobManager();
    }
    return JobManager.instance;
  }

  /**
   * Create a new job with UUID generation
   * @param {string} fileName - Original filename of the uploaded file
   * @param {string} s3Key - S3 storage key for the uploaded file
   * @returns {Promise<Job>} - Created job object
   */
  async createJob(fileName, s3Key) {
    try {
      // Validate input parameters
      if (!fileName || typeof fileName !== 'string') {
        throw new Error('fileName is required and must be a string');
      }
      if (!s3Key || typeof s3Key !== 'string') {
        throw new Error('s3Key is required and must be a string');
      }

      // Generate UUID for job
      const jobId = uuidv4();

      // Create new job instance
      const job = new Job({
        jobId,
        fileName,
        s3Key,
        status: JobStatus.UPLOADED,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Persist job
      this.jobs.set(jobId, job);
      
      console.log(`✅ Job created: ${jobId} (Total jobs: ${this.jobs.size})`);

      return job;
    } catch (error) {
      throw new Error(`Failed to create job: ${error.message}`);
    }
  }

  /**
   * Update job status with persistence
   * @param {string} jobId - UUID of the job to update
   * @param {string} status - New status from JobStatus enum
   * @param {Object} additionalData - Optional additional data to update
   * @returns {Promise<void>}
   */
  async updateJobStatus(jobId, status, additionalData = {}) {
    try {
      // Validate input parameters
      if (!jobId || typeof jobId !== 'string') {
        throw new Error('jobId is required and must be a string');
      }
      if (!status || typeof status !== 'string') {
        throw new Error('status is required and must be a string');
      }

      // Validate status is a valid JobStatus
      if (!Object.values(JobStatus).includes(status)) {
        throw new Error(
          `Invalid status: ${status}. Must be one of: ${Object.values(
            JobStatus
          ).join(', ')}`
        );
      }

      // Check if job exists
      const job = this.jobs.get(jobId);
      if (!job) {
        throw new Error(`Job not found: ${jobId}`);
      }

      // Validate state transition
      this._validateStatusTransition(job.status, status);

      // Update job properties
      job.status = status;
      job.updatedAt = new Date();

      // Update additional data if provided
      if (additionalData.accountsDetected !== undefined) {
        job.accountsDetected = additionalData.accountsDetected;
      }
      if (additionalData.processedData !== undefined) {
        job.processedData = additionalData.processedData;
      }
      if (additionalData.errorMessage !== undefined) {
        job.errorMessage = additionalData.errorMessage;
      }

      // Persist updated job
      this.jobs.set(jobId, job);
    } catch (error) {
      throw new Error(`Failed to update job status: ${error.message}`);
    }
  }

  /**
   * Get job result with data retrieval
   * @param {string} jobId - UUID of the job to retrieve
   * @returns {Promise<Job>} - Job object with current status and data
   */
  async getJobResult(jobId) {
    try {
      // Validate input parameter
      if (!jobId || typeof jobId !== 'string') {
        throw new Error('jobId is required and must be a string');
      }

      console.log(`🔍 Looking for job: ${jobId} (Total jobs: ${this.jobs.size})`);
      console.log(`📋 Available jobs: ${Array.from(this.jobs.keys()).join(', ')}`);

      // Retrieve job from storage
      const job = this.jobs.get(jobId);
      if (!job) {
        throw new Error(`Job not found: ${jobId}`);
      }

      console.log(`✅ Job found: ${jobId} with status: ${job.status}`);

      // Return a copy to prevent external modification
      return new Job({
        jobId: job.jobId,
        fileName: job.fileName,
        s3Key: job.s3Key,
        status: job.status,
        accountsDetected: job.accountsDetected,
        processedData: job.processedData,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      });
    } catch (error) {
      throw new Error(`Failed to get job result: ${error.message}`);
    }
  }

  /**
   * Get all jobs (for debugging/monitoring purposes)
   * @returns {Promise<Job[]>} - Array of all jobs
   */
  async getAllJobs() {
    return Array.from(this.jobs.values()).map(
      (job) =>
        new Job({
          jobId: job.jobId,
          fileName: job.fileName,
          s3Key: job.s3Key,
          status: job.status,
          accountsDetected: job.accountsDetected,
          processedData: job.processedData,
          errorMessage: job.errorMessage,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        })
    );
  }

  /**
   * Delete a job (for cleanup purposes)
   * @param {string} jobId - UUID of the job to delete
   * @returns {Promise<boolean>} - True if job was deleted, false if not found
   */
  async deleteJob(jobId) {
    try {
      if (!jobId || typeof jobId !== 'string') {
        throw new Error('jobId is required and must be a string');
      }

      return this.jobs.delete(jobId);
    } catch (error) {
      throw new Error(`Failed to delete job: ${error.message}`);
    }
  }

  /**
   * Validate job status transitions
   * @param {string} currentStatus - Current job status
   * @param {string} newStatus - New status to transition to
   * @throws {Error} - If transition is invalid
   * @private
   */
  _validateStatusTransition(currentStatus, newStatus) {
    const validTransitions = {
      [JobStatus.UPLOADED]: [JobStatus.PROCESSING, JobStatus.FAILED],
      [JobStatus.PROCESSING]: [JobStatus.PROCESSED, JobStatus.FAILED],
      [JobStatus.PROCESSED]: [], // Terminal state
      [JobStatus.FAILED]: [], // Terminal state
    };

    const allowedTransitions = validTransitions[currentStatus] || [];

    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(
        `Invalid status transition from ${currentStatus} to ${newStatus}. ` +
          `Allowed transitions: ${
            allowedTransitions.join(', ') || 'none (terminal state)'
          }`
      );
    }
  }
}

module.exports = JobManager;
