import { describe, expect, it } from 'vitest';

import { baseAgentInputSchema, baseAgentOutputSchema } from './agent-contracts.schema';
import { artifactDraftSchema, artifactSchema } from './artifact.schema';

const NOW = '2026-08-04T18:00:00.000Z';

const artifactDraft = {
  name: 'User Story',
  filename: 'story.md',
  type: 'USER_STORY',
  content: '# User Story',
} as const;

describe('base agent contracts', () => {
  it('should accept the canonical base input envelope', () => {
    const result = baseAgentInputSchema.safeParse({
      executionId: 'execution_123',
      projectId: 'project_123',
      agent: 'PRODUCT_OWNER',
      input: { title: 'Demanda fictícia' },
      context: { architecture: 'MVP local' },
      constraints: { dataPolicy: 'synthetic-only' },
      metadata: { requestedAt: NOW },
    });

    expect(result.success).toBe(true);
  });

  it('should reject an input envelope with an invalid date or unknown field', () => {
    const result = baseAgentInputSchema.safeParse({
      executionId: 'execution_123',
      projectId: 'project_123',
      agent: 'PRODUCT_OWNER',
      input: {},
      context: {},
      constraints: {},
      metadata: { requestedAt: 'today' },
      unexpected: true,
    });

    expect(result.success).toBe(false);
  });

  it('should accept the canonical base output envelope', () => {
    const result = baseAgentOutputSchema.safeParse({
      status: 'SUCCESS',
      summary: 'Demanda estruturada.',
      artifacts: [artifactDraft],
      nextContext: { userStoryId: 'US-001' },
      warnings: [],
      metadata: {
        agent: 'PRODUCT_OWNER',
        promptVersion: '1.0.0',
        schemaVersion: '1.0.0',
      },
    });

    expect(result.success).toBe(true);
  });

  it('should reject a non-canonical result status or missing schema version', () => {
    const result = baseAgentOutputSchema.safeParse({
      status: 'RUNNING',
      summary: 'Ainda executando.',
      artifacts: [],
      nextContext: {},
      warnings: [],
      metadata: {
        agent: 'PRODUCT_OWNER',
        promptVersion: '1.0.0',
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('artifact contracts', () => {
  it('should accept safe filenames for drafts and persisted artifacts', () => {
    expect(artifactDraftSchema.safeParse(artifactDraft).success).toBe(true);

    expect(
      artifactSchema.safeParse({
        ...artifactDraft,
        id: 'artifact_123',
        executionId: 'execution_123',
        agentExecutionId: 'agent_execution_123',
        version: 1,
        createdAt: NOW,
        provenance: {
          agent: 'PRODUCT_OWNER',
          promptVersion: '1.0.0',
          model: 'configured-model',
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    '',
    '   ',
    '../story.md',
    '/tmp/story.md',
    'folder/story.md',
    'folder\\story.md',
    'C:\\temp\\story.md',
  ])('should reject unsafe filename %j', (filename) => {
    expect(
      artifactDraftSchema.safeParse({
        ...artifactDraft,
        filename,
      }).success,
    ).toBe(false);
  });
});
