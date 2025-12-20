// Joi validation schemas for data validation
const Joi = require('joi');
const { JobStatus, AccountType } = require('../types');

// Date validation schema (YYYY-MM-DD format)
const dateSchema = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .allow(null);

// UUID validation schema
const uuidSchema = Joi.string().uuid();

// Transaction validation schema
const transactionSchema = Joi.object({
  date: dateSchema.required(),
  description: Joi.string().required(),
  debit: Joi.number().allow(null),
  credit: Joi.number().allow(null),
  balance: Joi.number().allow(null),
})
  .custom((value, helpers) => {
    // Ensure debit and credit are never both populated (exclusivity rule)
    if (value.debit !== null && value.credit !== null) {
      return helpers.error('custom.debitCreditExclusive');
    }
    return value;
  }, 'Transaction debit/credit exclusivity validation')
  .messages({
    'custom.debitCreditExclusive':
      'Transaction cannot have both debit and credit values populated',
  });

// Bank Account validation schema
const bankAccountSchema = Joi.object({
  bankName: Joi.string().allow(null),
  accountHolderName: Joi.string().allow(null),
  accountNumber: Joi.string().allow(null),
  accountType: Joi.string()
    .valid(...Object.values(AccountType))
    .allow(null),
  currency: Joi.string().allow(null),
  statementStartDate: dateSchema,
  statementEndDate: dateSchema,
  openingBalance: Joi.number().allow(null),
  closingBalance: Joi.number().allow(null),
  transactions: Joi.array().items(transactionSchema).default([]),
});

// Bank Statement Data validation schema
const bankStatementDataSchema = Joi.object({
  fileName: Joi.string().required(),
  accounts: Joi.array().items(bankAccountSchema).required(),
});

// Job validation schema
const jobSchema = Joi.object({
  jobId: uuidSchema.required(),
  fileName: Joi.string().required(),
  s3Key: Joi.string().required(),
  status: Joi.string()
    .valid(...Object.values(JobStatus))
    .required(),
  accountsDetected: Joi.number().integer().min(0).allow(null),
  processedData: bankStatementDataSchema.allow(null),
  errorMessage: Joi.string().allow(null),
  createdAt: Joi.date().required(),
  updatedAt: Joi.date().required(),
});

// API Request/Response validation schemas

// Upload Response validation schema
const uploadResponseSchema = Joi.object({
  jobId: uuidSchema.required(),
  fileName: Joi.string().required(),
  status: Joi.string().valid(JobStatus.UPLOADED).required(),
});

// Process Response validation schema
const processResponseSchema = Joi.object({
  jobId: uuidSchema.required(),
  status: Joi.string().valid(JobStatus.PROCESSED).required(),
  accountsDetected: Joi.number().integer().min(0).required(),
});

// Result Response validation schema
const resultResponseSchema = Joi.object({
  fileName: Joi.string().required(),
  accounts: Joi.array().items(bankAccountSchema).required(),
});

// Error Response validation schema
const errorResponseSchema = Joi.object({
  error: Joi.object({
    code: Joi.string().required(),
    message: Joi.string().required(),
    details: Joi.any().allow(null),
  }).required(),
  jobId: uuidSchema.allow(null),
  timestamp: Joi.string().isoDate().required(),
});

// File upload validation schema
const fileUploadSchema = Joi.object({
  fieldname: Joi.string().required(),
  originalname: Joi.string().required(),
  encoding: Joi.string().required(),
  mimetype: Joi.string().valid('application/pdf').required(),
  buffer: Joi.binary().required(),
  size: Joi.number().integer().min(1).required(),
});

// Process request parameters validation schema
const processParamsSchema = Joi.object({
  jobId: uuidSchema.required(),
});

// Result request parameters validation schema
const resultParamsSchema = Joi.object({
  jobId: uuidSchema.required(),
});

// Gemini AI output validation schema (for validating AI responses)
const geminiOutputSchema = bankStatementDataSchema;

// Transaction-specific validation functions

/**
 * Validate debit/credit exclusivity for a transaction
 * Requirements: 4.5 - debit and credit must never both be populated
 */
