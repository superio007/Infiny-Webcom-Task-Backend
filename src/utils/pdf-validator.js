/**
 * Enhanced PDF validation utility for Textract compatibility
 */

/**
 * Validates PDF buffer for Textract compatibility
 * @param {Buffer} buffer - PDF file buffer
 * @returns {Object} Validation result with details
 */
function validatePDFForTextract(buffer) {
  try {
    // Check PDF signature
    if (!buffer.slice(0, 5).equals(Buffer.from('%PDF-'))) {
      return {
        valid: false,
        error: 'INVALID_PDF_FORMAT',
        message: 'File is not a valid PDF document.',
        userMessage: 'The uploaded file is not a valid PDF. Please upload a proper PDF file.'
      };
    }
    
    // Get PDF version
    const versionMatch = buffer.slice(0, 50).toString().match(/%PDF-(\d+\.\d+)/);
    if (!versionMatch) {
      return {
        valid: false,
        error: 'UNKNOWN_PDF_VERSION',
        message: 'Cannot determine PDF version.',
        userMessage: 'The PDF file appears to be corrupted or uses an unsupported format.'
      };
    }
    
    const version = parseFloat(versionMatch[1]);
    
    // Check if version is supported by Textract (requires 1.4+)
    // Allow bypass in development mode for demo purposes
    const allowLegacyVersions = process.env.ALLOW_LEGACY_PDF_VERSIONS === 'true';
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    if (version < 1.4 && !(allowLegacyVersions && isDevelopment)) {
      return {
        valid: false,
        error: 'UNSUPPORTED_PDF_VERSION',
        message: `PDF version ${version} is not supported by Textract (requires 1.4+).`,
        userMessage: `This PDF uses an older format (version ${version}) that is not supported. Please save the PDF in a newer format (PDF 1.4 or higher) and try again.`
      };
    }
    
    // Log warning if using legacy version in development
    if (version < 1.4 && allowLegacyVersions && isDevelopment) {
      console.log(`⚠️  WARNING: Allowing legacy PDF version ${version} in development mode. This may cause Textract processing issues.`);
    }
    
    // Check for encryption
    const pdfString = buffer.toString('binary');
    if (pdfString.includes('/Encrypt')) {
      // Allow bypass in development mode for demo purposes
      const allowLegacyVersions = process.env.ALLOW_LEGACY_PDF_VERSIONS === 'true';
      const isDevelopment = process.env.NODE_ENV === 'development';
      
      if (!(allowLegacyVersions && isDevelopment)) {
        return {
          valid: false,
          error: 'ENCRYPTED_PDF',
          message: 'PDF is encrypted or password-protected.',
          userMessage: 'This PDF is password-protected or encrypted. Please remove the password protection and upload an unprotected PDF file.'
        };
      } else {
        console.log(`⚠️  WARNING: Allowing encrypted PDF in development mode. This may cause Textract processing issues.`);
      }
    }
    
    // Check for other potentially problematic elements
    const problematicElements = [
      { element: '/XFA', message: 'PDF contains XFA forms which are not supported.' },
      { element: '/JavaScript', message: 'PDF contains JavaScript which may cause processing issues.' },
      { element: '/JS', message: 'PDF contains JavaScript which may cause processing issues.' }
    ];
    
    for (const { element, message } of problematicElements) {
      if (pdfString.includes(element)) {
        return {
          valid: false,
          error: 'UNSUPPORTED_PDF_FEATURES',
          message: message,
          userMessage: 'This PDF contains features that are not supported for processing. Please save the PDF in a simpler format without interactive elements.'
        };
      }
    }
    
    // Check for basic PDF structure
    const hasEOF = buffer.slice(-100).includes(Buffer.from('%%EOF'));
    if (!hasEOF) {
      return {
        valid: false,
        error: 'CORRUPTED_PDF',
        message: 'PDF is missing end-of-file marker.',
        userMessage: 'The PDF file appears to be corrupted or incomplete. Please try uploading a different PDF file.'
      };
    }
    
    // Check file size (Textract has limits)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (buffer.length > maxSize) {
      return {
        valid: false,
        error: 'FILE_TOO_LARGE',
        message: `PDF file size (${Math.round(buffer.length / 1024 / 1024)}MB) exceeds maximum limit.`,
        userMessage: `The PDF file is too large (${Math.round(buffer.length / 1024 / 1024)}MB). Please upload a file smaller than 10MB.`
      };
    }
    
    // PDF is valid for Textract
    return {
      valid: true,
      version: version,
      size: buffer.length,
      message: 'PDF is compatible with Textract processing.'
    };
    
  } catch (error) {
    return {
      valid: false,
      error: 'VALIDATION_ERROR',
      message: `PDF validation failed: ${error.message}`,
      userMessage: 'Unable to validate the PDF file. Please ensure it is a valid PDF document.'
    };
  }
}

module.exports = {
  validatePDFForTextract
};