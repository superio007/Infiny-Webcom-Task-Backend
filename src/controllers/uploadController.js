const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { StorageService, JobManager, PDFConverterService } = require('../services');
const { AppError } = require('../middleware');
const { validatePDFForTextract } = require('../utils/pdf-validator');

// Configure multer for file upload with PDF validation
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Check if file is PDF by MIME type
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    const error = new AppError(
      'Only PDF files are allowed',
      400,
      'INVALID_FILE_TYPE'
    );
    cb(error, false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1, // Only allow single file
  },
});

/**
 * Upload controller for handling PDF file uploads
 */
class UploadController {
  /**
   * Handle POST /api/statements/upload
   * Accepts only PDF files via multipart/form-data
   */
  static async uploadStatement(req, res) {
    // Check if file was uploaded
    if (!req.file) {
      throw new AppError('No file was uploaded', 400, 'NO_FILE_UPLOADED');
    }

    const file = req.file;
    const originalFileName = file.originalname;

    // Validate file type again (defense in depth)
    if (file.mimetype !== 'application/pdf') {
      throw new AppError(
        'Only PDF files are allowed',
        400,
        'INVALID_FILE_TYPE'
      );
    }

    let finalBuffer = file.buffer;
    let conversionInfo = null;

    // Initialize PDF converter service
    const pdfConverter = new PDFConverterService();

    // Check if PDF needs conversion and convert if necessary
    if (pdfConverter.isConversionEnabled()) {
      try {
        const analysis = await pdfConverter.analyzePDF(file.buffer);
        
        if (analysis.needsConversion) {
          console.log(`🔄 PDF conversion needed for ${originalFileName}: ${analysis.issues.join(', ')}`);
          
          const conversionResult = await pdfConverter.convertPDF(file.buffer, originalFileName);
          
          if (conversionResult.converted) {
            finalBuffer = conversionResult.buffer;
            conversionInfo = {
              originalSize: conversionResult.originalSize,
              newSize: conversionResult.newSize,
              issues: conversionResult.issues,
              pagesProcessed: conversionResult.pagesProcessed,
              message: conversionResult.message,
              isPlaceholder: conversionResult.isPlaceholder || false,
              conversionStrategy: conversionResult.conversionStrategy || 'standard'
            };
            
            console.log(`✅ PDF conversion successful: ${conversionResult.message}`);
            
            // If it's a placeholder, we should warn the user but continue
            if (conversionResult.isPlaceholder) {
              console.log(`⚠️  Using placeholder PDF for ${originalFileName} - original could not be processed`);
            }
          }
        } else {
          console.log(`✅ PDF ${originalFileName} is already compatible, no conversion needed`);
        }
      } catch (conversionError) {
        console.error(`❌ PDF conversion failed for ${originalFileName}:`, conversionError.message);
        
        // Check if this is a critical error or if we can proceed with original
        if (conversionError.message.includes('completely') || conversionError.message.includes('critical')) {
          throw new AppError(
            `PDF conversion failed: ${conversionError.message}`,
            400,
            'PDF_CONVERSION_FAILED',
            {
              fileName: originalFileName,
              technicalReason: conversionError.message
            }
          );
        }
        
        // For non-critical errors, continue with original file
        console.log(`⚠️  Proceeding with original file despite conversion failure`);
      }
    }

    // Enhanced PDF validation for Textract compatibility (on final buffer)
    const pdfValidation = validatePDFForTextract(finalBuffer);
    if (!pdfValidation.valid) {
      console.log(`PDF validation failed for ${originalFileName}:`, pdfValidation.message);
      throw new AppError(
        pdfValidation.userMessage,
        400,
        pdfValidation.error,
        {
          fileName: originalFileName,
          technicalReason: pdfValidation.message,
          conversionAttempted: conversionInfo !== null
        }
      );
    }

    console.log(`✅ PDF validation passed for ${originalFileName} (version ${pdfValidation.version}, ${Math.round(pdfValidation.size / 1024)}KB)`);

    // Upload to S3 (using final buffer which may be converted)
    const storageService = new StorageService();
    const s3Key = await storageService.uploadFile(
      finalBuffer,
      file.mimetype,
      originalFileName
    );

    // Create job record
    const jobManager = JobManager.getInstance();
    const job = await jobManager.createJob(originalFileName, s3Key);

    // Return success response with conversion info
    const response = {
      jobId: job.jobId,
      fileName: originalFileName,
      status: 'uploaded',
    };

    // Add conversion info if PDF was converted
    if (conversionInfo) {
      response.converted = true;
      response.conversionInfo = {
        originalSize: Math.round(conversionInfo.originalSize / 1024),
        newSize: Math.round(conversionInfo.newSize / 1024),
        issuesResolved: conversionInfo.issues.length,
        message: conversionInfo.message
      };
    }

    res.status(200).json(response);
  }

  /**
   * Get multer middleware configured for single PDF upload
   */
  static getUploadMiddleware() {
    return upload.single('file');
  }
}

module.exports = UploadController;