const validateDebitCreditExclusivity = (transaction) => {
  if (!transaction || typeof transaction !== 'object') {
    return {
      isValid: false,
      error: 'Transaction must be an object',
    };
  }

  const hasDebit =
    transaction.debit !== null && transaction.debit !== undefined;
  const hasCredit =
    transaction.credit !== null && transaction.credit !== undefined;

  if (hasDebit && hasCredit) {
    return {
      isValid: false,
      error: 'Transaction cannot have both debit and credit values populated',
    };
  }

  return { isValid: true };
};

/**
 * Validate and format date to ISO YYYY-MM-DD format
 * Requirements: 5.3 - dates must be formatted as ISO YYYY-MM-DD strings
 */
const validateAndFormatDate = (dateValue) => {
  if (dateValue === null || dateValue === undefined) {
    return { isValid: true, value: null };
  }

  if (typeof dateValue !== 'string') {
    return {
      isValid: false,
      error: 'Date must be a string or null',
    };
  }

  // Check if already in correct format
  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (isoDatePattern.test(dateValue)) {
    // Validate it's a real date
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) {
      return {
        isValid: false,
        error: 'Invalid date value',
      };
    }
    return { isValid: true, value: dateValue };
  }

  // Try to parse and format common date formats
  let parsedDate;

  // Try various common formats
  const commonFormats = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // MM/DD/YYYY or DD/MM/YYYY
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/, // MM-DD-YYYY or DD-MM-YYYY
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, // YYYY/MM/DD
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, // DD.MM.YYYY
  ];

  for (const format of commonFormats) {
    const match = dateValue.match(format);
    if (match) {
      // For YYYY/MM/DD format
      if (format === commonFormats[2]) {
        parsedDate = new Date(match[1], match[2] - 1, match[3]);
      } else {
        // Assume DD/MM/YYYY for other formats (common in bank statements)
        parsedDate = new Date(match[3], match[2] - 1, match[1]);
      }
      break;
    }
  }

  if (!parsedDate) {
    // Try direct parsing as fallback
    parsedDate = new Date(dateValue);
  }

  if (isNaN(parsedDate.getTime())) {
    return {
      isValid: false,
      error: 'Unable to parse date value',
    };
  }

  // Format to ISO YYYY-MM-DD
  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const day = String(parsedDate.getDate()).padStart(2, '0');
  const formattedDate = `${year}-${month}-${day}`;

  return { isValid: true, value: formattedDate };
};

/**
 * Validate and convert monetary amount to number
 * Requirements: 5.4 - monetary amounts must be stored as numbers not strings
 */
const validateMonetaryAmount = (amount) => {
  if (amount === null || amount === undefined) {
    return { isValid: true, value: null };
  }

  // If already a number, validate it's finite
  if (typeof amount === 'number') {
    if (!isFinite(amount)) {
      return {
        isValid: false,
        error: 'Monetary amount must be a finite number',
      };
    }
    return { isValid: true, value: amount };
  }

  // If string, try to convert to number
  if (typeof amount === 'string') {
    // Remove common currency symbols and whitespace
    const cleanAmount = amount
      .replace(/[$£€¥₹,\s]/g, '') // Remove currency symbols and commas
      .replace(/[()]/g, '') // Remove parentheses (sometimes used for negative)
      .trim();

    if (cleanAmount === '') {
      return { isValid: true, value: null };
    }

    const numericAmount = parseFloat(cleanAmount);

    if (isNaN(numericAmount) || !isFinite(numericAmount)) {
      return {
        isValid: false,
        error: 'Unable to convert monetary amount to valid number',
      };
    }

    return { isValid: true, value: numericAmount };
  }

  return {
    isValid: false,
    error: 'Monetary amount must be a number, string, or null',
  };
};

/**
 * Comprehensive transaction validation
 * Combines all transaction-specific validation rules
 */
