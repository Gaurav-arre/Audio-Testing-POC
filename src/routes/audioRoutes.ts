import { Router, type Request, type Response } from 'express';
import {
  createPresignedPutUrl,
  createPresignedGetUrl,
  getFirstObjectKey,
  getAllObjectKeys,
} from '../utils/s3Util.js';
import {
  startAuphonicProduction,
  getAuphonicProductionDetails,
} from '../utils/auphonicUtil.js';
import {
  downloadProcessedFileToLocal,
  downloadS3FileToLocal,
} from '../utils/downloadToLocal.js';
import {
  saveProduction,
  getProduction,
  updateProduction,
} from '../store/productionStore.js';
import { logError, logInfo } from '../utils/loggerUtil.js';

const router = Router();

const DEFAULT_S3_PREFIX = 'Auphonic-audio-POC/';

/**
 * Original filename (keep as-is): original_v1.m4a
 */
const deriveOriginalFilename = (sourceS3Key: string): string => {
  const lastSlash = sourceS3Key.lastIndexOf('/');
  return lastSlash >= 0 ? sourceS3Key.slice(lastSlash + 1) : sourceS3Key;
};

/**
 * Processed filename: original_v1 -> improve_v1.mp3
 */
const deriveProcessedFilename = (
  sourceS3Key: string,
  outputFormat: string
): string => {
  const lastSlash = sourceS3Key.lastIndexOf('/');
  const filename = lastSlash >= 0 ? sourceS3Key.slice(lastSlash + 1) : sourceS3Key;
  const baseName = filename.replace(/\.[^.]+$/, '');
  const improvedName = baseName.replace(/^original/i, 'improve');
  return `${improvedName}.${outputFormat}`;
};

/**
 * Derive improve_* from Auphonic filename when metadata is missing: original_v1.mp3 -> improve_v1.mp3
 */
const deriveProcessedFromAuphonicFilename = (
  auphonicFilename: string,
  outputFormat: string
): string => {
  const baseName = auphonicFilename.replace(/\.[^.]+$/, '');
  const improvedName = baseName.replace(/^original/i, 'improve');
  return `${improvedName}.${outputFormat}`;
};

