const CleanupService = require('../services/cleanupService');

/**
 * Cleanup utilities for resource management and temporary data cleanup
 */

let cleanupServiceInstance = null;

/**
 * Get or create a singleton instance of CleanupService
 * @returns {CleanupService} - Cleanup service instance
 */
function getCleanupService() {
  if (!cleanupServiceInstance) {
    cleanupServiceInstance = new CleanupService();
  }
  return cleanupServiceInstance;
}

/**
 * Initialize cleanup service with automatic scheduling
 * @returns {Promise<void>}
 */
async function initializeCleanup() {
  try {
    const cleanupService = getCleanupService();
    await cleanupService.startScheduledCleanup();
    console.log('Cleanup service initialized successfully');
  } catch (error) {
    console.error('Failed to initialize cleanup service:', error.message);
    throw error;
  }
}

/**
 * Shutdown cleanup service gracefully
 * @returns {Promise<void>}
 */
async function shutdownCleanup() {
  try {
    if (cleanupServiceInstance) {
      await cleanupServiceInstance.shutdown();
      cleanupServiceInstance = null;
      console.log('Cleanup service shutdown completed');
    }
  } catch (error) {
    console.error('Failed to shutdown cleanup service:', error.message);
    throw error;
  }
}

/**
 * Perform manual cleanup cycle
 * @returns {Promise<Object>} - Cleanup statistics
 */
async function performManualCleanup() {
  try {
    const cleanupService = getCleanupService();
    return await cleanupService.performCleanup();
  } catch (error) {
    console.error('Manual cleanup failed:', error.message);
    throw error;
  }
}

/**
 * Clean up a specific job by ID
 * @param {string} jobId - UUID of the job to clean up
 * @returns {Promise<boolean>} - True if job was cleaned up
 */
async function cleanupJob(jobId) {
  try {
    const cleanupService = getCleanupService();
    return await cleanupService.cleanupJobById(jobId);
  } catch (error) {
    console.error(`Failed to cleanup job ${jobId}:`, error.message);
    throw error;
  }
}

/**
 * Get cleanup status and statistics
 * @returns {Promise<Object>} - Cleanup status information
 */
async function getCleanupStatus() {
  try {
    const cleanupService = getCleanupService();
    return await cleanupService.getCleanupStatus();
  } catch (error) {
    console.error('Failed to get cleanup status:', error.message);
    throw error;
  }
}

/**
 * Setup process handlers for graceful shutdown
 * @returns {void}
 */
function setupGracefulShutdown() {
  // Handle process termination signals
  const shutdownSignals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

  shutdownSignals.forEach((signal) => {
    process.on(signal, async () => {
      console.log(`Received ${signal}, initiating graceful shutdown...`);

      try {
        await shutdownCleanup();
        console.log('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        console.error('Error during graceful shutdown:', error.message);
        process.exit(1);
      }
    });
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);

    try {
      await shutdownCleanup();
    } catch (shutdownError) {
      console.error('Error during emergency shutdown:', shutdownError.message);
    }

    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason, promise) => {
    console.error(
      'Unhandled promise rejection at:',
      promise,
      'reason:',
      reason
    );

    try {
      await shutdownCleanup();
    } catch (shutdownError) {
      console.error('Error during emergency shutdown:', shutdownError.message);
    }

    process.exit(1);
  });
}

module.exports = {
  getCleanupService,
  initializeCleanup,
  shutdownCleanup,
  performManualCleanup,
  cleanupJob,
  getCleanupStatus,
  setupGracefulShutdown,
};
