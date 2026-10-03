import type { FastifyInstance } from 'fastify';
import { HttpError } from './errors.js';

/** One JSON error shape for the whole API: { error: { code, message, details? } }. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    }
    const status = err.statusCode ?? 500;
    if (status === 429) return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many attempts — please wait a bit and try again' } });
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: err.code ?? 'bad_request', message: err.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong on our side' } });
  });
}
