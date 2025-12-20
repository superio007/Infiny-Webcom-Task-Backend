const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

/**
 * StorageService handles file operations with AWS S3
 * Implements secure file storage with UUID-based naming
 */
class StorageService {
  constructor() {
    this.bucketName = process.env.S3_BUCKET_NAME;
    this.currentRegion = process.env.AWS_REGION || 'us-east-1';
    
    if (!this.bucketName) {
      throw new Error('S3_BUCKET_NAME environment variable is required');
    }

    // Initialize S3 client
    this.s3Client = this.createS3Client(this.currentRegion);
  }

  /**
   * Create S3 client for a specific region
   * @param {string} region - AWS region
   * @returns {S3Client} - Configured S3 client
   */
  createS3Client(region) {
    return new S3Client({
      region: region,
      forcePathStyle: true,
    });
  }

  /**
   * Test bucket access with current credentials and region
   * @returns {Promise<boolean>} - Whether bucket is accessible
   */
  async testBucketAccess() {
    try {
      console.log(`Testing bucket access: ${this.bucketName} in region: ${this.currentRegion}`);
      
      // Try a simple list operation to test access
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        MaxKeys: 1, // Just test with 1 object
      });

      await this.s3Client.send(command);
      console.log(`✅ Bucket access successful in region: ${this.currentRegion}`);
      return true;
    } catch (error) {
      console.log(`❌ Bucket access failed in region ${this.currentRegion}: ${error.code} - ${error.message}`);
      return false;
    }
  }

  /**
   * Find a working region by testing bucket access
   * @returns {Promise<string|null>} - Working region or null
   */
  async findWorkingRegion() {
    const commonRegions = [
      'ap-south-1',
      'us-east-1',
      'us-west-2', 
      'us-west-1',
      'eu-west-1',
      'eu-central-1',
      'ap-southeast-1',
      'ap-northeast-1',
      'ca-central-1'
    ];

    for (const region of commonRegions) {
      try {
        console.log(`🔍 Testing region: ${region}`);
        const testClient = this.createS3Client(region);
        const command = new ListObjectsV2Command({
          Bucket: this.bucketName,
          MaxKeys: 1,
        });
        
        await testClient.send(command);
        console.log(`✅ Found working region: ${region}`);
        return region;
      } catch (error) {
        console.log(`❌ Region ${region} failed: ${error.code} - ${error.message}`);
        continue;
      }
    }
    
    return null;
  }

  /**
   * Try to upload to different regions until one works
   * @param {PutObjectCommand} command - The S3 upload command
   * @returns {Promise<string>} - The working region
   */
  async tryUploadInDifferentRegions(command) {
    const commonRegions = [
      this.currentRegion, // Try current region first
      'ap-south-1',
      'us-east-1',
      'us-west-2', 
      'us-west-1',
      'eu-west-1',
      'eu-central-1',
      'ap-southeast-1',
      'ap-northeast-1',
      'ca-central-1'
    ];

    // Remove duplicates
    const uniqueRegions = [...new Set(commonRegions)];

    for (const region of uniqueRegions) {
      try {
        console.log(`Trying upload in region: ${region}`);
        const testClient = this.createS3Client(region);
        await testClient.send(command);
        console.log(`✅ Upload successful in region: ${region}`);
        return region;
      } catch (error) {
        console.log(`❌ Upload failed in region ${region}: ${error.code || 'Unknown'} - ${error.message}`);
        
        // If it's an access denied error, the credentials might be wrong
        if (error.code === 'AccessDenied' || error.code === 'InvalidAccessKeyId') {
          throw new Error(`AWS credentials error: ${error.message}`);
        }
        
        // If it's not a region issue, throw the error
        if (!error.message.includes('endpoint') && 
            !error.message.includes('region') && 
            !error.message.includes('addressed using the specified endpoint') &&
            error.code !== 'PermanentRedirect') {
          throw error;
        }
        continue;
      }
    }
    
    throw new Error(`Could not upload to bucket ${this.bucketName} in any tested region`);
  }

  /**
   * Upload a file to S3 with UUID-based naming
   * @param {Buffer} buffer - File buffer to upload
   * @param {string} contentType - MIME type of the file
   * @param {string} originalFileName - Original filename for reference
   * @returns {Promise<string>} - S3 key of the uploaded file
   */
  async uploadFile(buffer, contentType, originalFileName) {
    // First, test if we can access the bucket
    console.log(`🔍 Testing bucket access before upload...`);
    const hasAccess = await this.testBucketAccess();
    
    if (!hasAccess) {
      console.log(`❌ Cannot access bucket with current region, trying other regions...`);
      // Try to find a working region by testing bucket access
      const workingRegion = await this.findWorkingRegion();
      if (workingRegion) {
        this.currentRegion = workingRegion;
        this.s3Client = this.createS3Client(workingRegion);
        console.log(`✅ Found working region: ${workingRegion}`);
      }
    }

    // Generate UUID-based filename to prevent conflicts and enhance security
    const fileExtension = this._getFileExtension(originalFileName);
    const s3Key = `${uuidv4()}${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
      Metadata: {
        originalFileName: originalFileName,
        uploadedAt: new Date().toISOString(),
      },
    });

    // Try upload with current client first
    try {
      console.log(`📤 Attempting upload to bucket: ${this.bucketName} in region: ${this.currentRegion}`);
      await this.s3Client.send(command);
      console.log(`✅ Upload successful with region: ${this.currentRegion}`);
      return s3Key;
    } catch (error) {
      console.error('❌ Initial upload failed:', {
        message: error.message,
        code: error.Code || error.code,
        statusCode: error.$metadata?.httpStatusCode,
        region: this.currentRegion,
        bucket: this.bucketName,
      });

      // If it's a region/endpoint error, try different regions
      if (error.message.includes('endpoint') || 
          error.message.includes('region') || 
          error.message.includes('addressed using the specified endpoint') ||
          error.code === 'PermanentRedirect') {
        
        try {
          console.log('🔄 Attempting to find correct region by trying uploads...');
          const correctRegion = await this.tryUploadInDifferentRegions(command);
          
          // Update our client to use the working region
          console.log(`🔄 Switching from ${this.currentRegion} to ${correctRegion}`);
          this.currentRegion = correctRegion;
          this.s3Client = this.createS3Client(correctRegion);
          
          console.log(`✅ Upload successful after finding correct region: ${correctRegion}`);
          return s3Key;
        } catch (regionError) {
          console.error('❌ Failed to find working region:', regionError.message);
          throw new Error(`Failed to upload file to S3: Could not find working region. Original error: ${error.message}`);
        }
      }

      throw new Error(`Failed to upload file to S3: ${error.message}`);
    }
  }

  /**
   * Retrieve a file from S3
   * @param {string} s3Key - S3 key of the file to retrieve
   * @returns {Promise<Buffer>} - File buffer
   */
  async getFile(s3Key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const response = await this.s3Client.send(command);

      // Convert stream to buffer
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    } catch (error) {
      if (error.name === 'NoSuchKey') {
        throw new Error(`File not found in S3: ${s3Key}`);
      }
      throw new Error(`Failed to retrieve file from S3: ${error.message}`);
    }
  }

  /**
   * Delete a file from S3
   * @param {string} s3Key - S3 key of the file to delete
   * @returns {Promise<void>}
   */
  async deleteFile(s3Key) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      await this.s3Client.send(command);
    } catch (error) {
      // Don't throw error if file doesn't exist (idempotent operation)
      if (error.name !== 'NoSuchKey') {
        throw new Error(`Failed to delete file from S3: ${error.message}`);
      }
    }
  }

  /**
   * Extract file extension from filename
   * @param {string} filename - Original filename
   * @returns {string} - File extension including the dot
   * @private
   */
  _getFileExtension(filename) {
    const lastDotIndex = filename.lastIndexOf('.');
    return lastDotIndex !== -1 ? filename.substring(lastDotIndex) : '';
  }
}

module.exports = StorageService;