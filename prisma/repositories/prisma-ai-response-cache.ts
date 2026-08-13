import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  aiResponseSchema,
  calculateAIResponseHash,
  type AIResponseCache,
  type AIResponseCacheAgent,
  type AIResponseCacheClaimResult,
  type AIResponseCacheCompleteInput,
  type AIResponseCacheEntry,
  type AIResponseCacheFailInput,
  type AIResponseCacheKey,
  type AIResponseCheckpointInspection,
  type AIResponseCheckpointInspectionInput,
  type AIResponseCheckpointReader,
  type CompletedAIResponse,
} from '@brq/ai-provider';
import { AppError } from '@brq/shared/errors/app-error';
import { ERROR_CODES } from '@brq/shared/errors/error-codes';
import { Prisma } from '../../generated/prisma/client';

import type { DatabaseClient } from '../client';
import { runPersistenceOperation } from './prisma-errors';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const EXECUTION_ID_PATTERN = /^execution-[a-f0-9]{32}$/u;
const PROVIDER_MAX_LENGTH = 80;
const CLAIM_TOKEN_MAX_LENGTH = 256;
const CACHE_AGENTS = new Set<AIResponseCacheAgent>([
  'PRODUCT_OWNER',
  'DEVELOPER',
  'QA',
  'CODE_GENERATOR',
]);

interface RawCacheEntry {
  readonly executionId: string;
  readonly agent: string;
  readonly provider: string;
  readonly requestHash: string;
  readonly state: string;
  readonly claimToken: string | null;
  readonly responseHash: string | null;
  readonly response: unknown;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

function invalidInput(message: string, cause?: unknown): AppError {
  return new AppError(message, {
    code: ERROR_CODES.INVALID_INPUT,
    statusCode: 400,
    expose: true,
    ...(cause === undefined ? {} : { cause }),
  });
}

function persistenceFailure(message: string, cause?: unknown): AppError {
  return new AppError(message, {
    code: ERROR_CODES.PERSISTENCE_ERROR,
    ...(cause === undefined ? {} : { cause }),
  });
}

function persistenceConflict(): AppError {
  return new AppError('Conflito no checkpoint persistente de respostas de IA.', {
    code: ERROR_CODES.PERSISTENCE_CONFLICT,
    statusCode: 409,
  });
}

function parseKey(key: AIResponseCacheKey): AIResponseCacheKey {
  if (
    typeof key?.executionId !== 'string' ||
    !EXECUTION_ID_PATTERN.test(key.executionId) ||
    typeof key.agent !== 'string' ||
    !CACHE_AGENTS.has(key.agent as AIResponseCacheAgent) ||
    typeof key?.provider !== 'string' ||
    key.provider.trim() !== key.provider ||
    key.provider.length === 0 ||
    key.provider.length > PROVIDER_MAX_LENGTH ||
    typeof key.requestHash !== 'string' ||
    !HASH_PATTERN.test(key.requestHash)
  ) {
    throw invalidInput('Chave do checkpoint de respostas de IA inválida.');
  }
  return Object.freeze({
    executionId: key.executionId,
    agent: key.agent,
    provider: key.provider,
    requestHash: key.requestHash,
  });
}

function keyFromRecord(raw: RawCacheEntry): AIResponseCacheKey {
  return parseKey({
    executionId: raw.executionId,
    agent: raw.agent as AIResponseCacheAgent,
    provider: raw.provider,
    requestHash: raw.requestHash,
  });
}

function sameKey(left: AIResponseCacheKey, right: AIResponseCacheKey): boolean {
  return (
    left.executionId === right.executionId &&
    left.agent === right.agent &&
    left.provider === right.provider &&
    left.requestHash === right.requestHash
  );
}

function parseClaimToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > CLAIM_TOKEN_MAX_LENGTH
  ) {
    throw invalidInput('Token de claim do checkpoint de IA inválido.');
  }
  return value;
}