const validateTransaction = (transaction) => {
  const errors = [];

  if (!transaction || typeof transaction !== 'object') {
    return {
      isValid: false,
      error: 'Transaction must be an object',
    };
  }

  // Validate date
  const dateValidation = validateAndFormatDate(transaction.date);
  if (!dateValidation.isValid) {
    errors.push(`Date validation failed: ${dateValidation.error}`);
  } else {
    transaction.date = dateValidation.value;
  }

  // Validate description
  if (!transaction.description || typeof transaction.description !== 'string') {
    errors.push('Description must be a non-empty string');
  }

  // Validate debit amount
  const debitValidation = validateMonetaryAmount(transaction.debit);
  if (!debitValidation.isValid) {
    errors.push(`Debit validation failed: ${debitValidation.error}`);
  } else {
    transaction.debit = debitValidation.value;
  }

  // Validate credit amount
  const creditValidation = validateMonetaryAmount(transaction.credit);
  if (!creditValidation.isValid) {
    errors.push(`Credit validation failed: ${creditValidation.error}`);
  } else {
    transaction.credit = creditValidation.value;
  }

  // Validate balance amount
  const balanceValidation = validateMonetaryAmount(transaction.balance);
  if (!balanceValidation.isValid) {
    errors.push(`Balance validation failed: ${balanceValidation.error}`);
  } else {
    transaction.balance = balanceValidation.value;
  }

  // Validate debit/credit exclusivity
  const exclusivityValidation = validateDebitCreditExclusivity(transaction);
  if (!exclusivityValidation.isValid) {
    errors.push(exclusivityValidation.error);
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      error: errors.join('; '),
    };
  }

  return { isValid: true, value: transaction };
};

/**
 * Validate all transactions in an account
 */
const validateAccountTransactions = (transactions) => {
  if (!Array.isArray(transactions)) {
    return {
      isValid: false,
      error: 'Transactions must be an array',
    };
  }

  const errors = [];
  const validatedTransactions = [];

  transactions.forEach((transaction, index) => {
    const validation = validateTransaction(transaction);
    if (!validation.isValid) {
      errors.push(`Transaction ${index}: ${validation.error}`);
    } else {
      validatedTransactions.push(validation.value);
    }
  });

  if (errors.length > 0) {
    return {
      isValid: false,
      error: errors.join('; '),
    };
  }

  return { isValid: true, value: validatedTransactions };
};

// Validation helper functions
const validateData = (schema, data) => {
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    allowUnknown: false,
    stripUnknown: true,
  });

  if (error) {
    const details = error.details.map((detail) => ({
      field: detail.path.join('.'),
      message: detail.message,
      value: detail.context?.value,
    }));

    return {
      isValid: false,
      error: {
        message: 'Validation failed',
        details,
      },
    };
  }

  return {
    isValid: true,
    value,
  };
};

const validateBankStatementData = (data) =>
  validateData(bankStatementDataSchema, data);
const validateJob = (data) => validateData(jobSchema, data);
const validateUploadResponse = (data) =>
  validateData(uploadResponseSchema, data);
const validateProcessResponse = (data) =>
  validateData(processResponseSchema, data);
const validateResultResponse = (data) =>
  validateData(resultResponseSchema, data);
const validateFileUpload = (data) => validateData(fileUploadSchema, data);
const validateProcessParams = (data) => validateData(processParamsSchema, data);
const validateResultParams = (data) => validateData(resultParamsSchema, data);
const validateGeminiOutput = (data) => validateData(geminiOutputSchema, data);

module.exports = {
  // Schemas
  transactionSchema,
  bankAccountSchema,
  bankStatementDataSchema,
  jobSchema,
  uploadResponseSchema,
  processResponseSchema,
  resultResponseSchema,
  errorResponseSchema,
  fileUploadSchema,
  processParamsSchema,
  resultParamsSchema,
  geminiOutputSchema,

  // Transaction-specific validation functions
  validateDebitCreditExclusivity,
  validateAndFormatDate,
  validateMonetaryAmount,
  validateTransaction,
  validateAccountTransactions,

  // Validation functions
  validateData,
  validateBankStatementData,
  validateJob,
  validateUploadResponse,
  validateProcessResponse,
  validateResultResponse,
  validateFileUpload,
  validateProcessParams,
  validateResultParams,
  validateGeminiOutput,
};