const startProductionWithS3Key = async (
  s3Key: string,
  res: Response
): Promise<void> => {
  const webhookBaseUrl = (
    process.env.AUPHONIC_WEBHOOK_BASE_URL || ''
  ).replace(/\/$/, '');
  const webhookUrl = webhookBaseUrl
    ? `${webhookBaseUrl}/webhook/auphonic`
    : undefined;

  const presignedGetUrl = await createPresignedGetUrl(s3Key);
  logInfo('Generated presigned GET URL for Auphonic', { s3Key });

  const result = await startAuphonicProduction({
    inputFileUrl: presignedGetUrl,
    title: `Production: ${s3Key}`,
    webhookUrl,
  });

  const productionUuid = result.data?.uuid;
  if (!productionUuid) {
    throw new Error(result.error_message || 'No production UUID returned');
  }

  saveProduction({
    productionUuid,
    sourceS3Key: s3Key,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  logInfo('Production started and metadata stored', {
    productionUuid,
    sourceS3Key: s3Key,
  });

  res.json({
    productionUuid,
    sourceS3Key: s3Key,
    status: 'pending',
    message:
      'Production started. Webhook will be called when processing completes.',
  });
};


// /**
//  * POST /start-production-all-files
//  * Fetches all audio files from prefix, starts Auphonic production for each.
//  * Download from S3 → Process → Store as improve_*.mp3
//  */
// router.post('/start-production-all-files', async (req: Request, res: Response) => {
//   try {
//     const prefix = (req.body?.prefix as string) || DEFAULT_S3_PREFIX;
//     const keys = await getAllObjectKeys(prefix);

//     if (keys.length === 0) {
//       res.status(404).json({
//         error: `No files found in prefix: ${prefix}`,
//       });
//       return;
//     }

//     const results: { s3Key: string; productionUuid?: string; error?: string }[] = [];

//     for (const s3Key of keys) {
//       try {
//         const webhookBaseUrl = (
//           process.env.AUPHONIC_WEBHOOK_BASE_URL || ''
//         ).replace(/\/$/, '');
//         const webhookUrl = webhookBaseUrl
//           ? `${webhookBaseUrl}/webhook/auphonic`
//           : undefined;

//         const presignedGetUrl = await createPresignedGetUrl(s3Key);
//         const result = await startAuphonicProduction({
//           inputFileUrl: presignedGetUrl,
//           title: `Production: ${s3Key}`,
//           webhookUrl,
//         });

//         const productionUuid = result.data?.uuid;
//         if (productionUuid) {
//           saveProduction({
//             productionUuid,
//             sourceS3Key: s3Key,
//             status: 'pending',
//             createdAt: new Date().toISOString(),
//             updatedAt: new Date().toISOString(),
//           });
//           results.push({ s3Key, productionUuid });
//         } else {
//           results.push({ s3Key, error: result.error_message || 'No UUID' });
//         }
//       } catch (err) {
//         const error = err as Error;
//         results.push({ s3Key, error: error.message });
//       }
//     }

//     logInfo('Started productions for all files', { prefix, count: keys.length, results });
//     res.json({
//       message: `Started ${results.filter((r) => r.productionUuid).length}/${keys.length} productions`,
//       prefix,
//       results,
//     });
//   } catch (err) {
//     const error = err as Error;
//     logError(error.message, 'start-production-all-files', err);
//     res.status(500).json({ error: error.message });
//   }
// });

/**
 * POST /start-production-first-file
 * Fetches the first file from Auphonic-audio-POC/ and starts production.
 * For local testing with existing S3 files.
 * Optional body: { prefix?: string } to override default prefix
 */
router.post('/start-production-first-file', async (req: Request, res: Response) => {
  try {
    const prefix = (req.body?.prefix as string) || DEFAULT_S3_PREFIX;
    const s3Key = await getFirstObjectKey(prefix);

    if (!s3Key) {
      res.status(404).json({
        error: `No objects found in prefix: ${prefix}`,
      });
      return;
    }

    logInfo('Using first file from S3', { prefix, s3Key });
    await startProductionWithS3Key(s3Key, res);
  } catch (err) {
    const error = err as Error;
    logError(error.message, 'start-production-first-file', err);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /start-production
 * Body: { s3Key: string }
 * 1. Generates presigned GET URL for the S3 object
 * 2. Calls Auphonic Simple API with the URL as input_file
 * 3. Stores production metadata
 */
// router.post('/start-production', async (req: Request, res: Response) => {
//   try {
//     const { s3Key } = req.body;
//     if (!s3Key || typeof s3Key !== 'string') {
//       res.status(400).json({ error: 'Body parameter "s3Key" is required' });
//       return;
//     }
//     await startProductionWithS3Key(s3Key, res);
//   } catch (err) {
//     const error = err as Error;
//     logError(error.message, 'start-production', err);
//     res.status(500).json({ error: error.message });
//   }
// });

/**
 * POST /webhook/auphonic
 * Auphonic callback when production is finished.
 * Supports application/x-www-form-urlencoded and multipart/form-data.
 */
// router.post('/webhook/auphonic', async (req: Request, res: Response) => {
//   try {
//     const { uuid, status_string, status } = req.body;
//     if (!uuid) {
//       logError('Webhook received without uuid', 'webhook-auphonic', req.body);
//       res.status(400).json({ error: 'uuid is required' });
//       return;
//     }

//     logInfo('Auphonic webhook received', { uuid, status_string, status });

//     const metadata = getProduction(uuid);
//     if (!metadata) {
//       logError('Webhook for unknown production', 'webhook-auphonic', { uuid });
//       res.status(200).send('OK');
//       return;
//     }

//     const isDone = status_string === 'Done' || status === 3;
//     const isError = status_string === 'Error' || status === 2;

//     updateProduction(uuid, {
//       status: isDone ? 'done' : isError ? 'error' : 'pending',
//     });

//     if (isDone) {
//       try {
//         const details = await getAuphonicProductionDetails(uuid);
//         const outputFiles = details.data?.output_files;
//         const primaryFile = outputFiles?.[0];

//         const originalFilename = deriveOriginalFilename(metadata.sourceS3Key);
//         await downloadS3FileToLocal(metadata.sourceS3Key, originalFilename);
//         logInfo('Downloaded original to local output/', { uuid, filename: originalFilename });

//         if (primaryFile?.download_url) {
//           const processedFilename = deriveProcessedFilename(
//             metadata.sourceS3Key,
//             primaryFile.format || 'mp3'
//           );
//           await downloadProcessedFileToLocal(primaryFile.download_url, processedFilename);
//           logInfo('Downloaded processed file to local output/', {
//             uuid,
//             filename: processedFilename,
//           });
//         }
//       } catch (downloadErr) {
//         logError(
//           'Failed to download files',
//           'webhook-download',
//           downloadErr
//         );
//         updateProduction(uuid, { status: 'error' });
//       }
//     }

//     res.status(200).send('OK');
//   } catch (err) {
//     const error = err as Error;
//     logError(error.message, 'webhook-auphonic', err);
//     res.status(500).json({ error: error.message });
//   }
// });

/**
 * GET /production/:uuid/status
 * Fetch live status from Auphonic (status stays "Waiting" until webhook fires or you sync)
 */
router.get('/production/:uuid/status', async (req: Request, res: Response) => {
  try {
    const uuid = req.params.uuid as string;
    const details = await getAuphonicProductionDetails(uuid);
    const status = details.data?.status_string ?? 'Unknown';
    const statusCode = details.data?.status;
    res.json({
      uuid,
      status,
      statusCode,
      isDone: status === 'Done' || statusCode === 3,
    });
  } catch (err) {
    const error = err as Error;
    logError(error.message, 'production-status', err);
    res.status(500).json({ error: error.message });
  }
});

const parseSourceS3KeyFromTitle = (title?: string): string | null => {
  if (!title?.startsWith('Production: ')) return null;
  const s3Key = title.replace(/^Production:\s*/, '').trim();
  return s3Key && !s3Key.includes(' ') ? s3Key : null;
};

const handleProductionSync = async (req: Request, res: Response): Promise<void> => {
  try {
    const uuid = req.params.uuid as string;
    const sourceS3KeyFromQuery = (req.query.sourceS3Key as string)?.trim();

    let metadata = getProduction(uuid);
    if (!metadata && sourceS3KeyFromQuery) {
      metadata = { productionUuid: uuid, sourceS3Key: sourceS3KeyFromQuery, status: 'pending' as const, createdAt: '', updatedAt: '' };
    }

    const details = await getAuphonicProductionDetails(uuid);
    const isDone = details.data?.status_string === 'Done' || details.data?.status === 3;

    if (!isDone) {
      res.json({
        uuid,
        status: details.data?.status_string ?? 'Unknown',
        message: 'Production not done yet. Wait and try again.',
      });
      return;
    }

    const primaryFile = details.data?.output_files?.[0];
    if (!primaryFile?.download_url) {
      res.status(500).json({ error: 'No output file URL from Auphonic' });
      return;
    }

    const sourceS3Key = metadata?.sourceS3Key ?? parseSourceS3KeyFromTitle(details.data?.metadata?.title);
    const effectiveMetadata = metadata ?? (sourceS3Key ? { productionUuid: uuid, sourceS3Key, status: 'pending' as const, createdAt: '', updatedAt: '' } : null);

    const files: { type: string; path: string; filename: string }[] = [];

    if (effectiveMetadata) {
      const originalFilename = deriveOriginalFilename(effectiveMetadata.sourceS3Key);
      const originalPath = await downloadS3FileToLocal(
        effectiveMetadata.sourceS3Key,
        originalFilename
      );
      files.push({ type: 'original', path: originalPath, filename: originalFilename });
    }

    const processedFilename = effectiveMetadata
      ? deriveProcessedFilename(effectiveMetadata.sourceS3Key, primaryFile.format || 'mp3')
      : deriveProcessedFromAuphonicFilename(primaryFile.filename, primaryFile.format || 'mp3');
    const processedPath = await downloadProcessedFileToLocal(
      primaryFile.download_url,
      processedFilename
    );
    files.push({ type: 'processed', path: processedPath, filename: processedFilename });

    if (effectiveMetadata) {
      updateProduction(uuid, { status: 'done' });
    }

    logInfo('Downloaded original and processed files locally', { uuid, files });
    res.json({
      uuid,
      status: 'done',
      files,
      message: 'Downloaded original from S3 and processed from Auphonic to local output/ folder',
    });
  } catch (err) {
    const error = err as Error;
    logError(error.message, 'production-sync', err);
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST or GET /production/:uuid/sync
 * Download processed file from Auphonic to local output/ folder.
 * GET supported so you can trigger from browser.
 */
router.post('/production/:uuid/sync', handleProductionSync);
//router.get('/production/:uuid/sync', handleProductionSync);

// /**
//  * GET /production/:uuid
//  * Get production metadata by UUID (must be last - :uuid would match /status and /sync)
//  */
// router.get('/production/:uuid', (req: Request, res: Response) => {
//   const uuid = req.params.uuid as string;
//   const metadata = getProduction(uuid);
//   if (!metadata) {
//     res.status(404).json({ error: 'Production not found' });
//     return;
//   }
//   res.json(metadata);
// });

export default router;
