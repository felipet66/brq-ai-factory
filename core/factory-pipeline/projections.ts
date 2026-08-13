import {
  CODE_GENERATOR_SOURCE_REASON_CODES,
  codeGenerationRequestSchema,
  codeGeneratorAgentResultSchema,
  generatedCodeBundleSchema,
  type CodeGenerationRequest,
  type CodeGeneratorAgentResult,
  type GeneratedCodeBundle,
} from '@brq/code-generator-agent';
import {
  workspaceMaterializationResultSchema,
  workspacePlanRequestSchema,
  workspacePlanSchema,
  workspaceReleaseResultSchema,
  type WorkspaceMaterializationResult,
  type WorkspacePlan,
  type WorkspacePlanRequest,
  type WorkspaceReleaseResult,
} from '@brq/controlled-workspace';
import {
  executionResultSchema,
  type ExecutionRequest,
  type ExecutionResult,
} from '@brq/execution-engine';
import {
  projectGenerationProfileConstraints,
  type FactoryExecutionProfile,
  type FactoryExecutionProfileValidation,
} from '@brq/factory-execution-profile';
import {
  calculateSandboxRequestHash,
  sandboxRunRequestSchema,
  sandboxRunResultSchema,
  type SandboxRunRequest,
  type SandboxRunResult,
} from '@brq/sandbox-runner';

import type {
  FactoryAgentsSummary,
  FactoryGenerationSummary,
  FactoryPipelineConfiguration,
  FactoryPipelineFailure,
  FactoryPipelineProvenance,
  FactoryPipelineStageResult,
  FactorySandboxSummary,
  FactorySourceExecutionSummary,
  FactoryWorkspaceSummary,
} from './contracts';
import { canonicalJson } from './canonical-json';
import { FACTORY_PIPELINE_ERROR_CODES, FactoryPipelineError } from './errors';
import { deriveCodeGeneratorExecutionId } from './hashing';
import { immutableClone } from './immutability';

function boundaryViolation(message: string, stage: string, cause?: unknown): never {
  throw new FactoryPipelineError(message, {
    code: FACTORY_PIPELINE_ERROR_CODES.CONTRACT_VIOLATION,
    stage,
    cause,
  });
}

function parseBoundary<T>(
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
  },
  value: unknown,
  message: string,
  stage: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) boundaryViolation(message, stage, parsed.error);
  return parsed.data;
}

function verifiedTechnicalHandoff(result: ExecutionResult): boolean {
  return (
    result.lineage?.handoffs.some(
      (handoff) =>
        handoff.from === 'DEVELOPER' &&
        handoff.to === 'QA' &&
        handoff.specification === 'TECHNICAL_SPECIFICATION' &&
        handoff.verified &&
        handoff.calculatedHash === handoff.declaredHash &&
        handoff.calculatedHash === result.lineage?.outputs.technicalSpecificationHash,
    ) ?? false
  );
}

