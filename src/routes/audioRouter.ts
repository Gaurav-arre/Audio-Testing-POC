import { Router, type Request, type Response } from 'express';
import { createPresignedGetUrl } from '../utils/s3Util.js';
import {
  startAuphonicProduction,
  getAuphonicProductionDetails,
} from '../utils/auphonicUtil.js';
import {
  downloadProcessedFileToLocal,
  downloadS3FileToLocal,
} from '../utils/downloadToLocal.js';
import { logError, logInfo } from '../utils/loggerUtil.js';

const DEFAULT_S3_PREFIX = 'Auphonic-audio-POC/';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pollUntilDone = async (uuid: string) => {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const details = await getAuphonicProductionDetails(uuid);
    const isDone =
      details.data?.status_string === 'Done' || details.data?.status === 3;
    if (isDone) return details;
    logInfo('Production in progress, polling...', {
      uuid,
      status: details.data?.status_string ?? 'Unknown',
    });
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Production timed out waiting for Auphonic to finish');
};

const router = Router();

/**
 * Start production → wait until done → download original + processed to local output/
 */
router.post('/start-production-first-file', async (req: Request, res: Response) => {
  try {
    const filename = (req.body?.filename as string)?.trim();
    if (!filename) {
      res.status(400).json({ error: 'Body parameter "filename" is required' });
      return;
    }
    const prefix = (req.body?.prefix as string) || DEFAULT_S3_PREFIX;
    const s3Key = `${prefix.replace(/\/?$/, '/')}${filename.replace(/^\//, '')}`;
    logInfo('Using file from S3', { filename, s3Key });

    const startTime = Date.now();

    const presignedGetUrl = await createPresignedGetUrl(s3Key); // TODO: use the presigned URL to start the production
    const result = await startAuphonicProduction({
      inputFileUrl: presignedGetUrl,
      title: `Production: ${s3Key}`,
    });

    const productionUuid = result.data?.uuid;
    if (!productionUuid) {
      throw new Error(result.error_message || 'No production UUID returned');
    }

    logInfo('Production started, waiting for completion...', {
      productionUuid,
      sourceS3Key: s3Key,
    });

    const details = await pollUntilDone(productionUuid);

    const primaryFile = details.data?.output_files?.[0];
    if (!primaryFile?.download_url) {
      throw new Error('No output file URL from Auphonic');
    }

    const files: { type: string; path: string; filename: string }[] = [];

    const originalFilename = s3Key.split('/').pop()!;
    const originalPath = await downloadS3FileToLocal(s3Key, originalFilename);
    files.push({ type: 'original', path: originalPath, filename: originalFilename });

    const processedPath = await downloadProcessedFileToLocal(
      primaryFile.download_url,
      primaryFile.filename
    );
    files.push({ type: 'processed', path: processedPath, filename: primaryFile.filename });

    const timeTakenMs = Date.now() - startTime;

    logInfo('Downloaded original and processed files locally', {
      productionUuid,
      files,
      timeTakenMs,
    });

    const timeFormatted = `${(timeTakenMs / 1000).toFixed(2)}s`;
    res.json({
      productionUuid,
      sourceS3Key: s3Key,
      status: 'done',
      files,
      timeTakenMs,
      timeTakenFormatted: timeFormatted,
      message:
        `Downloaded original from S3 and processed from Auphonic to local output/ folder. Conversion took ${timeFormatted}`,
    });
  } catch (err) {
    const e = err as Error;
    logError(e.message, 'start-production-first-file', err);
    res.status(500).json({ error: e.message });
  }
});

export default router;
