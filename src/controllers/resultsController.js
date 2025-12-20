const JobManager = require('../services/jobManager');
const { ResultResponse, ErrorResponse, JobStatus } = require('../types');
const { AppError } = require('../middleware');

/**
 * ResultsController handles retrieval of processed bank statement data
 * Implements GET /api/statements/result/:jobId endpoint with data sanitization
 */
class ResultsController {
  constructor() {
    this.jobManager = JobManager.getInstance();
  }

  /**
   * Retrieve processed bank statement data for a specific job
   * GET /api/statements/result/:jobId
   *
   * Requirements addressed:
   * - 3.1: Return processed data for specified job
   * - 3.2: Include fileName and accounts array in response
   * - 3.4: Multi-account separation (handled by data structure)
   * - 3.5: Never expose raw Textract blocks
   */
  async getResult(req, res) {
    const { jobId } = req.params;

    // Validate jobId parameter
    if (!jobId || typeof jobId !== 'string') {
      throw new AppError(
        'jobId parameter is required and must be a valid string',
        400,
        'INVALID_JOB_ID',
        { jobId: jobId || null }
      );
    }

    // Retrieve job from JobManager
    let job;
    try {
      job = await this.jobManager.getJobResult(jobId);
    } catch (error) {
      // Handle job not found error
      if (error.message.includes('Job not found')) {
        throw new AppError(
          `No job found with ID: ${jobId}`,
          404,
          'JOB_NOT_FOUND',
          { jobId }
        );
      }
      throw error; // Re-throw other errors
    }

    // Check if job has been processed successfully
    if (job.status !== JobStatus.PROCESSED) {
      throw new AppError(
        `Job ${jobId} has not been processed successfully. Current status: ${job.status}`,
        400,
        'JOB_NOT_PROCESSED',
        {
          jobId,
          currentStatus: job.status,
          errorMessage: job.errorMessage || null,
        }
      );
    }

    // Ensure processed data exists
    if (!job.processedData) {
      throw new AppError(
        'Job marked as processed but no data available',
        500,
        'MISSING_PROCESSED_DATA',
        { jobId }
      );
    }

    // Sanitize data to ensure no raw Textract data is exposed
    const sanitizedData = this._sanitizeProcessedData(job.processedData);

    // Create result response with multi-account separation
    const resultResponse = new ResultResponse({
      fileName: sanitizedData.fileName,
      accounts: sanitizedData.accounts,
    });

    return res.status(200).json(resultResponse);
  }

  /**
   * Sanitize processed data to ensure no raw Textract data is exposed
   * This method ensures only clean, structured bank statement data is returned
   *
   * @param {Object} processedData - The processed data from the job
   * @returns {Object} - Sanitized data safe for client consumption
   * @private
   */
  _sanitizeProcessedData(processedData) {
    // Ensure we only return the expected structure
    const sanitized = {
      fileName: processedData.fileName || null,
      accounts: [],
    };

    // Process accounts array with multi-account separation
    if (processedData.accounts && Array.isArray(processedData.accounts)) {
      sanitized.accounts = processedData.accounts.map((account) => {
        return {
          bankName: account.bankName || null,
          accountHolderName: account.accountHolderName || null,
          accountNumber: account.accountNumber || null,
          accountType: account.accountType || null,
          currency: account.currency || null,
          statementStartDate: account.statementStartDate || null,
          statementEndDate: account.statementEndDate || null,
          openingBalance: account.openingBalance || null,
          closingBalance: account.closingBalance || null,
          transactions: this._sanitizeTransactions(account.transactions || []),
        };
      });
    }

    return sanitized;
  }

  /**
   * Sanitize transaction data to ensure proper formatting and no raw data exposure
   *
   * @param {Array} transactions - Array of transaction objects
   * @returns {Array} - Sanitized transaction array
   * @private
   */
  _sanitizeTransactions(transactions) {
    if (!Array.isArray(transactions)) {
      return [];
    }

    return transactions.map((transaction) => {
      return {
        date: transaction.date || null,
        description: transaction.description || null,
        debit: transaction.debit || null,
        credit: transaction.credit || null,
        balance: transaction.balance || null,
      };
    });
  }
}

module.exports = ResultsController;
