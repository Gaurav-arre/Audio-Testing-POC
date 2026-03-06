import * as dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import { initializeS3Client } from './utils/s3Util.js';
import { logInfo, logError } from './utils/loggerUtil.js';
import audioRouter from './routes/audioRouter.js';

dotenv.config({ path: '.env' });

const PORT = parseInt(process.env.PORT || '3000', 10);

initializeS3Client();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/', audioRouter);

app.listen(PORT, () => {
  logInfo(`Server running on port ${PORT}`);
});

