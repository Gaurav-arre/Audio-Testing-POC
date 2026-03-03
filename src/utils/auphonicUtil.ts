import axios, { type AxiosError } from 'axios';
import { logError, logInfo } from './loggerUtil.js';

const AUPHONIC_API_BASE = 'https://auphonic.com/api';

export interface AuphonicProductionResponse {
  status_code: number;
  data?: {
    uuid: string;
    status_string?: string;
  };
  error_message?: string;
}

/**
 * Start an Auphonic production using Simple API with input_file as HTTP URL
 */
export const startAuphonicProduction = async (params: {
  inputFileUrl: string;
  title?: string;
  webhookUrl?: string;
}): Promise<AuphonicProductionResponse> => {
  const apiKey = process.env.AUPHONIC_API_KEY;
  const presetUuid = process.env.AUPHONIC_PRESET_UUID;

  if (!apiKey) {
    throw new Error('AUPHONIC_API_KEY is not set');
  }
  if (!presetUuid) {
    throw new Error('AUPHONIC_PRESET_UUID is not set');
  }

  const formData = new FormData();
  formData.append('preset', presetUuid);
  formData.append('input_file', params.inputFileUrl);
  formData.append('action', 'start');
  formData.append('title', params.title || 'Audio Production');
  if (params.webhookUrl) {
    formData.append('webhook', params.webhookUrl);
  }

  try {
    logInfo('Starting Auphonic production', {
      inputFileUrl: params.inputFileUrl.substring(0, 80) + '...',
    });

    const response = await axios.post<AuphonicProductionResponse>(
      `${AUPHONIC_API_BASE}/simple/productions.json`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );

    logInfo('Auphonic production started', {
      uuid: response.data?.data?.uuid,
      status: response.data?.data?.status_string,
    });

    return response.data;
  } catch (err) {
    const axiosErr = err as AxiosError<{ error_message?: string }>;
    const message =
      axiosErr.response?.data?.error_message ||
      axiosErr.message ||
      'Failed to start Auphonic production';
    logError(message, 'startAuphonicProduction', err, params);
    throw err;
  }
};

export interface AuphonicProductionDetails {
  data?: {
    status?: number;
    status_string?: string;
    metadata?: { title?: string };
    input_file?: string;
    output_files?: Array<{
      filename: string;
      download_url: string;
      format: string;
    }>;
  };
}

/**
 * Fetch production details (status, output_files with download_url)
 */
export const getAuphonicProductionDetails = async (
  productionUuid: string
): Promise<AuphonicProductionDetails> => {
  const apiKey = process.env.AUPHONIC_API_KEY;
  if (!apiKey) {
    throw new Error('AUPHONIC_API_KEY is not set');
  }

  try {
    const response = await axios.get<AuphonicProductionDetails>(
      `${AUPHONIC_API_BASE}/production/${productionUuid}.json`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );
    return response.data;
  } catch (err) {
    const error = err as Error;
    logError(error.message, 'getAuphonicProductionDetails', err, {
      productionUuid,
    });
    throw err;
  }
};
