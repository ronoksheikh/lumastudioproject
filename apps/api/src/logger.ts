import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  // never let secrets reach the logs
  redact: ['req.headers.cookie', 'req.headers.authorization', '*.api_key', '*.apiKey', '*.password'],
  ...(config.isProd ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});