function parseResponse(value: unknown, provider: string): CompletedAIResponse {
  const parsed = aiResponseSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.finishReason !== 'COMPLETED' ||
    parsed.data.provider !== provider
  ) {
    throw invalidInput('Somente uma AIResponse COMPLETED e correlacionada pode ser persistida.', {
      validSchema: parsed.success,
    });
  }
  return structuredClone(parsed.data) as CompletedAIResponse;
}

function projectStoredEntry(raw: RawCacheEntry): AIResponseCacheEntry {
  const key = keyFromRecord(raw);
  if (
    raw.state !== 'COMPLETED' ||
    raw.claimToken !== null ||
    raw.responseHash === null ||
    raw.completedAt === null
  ) {
    throw persistenceFailure('O checkpoint COMPLETED persistido é estruturalmente inválido.');
  }
  const response = parseResponse(raw.response, key.provider);
  const responseHash = calculateAIResponseHash(response);
  if (raw.responseHash !== responseHash) {
    throw persistenceFailure('A integridade do checkpoint persistente de respostas de IA falhou.');
  }
  return Object.freeze({ ...key, responseHash, response: structuredClone(response) });
}

function projectPendingKey(raw: RawCacheEntry): AIResponseCacheKey {
  const key = keyFromRecord(raw);
  if (
    raw.state !== 'PENDING' ||
    raw.claimToken === null ||
    raw.responseHash !== null ||
    raw.response !== null ||
    raw.completedAt !== null
  ) {
    throw persistenceFailure('O claim PENDING persistido é estruturalmente inválido.');
  }
  parseClaimToken(raw.claimToken);
  return key;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function parseInspectionInput(
  input: AIResponseCheckpointInspectionInput,
): AIResponseCheckpointInspectionInput {
  if (
    typeof input?.executionId !== 'string' ||
    !EXECUTION_ID_PATTERN.test(input.executionId) ||
    !Array.isArray(input.requiredAgents) ||
    input.requiredAgents.length === 0 ||
    new Set(input.requiredAgents).size !== input.requiredAgents.length ||
    input.requiredAgents.some((agent) => !CACHE_AGENTS.has(agent))
  ) {
    throw invalidInput('Consulta de checkpoints de IA inválida.');
  }
  return Object.freeze({
    executionId: input.executionId,
    requiredAgents: Object.freeze([...input.requiredAgents]),
  });
}

export class PrismaAIResponseCache implements AIResponseCache, AIResponseCheckpointReader {
  constructor(private readonly client: DatabaseClient) {}

  private async deleteObservedCorruptRecord(record: RawCacheEntry): Promise<void> {
    await this.client.aiResponseCacheEntry.deleteMany({
      where: {
        executionId: record.executionId,
        agent: record.agent,
        provider: record.provider,
        requestHash: record.requestHash,
        state: record.state,
        claimToken: record.claimToken,
        responseHash: record.responseHash,
        createdAt: record.createdAt,
        completedAt: record.completedAt,
      },
    });
  }

  async get(rawKey: AIResponseCacheKey): Promise<AIResponseCacheEntry | null> {
    const key = parseKey(rawKey);
    return runPersistenceOperation(async () => {
      const record = await this.client.aiResponseCacheEntry.findUnique({
        where: { executionId_agent: { executionId: key.executionId, agent: key.agent } },
      });
      if (record === null) return null;
      if (record.state === 'PENDING') {
        try {
          projectPendingKey(record);
        } catch (error) {
          // Compare-and-delete prevents a delayed reader from deleting a concurrently repaired row.
          await this.deleteObservedCorruptRecord(record);
          throw error;
        }
        return null;
      }
      try {
        const entry = projectStoredEntry(record);
        return sameKey(entry, key) ? entry : null;
      } catch (error) {
        // Delete only a structurally corrupt row. A valid row for different immutable coordinates
        // is a cache miss and must remain intact.
        await this.deleteObservedCorruptRecord(record);
        throw error;
      }
    });
  }

  async claim(rawKey: AIResponseCacheKey): Promise<AIResponseCacheClaimResult> {
    const key = parseKey(rawKey);
    const claimToken = randomUUID();
    return runPersistenceOperation(async () => {
      try {
        await this.client.aiResponseCacheEntry.create({
          data: { ...key, state: 'PENDING', claimToken },
        });
        return Object.freeze({ status: 'CLAIMED' as const, ...key, claimToken });
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
      }

      const record = await this.client.aiResponseCacheEntry.findUnique({
        where: { executionId_agent: { executionId: key.executionId, agent: key.agent } },
      });
      if (record === null) throw persistenceConflict();
      if (record.state === 'COMPLETED') {
        const entry = projectStoredEntry(record);
        if (!sameKey(entry, key)) throw persistenceConflict();
        return Object.freeze({ status: 'COMPLETED' as const, entry });
      }
      const pendingKey = projectPendingKey(record);
      if (!sameKey(pendingKey, key)) throw persistenceConflict();
      return Object.freeze({ status: 'IN_PROGRESS' as const, ...key });
    });
  }

  async complete(rawInput: AIResponseCacheCompleteInput): Promise<AIResponseCacheEntry> {
    const key = parseKey(rawInput);
    const claimToken = parseClaimToken(rawInput.claimToken);
    const response = parseResponse(rawInput.response, key.provider);
    const responseHash = calculateAIResponseHash(response);

    return runPersistenceOperation(async () => {
      const updated = await this.client.aiResponseCacheEntry.updateMany({
        where: {
          executionId: key.executionId,
          agent: key.agent,
          provider: key.provider,
          requestHash: key.requestHash,
          state: 'PENDING',
          claimToken,
        },
        data: {
          state: 'COMPLETED',
          claimToken: null,
          responseHash,
          response: response as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw persistenceConflict();
      const record = await this.client.aiResponseCacheEntry.findUnique({
        where: { executionId_agent: { executionId: key.executionId, agent: key.agent } },
      });
      if (record === null) throw persistenceConflict();
      const stored = projectStoredEntry(record);
      if (
        !sameKey(stored, key) ||
        stored.responseHash !== responseHash ||
        !isDeepStrictEqual(stored.response, response)
      ) {
        throw persistenceConflict();
      }
      return stored;
    });
  }

  async fail(rawInput: AIResponseCacheFailInput): Promise<void> {
    const key = parseKey(rawInput);
    const claimToken = parseClaimToken(rawInput.claimToken);
    return runPersistenceOperation(async () => {
      const deleted = await this.client.aiResponseCacheEntry.deleteMany({
        where: {
          executionId: key.executionId,
          agent: key.agent,
          provider: key.provider,
          requestHash: key.requestHash,
          state: 'PENDING',
          claimToken,
        },
      });
      if (deleted.count === 1) return;
      const record = await this.client.aiResponseCacheEntry.findUnique({
        where: { executionId_agent: { executionId: key.executionId, agent: key.agent } },
      });
      if (record === null) return;
      throw persistenceConflict();
    });
  }

  async inspectExecution(
    rawInput: AIResponseCheckpointInspectionInput,
  ): Promise<AIResponseCheckpointInspection> {
    const input = parseInspectionInput(rawInput);
    return runPersistenceOperation(async () => {
      const records = await this.client.aiResponseCacheEntry.findMany({
        where: {
          executionId: input.executionId,
          agent: { in: [...input.requiredAgents] },
          state: 'COMPLETED',
        },
      });
      const entries = records
        .map(projectStoredEntry)
        .sort((left, right) => (left.agent < right.agent ? -1 : left.agent > right.agent ? 1 : 0));
      const present = new Set(entries.map((entry) => entry.agent));
      const missingAgents = input.requiredAgents.filter((agent) => !present.has(agent));
      return Object.freeze({
        executionId: input.executionId,
        complete: missingAgents.length === 0,
        missingAgents: Object.freeze([...missingAgents]),
        checkpoints: Object.freeze(
          entries.map((entry) =>
            Object.freeze({
              agent: entry.agent,
              provider: entry.provider,
              requestHash: entry.requestHash,
              responseHash: entry.responseHash,
            }),
          ),
        ),
      });
    });
  }
}
