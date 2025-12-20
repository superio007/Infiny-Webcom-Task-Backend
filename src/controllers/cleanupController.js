const { cleanup } = require('../utils');
const { ErrorResponse } = require('../types');

/**
 * CleanupController handles cleanup-related API endpoints
 * Provides monitoring and manual cleanup capabilities
 */
class CleanupController {
  /**
   * Get cleanup status and statistics
   * GET /api/admin/cleanup/status
   */
  static async getStatus(req, res) {
    try {
      const status = await cleanup.getCleanupStatus();

      res.status(200).json({
        success: true,
        data: status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to get cleanup status:', error.message);

      const errorResponse = new ErrorResponse({
        code: 'CLEANUP_STATUS_ERROR',
        message: 'Failed to retrieve cleanup status',
        details: error.message,
      });

      res.status(500).json(errorResponse);
    }
  }

  /**
   * Trigger manual cleanup cycle
   * POST /api/admin/cleanup/run
   */
  static async runCleanup(req, res) {
    try {
      const stats = await cleanup.performManualCleanup();

      res.status(200).json({
        success: true,
        message: 'Cleanup cycle completed successfully',
        data: stats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Manual cleanup failed:', error.message);

      const errorResponse = new ErrorResponse({
        code: 'CLEANUP_EXECUTION_ERROR',
        message: 'Failed to execute cleanup cycle',
        details: error.message,
      });

      res.status(500).json(errorResponse);
    }
  }

  /**
   * Clean up a specific job by ID
   * DELETE /api/admin/cleanup/job/:jobId
   */
  static async cleanupJob(req, res) {
    try {
      const { jobId } = req.params;

      if (!jobId) {
        const errorResponse = new ErrorResponse({
          code: 'MISSING_JOB_ID',
          message: 'Job ID is required',
        });

        return res.status(400).json(errorResponse);
      }

      const wasDeleted = await cleanup.cleanupJob(jobId);

      if (!wasDeleted) {
        const errorResponse = new ErrorResponse({
          code: 'JOB_NOT_FOUND',
          message: `Job not found: ${jobId}`,
          jobId,
        });

        return res.status(404).json(errorResponse);
      }

      res.status(200).json({
        success: true,
        message: `Job ${jobId} cleaned up successfully`,
        jobId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(
        `Failed to cleanup job ${req.params.jobId}:`,
        error.message
      );

      const errorResponse = new ErrorResponse({
        code: 'JOB_CLEANUP_ERROR',
        message: 'Failed to cleanup job',
        details: error.message,
        jobId: req.params.jobId,
      });

      res.status(500).json(errorResponse);
    }
  }

  /**
   * Clean up all failed jobs
   * POST /api/admin/cleanup/failed-jobs
   */
  static async cleanupFailedJobs(req, res) {
    try {
      const cleanupService = cleanup.getCleanupService();
      const cleanedCount = await cleanupService.cleanupFailedJobs();

      res.status(200).json({
        success: true,
        message: `Cleaned up ${cleanedCount} failed jobs`,
        data: {
          jobsDeleted: cleanedCount,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to cleanup failed jobs:', error.message);

      const errorResponse = new ErrorResponse({
        code: 'FAILED_JOBS_CLEANUP_ERROR',
        message: 'Failed to cleanup failed jobs',
        details: error.message,
      });

      res.status(500).json(errorResponse);
    }
  }

  /**
   * Clean up all completed jobs older than retention period
   * POST /api/admin/cleanup/completed-jobs
   */
  static async cleanupCompletedJobs(req, res) {
    try {
      const cleanupService = cleanup.getCleanupService();
      const cleanedCount = await cleanupService.cleanupCompletedJobs();

      res.status(200).json({
        success: true,
        message: `Cleaned up ${cleanedCount} completed jobs`,
        data: {
          jobsDeleted: cleanedCount,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to cleanup completed jobs:', error.message);

      const errorResponse = new ErrorResponse({
        code: 'COMPLETED_JOBS_CLEANUP_ERROR',
        message: 'Failed to cleanup completed jobs',
        details: error.message,
      });

      res.status(500).json(errorResponse);
    }
  }
}

module.exports = CleanupController;