export function projectExecutionToCodeGenerationRequest(
  rawExecutionResult: ExecutionResult,
  executionRequest: ExecutionRequest,
  configuration: FactoryPipelineConfiguration['codeGenerator'],
  executionProfile: FactoryPipelineConfiguration['executionProfile'],
): CodeGenerationRequest {
  const result = parseBoundary(
    executionResultSchema,
    rawExecutionResult,
    'O Execution Engine retornou um contrato inválido.',
    'EXECUTION',
  );
  const workflow = result.workflowResult;
  if (result.status !== 'SUCCESS' || workflow?.status !== 'SUCCESS') {
    throw new FactoryPipelineError('A geração exige uma execução funcional bem-sucedida.', {
      code: FACTORY_PIPELINE_ERROR_CODES.EXECUTION_FAILED,
      stage: 'EXECUTION',
      executionId: result.executionId,
    });
  }
  const developer = workflow.results.developer;
  const qa = workflow.results.qa;
  const technicalSpecificationHash = workflow.lineage.outputs.technicalSpecificationHash;
  const qaSpecificationHash = workflow.lineage.outputs.qaSpecificationHash;
  if (
    developer?.outcome !== 'GENERATED' ||
    qa?.outcome !== 'GENERATED' ||
    technicalSpecificationHash === null ||
    qaSpecificationHash === null ||
    !verifiedTechnicalHandoff(result)
  ) {
    throw new FactoryPipelineError(
      'A aprovação de geração não possui handoff técnico verificável.',
      {
        code: FACTORY_PIPELINE_ERROR_CODES.INVALID_APPROVAL,
        stage: 'CODE_GENERATOR',
        executionId: result.executionId,
        reasonCode: CODE_GENERATOR_SOURCE_REASON_CODES.HANDOFF_NOT_VERIFIED,
      },
    );
  }
  if (qa.readiness !== 'READY') {
    throw new FactoryPipelineError('A geração exige QA com readiness READY.', {
      code: FACTORY_PIPELINE_ERROR_CODES.QA_NOT_READY,
      stage: 'CODE_GENERATOR',
      executionId: result.executionId,
      reasonCode: CODE_GENERATOR_SOURCE_REASON_CODES.QA_READINESS_NOT_READY,
    });
  }

  return immutableClone(
    codeGenerationRequestSchema.parse({
      context: {
        executionId: result.executionId,
        agentExecutionId: deriveCodeGeneratorExecutionId(result.hashes.executionHash),
        attempt: 1,
        agentVersion: configuration.agentVersion,
        ...(executionRequest.requestId === undefined
          ? {}
          : { requestId: executionRequest.requestId }),
        ...(executionRequest.traceId === undefined ? {} : { traceId: executionRequest.traceId }),
      },
      technicalSpecification: developer.specification,
      declaredTechnicalSpecificationHash: technicalSpecificationHash,
      approval: {
        kind: 'WORKFLOW_QA_READY',
        executionId: result.executionId,
        workflowId: result.workflowId,
        executionHash: result.hashes.executionHash,
        workflowHash: result.hashes.workflowHash,
        lineageHash: result.hashes.lineageHash,
        provenanceHash: result.hashes.provenanceHash,
        qaSpecificationHash,
        qaReadiness: 'READY',
        technicalHandoffVerified: true,
      },
      model: configuration.model,
      generationConstraints: [
        {
          id: 'constraint:factory-execution-profile',
          serialization: 'JSON',
          value: projectGenerationProfileConstraints(executionProfile),
        },
      ],
      ...(configuration.limits === undefined ? {} : { limits: configuration.limits }),
    }),
  );
}

export function parseCodeGeneratorBoundary(
  value: unknown,
  request: CodeGenerationRequest,
): CodeGeneratorAgentResult {
  const result = parseBoundary(
    codeGeneratorAgentResultSchema,
    value,
    'O Code Generator retornou um contrato inválido.',
    'CODE_GENERATOR',
  );
  if (
    canonicalJson(result.context) !== canonicalJson(request.context) ||
    canonicalJson(result.metadata.approval) !== canonicalJson(request.approval) ||
    result.metadata.declaredTechnicalSpecificationHash !==
      request.declaredTechnicalSpecificationHash ||
    (result.outcome === 'GENERATED' &&
      result.bundle.technicalSpecificationHash !== request.declaredTechnicalSpecificationHash)
  ) {
    boundaryViolation(
      'O resultado do Code Generator não corresponde ao request.',
      'CODE_GENERATOR',
    );
  }
  return immutableClone(result);
}

export function projectGeneratedBundleToWorkspacePlanRequest(
  rawBundle: GeneratedCodeBundle,
): WorkspacePlanRequest {
  const bundle = parseBoundary(
    generatedCodeBundleSchema,
    rawBundle,
    'O GeneratedCodeBundle não é íntegro.',
    'WORKSPACE_PLAN',
  );
  return immutableClone(
    workspacePlanRequestSchema.parse({
      source: {
        technicalSpecificationHash: bundle.technicalSpecificationHash,
        generationHash: bundle.hashes.generationHash,
        bundleHash: bundle.hashes.bundleHash,
        bundleContentHash: bundle.bundleContentHash,
        bundleVersion: bundle.bundleVersion,
        contractVersion: bundle.contractVersion,
      },
      files: bundle.files.map((file) => ({
        path: file.path,
        content: file.content,
        encoding: file.encoding,
        mediaType: file.mediaType,
        purpose: file.purpose,
        byteLength: file.byteLength,
        contentHash: file.contentHash,
      })),
    }),
  );
}

