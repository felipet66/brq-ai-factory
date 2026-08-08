import type { AIResponse } from '../../../core/ai-provider/contracts';
import { calculateCanonicalJsonHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';

import { createTechnicalSpecification } from '../../developer/testing/developer-fixtures';
import type {
  CodeGenerationRequest,
  GeneratedCodeProposal,
  TechnicalSpecification,
} from '../contracts';
import { generatedCodeProposalSchema } from '../schemas';

export function createCodeGeneratorTechnicalSpecification(
  overrides: Partial<TechnicalSpecification> = {},
): TechnicalSpecification {
  const base = createTechnicalSpecification();
  return createTechnicalSpecification({
    components: base.components.map((component) => ({ ...component, changeType: 'CREATE' })),
    modules: base.modules.map((module) => ({ ...module, changeType: 'CREATE' })),
    ...overrides,
  });
}

function technicalSpecificationHash(specification: TechnicalSpecification): string {
  return `sha256:${calculateCanonicalJsonHash(specification as unknown as JsonValue)}`;
}

export function createCodeGenerationRequest(
  overrides: Partial<CodeGenerationRequest> = {},
): CodeGenerationRequest {
  const technicalSpecification =
    overrides.technicalSpecification ?? createCodeGeneratorTechnicalSpecification();
  return {
    context: {
      executionId: 'execution-code-generator-001',
      agentExecutionId: 'agent-execution-code-generator-001',
      attempt: 1,
      agentVersion: '1.0.0',
      requestId: 'request-code-generator-001',
      traceId: 'trace-code-generator-001',
    },
    technicalSpecification,
    declaredTechnicalSpecificationHash: technicalSpecificationHash(technicalSpecification),
    approval: {
      kind: 'WORKFLOW_QA_READY',
      executionId: 'execution-code-generator-001',
      workflowId: 'workflow-code-generator-001',
      executionHash: '1'.repeat(64),
      workflowHash: '2'.repeat(64),
      lineageHash: '3'.repeat(64),
      provenanceHash: '4'.repeat(64),
      qaSpecificationHash: `sha256:${'5'.repeat(64)}`,
      qaReadiness: 'READY',
      technicalHandoffVerified: true,
    },
    model: 'fake-model',
    ...overrides,
  };
}

export function createGeneratedCodeProposal(
  overrides: Partial<GeneratedCodeProposal> = {},
): GeneratedCodeProposal {
  return generatedCodeProposalSchema.parse({
    files: [
      {
        path: 'core/order-query/index.ts',
        content:
          'export function readOrderStatus(orderId: string): string {\n  return `Order ${orderId} is pending`;\n}\n',
        encoding: 'UTF-8',
        mediaType: 'text/typescript',
        purpose: 'SOURCE',
        sourceModuleIds: ['MOD-001'],
        sourcePlanItemIds: ['PLAN-001'],
      },
    ],
    entrypoints: ['core/order-query/index.ts'],
    ...overrides,
  }) as GeneratedCodeProposal;
}

export function createCodeGeneratorAIResponse(
  proposal: GeneratedCodeProposal = createGeneratedCodeProposal(),
  overrides: Partial<AIResponse> = {},
): AIResponse {
  return {
    provider: 'fake',
    model: 'fake-model',
    content: JSON.stringify(proposal),
    structuredData: structuredClone(proposal) as unknown as JsonValue,
    finishReason: 'COMPLETED',
    usage: { inputTokens: 800, outputTokens: 1_200 },
    metadata: {
      responseId: 'fake-code-generator-response-001',
      durationMs: 25,
      attempts: 1,
    },
    ...overrides,
  };
}
