// Tests for data models and validation schemas
const {
  JobStatus,
  AccountType,
  Job,
  Transaction,
  BankAccount,
  BankStatementData,
  UploadResponse,
  ProcessResponse,
  ResultResponse,
  ErrorResponse,
} = require('./index');

const {
  validateBankStatementData,
  validateJob,
  validateUploadResponse,
  validateProcessResponse,
  validateResultResponse,
  validateGeminiOutput,
} = require('../validators');

describe('Data Models', () => {
  describe('Constants', () => {
    test('JobStatus should have correct values', () => {
      expect(JobStatus.UPLOADED).toBe('uploaded');
      expect(JobStatus.PROCESSING).toBe('processing');
      expect(JobStatus.PROCESSED).toBe('processed');
      expect(JobStatus.FAILED).toBe('failed');
    });

    test('AccountType should have correct values', () => {
      expect(AccountType.SAVINGS).toBe('Savings');
      expect(AccountType.CURRENT).toBe('Current');
    });
  });

  describe('Model Classes', () => {
    test('Transaction should create valid instance', () => {
      const transaction = new Transaction({
        date: '2024-01-15',
        description: 'Test transaction',
        debit: 100.5,
        credit: null,
        balance: 500.25,
      });

      expect(transaction.date).toBe('2024-01-15');
      expect(transaction.description).toBe('Test transaction');
      expect(transaction.debit).toBe(100.5);
      expect(transaction.credit).toBe(null);
      expect(transaction.balance).toBe(500.25);
    });

    test('BankAccount should create valid instance', () => {
      const account = new BankAccount({
        bankName: 'Test Bank',
        accountHolderName: 'John Doe',
        accountNumber: '123456789',
        accountType: AccountType.SAVINGS,
        currency: 'USD',
        statementStartDate: '2024-01-01',
        statementEndDate: '2024-01-31',
        openingBalance: 1000.0,
        closingBalance: 1200.0,
        transactions: [],
      });

      expect(account.bankName).toBe('Test Bank');
      expect(account.accountType).toBe('Savings');
      expect(account.transactions).toEqual([]);
    });

    test('Job should create valid instance', () => {
      const jobId = '123e4567-e89b-12d3-a456-426614174000';
      const job = new Job({
        jobId,
        fileName: 'test.pdf',
        s3Key: 'statements/test-uuid.pdf',
        status: JobStatus.UPLOADED,
      });

      expect(job.jobId).toBe(jobId);
      expect(job.fileName).toBe('test.pdf');
      expect(job.status).toBe('uploaded');
      expect(job.accountsDetected).toBe(null);
    });
  });

  describe('Response Classes', () => {
    test('UploadResponse should create valid instance', () => {
      const response = new UploadResponse({
        jobId: '123e4567-e89b-12d3-a456-426614174000',
        fileName: 'test.pdf',
      });

      expect(response.jobId).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(response.fileName).toBe('test.pdf');
      expect(response.status).toBe('uploaded');
    });

    test('ProcessResponse should create valid instance', () => {
      const response = new ProcessResponse({
        jobId: '123e4567-e89b-12d3-a456-426614174000',
        accountsDetected: 2,
      });

      expect(response.jobId).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(response.status).toBe('processed');
      expect(response.accountsDetected).toBe(2);
    });
  });
});

describe('Validation Schemas', () => {
  describe('BankStatementData validation', () => {
    test('should validate valid bank statement data', () => {
      const validData = {
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
            closingBalance: 1200.0,
            transactions: [
              {
                date: '2024-01-15',
                description: 'Test transaction',
                debit: null,
                credit: 100.5,
                balance: 1100.5,
              },
            ],
          },
        ],
      };

      const result = validateBankStatementData(validData);
      expect(result.isValid).toBe(true);
      expect(result.value).toBeDefined();
    });

    test('should reject data with both debit and credit populated', () => {
      const invalidData = {
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
            closingBalance: 1200.0,
            transactions: [
              {
                date: '2024-01-15',
                description: 'Test transaction',
                debit: 50.0, // Both debit and credit populated - should fail
                credit: 100.5,
                balance: 1100.5,
              },
            ],
          },
        ],
      };

      const result = validateBankStatementData(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.error.details[0].message).toContain('debit and credit');
    });

    test('should accept null values for optional fields', () => {
      const dataWithNulls = {
        fileName: 'test.pdf',
        accounts: [
          {
            bankName: null,
            accountHolderName: null,
            accountNumber: null,
            accountType: null,
            currency: null,
            statementStartDate: null,
            statementEndDate: null,
            openingBalance: null,
            closingBalance: null,
            transactions: [],
          },
        ],
      };

      const result = validateBankStatementData(dataWithNulls);
      expect(result.isValid).toBe(true);
    });

    test('should validate date format (YYYY-MM-DD)', () => {
      const invalidDateData = {
        fileName: 'test.pdf',
        accounts: [
          {
            bankName: 'Test Bank',
            statementStartDate: '01/01/2024', // Invalid format
            transactions: [],
          },
        ],
      };

      const result = validateBankStatementData(invalidDateData);
      expect(result.isValid).toBe(false);
    });

    test('should validate account type enumeration', () => {
      const invalidAccountTypeData = {
        fileName: 'test.pdf',
        accounts: [
          {
            bankName: 'Test Bank',
            accountType: 'Checking', // Invalid account type
            transactions: [],
          },
        ],
      };

      const result = validateBankStatementData(invalidAccountTypeData);
      expect(result.isValid).toBe(false);
    });

    test('should validate monetary amounts as numbers', () => {
      const stringAmountData = {
        fileName: 'test.pdf',
        accounts: [
          {
            bankName: 'Test Bank',
            openingBalance: 'not-a-number', // Should be number, not string
            transactions: [],
          },
        ],
      };

      const result = validateBankStatementData(stringAmountData);
      expect(result.isValid).toBe(false);
    });
  });

  describe('Response validation', () => {
    test('should validate upload response', () => {
      const uploadResponse = {
        jobId: '123e4567-e89b-12d3-a456-426614174000',
        fileName: 'test.pdf',
        status: 'uploaded',
      };

      const result = validateUploadResponse(uploadResponse);
      expect(result.isValid).toBe(true);
    });

    test('should validate process response', () => {
      const processResponse = {
        jobId: '123e4567-e89b-12d3-a456-426614174000',
        status: 'processed',
        accountsDetected: 2,
      };

      const result = validateProcessResponse(processResponse);
      expect(result.isValid).toBe(true);
    });
  });
});
