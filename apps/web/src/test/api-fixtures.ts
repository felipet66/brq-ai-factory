import {
  executionResultSchema,
  type ExecutionEngine,
  type ExecutionResult,
} from '@brq/execution-engine';
import { createLogger, type Logger } from '@brq/shared/logger/logger';
import { vi } from 'vitest';

import type { AuthenticatedUser } from '@/api/auth-contracts';
import type { AuthenticatedPrincipal, RequestAuthenticator } from '@/server/auth/contracts';

export const FIXED_REQUEST_ID = 'request-123e4567-e89b-12d3-a456-426614174000';
export const EXECUTION_ID = `execution-${'a'.repeat(32)}`;
export const AUTHENTICATED_USER: AuthenticatedUser = Object.freeze({
  id: 'user-test-owner',
  name: 'Test Owner',
  email: 'owner@example.test',
  role: 'USER',
  createdAt: '2026-08-07T09:00:00.000Z',
  updatedAt: '2026-08-07T09:00:00.000Z',
});
export const AUTHENTICATED_PRINCIPAL: AuthenticatedPrincipal = Object.freeze({
  userId: AUTHENTICATED_USER.id,
  role: AUTHENTICATED_USER.role,
  user: AUTHENTICATED_USER,
});
export const authenticateRequestFixture: RequestAuthenticator = async () => AUTHENTICATED_PRINCIPAL;

export function executionBody(): Record<string, unknown> {
  return {
    workflowId: 'workflow-001',
    traceId: 'trace-001',
    demand: {
      title: 'Consulta de pedidos',
      description: 'Permitir que clientes consultem o andamento de seus pedidos.',
      businessGoal: 'Reduzir contatos manuais com o atendimento.',
      targetUsers: ['Cliente autenticado'],
      constraints: ['Não inventar integrações ainda não informadas.'],
      priority: 'HIGH',
    },
    additionalContext: 'A primeira versão atende somente pedidos nacionais.',
    agents: {
      productOwner: {
        agentExecutionId: 'product-owner-execution-001',
        agentVersion: '1.0.0',
        model: 'gpt-5-mini',
      },
      developer: {
        agentExecutionId: 'developer-execution-001',
        agentVersion: '1.0.0',
        model: 'gpt-5-mini',
      },
      qa: {
        agentExecutionId: 'qa-execution-001',
        agentVersion: '1.0.0',
        model: 'gpt-5-mini',
      },
    },
  };
}

export function executionResult(): ExecutionResult {
  return executionResultSchema.parse({
    executionId: EXECUTION_ID,
    workflowId: 'workflow-001',
    status: 'FAILED',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:00.010Z',
    metadata: {
      engineVersion: '1.0.0',
      contractVersion: '1.0.0',
      attempt: 1,
    },
    workflowResult: null,
    timeline: [
      {
        sequence: 1,
        event: 'EXECUTION_CREATED',
        state: 'CREATED',
        timestampMs: 0,
        durationMs: null,
      },
      {
        sequence: 2,
        event: 'EXECUTION_STARTED',
        state: 'RUNNING',
        timestampMs: 5,
        durationMs: null,
      },
      {
        sequence: 3,
        event: 'EXECUTION_FAILED',
        state: 'FAILED',
        timestampMs: 10,
        durationMs: 10,
      },
    ],
    lineage: null,
    provenance: null,
    metrics: {
      observed: { totalDurationMs: 10, orchestratorInvocations: 1 },
      workflow: null,
    },
    hashes: {
      executionRequestHash: '1'.repeat(64),
      workflowRequestHash: '2'.repeat(64),
      workflowHash: null,
      lineageHash: null,
      provenanceHash: null,
      executionHash: '3'.repeat(64),
    },
    failure: {
      kind: 'ORCHESTRATOR_ERROR',
      code: 'EXECUTION_ENGINE_ORCHESTRATOR_FAILED',
      sourceCode: null,
      message: 'O workflow falhou.',
    },
  });
}

export function fakeEngine(result = executionResult()): ExecutionEngine & {
  execute: ReturnType<typeof vi.fn>;
} {
  return { execute: vi.fn(async () => result) };
}

export function capturedLogger(): { logger: Logger; records: Record<string, unknown>[] } {
  const records: Record<string, unknown>[] = [];
  return {
    logger: createLogger({
      sink: (line) => records.push(JSON.parse(line) as Record<string, unknown>),
      now: () => new Date(0),
    }),
    records,
  };
}

export function jsonRequest(
  url: string,
  body: unknown = executionBody(),
  init: Omit<RequestInit, 'body'> = {},
): Request {
  return new Request(url, {
    method: 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      ...init.headers,
    },
    body: JSON.stringify(body),
  });
}
