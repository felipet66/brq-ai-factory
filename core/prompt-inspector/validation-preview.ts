import { Buffer } from 'node:buffer';

import { calculatePromptHash, type PromptResult } from '@brq/prompt-builder';
import type {
  ResponseValidator,
  ValidationContract,
  ValidationIssue,
  ValidationRequest,
} from '@brq/response-validator';
import { jsonValueSchema } from '@brq/shared/schemas/json-value.schema';
import type { JsonValue } from '@brq/shared/types/json-value';
import type { z } from 'zod';

import type {
  PromptInspectionAgent,
  PromptInspectionBusinessValidationResult,
  PromptInspectionIssue,
  PromptInspectionOutputContract,
  PromptInspectionValidationResult,
  PromptInspectionVersions,
  PromptValidationStage,
} from './contracts';
import { deepFreeze } from './immutability';
import { PROMPT_INSPECTOR_MAX_ISSUES, PROMPT_INSPECTOR_RETENTION } from './limits';

interface ValidateCandidateOptions {
  readonly agent: PromptInspectionAgent;
  readonly versions: PromptInspectionVersions;
  readonly promptResult: PromptResult;
  readonly projectedContract: PromptInspectionOutputContract;
  readonly validationContract: ValidationContract;
  readonly agentContractSchema: z.ZodType;
  readonly businessValidate: (candidate: JsonValue) => PromptInspectionBusinessValidationResult;
  readonly candidateContent: string;
  readonly responseValidator: ResponseValidator;
}

