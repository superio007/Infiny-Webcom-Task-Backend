const StorageService = require('./storageService');
const JobManager = require('./jobManager');
const { JobStatus } = require('../types');

/**
 * CleanupService handles temporary data cleanup and resource management
 * Implements cleanup procedures for files, jobs, and system resources
 */
class CleanupService {
  constructor(storageService = null, jobManager = null) {
    this.storageService = storageService || new StorageService();
    this.jobManager = jobManager || new JobManager();
    this.cleanupIntervals = new Map(); // Track active cleanup intervals
    this.isShuttingDown = false;

    // Configuration for cleanup policies
    this.config = {
      // How long to keep completed jobs (in milliseconds)
      completedJobRetentionMs:
        parseInt(process.env.COMPLETED_JOB_RETENTION_MS) || 24 * 60 * 60 * 1000, // 24 hours
      // How long to keep failed jobs (in milliseconds)
      failedJobRetentionMs:
        parseInt(process.env.FAILED_JOB_RETENTION_MS) ||
        7 * 24 * 60 * 60 * 1000, // 7 days
      // How often to run cleanup (in milliseconds)
      cleanupIntervalMs:
        parseInt(process.env.CLEANUP_INTERVAL_MS) || 60 * 60 * 1000, // 1 hour
      // Maximum number of jobs to process in one cleanup cycle
      maxJobsPerCleanup: parseInt(process.env.MAX_JOBS_PER_CLEANUP) || 100,
    };
  }

  /**
   * Start automatic cleanup scheduling
   * @returns {Promise<void>}
   */
  async startScheduledCleanup() {
    try {
      if (this.cleanupIntervals.has('main')) {
        console.log('Cleanup scheduler already running');
        return;
      }

      console.log(
        `Starting cleanup scheduler with interval: ${this.config.cleanupIntervalMs}ms`
      );

      // Run initial cleanup
      await this.performCleanup();

      // Schedule recurring cleanup
      const intervalId = setInterval(async () => {
        if (!this.isShuttingDown) {
          try {
            await this.performCleanup();
          } catch (error) {
            console.error('Scheduled cleanup failed:', error.message);
          }
        }
      }, this.config.cleanupIntervalMs);

      this.cleanupIntervals.set('main', intervalId);

      console.log('Cleanup scheduler started successfully');
    } catch (error) {
      throw new Error(`Failed to start cleanup scheduler: ${error.message}`);
    }
  }

  /**
   * Stop automatic cleanup scheduling
   * @returns {Promise<void>}
   */
  async stopScheduledCleanup() {
    try {
      this.isShuttingDown = true;

      // Clear all intervals
      for (const [name, intervalId] of this.cleanupIntervals) {
        clearInterval(intervalId);
        console.log(`Stopped cleanup interval: ${name}`);
      }

      this.cleanupIntervals.clear();
      console.log('All cleanup schedulers stopped');
    } catch (error) {
      throw new Error(`Failed to stop cleanup scheduler: ${error.message}`);
    }
  }

  /**
   * Perform comprehensive cleanup of temporary data and resources
   * @returns {Promise<Object>} - Cleanup statistics
   */
  async performCleanup() {
    try {
      console.log('Starting cleanup cycle...');
      const startTime = Date.now();

      const stats = {
        jobsProcessed: 0,
        jobsDeleted: 0,
        filesDeleted: 0,
        errors: [],
        duration: 0,
      };

      // Get all jobs for cleanup evaluation
      const allJobs = await this.jobManager.getAllJobs();
      const now = new Date();

      let processedCount = 0;

      for (const job of allJobs) {
        // Respect max jobs per cleanup limit
        if (processedCount >= this.config.maxJobsPerCleanup) {
          console.log(
            `Reached max jobs per cleanup limit: ${this.config.maxJobsPerCleanup}`
          );
          break;
        }

        try {
          const shouldCleanup = this._shouldCleanupJob(job, now);

          if (shouldCleanup) {
            await this._cleanupJob(job);
            stats.jobsDeleted++;
            stats.filesDeleted++;
          }

          stats.jobsProcessed++;
          processedCount++;
        } catch (error) {
          console.error(`Failed to cleanup job ${job.jobId}:`, error.message);
          stats.errors.push({
            jobId: job.jobId,
            error: error.message,
          });
        }
      }

      // Cleanup any orphaned resources
      await this._cleanupOrphanedResources(stats);

      stats.duration = Date.now() - startTime;

      console.log('Cleanup cycle completed:', {
        jobsProcessed: stats.jobsProcessed,
        jobsDeleted: stats.jobsDeleted,
        filesDeleted: stats.filesDeleted,
        errors: stats.errors.length,
        duration: `${stats.duration}ms`,
      });

      return stats;
    } catch (error) {
      throw new Error(`Cleanup cycle failed: ${error.message}`);
    }
  }

  /**
   * Clean up a specific job by ID
   * @param {string} jobId - UUID of the job to clean up
   * @returns {Promise<boolean>} - True if job was cleaned up, false if not found
   */
  async cleanupJobById(jobId) {
    try {
      if (!jobId || typeof jobId !== 'string') {
        throw new Error('jobId is required and must be a string');
      }

      const job = await this.jobManager.getJobResult(jobId);

      if (!job) {
        return false;
      }

      await this._cleanupJob(job);
      console.log(`Manually cleaned up job: ${jobId}`);

      return true;
    } catch (error) {
      if (error.message.includes('Job not found')) {
        return false;
      }
      throw new Error(`Failed to cleanup job ${jobId}: ${error.message}`);
    }
  }

