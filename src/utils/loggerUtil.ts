const SERVICE_NAME = process.env.SERVICE_NAME || 'auphonic-poc';

export const logError = (message: string, code: string, ...args: unknown[]) => {
  console.error(`[${SERVICE_NAME}] [ERROR] [${code}]`, message, ...args);
};

export const logInfo = (message: string, ...args: unknown[]) => {
  console.log(`[${SERVICE_NAME}] [INFO]`, message, ...args);
};
export const logWarn = (message: string, ...args: unknown[]) => {
  console.warn(`[${SERVICE_NAME}] [WARN]`, message, ...args);
};

