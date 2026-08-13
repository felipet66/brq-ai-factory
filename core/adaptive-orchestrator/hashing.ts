import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json';

export function domainHash(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(`${domain}\u0000${canonicalJson(value)}`)
    .digest('hex');
}
