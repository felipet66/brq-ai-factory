import { createLogger } from '@brq/shared/logger/logger';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ExecutionRequest } from './contracts';
import { EXECUTION_CONTRACT_VERSION, createExecutionEngine } from './execution-engine';
import { calculateCanonicalJsonHash, createDeterministicExecutionId } from './hashing';
import {
  createExecutionRequestFixture,
  createSuccessfulWorkflowResultFixture,
  createWorkflowRequestForExecution,
  incrementalClock,
} from './testing/execution-engine-fixtures';

describe('Execution Engine logging', () => {
  let request: ExecutionRequest;
  let workflowResult: Awaited<ReturnType<typeof createSuccessfulWorkflowResultFixture>>;

  beforeAll(async () => {
    request = createExecutionRequestFixture({
      additionalContext: 'CONTEUDO_USUARIO_SENTINELA_NAO_LOGAR',
    });
    const executionId = createDeterministicExecutionId(
      calculateCanonicalJsonHash(request),
      EXECUTION_CONTRACT_VERSION,
    );
    workflowResult = await createSuccessfulWorkflowResultFixture(
      createWorkflowRequestForExecution(request, executionId),
    );
  });

  it('registra somente projeções sanitizadas e nunca payloads do workflow', async () => {
    const lines: string[] = [];
    await createExecutionEngine({
      orchestrator: { execute: async () => workflowResult },
      logger: createLogger({
        sink: (line) => lines.push(line),
        now: () => new Date('2026-01-01T00:00:00.000Z'),
      }),
      now: incrementalClock(),
    }).execute(request);

    expect(lines.map((line) => JSON.parse(line).event)).toEqual([
      'execution.created',
      'execution.started',
      'execution.completed',
    ]);
    const serialized = lines.join('\n');
    expect(serialized).not.toContain('CONTEUDO_USUARIO_SENTINELA_NAO_LOGAR');
    expect(serialized).not.toContain('workflowResult');
    expect(serialized).not.toContain('specification');
    expect(serialized).not.toContain('artifacts');
    expect(serialized).not.toContain('"prompt":');
    expect(serialized).toContain('executionId');
    expect(serialized).toContain('workflowId');
    expect(serialized).toContain('engineVersion');
    expect(serialized).toContain('contractVersion');
  });
});
