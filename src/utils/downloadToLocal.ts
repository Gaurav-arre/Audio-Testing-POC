import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { logError, logInfo } from './loggerUtil.js';
import { downloadFileFromS3, getBucketName } from './s3Util.js';

const OUTPUT_DIR = 'output';

/**
 * Download file from URL and save to local output/ folder.
 */
export const downloadFileToLocal = async (
  downloadUrl: string,
  filename: string,
  options?: { authHeader?: string }
): Promise<string> => {
  try {
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      headers: options?.authHeader ? { Authorization: options.authHeader } : undefined,
    });

    const outputPath = path.join(process.cwd(), OUTPUT_DIR);
    fs.mkdirSync(outputPath, { recursive: true });

    const filePath = path.join(outputPath, filename);
    fs.writeFileSync(filePath, Buffer.from(response.data));

    logInfo('Saved file locally', { filePath });
    return filePath;
  } catch (err) {
    const error = err as Error;
    logError(error.message, 'downloadFileToLocal', err, { downloadUrl, filename });
    throw err;
  }
};

/**
 * Download processed file from Auphonic and save to local output/ folder.
 */
export const downloadProcessedFileToLocal = async (
  downloadUrl: string,
  filename: string
): Promise<string> => {
  logInfo('Downloading processed file from Auphonic', { downloadUrl });
  const apiKey = process.env.AUPHONIC_API_KEY;
  return downloadFileToLocal(downloadUrl, filename, {
    authHeader: apiKey ? `Bearer ${apiKey}` : undefined,
  });
};

export const downloadS3FileToLocal = async (
  s3Key: string,
  filename: string
): Promise<string> => {
  logInfo('Downloading original file from S3 (stream pipe)', { s3Key });
  const outputPath = path.join(process.cwd(), OUTPUT_DIR);
  fs.mkdirSync(outputPath, { recursive: true });
  const filePath = path.join(outputPath, filename);
  await downloadFileFromS3(getBucketName(), s3Key, filePath);
  logInfo('Saved original file locally', { filePath });
  return filePath;
};
