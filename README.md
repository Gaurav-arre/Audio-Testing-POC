# Auphonic POC - Audio Workflow Backend

Node.js (Express) backend for an audio workflow: upload to S3 → process via Auphonic → receive output.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `SERVICE_NAME` | Service identifier (default: auphonic-poc) |
| `PORT` | Server port (default: 3000) |
| `S3_AWS_REGION` | AWS region for S3 |
| `S3_AWS_ACCESS_KEY_ID` | AWS access key |
| `S3_AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `S3_BUCKET_NAME` | S3 bucket for uploads |
| `AUPHONIC_API_KEY` | Auphonic API key |
| `AUPHONIC_PRESET_UUID` | Auphonic preset UUID |
| `AUPHONIC_WEBHOOK_BASE_URL` | Base URL for webhook (must be reachable by Auphonic) |
| `AUPHONIC_S3_SERVICE_UUID` | Optional: set if preset has S3 output configured (skip download/upload) |

### 3. Auphonic S3 external service (optional)

To have Auphonic automatically upload processed files to your S3 bucket:

1. Go to [Auphonic Services](https://auphonic.com/engine/services/)
2. Add "Amazon S3" as an external service
3. Configure bucket, region, credentials
4. Edit your preset at [Presets](https://auphonic.com/engine/presets/)
5. In "Publishing / External Services", add the S3 service as output
6. Set `AUPHONIC_S3_SERVICE_UUID` in `.env` (use the service UUID from step 2)

If you skip this, the backend will download the processed file from Auphonic and upload it to S3 when the webhook fires.

## Run

```bash
npm start
```

## API Endpoints

### `GET /presigned-upload?key=<s3-key>&contentType=<optional>`

Returns a presigned S3 PUT URL. Frontend uses this to upload the audio file directly to S3.

### `POST /start-production-first-file`

Fetches the first file from `Auphonic-audio-POC/` and starts production. No body required.

### `POST /start-production-all-files`

Fetches all files from the prefix and starts Auphonic production for each. Optional body: `{ "prefix": "custom/prefix/" }`.

### `POST /start-production`

Body:

```json
{ "s3Key": "uploads/my-audio.mp3" }
```

1. Generates a presigned GET URL for the S3 object
2. Calls Auphonic Simple API with that URL as `input_file`
3. Stores production metadata

### `POST /webhook/auphonic`

Auphonic callback when production is finished. Expects `uuid`, `status_string`, `status` (form-urlencoded or multipart).

### `GET /production/:uuid`

Returns stored production metadata.

## Workflow

**Flow: Download from S3 → Process via Auphonic → Store to S3 as `improve_*`**

1. Audio files in S3 (e.g. `Auphonic-audio-POC/original_v1.m4a`, `original_v2.m4a`)
2. Call `POST /start-production-first-file` or `POST /start-production-all-files`
3. Auphonic fetches from S3 via presigned URL, processes audio
4. Webhook fires when done → backend downloads from Auphonic, uploads to S3
5. Output naming: `original_v1.m4a` → `improve_v1.mp3` (same path prefix)
