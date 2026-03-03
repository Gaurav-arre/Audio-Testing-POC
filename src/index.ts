import * as dotenv from 'dotenv';
import express from 'express';
import { initializeS3Client } from './utils/s3Util.js';
import audioRoutes from './routes/audioRoutes.js';
import { logInfo, logError } from './utils/loggerUtil.js';

dotenv.config({ path: '.env' });

const PORT = parseInt(process.env.PORT || '3000', 10);

initializeS3Client();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: process.env.SERVICE_NAME || 'auphonic-poc',
  });
});

app.use('/', audioRoutes);

app.listen(PORT, () => {
  logInfo(`Server running on port ${PORT}`);
});

process.on('unhandledRejection', (reason: unknown) => {
  logError('unhandledRejection', 'unhandledRejection', reason);
});

process.on('uncaughtException', (reason: unknown) => {
  logError('uncaughtException', 'uncaughtException', reason);
  process.exit(1);
});
