import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
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
 * Modern S3 buckets (Object Ownership = "Bucket owner enforced", the AWS default)
 * reject any request that sets an ACL with AccessControlListNotSupported.
 * So no ACL is sent by default; public read access should come from a bucket policy.
 * Only set S3_OBJECT_ACL=public-read if your bucket still has ACLs enabled.
 */
function objectAcl(): { ACL?: 'public-read' } {
  return process.env.S3_OBJECT_ACL === 'public-read' ? { ACL: 'public-read' } : {};
}

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
    ...objectAcl()
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
      ...objectAcl()
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
      ...objectAcl()
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

// ---------------------------------------------------------------------------
// Private object helpers (Library). Library files are never public: the app serves them through
// short-lived signed links, so unreleased client work can't be reached by URL.
// ---------------------------------------------------------------------------

/** Upload a buffer or stream without any public ACL. */
export async function putPrivateObject(key: string, body: Buffer | NodeJS.ReadableStream, contentType: string, contentLength: number): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: body as any,
      ContentType: contentType,
      ContentLength: contentLength
    })
  );
}

/** Download an object fully into memory (only used for files we cap in size). */
export async function getObjectBuffer(key: string, maxBytes = 60 * 1024 * 1024): Promise<Buffer> {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
  const body: any = res.Body;
  if (!body) throw new Error('Empty object');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Object is too large to process');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Signed GET link. The signing time is rounded down to the hour so the same link is reused within the
 * hour, letting browsers cache thumbnails instead of downloading them on every page view.
 */
export async function signedObjectUrl(key: string, opts: { downloadName?: string; contentType?: string } = {}): Promise<string> {
  const hour = new Date();
  hour.setMinutes(0, 0, 0);
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ...(opts.downloadName
      ? { ResponseContentDisposition: `attachment; filename="${opts.downloadName.replace(/["\\\r\n]/g, '_')}"` }
      : {}),
    ...(opts.contentType ? { ResponseContentType: opts.contentType } : {})
  });
  return getSignedUrl(s3Client, command, { expiresIn: 2 * 60 * 60, signingDate: hour });
}

/** If a URL points into our bucket, return its object key (so existing files can be reused). */
export function objectKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const bucket = BUCKET_NAME.toLowerCase();
    if (host === `${bucket}.s3.amazonaws.com` || (host.startsWith(`${bucket}.s3.`) && host.endsWith('.amazonaws.com'))) {
      return decodeURIComponent(u.pathname.replace(/^\/+/, '')) || null;
    }
    if (/^s3[.-]/.test(host) && host.endsWith('.amazonaws.com')) {
      const [first, ...rest] = u.pathname.replace(/^\/+/, '').split('/');
      if (first.toLowerCase() === bucket && rest.length) return decodeURIComponent(rest.join('/'));
    }
    return null;
  } catch {
    return null;
  }
}

/** Size and type of a stored object, without downloading it. */
export async function headObjectInfo(key: string): Promise<{ size: number; contentType: string }> {
  const res = await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
  return { size: Number(res.ContentLength || 0), contentType: res.ContentType || 'application/octet-stream' };
}

/** Read one byte range of an object (inclusive end), so large videos are uploaded in chunks, never held whole in memory. */
export async function getObjectRange(key: string, start: number, end: number): Promise<Buffer> {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key, Range: `bytes=${start}-${end}` }));
  const body: any = res.Body;
  if (!body) throw new Error('Empty object');
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** The objects under a folder (e.g. "design-backgrounds/"), page by page. */
export async function* listObjects(prefix: string): AsyncGenerator<{ key: string; lastModified: Date }> {
  let token: string | undefined;
  do {
    const page: any = await s3Client.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of page.Contents || []) if (o.Key) yield { key: o.Key, lastModified: o.LastModified ? new Date(o.LastModified) : new Date() };
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}
