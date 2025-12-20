const StorageService = require('./storageService');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3');
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));

describe('StorageService', () => {
  let storageService;
  let mockS3Client;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock S3Client
    mockS3Client = {
      send: jest.fn(),
    };
    S3Client.mockImplementation(() => mockS3Client);

    // Set environment variable
    process.env.S3_BUCKET_NAME = 'test-bucket';

    storageService = new StorageService();
  });

  afterEach(() => {
    delete process.env.S3_BUCKET_NAME;
  });

  describe('constructor', () => {
    it('should throw error if S3_BUCKET_NAME is not set', () => {
      delete process.env.S3_BUCKET_NAME;
      expect(() => new StorageService()).toThrow(
        'S3_BUCKET_NAME environment variable is required'
      );
    });

    it('should initialize with correct bucket name', () => {
      expect(storageService.bucketName).toBe('test-bucket');
    });
  });

  describe('uploadFile', () => {
    it('should upload file with UUID-based naming', async () => {
      const buffer = Buffer.from('test file content');
      const contentType = 'application/pdf';
      const originalFileName = 'test-document.pdf';

      mockS3Client.send.mockResolvedValue({});

      const result = await storageService.uploadFile(
        buffer,
        contentType,
        originalFileName
      );

      expect(result).toBe('test-uuid-1234.pdf');
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(PutObjectCommand)
      );
    });

    it('should handle files without extension', async () => {
      const buffer = Buffer.from('test content');
      const contentType = 'application/pdf';
      const originalFileName = 'testfile';

      mockS3Client.send.mockResolvedValue({});

      const result = await storageService.uploadFile(
        buffer,
        contentType,
        originalFileName
      );

      expect(result).toBe('test-uuid-1234');
      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(PutObjectCommand)
      );
    });

    it('should throw error on S3 failure', async () => {
      const buffer = Buffer.from('test content');
      const contentType = 'application/pdf';
      const originalFileName = 'test.pdf';

      mockS3Client.send.mockRejectedValue(new Error('S3 error'));

      await expect(
        storageService.uploadFile(buffer, contentType, originalFileName)
      ).rejects.toThrow('Failed to upload file to S3: S3 error');
    });
  });

  describe('getFile', () => {
    it('should retrieve file from S3', async () => {
      const s3Key = 'test-uuid-1234.pdf';
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('chunk1');
          yield Buffer.from('chunk2');
        },
      };

      mockS3Client.send.mockResolvedValue({
        Body: mockStream,
      });

      const result = await storageService.getFile(s3Key);

      expect(result).toEqual(Buffer.from('chunk1chunk2'));
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(GetObjectCommand)
      );
    });

    it('should throw specific error for missing file', async () => {
      const s3Key = 'missing-file.pdf';
      const error = new Error('Not found');
      error.name = 'NoSuchKey';

      mockS3Client.send.mockRejectedValue(error);

      await expect(storageService.getFile(s3Key)).rejects.toThrow(
        'File not found in S3: missing-file.pdf'
      );
    });

    it('should throw generic error for other S3 failures', async () => {
      const s3Key = 'test-file.pdf';
      mockS3Client.send.mockRejectedValue(new Error('S3 error'));

      await expect(storageService.getFile(s3Key)).rejects.toThrow(
        'Failed to retrieve file from S3: S3 error'
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete file from S3', async () => {
      const s3Key = 'test-uuid-1234.pdf';

      mockS3Client.send.mockResolvedValue({});

      await storageService.deleteFile(s3Key);

      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(DeleteObjectCommand)
      );
    });

    it('should not throw error if file does not exist', async () => {
      const s3Key = 'missing-file.pdf';
      const error = new Error('Not found');
      error.name = 'NoSuchKey';

      mockS3Client.send.mockRejectedValue(error);

      await expect(storageService.deleteFile(s3Key)).resolves.not.toThrow();
    });

    it('should throw error for other S3 failures', async () => {
      const s3Key = 'test-file.pdf';
      mockS3Client.send.mockRejectedValue(new Error('S3 error'));

      await expect(storageService.deleteFile(s3Key)).rejects.toThrow(
        'Failed to delete file from S3: S3 error'
      );
    });
  });

  describe('_getFileExtension', () => {
    it('should extract file extension correctly', () => {
      expect(storageService._getFileExtension('test.pdf')).toBe('.pdf');
      expect(storageService._getFileExtension('document.doc.pdf')).toBe('.pdf');
      expect(storageService._getFileExtension('noextension')).toBe('');
      expect(storageService._getFileExtension('.hidden')).toBe('.hidden');
    });
  });
});
