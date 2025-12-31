import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET || 'campaign-management-assets';

/**
 * Upload file to S3
 */
export async function uploadToS3(
  file: Express.Multer.File,
  folder: string = 'assets'
): Promise<{ location: string; key: string }> {
  const fileExtension = file.originalname.split('.').pop();
  const randomName = crypto.randomBytes(16).toString('hex');
  const key = `${folder}/${randomName}.${fileExtension}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'public-read' // Make files publicly readable
  });

  await s3Client.send(command);

  const location = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

  return { location, key };
}

/**
 * Generate signed URL for private files
 */
export async function getSignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Delete file from S3
 */
export async function deleteFromS3(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key
  });

  await s3Client.send(command);
}

/**
 * Upload image and return S3 URL (for task designedImage field)
 */
export async function uploadTaskImage(file: Express.Multer.File): Promise<string> {
  const { location } = await uploadToS3(file, 'task-images');
  return location;
}

/**
 * Upload buffer directly to S3
 * Used for AI-generated images that are returned as base64
 */
export async function uploadBufferToS3(
  buffer: Buffer,
  contentType: string = 'image/png',
  folder: string = 'generated-images'
): Promise<string> {
  const startTime = Date.now();

  console.log('\n========================================');
  console.log('📦 S3 UPLOAD FROM BUFFER');
  console.log('========================================');
  console.log('Target Folder:', folder);
  console.log('Target Bucket:', BUCKET_NAME);
  console.log('Content-Type:', contentType);
  console.log('Size:', buffer.length, 'bytes');
  console.log('Timestamp:', new Date().toISOString());
  console.log('========================================\n');

  try {
    // Determine file extension
    const extension = contentType.split('/')[1] || 'png';

    // Generate random filename
    const randomName = crypto.randomBytes(16).toString('hex');
    const key = `${folder}/${randomName}.${extension}`;

    console.log('📤 Uploading to S3...');
    console.log('   Key:', key);

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read'
    });

    await s3Client.send(command);

    // Return the S3 URL
    const location = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

    const duration = Date.now() - startTime;

    console.log('\n========================================');
    console.log('✅ S3 UPLOAD SUCCESS');
    console.log('========================================');
    console.log('S3 URL:', location);
    console.log('Key:', key);
    console.log('Size:', buffer.length, 'bytes');
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    return location;
  } catch (error: any) {
    const duration = Date.now() - startTime;

    console.log('\n========================================');
    console.log('❌ S3 UPLOAD ERROR');
    console.log('========================================');
    console.log('Error:', error.message);
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    throw new Error(`Failed to upload buffer to S3: ${error.message}`);
  }
}

/**
 * Download image from URL and return buffer
 * Used to download base images for LLM API calls
 */
export async function downloadImageFromUrl(imageUrl: string): Promise<{ buffer: Buffer; contentType: string; extension: string }> {
  const startTime = Date.now();

  console.log('\n========================================');
  console.log('⬇️  IMAGE DOWNLOAD FROM URL');
  console.log('========================================');
  console.log('Source URL:', imageUrl);
  console.log('Timestamp:', new Date().toISOString());
  console.log('========================================\n');

  try {
    console.log('📥 Fetching image...');

    // Fetch the image from the URL
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
    }

    // Get the image buffer
    const buffer = Buffer.from(await response.arrayBuffer());

    // Determine content type from response headers or default to image/png
    const contentType = response.headers.get('content-type') || 'image/png';

    // Determine file extension
    const extension = contentType.split('/')[1] || 'png';

    const duration = Date.now() - startTime;

    console.log('\n========================================');
    console.log('✅ IMAGE DOWNLOAD SUCCESS');
    console.log('========================================');
    console.log('Size:', buffer.length, 'bytes');
    console.log('Content-Type:', contentType);
    console.log('Extension:', extension);
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    return { buffer, contentType, extension };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    console.log('\n========================================');
    console.log('❌ IMAGE DOWNLOAD ERROR');
    console.log('========================================');
    console.log('Source URL:', imageUrl);
    console.log('Error:', error.message);
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    throw new Error(`Failed to download image from URL: ${error.message}`);
  }
}

/**
 * Download image from URL and upload to S3
 * Used for AI-generated images that need to be stored permanently
 */
export async function uploadImageFromUrl(imageUrl: string, folder: string = 'generated-images'): Promise<string> {
  const startTime = Date.now();

  console.log('\n========================================');
  console.log('📦 S3 UPLOAD FROM URL');
  console.log('========================================');
  console.log('Source URL:', imageUrl);
  console.log('Target Folder:', folder);
  console.log('Target Bucket:', BUCKET_NAME);
  console.log('Timestamp:', new Date().toISOString());
  console.log('========================================\n');

  try {
    console.log('⬇️  Downloading image from URL...');

    // Fetch the image from the URL
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
    }

    // Get the image buffer
    const buffer = Buffer.from(await response.arrayBuffer());

    console.log('✅ Image downloaded:', buffer.length, 'bytes');

    // Determine content type from response headers or default to image/png
    const contentType = response.headers.get('content-type') || 'image/png';

    // Determine file extension
    const extension = contentType.split('/')[1] || 'png';

    // Generate random filename
    const randomName = crypto.randomBytes(16).toString('hex');
    const key = `${folder}/${randomName}.${extension}`;

    console.log('📤 Uploading to S3...');
    console.log('   Key:', key);
    console.log('   Content-Type:', contentType);
    console.log('   Size:', buffer.length, 'bytes');

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read'
    });

    await s3Client.send(command);

    // Return the S3 URL
    const location = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

    const duration = Date.now() - startTime;

    console.log('\n========================================');
    console.log('✅ S3 UPLOAD SUCCESS');
    console.log('========================================');
    console.log('S3 URL:', location);
    console.log('Key:', key);
    console.log('Size:', buffer.length, 'bytes');
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    return location;
  } catch (error: any) {
    const duration = Date.now() - startTime;

    console.log('\n========================================');
    console.log('❌ S3 UPLOAD ERROR');
    console.log('========================================');
    console.log('Source URL:', imageUrl);
    console.log('Error:', error.message);
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    throw new Error(`Failed to upload image from URL: ${error.message}`);
  }
}
