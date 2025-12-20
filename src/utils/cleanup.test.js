const cleanup = require('./cleanup');
const CleanupService = require('../services/cleanupService');

// Mock the CleanupService
jest.mock('../services/cleanupService');

describe('Cleanup Utilities', () => {
  let mockCleanupService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset the singleton instance
    cleanup.getCleanupService().__reset = () => {
      // This is a test helper to reset the singleton
    };

    mockCleanupService = {
      startScheduledCleanup: jest.fn().mockResolvedValue(),
      shutdown: jest.fn().mockResolvedValue(),
      performCleanup: jest.fn().mockResolvedValue({ jobsDeleted: 5 }),
      cleanupJobById: jest.fn().mockResolvedValue(true),
      getCleanupStatus: jest.fn().mockResolvedValue({ totalJobs: 10 }),
    };

    CleanupService.mockImplementation(() => mockCleanupService);
  });

  describe('getCleanupService', () => {
    it('should return a singleton instance', () => {
      const service1 = cleanup.getCleanupService();
      const service2 = cleanup.getCleanupService();

      expect(service1).toBe(service2);
    });
  });

  describe('initializeCleanup', () => {
    it('should initialize cleanup service successfully', async () => {
      await cleanup.initializeCleanup();

      expect(mockCleanupService.startScheduledCleanup).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      mockCleanupService.startScheduledCleanup.mockRejectedValue(
        new Error('Init failed')
      );

      await expect(cleanup.initializeCleanup()).rejects.toThrow('Init failed');
    });
  });

  describe('shutdownCleanup', () => {
    it('should shutdown cleanup service successfully', async () => {
      // First initialize to create the instance
      await cleanup.initializeCleanup();

      await cleanup.shutdownCleanup();

      expect(mockCleanupService.shutdown).toHaveBeenCalled();
    });

    it('should handle shutdown when no instance exists', async () => {
      // Should not throw error when no instance exists
      await expect(cleanup.shutdownCleanup()).resolves.not.toThrow();
    });
  });

  describe('performManualCleanup', () => {
    it('should perform manual cleanup successfully', async () => {
      const result = await cleanup.performManualCleanup();

      expect(result).toEqual({ jobsDeleted: 5 });
      expect(mockCleanupService.performCleanup).toHaveBeenCalled();
    });

    it('should handle cleanup errors', async () => {
      mockCleanupService.performCleanup.mockRejectedValue(
        new Error('Cleanup failed')
      );

      await expect(cleanup.performManualCleanup()).rejects.toThrow(
        'Cleanup failed'
      );
    });
  });

  describe('cleanupJob', () => {
    it('should cleanup specific job successfully', async () => {
      const result = await cleanup.cleanupJob('test-job-id');

      expect(result).toBe(true);
      expect(mockCleanupService.cleanupJobById).toHaveBeenCalledWith(
        'test-job-id'
      );
    });

    it('should handle job cleanup errors', async () => {
      mockCleanupService.cleanupJobById.mockRejectedValue(
        new Error('Job cleanup failed')
      );

      await expect(cleanup.cleanupJob('test-job-id')).rejects.toThrow(
        'Job cleanup failed'
      );
    });
  });

  describe('getCleanupStatus', () => {
    it('should get cleanup status successfully', async () => {
      const result = await cleanup.getCleanupStatus();

      expect(result).toEqual({ totalJobs: 10 });
      expect(mockCleanupService.getCleanupStatus).toHaveBeenCalled();
    });

    it('should handle status retrieval errors', async () => {
      mockCleanupService.getCleanupStatus.mockRejectedValue(
        new Error('Status failed')
      );

      await expect(cleanup.getCleanupStatus()).rejects.toThrow('Status failed');
    });
  });

  describe('setupGracefulShutdown', () => {
    let originalProcessOn;
    let processListeners;

    beforeEach(() => {
      originalProcessOn = process.on;
      processListeners = {};

      // Mock process.on to capture listeners
      process.on = jest.fn((event, listener) => {
        processListeners[event] = listener;
        return originalProcessOn.call(process, event, listener);
      });
    });

    afterEach(() => {
      process.on = originalProcessOn;

      // Clean up listeners
      Object.keys(processListeners).forEach((event) => {
        if (processListeners[event]) {
          process.removeListener(event, processListeners[event]);
        }
      });
    });

    it('should setup process signal handlers', () => {
      cleanup.setupGracefulShutdown();

      expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('SIGUSR2', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith(
        'uncaughtException',
        expect.any(Function)
      );
      expect(process.on).toHaveBeenCalledWith(
        'unhandledRejection',
        expect.any(Function)
      );
    });
  });
});
