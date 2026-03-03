import { createWriteStream } from 'fs';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { logError } from './loggerUtil.js';

let s3Client: S3Client;

export const initializeS3Client = (): void => {
  const region =
    process.env.S3_AWS_REGION || process.env.AWS_REGION || 'ap-south-1';
  const accessKeyId =
    process.env.S3_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.S3_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  s3Client = new S3Client({
    region,
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
  });
};

export const getS3Client = (): S3Client => s3Client;

export const getBucketName = (): string => {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME is not set');
  }
  return bucket;
};

/**
 * List all object keys in a prefix (skips folder placeholders).
 */
export const getAllObjectKeys = async (prefix: string): Promise<string[]> => {
  try {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: getBucketName(),
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      });
      const response = await s3Client.send(command);
      const contents = response.Contents ?? [];
      for (const obj of contents) {
        if (obj.Key && !obj.Key.endsWith('/')) keys.push(obj.Key);
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
  } catch (err) {
    const error = err as Error;
    logError(error.message, 'getAllObjectKeys', err, { prefix });
    throw err;
  }
};

/**
 * List objects in a prefix and return the first object key (for testing).
 * Skips folder placeholders (keys ending with /) to return an actual file.
 */
export const getFirstObjectKey = async (
  prefix: string
): Promise<string | null> => {
  try {
    const bucket = getBucketName();
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 20,
    });
    const response = await s3Client.send(command);
    const contents = response.Contents ?? [];
    const firstFile = contents.find(
      (obj) => obj.Key && !obj.Key.endsWith('/')
    );
    return firstFile?.Key ?? null;
  } catch (err) {
    const error = err as Error;
    logError(error.message, 'getFirstObjectKey', err, { prefix });
    throw err;
  }
};

/**
 * Generate presigned PUT URL for frontend to upload audio file directly to S3
 */
export const createPresignedPutUrl = async (
  key: string,
  contentType?: string,
  expiresIn = 3600
): Promise<string> => {
  try {
    const bucket = getBucketName();
    const params: PutObjectCommandInput = {
      Bucket: bucket,
      Key: key,
      ...(contentType && { ContentType: contentType }),
    };
    const command = new PutObjectCommand(params);
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (err) {
    const error = err as Error;
    logError(error.message, 'createPresignedPutUrl', err, { key });
    throw err;
  }
};

/**
 * Download file from S3 to local path (matches service-background-ops pattern).
 * Pipes S3 stream directly to file - no buffer conversion.
 */
export const downloadFileFromS3 = async (
  bucketName: string,
  s3Key: string,
  filePath: string
): Promise<void> => {
  try {
    const command = new GetObjectCommand({ Bucket: bucketName, Key: s3Key });
    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error('Empty S3 response body');
    }

    const writeStream = createWriteStream(filePath);
    await new Promise<void>((resolve, reject) => {
      (response.Body as NodeJS.ReadableStream)
        .pipe(writeStream)
        .on('close', () => resolve())
        .on('error', reject);
    });
  } catch (err) {
    const error = err as Error;
    logError(error.message, 'downloadFileFromS3', err, { s3Key, filePath });
    throw err;
  }
};

/**
 * Generate presigned GET URL so Auphonic can fetch the file from S3
 */
export const createPresignedGetUrl = async (
  key: string,
  expiresIn = 86400
): Promise<string> => {
  try {
    const bucket = getBucketName();
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (err) {
    const error = err as Error;
    logError(error.message, 'createPresignedGetUrl', err, { key });
    throw err;
  }
};