  /**
   * Clean up all failed jobs immediately
   * @returns {Promise<number>} - Number of jobs cleaned up
   */
  async cleanupFailedJobs() {
    try {
      const allJobs = await this.jobManager.getAllJobs();
      const failedJobs = allJobs.filter(
        (job) => job.status === JobStatus.FAILED
      );

      let cleanedCount = 0;

      for (const job of failedJobs) {
        try {
          await this._cleanupJob(job);
          cleanedCount++;
        } catch (error) {
          console.error(
            `Failed to cleanup failed job ${job.jobId}:`,
            error.message
          );
        }
      }

      console.log(`Cleaned up ${cleanedCount} failed jobs`);
      return cleanedCount;
    } catch (error) {
      throw new Error(`Failed to cleanup failed jobs: ${error.message}`);
    }
  }

  /**
   * Clean up all completed jobs older than retention period
   * @returns {Promise<number>} - Number of jobs cleaned up
   */
  async cleanupCompletedJobs() {
    try {
      const allJobs = await this.jobManager.getAllJobs();
      const now = new Date();

      const expiredCompletedJobs = allJobs.filter((job) => {
        if (job.status !== JobStatus.PROCESSED) {
          return false;
        }

        const jobAge = now.getTime() - job.updatedAt.getTime();
        return jobAge > this.config.completedJobRetentionMs;
      });

      let cleanedCount = 0;

      for (const job of expiredCompletedJobs) {
        try {
          await this._cleanupJob(job);
          cleanedCount++;
        } catch (error) {
          console.error(
            `Failed to cleanup completed job ${job.jobId}:`,
            error.message
          );
        }
      }

      console.log(`Cleaned up ${cleanedCount} expired completed jobs`);
      return cleanedCount;
    } catch (error) {
      throw new Error(`Failed to cleanup completed jobs: ${error.message}`);
    }
  }

  /**
   * Get cleanup statistics and monitoring information
   * @returns {Promise<Object>} - Cleanup status and statistics
   */
  async getCleanupStatus() {
    try {
      const allJobs = await this.jobManager.getAllJobs();
      const now = new Date();

      const stats = {
        totalJobs: allJobs.length,
        jobsByStatus: {},
        eligibleForCleanup: 0,
        schedulerRunning: this.cleanupIntervals.has('main'),
        config: this.config,
        nextCleanupEstimate: null,
      };

      // Count jobs by status
      for (const status of Object.values(JobStatus)) {
        stats.jobsByStatus[status] = allJobs.filter(
          (job) => job.status === status
        ).length;
      }

      // Count jobs eligible for cleanup
      stats.eligibleForCleanup = allJobs.filter((job) =>
        this._shouldCleanupJob(job, now)
      ).length;

      // Estimate next cleanup time if scheduler is running
      if (stats.schedulerRunning) {
        stats.nextCleanupEstimate = new Date(
          now.getTime() + this.config.cleanupIntervalMs
        ).toISOString();
      }

      return stats;
    } catch (error) {
      throw new Error(`Failed to get cleanup status: ${error.message}`);
    }
  }

  /**
   * Graceful shutdown - cleanup resources and stop schedulers
   * @returns {Promise<void>}
   */
  async shutdown() {
    try {
      console.log('Initiating cleanup service shutdown...');

      // Stop schedulers
      await this.stopScheduledCleanup();

      // Perform final cleanup if needed
      if (process.env.CLEANUP_ON_SHUTDOWN === 'true') {
        console.log('Performing final cleanup before shutdown...');
        await this.performCleanup();
      }

      console.log('Cleanup service shutdown completed');
    } catch (error) {
      console.error('Error during cleanup service shutdown:', error.message);
      throw error;
    }
  }

  /**
   * Determine if a job should be cleaned up based on age and status
   * @param {Job} job - Job to evaluate
   * @param {Date} now - Current timestamp
   * @returns {boolean} - True if job should be cleaned up
   * @private
   */
  _shouldCleanupJob(job, now) {
    const jobAge = now.getTime() - job.updatedAt.getTime();

    switch (job.status) {
    case JobStatus.PROCESSED:
      return jobAge > this.config.completedJobRetentionMs;

    case JobStatus.FAILED:
      return jobAge > this.config.failedJobRetentionMs;

    case JobStatus.UPLOADED:
    case JobStatus.PROCESSING:
      // Don't cleanup active jobs, but could add timeout logic here
      return false;

    default:
      return false;
    }
  }

  /**
   * Clean up a specific job and its associated resources
   * @param {Job} job - Job to clean up
   * @returns {Promise<void>}
   * @private
   */
  async _cleanupJob(job) {
    try {
      // Delete associated S3 file
      if (job.s3Key) {
        await this.storageService.deleteFile(job.s3Key);
        console.log(`Deleted S3 file: ${job.s3Key}`);
      }

      // Delete job record
      await this.jobManager.deleteJob(job.jobId);
      console.log(`Deleted job record: ${job.jobId}`);
    } catch (error) {
      throw new Error(`Failed to cleanup job ${job.jobId}: ${error.message}`);
    }
  }

  /**
   * Clean up any orphaned resources that don't have corresponding jobs
   * @param {Object} stats - Cleanup statistics to update
   * @returns {Promise<void>}
   * @private
   */
  async _cleanupOrphanedResources(stats) {
    try {
      // This is a placeholder for orphaned resource cleanup
      // In a production system, you might:
      // 1. List all S3 objects and compare with job records
      // 2. Clean up temporary files in local storage (if any)
      // 3. Clean up database connections or other resources

      console.log('Orphaned resource cleanup completed (placeholder)');
    } catch (error) {
      console.error('Orphaned resource cleanup failed:', error.message);
      stats.errors.push({
        type: 'orphaned_resources',
        error: error.message,
      });
    }
  }
}

module.exports = CleanupService;
