import { Buffer } from 'node:buffer';

import type { SandboxOutputSummary } from './contracts';
import { calculateSandboxOutputHash } from './hashing';

const ANSI_SEQUENCE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const COMMON_TOKEN =
  /(?:\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\b(?:sk|gh[opusr]|npm)_[A-Za-z0-9_-]{12,}\b)/gu;
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu;
const PEM_BLOCK = /-----BEGIN [^-\r\n]+-----[\s\S]*?-----END [^-\r\n]+-----/gu;
const REDACTED = '[REDACTED]';

export interface SandboxOutputSanitizationOptions {
  readonly maxBytes: number;
  readonly maxLines: number;
  readonly maxLineBytes: number;
  readonly sensitiveValues?: readonly string[];
  readonly hostPaths?: readonly string[];
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.byteLength <= maxBytes) return value;
  if (maxBytes <= 0) return '';
  let end = maxBytes;
  while (end > 0 && (encoded[end] ?? 0) >= 0x80 && (encoded[end] ?? 0) < 0xc0) end -= 1;
  return encoded.subarray(0, end).toString('utf8');
}

function utf8Tail(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.byteLength <= maxBytes) return value;
  if (maxBytes <= 0) return '';
  let start = encoded.byteLength - maxBytes;
  while (
    start < encoded.byteLength &&
    (encoded[start] ?? 0) >= 0x80 &&
    (encoded[start] ?? 0) < 0xc0
  ) {
    start += 1;
  }
  return encoded.subarray(start).toString('utf8');
}

const TRUNCATION_MARKER = '\n...[TRUNCATED]...\n';

function truncateHeadTail(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
  if (maxBytes <= markerBytes) return truncateUtf8(value, maxBytes);
  const available = maxBytes - markerBytes;
  const headBytes = Math.min(64 * 1024, Math.floor(available / 4));
  return `${truncateUtf8(value, headBytes)}${TRUNCATION_MARKER}${utf8Tail(
    value,
    available - headBytes,
  )}`;
}

function limitLinesHeadTail(value: string, maxLines: number): string {
  const lines = value.split('\n');
  if (lines.length <= maxLines) return value;
  if (maxLines === 1) return lines[0] ?? '';
  const headLines = Math.max(1, Math.floor(maxLines / 4));
  const tailLines = maxLines - headLines;
  return [...lines.slice(0, headLines), ...lines.slice(-tailLines)].join('\n');
}

function redactLiteralValues(value: string, literals: readonly string[]): string {
  return literals
    .filter((literal) => literal.length >= 4)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (redacted, literal) =>
        redacted.replace(new RegExp(escapeRegularExpression(literal), 'gu'), REDACTED),
      value,
    );
}

function sanitize(value: string, options: SandboxOutputSanitizationOptions): string {
  const normalized = value
    .replace(/\r\n?/gu, '\n')
    .replace(ANSI_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(PEM_BLOCK, REDACTED)
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
    .replace(COMMON_TOKEN, REDACTED)
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`);
  return redactLiteralValues(normalized, [
    ...(options.sensitiveValues ?? []),
    ...(options.hostPaths ?? []),
  ]);
}

export function sanitizeSandboxOutput(
  value: string,
  options: SandboxOutputSanitizationOptions,
): SandboxOutputSummary {
  const observedBytes = Buffer.byteLength(value, 'utf8');
  const observedLines = value.length === 0 ? 0 : value.split(/\r\n?|\n/u).length;
  const sanitized = sanitize(value, options);
  const lineLimited = limitLinesHeadTail(sanitized, options.maxLines);
  const limitedLines = lineLimited
    .split('\n')
    .map((line) => truncateUtf8(line, options.maxLineBytes))
    .join('\n');
  const summary = truncateHeadTail(limitedLines, options.maxBytes);
  const truncated = summary !== sanitized;
  return Object.freeze({
    summary,
    observedBytes,
    observedLines,
    truncated,
    summaryHash: calculateSandboxOutputHash(summary),
  });
}
