import axios from 'axios';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getS3Client, getBucketName } from './s3Util.js';
import { logError, logInfo } from './loggerUtil.js';

/**
 * Download processed file from Auphonic and upload to S3.
 * Use when NOT using Auphonic S3 external service for auto-upload.
 */
export const downloadAndUploadToS3 = async (
  downloadUrl: string,
  s3OutputKey: string
): Promise<void> => {
  try {
    logInfo('Downloading processed file from Auphonic', { downloadUrl });

    const apiKey = process.env.AUPHONIC_API_KEY;
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });

    const buffer = Buffer.from(response.data);
    const contentType =
      response.headers['content-type'] || 'audio/mpeg';
    const s3Client = getS3Client();
    const bucket = getBucketName();

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: s3OutputKey,
      Body: buffer,
      ContentType: contentType,
    });

    await s3Client.send(command);
    logInfo('Uploaded processed file to S3', { s3OutputKey, bucket });
  } catch (err) {
    const error = err as Error;
    logError(error.message, 'downloadAndUploadToS3', err, {
      downloadUrl,
      s3OutputKey,
    });
    throw err;
  }
};
