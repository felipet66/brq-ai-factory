import type { KnowledgeSourceEntry } from '../contracts';
import { KNOWLEDGE_ERROR_CODES, KnowledgeLoaderError } from '../errors';
import type { KnowledgeSource } from '../knowledge-source';

export type FakeKnowledgeDocumentValue = string | Uint8Array;

export interface FakeKnowledgeSourceOptions {
  documents?: Readonly<Record<string, FakeKnowledgeDocumentValue>>;
  sourceId?: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toBytes(value: FakeKnowledgeDocumentValue): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : Uint8Array.from(value);
}

export class FakeKnowledgeSource implements KnowledgeSource {
  readonly sourceId: string;
  readonly readCalls: string[] = [];
  discoverCalls = 0;

  readonly #documents = new Map<string, Uint8Array>();

  constructor(options: FakeKnowledgeSourceOptions = {}) {
    this.sourceId = options.sourceId ?? 'fake-knowledge';

    for (const [locator, value] of Object.entries(options.documents ?? {})) {
      this.#documents.set(locator, toBytes(value));
    }
  }

  async discover(): Promise<readonly KnowledgeSourceEntry[]> {
    this.discoverCalls += 1;

    return [...this.#documents.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([locator, bytes]) => ({
        locator,
        kind: 'FILE' as const,
        sizeBytes: bytes.byteLength,
      }));
  }

  async read(locator: string): Promise<Uint8Array> {
    this.readCalls.push(locator);
    const bytes = this.#documents.get(locator);

    if (bytes === undefined) {
      throw new KnowledgeLoaderError('O documento simulado não foi encontrado.', {
        code: KNOWLEDGE_ERROR_CODES.DOCUMENT_NOT_FOUND,
        sourceId: this.sourceId,
      });
    }

    return Uint8Array.from(bytes);
  }

  setDocument(locator: string, value: FakeKnowledgeDocumentValue): void {
    this.#documents.set(locator, toBytes(value));
  }

  removeDocument(locator: string): void {
    this.#documents.delete(locator);
  }
}
