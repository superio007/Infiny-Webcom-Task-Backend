const {
  validateDebitCreditExclusivity,
  validateAndFormatDate,
  validateMonetaryAmount,
  validateTransaction,
  validateAccountTransactions,
} = require('./index');

describe('Transaction Validation Functions', () => {
  describe('validateDebitCreditExclusivity', () => {
    it('should pass when only debit is populated', () => {
      const transaction = { debit: 100, credit: null };
      const result = validateDebitCreditExclusivity(transaction);
      expect(result.isValid).toBe(true);
    });

    it('should pass when only credit is populated', () => {
      const transaction = { debit: null, credit: 50 };
      const result = validateDebitCreditExclusivity(transaction);
      expect(result.isValid).toBe(true);
    });

    it('should pass when both are null', () => {
      const transaction = { debit: null, credit: null };
      const result = validateDebitCreditExclusivity(transaction);
      expect(result.isValid).toBe(true);
    });

    it('should fail when both debit and credit are populated', () => {
      const transaction = { debit: 100, credit: 50 };
      const result = validateDebitCreditExclusivity(transaction);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('cannot have both debit and credit');
    });

    it('should fail for invalid transaction object', () => {
      const result = validateDebitCreditExclusivity(null);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Transaction must be an object');
    });
  });

  describe('validateAndFormatDate', () => {
    it('should pass and return null for null input', () => {
      const result = validateAndFormatDate(null);
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(null);
    });

    it('should pass for valid ISO date format', () => {
      const result = validateAndFormatDate('2023-12-25');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('2023-12-25');
    });

    it('should format DD/MM/YYYY to ISO format', () => {
      const result = validateAndFormatDate('25/12/2023');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('2023-12-25');
    });

    it('should format DD-MM-YYYY to ISO format', () => {
      const result = validateAndFormatDate('25-12-2023');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('2023-12-25');
    });

    it('should format YYYY/MM/DD to ISO format', () => {
      const result = validateAndFormatDate('2023/12/25');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('2023-12-25');
    });

    it('should format DD.MM.YYYY to ISO format', () => {
      const result = validateAndFormatDate('25.12.2023');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('2023-12-25');
    });

    it('should fail for invalid date string', () => {
      const result = validateAndFormatDate('invalid-date');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Unable to parse date');
    });

    it('should fail for non-string input', () => {
      const result = validateAndFormatDate(123);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Date must be a string or null');
    });

    it('should fail for invalid date values', () => {
      const result = validateAndFormatDate('2023-13-45');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid date value');
    });
  });

  describe('validateMonetaryAmount', () => {
    it('should pass and return null for null input', () => {
      const result = validateMonetaryAmount(null);
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(null);
    });

    it('should pass for valid number', () => {
      const result = validateMonetaryAmount(123.45);
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(123.45);
    });

    it('should convert valid string to number', () => {
      const result = validateMonetaryAmount('123.45');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(123.45);
    });

    it('should handle currency symbols', () => {
      const result = validateMonetaryAmount('$123.45');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(123.45);
    });

    it('should handle commas in amounts', () => {
      const result = validateMonetaryAmount('1,234.56');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(1234.56);
    });

    it('should handle various currency symbols', () => {
      const symbols = ['£123.45', '€123.45', '¥123', '₹123.45'];
      symbols.forEach((amount) => {
        const result = validateMonetaryAmount(amount);
        expect(result.isValid).toBe(true);
        expect(typeof result.value).toBe('number');
      });
    });

    it('should handle empty string as null', () => {
      const result = validateMonetaryAmount('');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(null);
    });

    it('should fail for infinite numbers', () => {
      const result = validateMonetaryAmount(Infinity);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('finite number');
    });

    it('should fail for NaN', () => {
      const result = validateMonetaryAmount(NaN);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('finite number');
    });

    it('should fail for invalid string', () => {
      const result = validateMonetaryAmount('not-a-number');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('convert monetary amount');
    });

    it('should fail for invalid types', () => {
      const result = validateMonetaryAmount({});
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('must be a number, string, or null');
    });
  });

  describe('validateTransaction', () => {
    it('should validate a complete valid transaction', () => {
      const transaction = {
        date: '2023-12-25',
        description: 'Test transaction',
        debit: 100.5,
        credit: null,
        balance: 500.25,
      };
      const result = validateTransaction(transaction);
      expect(result.isValid).toBe(true);
      expect(result.value.date).toBe('2023-12-25');
      expect(result.value.debit).toBe(100.5);
    });

    it('should format date and convert monetary amounts', () => {
      const transaction = {
        date: '25/12/2023',
        description: 'Test transaction',
        debit: '$100.50',
        credit: null,
        balance: '500.25',
      };
      const result = validateTransaction(transaction);
      expect(result.isValid).toBe(true);
      expect(result.value.date).toBe('2023-12-25');
      expect(result.value.debit).toBe(100.5);
      expect(result.value.balance).toBe(500.25);
    });

    it('should fail for debit/credit exclusivity violation', () => {
      const transaction = {
        date: '2023-12-25',
        description: 'Test transaction',
        debit: 100,
        credit: 50,
        balance: null,
      };
      const result = validateTransaction(transaction);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('cannot have both debit and credit');
    });

    it('should fail for missing description', () => {
      const transaction = {
        date: '2023-12-25',
        description: '',
        debit: 100,
        credit: null,
        balance: null,
      };
      const result = validateTransaction(transaction);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Description must be a non-empty string');
    });

    it('should fail for invalid date', () => {
      const transaction = {
        date: 'invalid-date',
        description: 'Test transaction',
        debit: 100,
        credit: null,
        balance: null,
      };
      const result = validateTransaction(transaction);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Date validation failed');
    });

    it('should fail for non-object input', () => {
      const result = validateTransaction(null);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Transaction must be an object');
    });
  });

  describe('validateAccountTransactions', () => {
    it('should validate array of valid transactions', () => {
      const transactions = [
        {
          date: '2023-12-25',
          description: 'Transaction 1',
          debit: 100,
          credit: null,
          balance: 500,
        },
        {
          date: '2023-12-26',
          description: 'Transaction 2',
          debit: null,
          credit: 50,
          balance: 550,
        },
      ];
      const result = validateAccountTransactions(transactions);
      expect(result.isValid).toBe(true);
      expect(result.value).toHaveLength(2);
    });

    it('should fail for non-array input', () => {
      const result = validateAccountTransactions('not-an-array');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Transactions must be an array');
    });

    it('should fail when any transaction is invalid', () => {
      const transactions = [
        {
          date: '2023-12-25',
          description: 'Valid transaction',
          debit: 100,
          credit: null,
          balance: 500,
        },
        {
          date: 'invalid-date',
          description: 'Invalid transaction',
          debit: null,
          credit: 50,
          balance: 550,
        },
      ];
      const result = validateAccountTransactions(transactions);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Transaction 1');
      expect(result.error).toContain('Date validation failed');
    });

    it('should validate empty array', () => {
      const result = validateAccountTransactions([]);
      expect(result.isValid).toBe(true);
      expect(result.value).toHaveLength(0);
    });
  });
});
