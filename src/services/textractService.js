const {
  TextractClient,
  AnalyzeDocumentCommand,
} = require('@aws-sdk/client-textract');

/**
 * TextractService handles document analysis using AWS Textract
 * Implements document processing with FORMS and TABLES feature extraction
 */
class TextractService {
  constructor() {
    // Start with the configured region, but allow dynamic updates
    this.currentRegion = process.env.AWS_REGION || 'us-east-1';
    this.textractClient = this.createTextractClient(this.currentRegion);
    this.bucketName = process.env.S3_BUCKET_NAME;

    if (!this.bucketName) {
      throw new Error('S3_BUCKET_NAME environment variable is required');
    }
  }

  /**
   * Create Textract client for a specific region
   * @param {string} region - AWS region
   * @returns {TextractClient} - Configured Textract client
   */
  createTextractClient(region) {
    return new TextractClient({
      region: region,
    });
  }

  /**
   * Update the region for Textract client
   * @param {string} region - New AWS region
   */
  updateRegion(region) {
    if (region !== this.currentRegion) {
      console.log(`🔄 Updating Textract region from ${this.currentRegion} to ${region}`);
      this.currentRegion = region;
      this.textractClient = this.createTextractClient(region);
    }
  }

  /**
   * Analyze a document stored in S3 using AWS Textract
   * @param {string} s3Key - S3 key of the PDF file to analyze
   * @returns {Promise<object>} - Formatted Textract response
   */
  async analyzeDocument(s3Key) {
    try {
      const command = new AnalyzeDocumentCommand({
        Document: {
          S3Object: {
            Bucket: this.bucketName,
            Name: s3Key,
          },
        },
        FeatureTypes: ['FORMS', 'TABLES'],
      });

      const response = await this.textractClient.send(command);

      // Format the response for downstream processing
      return this._formatTextractResponse(response);
    } catch (error) {
      // Handle specific Textract errors with enhanced messaging
      if (error.name === 'InvalidS3ObjectException') {
        throw new Error(`Invalid S3 object or file not found: ${s3Key}`);
      }
      if (error.name === 'UnsupportedDocumentException') {
        // Check if this might be due to legacy PDF version
        const isDevelopment = process.env.NODE_ENV === 'development';
        const allowLegacyVersions = process.env.ALLOW_LEGACY_PDF_VERSIONS === 'true';
        
        if (isDevelopment && allowLegacyVersions) {
          console.log(`⚠️  Textract rejected document ${s3Key} - likely due to legacy PDF format. This is expected in development mode with legacy PDFs.`);
          throw new Error(`Document format not supported by Textract: ${s3Key}. This may be due to an older PDF version or unsupported features. In production, please use PDF version 1.4 or higher.`);
        } else {
          throw new Error(`Unsupported document format: ${s3Key}`);
        }
      }
      if (error.name === 'DocumentTooLargeException') {
        throw new Error(`Document too large for processing: ${s3Key}`);
      }
      if (error.name === 'BadDocumentException') {
        throw new Error(`Bad document format: ${s3Key}`);
      }
      if (error.name === 'ThrottlingException') {
        throw new Error(
          'Textract service is throttling requests. Please retry later.'
        );
      }
      if (error.name === 'InternalServerError') {
        throw new Error('Textract internal server error. Please retry later.');
      }

      throw new Error(
        `Failed to analyze document with Textract: ${error.message}`
      );
    }
  }

  /**
   * Extract forms and tables data from Textract response
   * @param {object} textractResponse - Raw Textract response
   * @returns {Promise<object>} - Extracted forms and tables data
   */
  async extractFormsAndTables(textractResponse) {
    try {
      const blocks = textractResponse.Blocks || [];

      const result = {
        forms: this._extractForms(blocks),
        tables: this._extractTables(blocks),
        lines: this._extractLines(blocks),
        metadata: {
          documentMetadata: textractResponse.DocumentMetadata,
          analyzeDocumentModelVersion:
            textractResponse.AnalyzeDocumentModelVersion,
          processedAt: new Date().toISOString(),
        },
      };

      return result;
    } catch (error) {
      throw new Error(`Failed to extract forms and tables: ${error.message}`);
    }
  }

  /**
   * Format Textract response for downstream processing
   * @param {object} response - Raw Textract response
   * @returns {object} - Formatted response
   * @private
   */
  _formatTextractResponse(response) {
    return {
      Blocks: response.Blocks || [],
      DocumentMetadata: response.DocumentMetadata || {},
      AnalyzeDocumentModelVersion: response.AnalyzeDocumentModelVersion || '',
      JobStatus: 'SUCCEEDED', // For synchronous calls, this is always succeeded
      StatusMessage: 'Document analysis completed successfully',
      ProcessedAt: new Date().toISOString(),
    };
  }

