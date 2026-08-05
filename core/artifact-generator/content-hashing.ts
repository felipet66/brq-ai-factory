import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type { ValidatedOutput } from '@brq/response-validator';

import { canonicalizeJson } from './canonical-json';

export function utf8ByteLength(content: string): number {
  return Buffer.byteLength(content, 'utf8');
}

export function calculateContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function calculateValidatedValueHash(output: ValidatedOutput): string {
  return output.format === 'TEXT'
    ? calculateContentHash(output.content)
    : calculateContentHash(canonicalizeJson(output.data));
}