export function parseWorkspacePlanBoundary(value: unknown): WorkspacePlan {
  return immutableClone(
    parseBoundary(
      workspacePlanSchema,
      value,
      'O Controlled Workspace retornou um plano inválido.',
      'WORKSPACE_PLAN',
    ),
  );
}

export function parseWorkspaceMaterializationBoundary(
  value: unknown,
  plan: WorkspacePlan,
): WorkspaceMaterializationResult {
  const materialization = parseBoundary(
    workspaceMaterializationResultSchema,
    value,
    'O Controlled Workspace retornou uma materialização inválida.',
    'WORKSPACE_MATERIALIZATION',
  );
  if (
    materialization.workspaceId !== plan.workspaceId ||
    materialization.metadata.planHash !== plan.metadata.planHash ||
    materialization.source.bundleHash !== plan.source.bundleHash ||
    materialization.source.bundleContentHash !== plan.source.bundleContentHash
  ) {
    boundaryViolation(
      'A materialização não corresponde ao WorkspacePlan.',
      'WORKSPACE_MATERIALIZATION',
    );
  }
  return immutableClone(materialization);
}

export function projectWorkspaceToSandboxRunRequest(
  workspace: WorkspaceMaterializationResult,
  executionId: string,
  executionRequest: ExecutionRequest,
  configuration: FactoryPipelineConfiguration['sandbox'],
): SandboxRunRequest {
  const parsedWorkspace = parseBoundary(
    workspaceMaterializationResultSchema,
    workspace,
    'O workspace não é íntegro para execução.',
    'SANDBOX_PREPARE',
  );
  return immutableClone(
    sandboxRunRequestSchema.parse({
      context: {
        executionId,
        ...(executionRequest.requestId === undefined
          ? {}
          : { requestId: executionRequest.requestId }),
        ...(executionRequest.traceId === undefined ? {} : { traceId: executionRequest.traceId }),
      },
      workspace: parsedWorkspace,
      policyId: configuration.policyId,
      ...(configuration.limits === undefined ? {} : { limits: configuration.limits }),
    }),
  );
}

export function parseSandboxBoundary(value: unknown, request: SandboxRunRequest): SandboxRunResult {
  const result = parseBoundary(
    sandboxRunResultSchema,
    value,
    'O Sandbox Runner retornou um contrato inválido.',
    'SANDBOX_PREPARE',
  );
  const expectedRequestHash = calculateSandboxRequestHash({
    request,
    effectiveLimits: result.limits,
    policyHash: result.hashes.policyHash,
  });
  if (
    result.context.executionId !== request.context.executionId ||
    result.workspace.workspaceId !== request.workspace.workspaceId ||
    result.workspace.planHash !== request.workspace.metadata.planHash ||
    result.workspace.workspaceHash !== request.workspace.metadata.workspaceHash ||
    result.provenance.policyId !== request.policyId ||
    result.hashes.sandboxRequestHash !== expectedRequestHash ||
    result.lineage.generationHash !== request.workspace.source.generationHash ||
    result.lineage.bundleHash !== request.workspace.source.bundleHash ||
    result.lineage.bundleContentHash !== request.workspace.source.bundleContentHash
  ) {
    boundaryViolation('O SandboxRunResult não corresponde ao request.', 'SANDBOX_PREPARE');
  }
  return immutableClone(result);
}

export function parseWorkspaceReleaseBoundary(
  value: unknown,
  workspace: WorkspaceMaterializationResult,
): WorkspaceReleaseResult {
  const release = parseBoundary(
    workspaceReleaseResultSchema,
    value,
    'O Controlled Workspace retornou um release inválido.',
    'WORKSPACE_RELEASE',
  );
  if (
    release.workspaceId !== workspace.workspaceId ||
    release.planHash !== workspace.metadata.planHash ||
    release.workspaceHash !== workspace.metadata.workspaceHash
  ) {
    boundaryViolation('O release não corresponde ao workspace.', 'WORKSPACE_RELEASE');
  }
  return immutableClone(release);
}

