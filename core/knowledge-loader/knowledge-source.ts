import type { KnowledgeSourceEntry } from './contracts';

export interface KnowledgeSource {
  readonly sourceId: string;
  discover(): Promise<readonly KnowledgeSourceEntry[]>;
  read(locator: string): Promise<Uint8Array>;
}
