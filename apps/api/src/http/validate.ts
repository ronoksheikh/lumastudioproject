import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses `data` with a zod schema or throws a 400 HttpError listing what is wrong. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest(issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; '), issues);
  }
  return r.data;
}
