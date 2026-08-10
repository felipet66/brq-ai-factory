import { Buffer } from 'node:buffer';

const HEAD_BYTES = 64 * 1024;
const TRUNCATION_MARKER = Buffer.from('\n...[OUTPUT TRUNCATED]...\n', 'utf8');
const REDACTED_BOUNDARY_BYTES = 1024;

export interface DockerCapturedOutput {
  readonly value: string;
  readonly observedBytes: number;
  readonly observedLines: number;
  readonly captureTruncated: boolean;
}

function trailingBytes(chunks: readonly Buffer[], limit: number): Buffer {
  if (limit <= 0) return Buffer.alloc(0);
  const joined = Buffer.concat(chunks);
  return joined.byteLength <= limit ? joined : joined.subarray(joined.byteLength - limit);
}

function decodeBoundary(buffer: Buffer, boundary: 'HEAD' | 'TAIL'): string {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let trim = 0; trim <= Math.min(3, buffer.byteLength); trim += 1) {
    try {
      const candidate =
        boundary === 'HEAD' ? buffer.subarray(0, buffer.byteLength - trim) : buffer.subarray(trim);
      return decoder.decode(candidate);
    } catch {
      // UTF-8 code points are at most four bytes; trim only the retention boundary.
    }
  }
  return '';
}

export class BoundedDockerOutputCollector {
  readonly #captureLimit: number;
  readonly #retentionLimit: number;
  readonly #headLimit: number;
  readonly #tailLimit: number;
  readonly #head: Buffer[] = [];
  readonly #tail: Buffer[] = [];
  #headBytes = 0;
  #tailBytes = 0;
  #observedBytes = 0;
  #lineBreaks = 0;

  constructor(captureLimit: number, retentionLimit = captureLimit) {
    this.#captureLimit = captureLimit;
    this.#retentionLimit = Math.max(captureLimit, retentionLimit);
    this.#headLimit = Math.min(HEAD_BYTES, this.#retentionLimit);
    this.#tailLimit = Math.max(0, this.#retentionLimit - this.#headLimit);
  }

  append(chunk: Buffer): void {
    if (chunk.byteLength === 0) return;
    this.#observedBytes += chunk.byteLength;
    for (const byte of chunk) if (byte === 0x0a) this.#lineBreaks += 1;

    let remaining = chunk;
    if (this.#headBytes < this.#headLimit) {
      const length = Math.min(this.#headLimit - this.#headBytes, remaining.byteLength);
      this.#head.push(remaining.subarray(0, length));
      this.#headBytes += length;
      remaining = remaining.subarray(length);
    }
    if (remaining.byteLength > 0 && this.#tailLimit > 0) {
      this.#tail.push(remaining);
      this.#tailBytes += remaining.byteLength;
      if (this.#tailBytes > this.#tailLimit) {
        const compacted = trailingBytes(this.#tail, this.#tailLimit);
        this.#tail.splice(0, this.#tail.length, compacted);
        this.#tailBytes = compacted.byteLength;
      }
    }
  }

  finish(): DockerCapturedOutput {
    const retentionTruncated = this.#observedBytes > this.#retentionLimit;
    const head = Buffer.concat(this.#head);
    const tail = trailingBytes(this.#tail, this.#tailLimit);
    const value = retentionTruncated
      ? `${decodeBoundary(
          head.subarray(0, Math.max(0, head.byteLength - REDACTED_BOUNDARY_BYTES)),
          'HEAD',
        )}${TRUNCATION_MARKER.toString('utf8')}${decodeBoundary(
          tail.subarray(Math.min(REDACTED_BOUNDARY_BYTES, tail.byteLength)),
          'TAIL',
        )}`
      : decodeBoundary(Buffer.concat([head, tail]), 'HEAD');
    return Object.freeze({
      value,
      observedBytes: this.#observedBytes,
      observedLines: this.#observedBytes === 0 ? 0 : this.#lineBreaks + 1,
      captureTruncated: this.#observedBytes > this.#captureLimit,
    });
  }
}
