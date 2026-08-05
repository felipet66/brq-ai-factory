import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { canonicalizeJson, type ReadonlyJsonValue } from './canonical-json';

export function calculateTextHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function calculateCanonicalHash(value: ReadonlyJsonValue): string {
  return calculateTextHash(canonicalizeJson(value));
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function canonicalByteLength(value: ReadonlyJsonValue): number {
  return utf8ByteLength(canonicalizeJson(value));
}
