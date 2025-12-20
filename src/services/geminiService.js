const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require('@google/generative-ai');
const Joi = require('joi');

/**
 * GeminiService handles AI-powered normalization of Textract output
 * using Google Gemini gemini-2.5-flash model
 */
class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }

    this.genAI = new GoogleGenerativeAI(this.apiKey);
    
    // Enhanced model configuration with safety settings and tools
    this.modelConfig = {
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.1, // Lower temperature for more consistent JSON output
        topK: 1,
        topP: 0.8,
        // maxOutputTokens: 8192,
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
      ],
    };

    this.model = this.genAI.getGenerativeModel(this.modelConfig);

    // Enhanced system instruction
    this.systemInstruction = `You are a professional financial system helper specialized in bank statement data extraction. 

CRITICAL INSTRUCTIONS:
1. Analyze the provided Textract OCR data from a bank statement PDF
2. Extract structured financial information with high accuracy
3. Return ONLY valid JSON - no explanations, markdown, or additional text
4. Use null for missing or uncertain values - never guess or hallucinate data
5. If bank name is unclear from the text, search your knowledge for common bank identifiers

IMPORTANT JSON FORMATTING RULES:
- Return ONLY the JSON object, nothing else
- Ensure all JSON is properly formatted with correct commas and brackets
- Do not include any markdown code blocks or explanations
- All strings must be properly quoted
- All arrays and objects must be properly closed
- No trailing commas

REQUIRED JSON FORMAT (return exactly this structure):
{
  "fileName": "string",
  "accounts": [
    {
      "bankName": "string|null",
      "accountHolderName": "string|null", 
      "accountNumber": "string|null",
      "accountType": "Savings|Current|null",
      "currency": "string|null",
      "statementStartDate": "YYYY-MM-DD|null",
      "statementEndDate": "YYYY-MM-DD|null", 
      "openingBalance": number|null,
      "closingBalance": number|null,
      "transactions": [
        {
          "date": "YYYY-MM-DD",
          "description": "string",
          "debit": number|null,
          "credit": number|null, 
          "balance": number|null
        }
      ]
    }
  ]
}

VALIDATION RULES:
- Dates must be in YYYY-MM-DD format
- Monetary amounts must be numbers (not strings)
- Account types: only "Savings", "Current", or null
- Transactions: never populate both debit AND credit for same transaction
- Multiple accounts should be separate objects in accounts array

RESPOND WITH ONLY THE JSON OBJECT - NO OTHER TEXT OR FORMATTING.`;

    // Joi schema for validation
    this.validationSchema = Joi.object({
      fileName: Joi.string().required(),
      accounts: Joi.array()
        .items(
          Joi.object({
            bankName: Joi.string().allow(null),
            accountHolderName: Joi.string().allow(null),
            accountNumber: Joi.string().allow(null),
            accountType: Joi.string().valid('Savings', 'Current').allow(null),
            currency: Joi.string().allow(null),
            statementStartDate: Joi.string()
              .pattern(/^\d{4}-\d{2}-\d{2}$/)
              .allow(null),
            statementEndDate: Joi.string()
              .pattern(/^\d{4}-\d{2}-\d{2}$/)
              .allow(null),
            openingBalance: Joi.number().allow(null),
            closingBalance: Joi.number().allow(null),
            transactions: Joi.array()
              .items(
                Joi.object({
                  date: Joi.string()
                    .pattern(/^\d{4}-\d{2}-\d{2}$/)
                    .required(),
                  description: Joi.string().required(),
                  debit: Joi.number().allow(null),
                  credit: Joi.number().allow(null),
                  balance: Joi.number().allow(null),
                }).custom((value, helpers) => {
                  // Ensure debit and credit are never both populated
                  if (value.debit !== null && value.credit !== null) {
                    return helpers.error('custom.debitCreditExclusive');
                  }
                  return value;
                })
              )
              .required(),
          })
        )
        .required(),
    }).messages({
      'custom.debitCreditExclusive':
        'Transaction cannot have both debit and credit values',
    });
  }

  /**
   * Normalize Textract data using Gemini AI
   * @param {Object} textractData - Raw Textract JSON output
   * @param {string} fileName - Original PDF filename
   * @returns {Promise<Object>} Normalized bank statement data
   */
  async normalizeTextractData(textractData, fileName) {
    if (!textractData || typeof textractData !== 'object') {
      throw new Error('Invalid textractData: must be a valid object');
    }

    if (!fileName || typeof fileName !== 'string') {
      throw new Error('Invalid fileName: must be a non-empty string');
    }

    console.log(`🤖 Starting Gemini normalization for file: ${fileName}`);
    console.log(`📊 Textract data size: ${JSON.stringify(textractData).length} characters`);

    // Prepare the user prompt with Textract data
    const userPrompt = `Extract and normalize bank statement data from this AWS Textract OCR output:

FILE: ${fileName}

TEXTRACT DATA:
${JSON.stringify(textractData, null, 2)}

Return only the structured JSON data following the exact format specified in the system instructions.`;

    try {
      const result = await this._callGeminiWithRetry(userPrompt, 2);
      console.log(`✅ Gemini normalization successful for ${fileName}`);
      console.log(`📈 Extracted ${result.accounts?.length || 0} account(s)`);
      return result;
    } catch (error) {
      console.error(`❌ Gemini normalization failed for ${fileName}:`, error.message);
      throw new Error(`Failed to normalize Textract data: ${error.message}`);
    }
  }

  /**
   * Call Gemini API with retry logic and enhanced error handling
   * @private
   */
  async _callGeminiWithRetry(userPrompt, maxRetries = 2) {
    let lastError;
    const timeoutMs = parseInt(process.env.GEMINI_TIMEOUT_MS) || 120000; // 2 minutes default

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        console.log(`🔄 Gemini API attempt ${attempt}/${maxRetries + 1} (timeout: ${timeoutMs}ms)`);

        // Create a timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Gemini API timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        });

        // Create chat session with system instruction
        const chat = this.model.startChat({
          history: [
            {
              role: 'user',
              parts: [{ text: this.systemInstruction }],
            },
            {
              role: 'model',
              parts: [{ text: 'I understand. I will analyze bank statement data and return only valid JSON in the specified format.' }],
            },
          ],
        });

        // Race between API call and timeout
        const apiPromise = chat.sendMessage(userPrompt);
        const result = await Promise.race([apiPromise, timeoutPromise]);
        
        const response = result.response;
        const text = response.text();

        console.log(`📝 Raw Gemini response length: ${text.length} characters`);
        console.log(`📝 Raw Gemini response preview: ${text.substring(0, 200)}...`);

        // Validate and parse JSON response with enhanced error handling
        const normalizedData = this._validateJsonResponse(text, attempt);

        // Validate against schema
        const validationResult = this.validationSchema.validate(normalizedData);
        if (validationResult.error) {
          const errorMsg = `Schema validation failed: ${validationResult.error.message}`;
          console.error(`❌ ${errorMsg}`);
          
          // On the last attempt, try to fix common schema issues
          if (attempt === maxRetries + 1) {
            console.log(`🔧 Attempting to fix schema issues on final attempt`);
            const fixedData = this._fixSchemaIssues(normalizedData);
            const retryValidation = this.validationSchema.validate(fixedData);
            
            if (!retryValidation.error) {
              console.log(`✅ Schema issues fixed successfully`);
              return retryValidation.value;
            }
          }
          
          throw new Error(errorMsg);
        }

        console.log(`✅ Gemini API success on attempt ${attempt}`);
        return validationResult.value;
      } catch (error) {
        lastError = error;
        console.error(`❌ Gemini API attempt ${attempt} failed:`, error.message);

        if (attempt === maxRetries + 1) {
          break; // No more retries
        }

        // Determine if we should retry based on error type
        const shouldRetry = this._shouldRetryError(error, attempt);
        
        if (!shouldRetry) {
          console.log(`🚫 Not retrying due to error type: ${error.message}`);
          break;
        }

        // Exponential backoff for retries
        const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
        console.log(`🔄 Retrying in ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError;
  }

  /**
   * Determine if an error should trigger a retry
   * @private
   */
  _shouldRetryError(error, attempt) {
    const errorMessage = error.message.toLowerCase();
    
    // Don't retry on these types of errors
    const nonRetryableErrors = [
      'api key',
      'authentication',
      'authorization',
      'quota exceeded',
      'rate limit exceeded',
      'model not found',
      'invalid request'
    ];
    
    for (const nonRetryable of nonRetryableErrors) {
      if (errorMessage.includes(nonRetryable)) {
        return false;
      }
    }
    
    // Retry on these types of errors
    const retryableErrors = [
      'timeout',
      'network',
      'connection',
      'json parse',
      'schema validation',
      'invalid json',
      'unexpected token'
    ];
    
    for (const retryable of retryableErrors) {
      if (errorMessage.includes(retryable)) {
        return true;
      }
    }
    
    // Default: retry on first attempt, don't retry on subsequent attempts for unknown errors
    return attempt === 1;
  }

  /**
   * Fix common schema validation issues
   * @private
   */
  _fixSchemaIssues(data) {
    try {
      const fixed = JSON.parse(JSON.stringify(data)); // Deep clone
      
      // Ensure required fields exist
      if (!fixed.fileName) {
        fixed.fileName = 'unknown.pdf';
      }
      
      if (!fixed.accounts || !Array.isArray(fixed.accounts)) {
        fixed.accounts = [];
      }
      
      // Fix each account
      fixed.accounts = fixed.accounts.map(account => {
        // Ensure transactions array exists
        if (!account.transactions || !Array.isArray(account.transactions)) {
          account.transactions = [];
        }
        
        // Fix transaction objects
        account.transactions = account.transactions.map(txn => {
          const fixedTxn = { ...txn };
          
          // Ensure required fields
          if (!fixedTxn.date) {
            fixedTxn.date = '2024-01-01';
          }
          if (!fixedTxn.description) {
            fixedTxn.description = 'Transaction';
          }
          
          // Ensure date format
          if (fixedTxn.date && !fixedTxn.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // Try to convert common date formats
            const dateStr = fixedTxn.date.toString();
            if (dateStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
              const [month, day, year] = dateStr.split('/');
              fixedTxn.date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            } else {
              fixedTxn.date = '2024-01-01'; // Fallback
            }
          }
          
          return fixedTxn;
        });
        
        return account;
      });
      
      console.log(`🔧 Schema issues fixed`);
      return fixed;
    } catch (fixError) {
      console.error(`❌ Failed to fix schema issues:`, fixError.message);
      return data; // Return original if fixing fails
    }
  }

  /**
   * Validate that response is JSON-only without explanations
   * @private
   */
  _validateJsonResponse(text, attempt = 1) {
    if (!text || typeof text !== 'string') {
      throw new Error('Empty or invalid response from Gemini');
    }

    console.log(`🔍 Validating JSON response (attempt ${attempt})`);

    // Remove any potential markdown code blocks or explanations
    let cleanText = text.trim();
    
    // Handle various markdown formats
    if (cleanText.includes('```json')) {
      const jsonMatch = cleanText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleanText = jsonMatch[1].trim();
        console.log(`🔧 Extracted JSON from markdown code block`);
      }
    } else if (cleanText.includes('```')) {
      const codeMatch = cleanText.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        cleanText = codeMatch[1].trim();
        console.log(`🔧 Extracted content from code block`);
      }
    }

    // Remove any text before the first { or after the last }
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
      console.log(`🔧 Trimmed to JSON boundaries`);
    }

    // Additional JSON cleaning - fix common issues (enhanced for attempt-based fixing)
    cleanText = this._fixCommonJsonIssues(cleanText, attempt);

    try {
      const parsed = JSON.parse(cleanText);
      console.log(`✅ Successfully parsed JSON response`);
      return parsed;
    } catch (parseError) {
      console.error(`❌ JSON parse error:`, parseError.message);
      console.error(`📝 Problematic text (first 1000 chars):`, cleanText.substring(0, 1000));
      
      // Try more aggressive fixing on later attempts
      if (attempt > 1) {
        console.log(`🔧 Attempting aggressive JSON fix (attempt ${attempt})`);
        const aggressivelyFixed = this._aggressiveJsonFix(cleanText, parseError);
        
        if (aggressivelyFixed !== cleanText) {
          try {
            const parsed = JSON.parse(aggressivelyFixed);
            console.log(`✅ Successfully parsed JSON after aggressive fixing`);
            return parsed;
          } catch (secondError) {
            console.error(`❌ Still failed after aggressive fixing:`, secondError.message);
          }
        }
      } else {
        // Try standard fix on first attempt
        const fixedText = this._attemptJsonFix(cleanText);
        if (fixedText !== cleanText) {
          try {
            const parsed = JSON.parse(fixedText);
            console.log(`✅ Successfully parsed JSON after standard fixing`);
            return parsed;
          } catch (secondError) {
            console.error(`❌ Still failed after standard fixing:`, secondError.message);
          }
        }
      }
      
      throw new Error(
        `Invalid JSON response from Gemini: ${parseError.message}`
      );
    }
  }

  /**
   * Fix common JSON formatting issues
   * @private
   */
  _fixCommonJsonIssues(text, attempt = 1) {
    let fixed = text;
    
    console.log(`🔧 Starting JSON fix for text length: ${fixed.length} (attempt ${attempt})`);
    
    // Step 1: Remove any non-JSON content before and after
    const firstBrace = fixed.indexOf('{');
    const lastBrace = fixed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      fixed = fixed.substring(firstBrace, lastBrace + 1);
      console.log(`🔧 Trimmed to JSON boundaries: ${fixed.length} chars`);
    }
    
    // Step 2: Fix escaped quotes issues - this is the main problem
    // Remove unnecessary escaping of quotes within JSON strings
    fixed = fixed.replace(/\\"/g, '"');
    console.log(`🔧 Fixed escaped quotes`);
    
    // Step 3: Fix missing commas between array elements (common issue at position 812)
    // Look for patterns like }{ which should be },{
    fixed = fixed.replace(/}\s*{/g, '}, {');
    console.log(`🔧 Fixed missing commas between objects`);
    
    // Step 4: Fix missing commas between array elements with newlines
    fixed = fixed.replace(/}\s*\n\s*{/g, '},\n{');
    console.log(`🔧 Fixed missing commas with newlines`);
    
    // Step 5: Fix missing commas between object properties
    fixed = fixed.replace(/"\s*\n\s*"/g, '",\n"');
    fixed = fixed.replace(/(\d+)\s*\n\s*"/g, '$1,\n"');
    fixed = fixed.replace(/null\s*\n\s*"/g, 'null,\n"');
    console.log(`🔧 Fixed missing commas between properties`);
    
    // Step 6: Fix trailing commas (remove them)
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    console.log(`🔧 Removed trailing commas`);
    
    // Step 7: Fix incomplete arrays - ensure proper closing
    const openBraces = (fixed.match(/{/g) || []).length;
    const closeBraces = (fixed.match(/}/g) || []).length;
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/\]/g) || []).length;
    
    console.log(`🔧 Bracket counts - Braces: ${openBraces}/${closeBraces}, Brackets: ${openBrackets}/${closeBrackets}`);
    
    // Add missing closing brackets first (arrays)
    for (let i = 0; i < openBrackets - closeBrackets; i++) {
      fixed += ']';
      console.log(`🔧 Added missing closing bracket`);
    }
    
    // Add missing closing braces (objects)
    for (let i = 0; i < openBraces - closeBraces; i++) {
      fixed += '}';
      console.log(`🔧 Added missing closing brace`);
    }
    
    // Step 8: Handle specific transaction array issues
    // Look for incomplete transaction objects and fix them
    fixed = this._fixTransactionArrays(fixed);
    
    // Step 9: On later attempts, apply more aggressive fixes
    if (attempt > 1) {
      fixed = this._applyAggressiveFixes(fixed, attempt);
    }
    
    console.log(`🔧 JSON fix completed, final length: ${fixed.length}`);
    return fixed;
  }

  /**
   * Apply more aggressive fixes on retry attempts
   * @private
   */
  _applyAggressiveFixes(text, attempt) {
    let fixed = text;
    
    console.log(`🔧 Applying aggressive fixes (attempt ${attempt})`);
    
    // Fix common position 812 error - missing comma in transaction arrays
    // Look for patterns like: "balance": null "date": "2024-01-01"
    fixed = fixed.replace(/null\s+"([^"]+)":/g, 'null, "$1":');
    fixed = fixed.replace(/(\d+(?:\.\d+)?)\s+"([^"]+)":/g, '$1, "$2":');
    
    // Fix incomplete JSON strings that might be cut off
    fixed = fixed.replace(/,\s*$/, '');
    
    // Fix malformed arrays that might be missing closing brackets
    const transactionArrayPattern = /"transactions":\s*\[([^\]]*?)(?:\s*$)/g;
    fixed = fixed.replace(transactionArrayPattern, (match, content) => {
      if (!content.trim().endsWith('}')) {
        // Try to close the last transaction object
        const lastBraceIndex = content.lastIndexOf('}');
        if (lastBraceIndex === -1) {
          // No complete transaction found, add a minimal one
          return '"transactions": []';
        }
      }
      return `"transactions": [${content}]`;
    });
    
    console.log(`🔧 Aggressive fixes applied`);
    return fixed;
  }

  /**
   * Most aggressive JSON fix for final attempts
   * @private
   */
  _aggressiveJsonFix(text, parseError) {
    let fixed = text;
    
    console.log(`🔧 Applying most aggressive JSON fix`);
    console.log(`🔧 Parse error was: ${parseError.message}`);
    
    try {
      // If the error mentions a specific position, try to fix around that area
      const positionMatch = parseError.message.match(/position (\d+)/);
      if (positionMatch) {
        const errorPosition = parseInt(positionMatch[1]);
        console.log(`🔧 Targeting error at position ${errorPosition}`);
        
        // Get context around the error position
        const start = Math.max(0, errorPosition - 50);
        const end = Math.min(fixed.length, errorPosition + 50);
        const context = fixed.substring(start, end);
        console.log(`🔧 Error context: "${context}"`);
        
        // Common fixes for specific positions
        if (context.includes('"balance": null') && context.includes('"date"')) {
          // This is the common position 812 error - missing comma
          fixed = fixed.replace(/"balance":\s*null\s+"date":/g, '"balance": null, "date":');
          console.log(`🔧 Fixed missing comma after null balance`);
        }
        
        if (context.includes('} {')) {
          // Missing comma between objects
          fixed = fixed.replace(/}\s*{/g, '}, {');
          console.log(`🔧 Fixed missing comma between objects`);
        }
      }
      
      // Try to salvage partial JSON by truncating at the last valid structure
      const lastValidBrace = fixed.lastIndexOf('}');
      const lastValidBracket = fixed.lastIndexOf(']');
      
      if (lastValidBrace > lastValidBracket && lastValidBrace > 0) {
        // Try truncating at the last valid brace
        const truncated = fixed.substring(0, lastValidBrace + 1);
        console.log(`🔧 Truncated to last valid brace at position ${lastValidBrace}`);
        return truncated;
      }
      
    } catch (fixError) {
      console.error(`❌ Aggressive fix failed:`, fixError.message);
    }
    
    return fixed;
  }

  /**
   * Fix specific issues with transaction arrays
   * @private
   */
  _fixTransactionArrays(text) {
    let fixed = text;
    
    // Find transaction arrays and ensure they're properly formatted
    const transactionPattern = /"transactions":\s*\[([^\]]*)\]/g;
    
    fixed = fixed.replace(transactionPattern, (match, content) => {
      console.log(`🔧 Fixing transaction array: ${content.substring(0, 100)}...`);
      
      // Ensure each transaction object is properly separated by commas
      let fixedContent = content;
      
      // Fix missing commas between transaction objects
      fixedContent = fixedContent.replace(/}\s*{/g, '}, {');
      
      // Fix incomplete transaction objects by ensuring they end properly
      // Look for patterns like: "balance": null "date" and add comma
      fixedContent = fixedContent.replace(/null\s+"/g, 'null, "');
      fixedContent = fixedContent.replace(/(\d+(?:\.\d+)?)\s+"/g, '$1, "');
      
      // Ensure the last transaction doesn't have a trailing comma
      fixedContent = fixedContent.replace(/,(\s*$)/g, '$1');
      
      return `"transactions": [${fixedContent}]`;
    });
    
    return fixed;
  }

  /**
   * Attempt to fix malformed JSON
   * @private
   */
  _attemptJsonFix(text) {
    let fixed = text;
    
    try {
      // Try to find and fix incomplete arrays/objects
      const openBraces = (fixed.match(/{/g) || []).length;
      const closeBraces = (fixed.match(/}/g) || []).length;
      const openBrackets = (fixed.match(/\[/g) || []).length;
      const closeBrackets = (fixed.match(/\]/g) || []).length;
      
      // Add missing closing braces
      for (let i = 0; i < openBraces - closeBraces; i++) {
        fixed += '}';
      }
      
      // Add missing closing brackets
      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        fixed += ']';
      }
      
      console.log(`🔧 Attempted JSON fix: added ${openBraces - closeBraces} braces, ${openBrackets - closeBrackets} brackets`);
      
    } catch (error) {
      console.error(`❌ Error during JSON fix attempt:`, error.message);
    }
    
    return fixed;
  }
}

module.exports = GeminiService;