  /**
   * Extract form data from Textract blocks
   * @param {Array} blocks - Textract blocks
   * @returns {Array} - Extracted form data
   * @private
   */
  _extractForms(blocks) {
    const keyValuePairs = [];
    const keyBlocks = blocks.filter(
      (block) =>
        block.BlockType === 'KEY_VALUE_SET' &&
        block.EntityTypes?.includes('KEY')
    );

    keyBlocks.forEach((keyBlock) => {
      const valueBlock = this._findValueBlock(blocks, keyBlock);
      if (valueBlock) {
        const keyText = this._getBlockText(blocks, keyBlock);
        const valueText = this._getBlockText(blocks, valueBlock);

        keyValuePairs.push({
          key: keyText,
          value: valueText,
          confidence: Math.min(
            keyBlock.Confidence || 0,
            valueBlock.Confidence || 0
          ),
        });
      }
    });

    return keyValuePairs;
  }

  /**
   * Extract table data from Textract blocks
   * @param {Array} blocks - Textract blocks
   * @returns {Array} - Extracted table data
   * @private
   */
  _extractTables(blocks) {
    const tables = [];
    const tableBlocks = blocks.filter((block) => block.BlockType === 'TABLE');

    tableBlocks.forEach((tableBlock) => {
      const table = {
        rows: [],
        confidence: tableBlock.Confidence || 0,
      };

      const cellBlocks = blocks.filter(
        (block) =>
          block.BlockType === 'CELL' &&
          block.Relationships?.some(
            (rel) =>
              rel.Type === 'CHILD' &&
              tableBlock.Relationships?.some(
                (tableRel) =>
                  tableRel.Type === 'CHILD' && tableRel.Ids.includes(block.Id)
              )
          )
      );

      // Group cells by row
      const rowMap = new Map();
      cellBlocks.forEach((cell) => {
        const rowIndex = cell.RowIndex || 0;
        if (!rowMap.has(rowIndex)) {
          rowMap.set(rowIndex, []);
        }
        rowMap.get(rowIndex).push({
          text: this._getBlockText(blocks, cell),
          confidence: cell.Confidence || 0,
          columnIndex: cell.ColumnIndex || 0,
        });
      });

      // Sort rows and cells
      Array.from(rowMap.keys())
        .sort((a, b) => a - b)
        .forEach((rowIndex) => {
          const cells = rowMap
            .get(rowIndex)
            .sort((a, b) => a.columnIndex - b.columnIndex);
          table.rows.push(
            cells.map((cell) => ({
              text: cell.text,
              confidence: cell.confidence,
            }))
          );
        });

      tables.push(table);
    });

    return tables;
  }

  /**
   * Extract line text from Textract blocks
   * @param {Array} blocks - Textract blocks
   * @returns {Array} - Extracted line data
   * @private
   */
  _extractLines(blocks) {
    return blocks
      .filter((block) => block.BlockType === 'LINE')
      .map((block) => ({
        text: block.Text || '',
        confidence: block.Confidence || 0,
        geometry: block.Geometry,
      }));
  }

  /**
   * Find the value block associated with a key block
   * @param {Array} blocks - All Textract blocks
   * @param {object} keyBlock - Key block
   * @returns {object|null} - Associated value block
   * @private
   */
  _findValueBlock(blocks, keyBlock) {
    const valueRelationship = keyBlock.Relationships?.find(
      (rel) => rel.Type === 'VALUE'
    );
    if (!valueRelationship || !valueRelationship.Ids?.length) {
      return null;
    }

    return blocks.find(
      (block) =>
        block.BlockType === 'KEY_VALUE_SET' &&
        block.EntityTypes?.includes('VALUE') &&
        valueRelationship.Ids.includes(block.Id)
    );
  }

  /**
   * Get text content from a block by following child relationships
   * @param {Array} blocks - All Textract blocks
   * @param {object} block - Block to get text from
   * @returns {string} - Extracted text
   * @private
   */
  _getBlockText(blocks, block) {
    if (block.Text) {
      return block.Text;
    }

    const childRelationship = block.Relationships?.find(
      (rel) => rel.Type === 'CHILD'
    );
    if (!childRelationship || !childRelationship.Ids?.length) {
      return '';
    }

    const childTexts = childRelationship.Ids.map((id) =>
      blocks.find((b) => b.Id === id)
    )
      .filter((childBlock) => childBlock && childBlock.BlockType === 'WORD')
      .map((wordBlock) => wordBlock.Text || '');

    return childTexts.join(' ');
  }
}

module.exports = TextractService;