function parseStructuredData(content: string): JsonValue | null {
  try {
    const result = jsonValueSchema.safeParse(JSON.parse(content));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function syntheticRunResult(
  options: ValidateCandidateOptions,
  candidateHash: string,
): ValidationRequest['runResult'] {
  return {
    context: {
      execution: {
        executionId: 'prompt-inspector-execution',
        agentExecutionId: 'prompt-inspector-agent-execution',
        agent: options.agent,
        attempt: 1,
        agentVersion: options.versions.agentVersion,
      },
    },
    prompt: {
      metadata: options.promptResult.metadata,
      budget: options.promptResult.budget,
    },
    outputContract: options.promptResult.outputContract,
    output: {
      content: options.candidateContent,
      structuredData: parseStructuredData(options.candidateContent),
      finishReason: 'COMPLETED',
      responseHash: candidateHash,
    },
    provider: {
      provider: 'prompt-inspector',
      requestedModel: 'inspection-only',
      responseModel: 'inspection-only',
      responseId: null,
    },
    metrics: {
      observed: {
        totalDurationMs: 0,
        promptBuilderDurationMs: 0,
        providerDurationMs: 0,
        bytesSent: options.promptResult.budget.usedBytes,
        bytesReceived: Buffer.byteLength(options.candidateContent, 'utf8'),
      },
      reported: {
        durationMs: 0,
        attempts: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    },
  };
}

function responseIssue(issue: ValidationIssue): PromptInspectionIssue {
  const path = issue.instancePath === undefined ? [] : [issue.instancePath];
  return {
    code: issue.code,
    path,
    keyword: issue.keyword ?? null,
    message: 'The candidate did not pass response validation.',
  };
}

function zodIssues(error: z.ZodError): {
  readonly issues: readonly PromptInspectionIssue[];
  readonly issuesTruncated: boolean;
} {
  return {
    issues: error.issues.slice(0, PROMPT_INSPECTOR_MAX_ISSUES).map((issue) => ({
      code: 'AGENT_CONTRACT_SCHEMA_MISMATCH',
      path: issue.path.map((segment) =>
        typeof segment === 'string' || typeof segment === 'number' ? segment : String(segment),
      ),
      keyword: issue.code,
      message: 'The candidate does not satisfy the agent contract.',
    })),
    issuesTruncated: error.issues.length > PROMPT_INSPECTOR_MAX_ISSUES,
  };
}

function businessIssues(result: PromptInspectionBusinessValidationResult): {
  readonly issues: readonly PromptInspectionIssue[];
  readonly issuesTruncated: boolean;
} {
  return {
    issues: result.issues.slice(0, PROMPT_INSPECTOR_MAX_ISSUES).map((issue) => ({
      code: issue.code,
      path: issue.path,
      keyword: null,
      message: 'The candidate violates an agent business rule.',
    })),
    issuesTruncated:
      result.issuesTruncated === true || result.issues.length > PROMPT_INSPECTOR_MAX_ISSUES,
  };
}

function notRun(stage: PromptValidationStage['stage']): PromptValidationStage {
  return { stage, status: 'NOT_RUN', issues: [], issuesTruncated: false };
}

export function validateCandidate(
  options: ValidateCandidateOptions,
): PromptInspectionValidationResult {
  const candidateHash = calculatePromptHash(options.candidateContent);
  const validationContract =
    options.validationContract.format === 'TEXT'
      ? {
          ...options.validationContract,
          expectedOutputContractHash: options.promptResult.metadata.outputContractHash,
        }
      : {
          ...options.validationContract,
          expectedOutputContractHash: options.promptResult.metadata.outputContractHash,
        };
  const responseValidation = options.responseValidator.validate({
    runResult: syntheticRunResult(options, candidateHash),
    contract: validationContract,
  });
  const allResponseStageIssues = responseValidation.issues.filter(
    (issue) => issue.category !== 'SCHEMA',
  );
  const responseIssues = allResponseStageIssues
    .slice(0, PROMPT_INSPECTOR_MAX_ISSUES)
    .map(responseIssue);
  const responseStage: PromptValidationStage = {
    stage: 'RESPONSE_VALIDATOR',
    status: responseIssues.length === 0 ? 'PASS' : 'FAIL',
    issues: responseIssues,
    issuesTruncated:
      responseValidation.metadata.issuesTruncated ||
      allResponseStageIssues.length > PROMPT_INSPECTOR_MAX_ISSUES,
  };
  const allSchemaRelevantIssues = responseValidation.issues.filter(
    (issue) => issue.category === 'SCHEMA',
  );
  const schemaRelevantIssues = allSchemaRelevantIssues
    .slice(0, PROMPT_INSPECTOR_MAX_ISSUES)
    .map(responseIssue);
  const responsePreventedSchema = responseValidation.issues.some(
    (issue) =>
      issue.category === 'FINISH_REASON' ||
      issue.category === 'CONTENT' ||
      issue.category === 'JSON_SYNTAX',
  );
  const schemaStage: PromptValidationStage =
    options.validationContract.format === 'TEXT' || responsePreventedSchema
      ? notRun('JSON_SCHEMA')
      : {
          stage: 'JSON_SCHEMA',
          status: schemaRelevantIssues.length === 0 ? 'PASS' : 'FAIL',
          issues: schemaRelevantIssues,
          issuesTruncated:
            responseValidation.metadata.issuesTruncated ||
            allSchemaRelevantIssues.length > PROMPT_INSPECTOR_MAX_ISSUES,
        };

  let contractStage = notRun('AGENT_CONTRACT');
  let businessStage = notRun('BUSINESS_VALIDATION');

  if (responseValidation.valid && responseValidation.validatedOutput !== null) {
    const candidate =
      responseValidation.validatedOutput.format === 'JSON_SCHEMA'
        ? responseValidation.validatedOutput.data
        : responseValidation.validatedOutput.content;
    const contractResult = options.agentContractSchema.safeParse(candidate);

    if (contractResult.success) {
      contractStage = {
        stage: 'AGENT_CONTRACT',
        status: 'PASS',
        issues: [],
        issuesTruncated: false,
      };
      const businessResult = options.businessValidate(contractResult.data as JsonValue);
      const projectedBusinessIssues = businessIssues(businessResult);
      businessStage = {
        stage: 'BUSINESS_VALIDATION',
        status: businessResult.valid ? 'PASS' : 'FAIL',
        issues: projectedBusinessIssues.issues,
        issuesTruncated: projectedBusinessIssues.issuesTruncated,
      };
    } else {
      const projectedContractIssues = zodIssues(contractResult.error);
      contractStage = {
        stage: 'AGENT_CONTRACT',
        status: 'FAIL',
        issues: projectedContractIssues.issues,
        issuesTruncated: projectedContractIssues.issuesTruncated,
      };
    }
  }

  const stages = [responseStage, schemaStage, contractStage, businessStage] as const;
  const result: PromptInspectionValidationResult = {
    status: stages.every((stage) => stage.status === 'PASS') ? 'PASS' : 'FAIL',
    agent: options.agent,
    retention: PROMPT_INSPECTOR_RETENTION,
    candidateHash,
    contract: options.projectedContract,
    stages,
  };

  return deepFreeze(result);
}