export function projectFactorySourceExecutionSummary(
  result: ExecutionResult,
): FactorySourceExecutionSummary {
  const workflow = result.workflowResult;
  const readiness =
    workflow?.results.qa?.readiness ??
    workflow?.results.developer?.readiness ??
    workflow?.results.productOwner?.readiness ??
    null;
  return immutableClone({
    status: result.status,
    readiness,
    hashes: result.hashes,
    lineage: result.lineage,
    provenance: result.provenance,
  });
}

function agentStatus(
  result: ExecutionResult,
  agent: 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA',
): 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED' {
  const key =
    agent === 'PRODUCT_OWNER' ? 'productOwner' : agent === 'DEVELOPER' ? 'developer' : 'qa';
  const agentResult = result.workflowResult?.results[key] ?? null;
  if (agentResult?.outcome === 'GENERATED') return 'SUCCESS';
  if (agentResult?.outcome === 'VALIDATION_REJECTED') return 'FAILED';
  if (result.workflowResult?.failure?.agent === agent) {
    return result.workflowResult.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
  }
  if (result.workflowResult === null && agent === 'PRODUCT_OWNER') {
    return result.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
  }
  return 'SKIPPED';
}

export function projectFactoryAgentsSummary(result: ExecutionResult): FactoryAgentsSummary {
  const workflow = result.workflowResult;
  const project = (
    key: 'productOwner' | 'developer' | 'qa',
    agent: 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA',
  ) => {
    const value = workflow?.results[key] ?? null;
    return {
      status: agentStatus(result, agent),
      outcome: value?.outcome ?? null,
      readiness: value?.readiness ?? null,
      agentVersion: value?.context.agentVersion ?? null,
      outputHash: workflow?.hashes.stageHashes[key] ?? null,
    };
  };
  return immutableClone({
    productOwner: project('productOwner', 'PRODUCT_OWNER'),
    developer: project('developer', 'DEVELOPER'),
    qa: project('qa', 'QA'),
  });
}

export function projectFactoryGenerationSummary(
  result: CodeGeneratorAgentResult | null,
  agentVersion: string,
  status: FactoryGenerationSummary['status'],
): FactoryGenerationSummary {
  if (result?.outcome === 'GENERATED') {
    return immutableClone({
      status,
      outcome: result.outcome,
      agentVersion,
      bundleVersion: result.bundle.bundleVersion,
      contractVersion: result.bundle.contractVersion,
      fileCount: result.bundle.manifest.fileCount,
      totalBytes: result.bundle.manifest.totalBytes,
      hashes: result.bundle.hashes,
    });
  }
  return immutableClone({
    status,
    outcome: result?.outcome ?? null,
    agentVersion,
    bundleVersion: null,
    contractVersion: null,
    fileCount: null,
    totalBytes: null,
    hashes: null,
  });
}

export function projectFactoryWorkspaceSummary(input: {
  readonly planStatus: FactoryWorkspaceSummary['planStatus'];
  readonly materializationStatus: FactoryWorkspaceSummary['materializationStatus'];
  readonly releaseStatus: FactoryWorkspaceSummary['releaseStatus'];
  readonly materialization: WorkspaceMaterializationResult | null;
}): FactoryWorkspaceSummary {
  const workspace = input.materialization;
  return immutableClone({
    planStatus: input.planStatus,
    materializationStatus: input.materializationStatus,
    releaseStatus: input.releaseStatus,
    workspaceId: workspace?.workspaceId ?? null,
    fileCount: workspace?.metadata.fileCount ?? null,
    totalBytes: workspace?.metadata.totalBytes ?? null,
    hashes:
      workspace === null
        ? null
        : {
            sourceBundleHash: workspace.source.bundleHash,
            planHash: workspace.metadata.planHash,
            workspaceHash: workspace.metadata.workspaceHash,
            policyHash: workspace.metadata.policyHash,
            configurationHash: workspace.metadata.configurationHash,
          },
  });
}

