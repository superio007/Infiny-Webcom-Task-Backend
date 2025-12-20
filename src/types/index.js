// Type definitions and constants for the bank statement API

// Job Status Constants
const JobStatus = {
  UPLOADED: 'uploaded',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed',
};

// Account Type Constants
const AccountType = {
  SAVINGS: 'Savings',
  CURRENT: 'Current',
};

// Job Model Structure
class Job {
  constructor({
    jobId,
    fileName,
    s3Key,
    status = JobStatus.UPLOADED,
    accountsDetected = null,
    processedData = null,
    errorMessage = null,
    createdAt = new Date(),
    updatedAt = new Date(),
  }) {
    this.jobId = jobId; // UUID
    this.fileName = fileName; // Original filename
    this.s3Key = s3Key; // S3 storage key
    this.status = status; // Processing status
    this.accountsDetected = accountsDetected; // Number of accounts detected
    this.processedData = processedData; // BankStatementData object
    this.errorMessage = errorMessage; // Error message if failed
    this.createdAt = createdAt; // Creation timestamp
    this.updatedAt = updatedAt; // Last update timestamp
  }
}

// Transaction Model Structure
class Transaction {
  constructor({
    date,
    description,
    debit = null,
    credit = null,
    balance = null,
  }) {
    this.date = date; // YYYY-MM-DD format
    this.description = description; // Transaction description
    this.debit = debit; // Debit amount as number or null
    this.credit = credit; // Credit amount as number or null
    this.balance = balance; // Balance after transaction as number or null
  }
}

// Bank Account Model Structure
class BankAccount {
  constructor({
    bankName = null,
    accountHolderName = null,
    accountNumber = null,
    accountType = null,
    currency = null,
    statementStartDate = null,
    statementEndDate = null,
    openingBalance = null,
    closingBalance = null,
    transactions = [],
  }) {
    this.bankName = bankName; // Bank name or null
    this.accountHolderName = accountHolderName; // Account holder name or null
    this.accountNumber = accountNumber; // Account number or null
    this.accountType = accountType; // "Savings", "Current", or null
    this.currency = currency; // Currency code or null
    this.statementStartDate = statementStartDate; // YYYY-MM-DD or null
    this.statementEndDate = statementEndDate; // YYYY-MM-DD or null
    this.openingBalance = openingBalance; // Opening balance as number or null
    this.closingBalance = closingBalance; // Closing balance as number or null
    this.transactions = transactions; // Array of Transaction objects
  }
}

// Bank Statement Data Model Structure
class BankStatementData {
  constructor({ fileName, accounts = [] }) {
    this.fileName = fileName; // Original filename
    this.accounts = accounts; // Array of BankAccount objects
  }
}

// API Response Models

// Upload Response Structure
class UploadResponse {
  constructor({ jobId, fileName, status = JobStatus.UPLOADED }) {
    this.jobId = jobId; // UUID of created job
    this.fileName = fileName; // Original filename
    this.status = status; // Always "uploaded" for successful uploads
  }
}

// Process Response Structure
class ProcessResponse {
  constructor({ jobId, status = JobStatus.PROCESSED, accountsDetected }) {
    this.jobId = jobId; // UUID of processed job
    this.status = status; // Always "processed" for successful processing
    this.accountsDetected = accountsDetected; // Number of accounts found
  }
}

// Result Response Structure
class ResultResponse {
  constructor({ fileName, accounts }) {
    this.fileName = fileName; // Original filename
    this.accounts = accounts; // Array of BankAccount objects
  }
}

// Error Response Structure
class ErrorResponse {
  constructor({
    code,
    message,
    details = null,
    jobId = null,
    timestamp = new Date().toISOString(),
  }) {
    this.error = {
      code,
      message,
      details,
      timestamp,
    };
    if (jobId) {
      this.jobId = jobId;
    }
  }
}

module.exports = {
  // Constants
  JobStatus,
  AccountType,

  // Model Classes
  Job,
  Transaction,
  BankAccount,
  BankStatementData,

  // Response Classes
  UploadResponse,
  ProcessResponse,
  ResultResponse,
  ErrorResponse,
};
