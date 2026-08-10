import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { previewIdSchema } from '@/api/preview-contracts';

const COOKIE_VERSION = 1 as const;
const HASH_DOMAIN = 'brq.preview.access-ticket.v1';
const COOKIE_DOMAIN = 'brq.preview.access-cookie.v1';
const TECHNICAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface PreviewAccessClaims {
  readonly version: typeof COOKIE_VERSION;
  readonly previewId: string;
  readonly executionId: string;
  readonly ownerUserId: string;
  readonly expiresAt: string;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${COOKIE_DOMAIN}\0${payload}`, 'utf8')
    .digest('base64url');
}

function validClaims(value: unknown): value is PreviewAccessClaims {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const claims = value as Partial<PreviewAccessClaims>;
  return (
    claims.version === COOKIE_VERSION &&
    typeof claims.previewId === 'string' &&
    previewIdSchema.safeParse(claims.previewId).success &&
    typeof claims.executionId === 'string' &&
    TECHNICAL_ID.test(claims.executionId) &&
    typeof claims.ownerUserId === 'string' &&
    TECHNICAL_ID.test(claims.ownerUserId) &&
    typeof claims.expiresAt === 'string' &&
    Number.isFinite(Date.parse(claims.expiresAt))
  );
}

export function hashPreviewAccessTicket(ticket: string): string {
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(ticket)) {
    throw new TypeError('O ticket de Preview é inválido.');
  }
  return createHash('sha256').update(`${HASH_DOMAIN}\0${ticket}`, 'utf8').digest('hex');
}

export function signPreviewAccessCookie(claims: PreviewAccessClaims, secret: string): string {
  if (!validClaims(claims) || secret.length < 32) {
    throw new TypeError('As credenciais do Preview são inválidas.');
  }
  const payload = encode(JSON.stringify(claims));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyPreviewAccessCookie(
  value: string,
  secret: string,
  observedAt: string,
): PreviewAccessClaims | null {
  if (secret.length < 32 || value.length > 2048) return null;
  const pieces = value.split('.');
  if (pieces.length !== 2) return null;
  const [payload, suppliedSignature] = pieces;
  if (
    payload === undefined ||
    suppliedSignature === undefined ||
    !/^[A-Za-z0-9_-]+$/u.test(payload) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(suppliedSignature)
  ) {
    return null;
  }
  const expected = signature(payload, secret);
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(suppliedSignature, 'utf8');
  if (left.byteLength !== right.byteLength || !timingSafeEqual(left, right)) return null;
  try {
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    const claims: unknown = JSON.parse(decoded);
    if (!validClaims(claims) || Date.parse(claims.expiresAt) <= Date.parse(observedAt)) return null;
    return Object.freeze({ ...claims });
  } catch {
    return null;
  }
}