function outputMetadata(output: SandboxRunResult['steps'][number]['stdout']) {
  return output === null
    ? null
    : {
        observedBytes: output.observedBytes,
        observedLines: output.observedLines,
        truncated: output.truncated,
        summaryHash: output.summaryHash,
      };
}

export function projectFactorySandboxSummary(
  result: SandboxRunResult | null,
  fallbackStatus: FactorySandboxSummary['status'] = 'SKIPPED',
): FactorySandboxSummary {
  if (result === null) {
    return immutableClone({
      status: fallbackStatus,
      sandboxRunId: null,
      resourceOutcome: 'NONE',
      steps: ['PREPARE', 'TYPECHECK', 'BUILD', 'TEST'].map((stepId) => ({
        stepId,
        status: 'SKIPPED',
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        exitCode: null,
        resourceOutcome: 'NONE',
        stdout: null,
        stderr: null,
        failure: null,
      })),
      hashes: null,
      provenance: null,
    }) as FactorySandboxSummary;
  }
  return immutableClone({
    status: result.status,
    sandboxRunId: result.sandboxRunId,
    resourceOutcome: result.resourceOutcome,
    steps: result.steps.map((step) => ({
      stepId: step.stepId,
      status: step.status,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      durationMs: step.durationMs,
      exitCode: step.exitCode,
      resourceOutcome: step.resourceOutcome,
      stdout: outputMetadata(step.stdout),
      stderr: outputMetadata(step.stderr),
      failure:
        step.failure === null
          ? null
          : {
              ...step.failure,
              sourceCode: null,
            },
    })),
    hashes: result.hashes,
    provenance: {
      runnerVersion: result.provenance.runnerVersion,
      contractVersion: result.provenance.contractVersion,
      sanitizerVersion: result.provenance.sanitizerVersion,
      policyId: result.provenance.policyId,
      policyVersion: result.provenance.policyVersion,
      packageManager: result.provenance.packageManager,
      helperAbiVersion: result.provenance.helperAbiVersion,
      dependencySnapshotHash: result.provenance.dependencySnapshotHash,
      policyHash: result.hashes.policyHash,
      commandPolicyHash: result.hashes.commandPolicyHash,
      limitsHash: result.hashes.limitsHash,
      adapter: result.provenance.runtime.adapter,
      imageReference: result.provenance.runtime.imageReference,
      imageDigest: result.provenance.runtime.imageDigest,
      imageId: result.provenance.runtime.imageId,
      platform: result.provenance.runtime.platform,
      runtimeName: result.provenance.runtime.runtimeName,
      runtimeVersion: result.provenance.runtime.runtimeVersion,
      toolchainVersions: result.provenance.runtime.toolchainVersions,
    },
  });
}

