const GeminiService = require('./geminiService');

// Mock the Google Generative AI module
jest.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: jest.fn(),
      }),
    })),
  };
});

describe('GeminiService', () => {
  let geminiService;
  let mockModel;

  beforeEach(() => {
    // Set up environment variable
    process.env.GEMINI_API_KEY = 'test-api-key';

    // Create service instance
    geminiService = new GeminiService();
    mockModel = geminiService.model;
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  describe('constructor', () => {
    it('should throw error if GEMINI_API_KEY is not provided', () => {
      delete process.env.GEMINI_API_KEY;
      expect(() => new GeminiService()).toThrow(
        'GEMINI_API_KEY environment variable is required'
      );
    });

    it('should initialize with correct model', () => {
      expect(geminiService.model).toBeDefined();
    });
  });

  describe('normalizeTextractData', () => {
    const mockTextractData = {
      Blocks: [
        { BlockType: 'PAGE', Id: '1' },
        { BlockType: 'LINE', Text: 'Bank Statement' },
      ],
    };

    const mockValidResponse = {
      fileName: 'test.pdf',
      accounts: [
        {
          bankName: 'Test Bank',
          accountHolderName: 'John Doe',
          accountNumber: '123456789',
          accountType: 'Savings',
          currency: 'USD',
          statementStartDate: '2024-01-01',
          statementEndDate: '2024-01-31',
          openingBalance: 1000.0,
          closingBalance: 1500.0,
          transactions: [
            {
              date: '2024-01-15',
              description: 'Deposit',
              debit: null,
              credit: 500.0,
              balance: 1500.0,
            },
          ],
        },
      ],
    };

    it('should successfully normalize valid textract data', async () => {
      mockModel.generateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(mockValidResponse),
        },
      });

      const result = await geminiService.normalizeTextractData(
        mockTextractData,
        'test.pdf'
      );

      expect(result).toEqual(mockValidResponse);
      expect(mockModel.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should throw error for invalid textractData', async () => {
      await expect(
        geminiService.normalizeTextractData(null, 'test.pdf')
      ).rejects.toThrow('Invalid textractData: must be a valid object');
    });

    it('should throw error for invalid fileName', async () => {
      await expect(
        geminiService.normalizeTextractData(mockTextractData, '')
      ).rejects.toThrow('Invalid fileName: must be a non-empty string');
    });

    it('should handle JSON parsing errors', async () => {
      mockModel.generateContent.mockResolvedValue({
        response: {
          text: () => 'invalid json response',
        },
      });

      await expect(
        geminiService.normalizeTextractData(mockTextractData, 'test.pdf')
      ).rejects.toThrow('Failed to normalize Textract data');
    });

    it('should handle schema validation errors', async () => {
      const invalidResponse = {
        fileName: 'test.pdf',
        accounts: [
          {
            accountType: 'InvalidType', // Invalid account type
          },
        ],
      };

      mockModel.generateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(invalidResponse),
        },
      });

      await expect(
        geminiService.normalizeTextractData(mockTextractData, 'test.pdf')
      ).rejects.toThrow('Failed to normalize Textract data');
    });

    it('should retry once on validation failure', async () => {
      const invalidResponse = { invalid: 'data' };
      const validResponse = mockValidResponse;

      mockModel.generateContent
        .mockResolvedValueOnce({
          response: { text: () => JSON.stringify(invalidResponse) },
        })
        .mockResolvedValueOnce({
          response: { text: () => JSON.stringify(validResponse) },
        });

      const result = await geminiService.normalizeTextractData(
        mockTextractData,
        'test.pdf'
      );

      expect(result).toEqual(validResponse);
      expect(mockModel.generateContent).toHaveBeenCalledTimes(2);
    });

    it('should fail after retry attempts are exhausted', async () => {
      const invalidResponse = { invalid: 'data' };

      mockModel.generateContent.mockResolvedValue({
        response: { text: () => JSON.stringify(invalidResponse) },
      });

      await expect(
        geminiService.normalizeTextractData(mockTextractData, 'test.pdf')
      ).rejects.toThrow('Failed to normalize Textract data');

      expect(mockModel.generateContent).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });
  });

  describe('_validateJsonResponse', () => {
    it('should parse valid JSON', () => {
      const validJson = '{"test": "data"}';
      const result = geminiService._validateJsonResponse(validJson);
      expect(result).toEqual({ test: 'data' });
    });

    it('should handle JSON wrapped in markdown code blocks', () => {
      const markdownJson = '```json\n{"test": "data"}\n```';
      const result = geminiService._validateJsonResponse(markdownJson);
      expect(result).toEqual({ test: 'data' });
    });

    it('should throw error for invalid JSON', () => {
      const invalidJson = 'not json';
      expect(() => geminiService._validateJsonResponse(invalidJson)).toThrow(
        'Invalid JSON response from Gemini'
      );
    });

    it('should throw error for empty response', () => {
      expect(() => geminiService._validateJsonResponse('')).toThrow(
        'Empty or invalid response from Gemini'
      );
    });
  });
});
