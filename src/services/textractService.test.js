const TextractService = require('./textractService');

// Mock AWS SDK
jest.mock('@aws-sdk/client-textract');
const {
  TextractClient,
  AnalyzeDocumentCommand,
} = require('@aws-sdk/client-textract');

describe('TextractService', () => {
  let textractService;
  let mockSend;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Mock the send method
    mockSend = jest.fn();
    TextractClient.mockImplementation(() => ({
      send: mockSend,
    }));

    // Set required environment variables
    process.env.S3_BUCKET_NAME = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';

    textractService = new TextractService();
  });

  afterEach(() => {
    delete process.env.S3_BUCKET_NAME;
    delete process.env.AWS_REGION;
  });

  describe('constructor', () => {
    it('should throw error if S3_BUCKET_NAME is not set', () => {
      delete process.env.S3_BUCKET_NAME;
      expect(() => new TextractService()).toThrow(
        'S3_BUCKET_NAME environment variable is required'
      );
    });

    it('should create TextractClient with correct region', () => {
      expect(TextractClient).toHaveBeenCalledWith({
        region: 'us-east-1',
      });
    });
  });

  describe('analyzeDocument', () => {
    const mockTextractResponse = {
      Blocks: [
        {
          Id: '1',
          BlockType: 'LINE',
          Text: 'Sample text',
          Confidence: 99.5,
        },
      ],
      DocumentMetadata: {
        Pages: 1,
      },
      AnalyzeDocumentModelVersion: '1.0',
    };

    it('should analyze document with correct parameters', async () => {
      mockSend.mockResolvedValue(mockTextractResponse);

      const result = await textractService.analyzeDocument('test-key.pdf');

      expect(mockSend).toHaveBeenCalledWith(expect.any(AnalyzeDocumentCommand));
      expect(AnalyzeDocumentCommand).toHaveBeenCalledWith({
        Document: {
          S3Object: {
            Bucket: 'test-bucket',
            Name: 'test-key.pdf',
          },
        },
        FeatureTypes: ['FORMS', 'TABLES'],
      });

      expect(result).toEqual({
        Blocks: mockTextractResponse.Blocks,
        DocumentMetadata: mockTextractResponse.DocumentMetadata,
        AnalyzeDocumentModelVersion:
          mockTextractResponse.AnalyzeDocumentModelVersion,
        JobStatus: 'SUCCEEDED',
        StatusMessage: 'Document analysis completed successfully',
        ProcessedAt: expect.any(String),
      });
    });

    it('should handle InvalidS3ObjectException', async () => {
      const error = new Error('Invalid S3 object');
      error.name = 'InvalidS3ObjectException';
      mockSend.mockRejectedValue(error);

      await expect(
        textractService.analyzeDocument('invalid-key.pdf')
      ).rejects.toThrow('Invalid S3 object or file not found: invalid-key.pdf');
    });

    it('should handle UnsupportedDocumentException', async () => {
      const error = new Error('Unsupported document');
      error.name = 'UnsupportedDocumentException';
      mockSend.mockRejectedValue(error);

      await expect(
        textractService.analyzeDocument('unsupported.txt')
      ).rejects.toThrow('Unsupported document format: unsupported.txt');
    });

    it('should handle DocumentTooLargeException', async () => {
      const error = new Error('Document too large');
      error.name = 'DocumentTooLargeException';
      mockSend.mockRejectedValue(error);

      await expect(
        textractService.analyzeDocument('large.pdf')
      ).rejects.toThrow('Document too large for processing: large.pdf');
    });

    it('should handle ThrottlingException', async () => {
      const error = new Error('Throttling');
      error.name = 'ThrottlingException';
      mockSend.mockRejectedValue(error);

      await expect(textractService.analyzeDocument('test.pdf')).rejects.toThrow(
        'Textract service is throttling requests. Please retry later.'
      );
    });

    it('should handle generic errors', async () => {
      const error = new Error('Generic error');
      mockSend.mockRejectedValue(error);

      await expect(textractService.analyzeDocument('test.pdf')).rejects.toThrow(
        'Failed to analyze document with Textract: Generic error'
      );
    });
  });

  describe('extractFormsAndTables', () => {
    it('should extract forms and tables from Textract response', async () => {
      const mockResponse = {
        Blocks: [
          {
            Id: '1',
            BlockType: 'LINE',
            Text: 'Sample line',
            Confidence: 99.0,
          },
          {
            Id: '2',
            BlockType: 'KEY_VALUE_SET',
            EntityTypes: ['KEY'],
            Confidence: 95.0,
            Relationships: [
              {
                Type: 'VALUE',
                Ids: ['3'],
              },
              {
                Type: 'CHILD',
                Ids: ['4'],
              },
            ],
          },
          {
            Id: '3',
            BlockType: 'KEY_VALUE_SET',
            EntityTypes: ['VALUE'],
            Confidence: 90.0,
            Relationships: [
              {
                Type: 'CHILD',
                Ids: ['5'],
              },
            ],
          },
          {
            Id: '4',
            BlockType: 'WORD',
            Text: 'Name',
          },
          {
            Id: '5',
            BlockType: 'WORD',
            Text: 'John Doe',
          },
        ],
        DocumentMetadata: { Pages: 1 },
        AnalyzeDocumentModelVersion: '1.0',
      };

      const result = await textractService.extractFormsAndTables(mockResponse);

      expect(result).toEqual({
        forms: [
          {
            key: 'Name',
            value: 'John Doe',
            confidence: 90.0,
          },
        ],
        tables: [],
        lines: [
          {
            text: 'Sample line',
            confidence: 99.0,
            geometry: undefined,
          },
        ],
        metadata: {
          documentMetadata: { Pages: 1 },
          analyzeDocumentModelVersion: '1.0',
          processedAt: expect.any(String),
        },
      });
    });

    it('should handle empty blocks array', async () => {
      const mockResponse = {
        Blocks: [],
        DocumentMetadata: {},
        AnalyzeDocumentModelVersion: '',
      };

      const result = await textractService.extractFormsAndTables(mockResponse);

      expect(result).toEqual({
        forms: [],
        tables: [],
        lines: [],
        metadata: {
          documentMetadata: {},
          analyzeDocumentModelVersion: '',
          processedAt: expect.any(String),
        },
      });
    });

    it('should handle extraction errors', async () => {
      const invalidResponse = null;

      await expect(
        textractService.extractFormsAndTables(invalidResponse)
      ).rejects.toThrow('Failed to extract forms and tables:');
    });
  });
});
