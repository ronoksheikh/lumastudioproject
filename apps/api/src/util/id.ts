import { randomBytes } from 'node:crypto';

/** 16-char url-safe random id. */
export const newId = () => randomBytes(12).toString('base64url');