export function projectFactoryPipelineProvenance(input: {
  readonly execution: ExecutionResult;
  readonly codeGeneratorResult: CodeGeneratorAgentResult | null;
  readonly codeGeneratorVersion: string;
  readonly workspace: WorkspaceMaterializationResult | null;
  readonly sandbox: SandboxRunResult | null;
  readonly executionProfile: FactoryExecutionProfile;
  readonly profileValidation: FactoryExecutionProfileValidation | null;
}): Omit<FactoryPipelineProvenance, 'pipelineVersion' | 'contractVersion' | 'hashAlgorithm'> {
  const agents = projectFactoryAgentsSummary(input.execution);
  return immutableClone({
    executionEngine: {
      engineVersion: input.execution.metadata.engineVersion,
      contractVersion: input.execution.metadata.contractVersion,
    },
    agents: {
      productOwner: agents.productOwner.agentVersion,
      developer: agents.developer.agentVersion,
      qa: agents.qa.agentVersion,
      codeGenerator: input.codeGeneratorVersion,
    },
    executionProfile: {
      profileId: input.executionProfile.identity.profileId,
      version: input.executionProfile.identity.version,
      contractVersion: input.executionProfile.identity.contractVersion,
      profileHash: input.executionProfile.identity.profileHash,
      generationProjectionHash: projectGenerationProfileConstraints(input.executionProfile)
        .generationProjectionHash,
      profileValidationHash: input.profileValidation?.profileValidationHash ?? null,
    },
    codeGenerator:
      input.codeGeneratorResult?.outcome === 'GENERATED'
        ? {
            contractVersion: input.codeGeneratorResult.bundle.contractVersion,
            assetBundleHash: input.codeGeneratorResult.metadata.assets.bundleHash,
          }
        : null,
    workspace:
      input.workspace === null
        ? null
        : {
            workspaceVersion: input.workspace.provenance.workspaceVersion,
            contractVersion: input.workspace.provenance.contractVersion,
            policyHash: input.workspace.provenance.policyHash,
            configurationHash: input.workspace.provenance.configurationHash,
          },
    sandbox:
      input.sandbox === null
        ? null
        : {
            runnerVersion: input.sandbox.provenance.runnerVersion,
            contractVersion: input.sandbox.provenance.contractVersion,
            sanitizerVersion: input.sandbox.provenance.sanitizerVersion,
            policyId: input.sandbox.provenance.policyId,
            policyVersion: input.sandbox.provenance.policyVersion,
            helperAbiVersion: input.sandbox.provenance.helperAbiVersion,
            dependencySnapshotHash: input.sandbox.provenance.dependencySnapshotHash,
            policyHash: input.sandbox.hashes.policyHash,
            commandPolicyHash: input.sandbox.hashes.commandPolicyHash,
            limitsHash: input.sandbox.hashes.limitsHash,
            adapter: input.sandbox.provenance.runtime.adapter,
            imageDigest: input.sandbox.provenance.runtime.imageDigest,
            imageId: input.sandbox.provenance.runtime.imageId,
            platform: input.sandbox.provenance.runtime.platform,
            runtimeName: input.sandbox.provenance.runtime.runtimeName,
            runtimeVersion: input.sandbox.provenance.runtime.runtimeVersion,
            toolchainVersions: input.sandbox.provenance.runtime.toolchainVersions,
          },
  });
}

export function projectAgentStages(
  result: ExecutionResult,
  fallbackTimestampMs: number,
): readonly FactoryPipelineStageResult[] {
  const workflow = result.workflowResult;
  const mappings = [
    ['PRODUCT_OWNER', 'productOwner'],
    ['DEVELOPER', 'developer'],
    ['QA', 'qa'],
  ] as const;
  return mappings.map(([stageId, key]) => {
    const status = agentStatus(result, stageId);
    if (status === 'SKIPPED') {
      return {
        stageId,
        status,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        outputHash: null,
        profileRuleId: null,
        diagnosticSummary: null,
        failure: null,
      };
    }
    const started = workflow?.timeline.find(
      (event) => event.stage === stageId && event.event === 'STAGE_STARTED',
    );
    const finished = workflow?.timeline.find(
      (event) =>
        event.stage === stageId &&
        ['STAGE_COMPLETED', 'STAGE_REJECTED', 'STAGE_FAILED', 'STAGE_CANCELLED'].includes(
          event.event,
        ),
    );
    const startedAtMs = started?.timestampMs ?? fallbackTimestampMs;
    const finishedAtMs = finished?.timestampMs ?? fallbackTimestampMs;
    const sourceFailure = workflow?.failure?.agent === stageId ? workflow.failure : null;
    const failure: FactoryPipelineFailure | null =
      status === 'SUCCESS'
        ? null
        : {
            code:
              sourceFailure?.code ??
              (status === 'CANCELLED'
                ? FACTORY_PIPELINE_ERROR_CODES.CANCELLED
                : FACTORY_PIPELINE_ERROR_CODES.EXECUTION_FAILED),
            stage: stageId,
            sourceCode: sourceFailure?.sourceCode ?? null,
            reasonCode: null,
            profileRuleId: null,
            diagnosticSummary: null,
            message:
              status === 'CANCELLED'
                ? 'A etapa foi cancelada.'
                : 'A etapa funcional não foi concluída.',
          };
    return {
      stageId,
      status,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(Math.max(startedAtMs, finishedAtMs)).toISOString(),
      durationMs: finished?.durationMs ?? Math.max(0, finishedAtMs - startedAtMs),
      outputHash: workflow?.hashes.stageHashes[key] ?? null,
      profileRuleId: null,
      diagnosticSummary: null,
      failure,
    };
  });
}
