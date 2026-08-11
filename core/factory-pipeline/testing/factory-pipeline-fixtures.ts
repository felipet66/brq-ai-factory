import type {
  FactoryExecutionResult,
  FactoryPipelineConfiguration,
  FactoryPipelineProvenance,
} from '../contracts';
import {
  NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE,
  projectGenerationProfileConstraints,
  projectSandboxExecutionProfileSnapshot,
} from '@brq/factory-execution-profile';
import { SANDBOX_RUNNER_CONTRACT_VERSION, SANDBOX_RUNNER_VERSION } from '@brq/sandbox-runner';
import {
  calculateFactoryPipelineLineageHash,
  calculateFactoryPipelineProvenanceHash,
  calculateFactoryPipelineResultHash,
} from '../hashing';
import { immutableClone } from '../immutability';
import { factoryExecutionResultSchema } from '../schemas';
import { FACTORY_PIPELINE_STAGE_IDS } from '../state-machine';
import {
  FACTORY_PIPELINE_CONTRACT_VERSION,
  FACTORY_PIPELINE_HASH_ALGORITHM,
  FACTORY_PIPELINE_VERSION,
} from '../version';

const hash = (character: string): string => character.repeat(64);
const prefixedHash = (character: string): string => `sha256:${hash(character)}`;

export function createFactoryPipelineConfigurationFixture(
  overrides: Partial<Omit<FactoryPipelineConfiguration, 'codeGenerator' | 'sandbox'>> & {
    readonly codeGenerator?: Partial<FactoryPipelineConfiguration['codeGenerator']>;
    readonly sandbox?: Partial<FactoryPipelineConfiguration['sandbox']>;
  } = {},
): FactoryPipelineConfiguration {
  const snapshot = projectSandboxExecutionProfileSnapshot(NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE);
  return immutableClone({
    executionProfile: overrides.executionProfile ?? NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE,
    codeGenerator: {
      agentVersion: '1.0.0',
      model: 'fake-model',
      ...overrides.codeGenerator,
    },
    sandbox: {
      policyId: 'NODE_WEB_PREVIEW_24_V1',
      policyVersion: '1.0.0',
      profileSnapshotHash: snapshot.snapshotHash,
      ...overrides.sandbox,
    },
  });
}

export function incrementalFactoryPipelineClock(
  start = 1_786_320_000_000,
  step = 10,
): () => number {
  let value = start;
  return () => {
    value += step;
    return value;
  };
}

export interface FactoryExecutionResultFixtureOptions {
  readonly executionId?: string;
  readonly workflowId?: string;
}

export function createFactoryExecutionResultFixture(
  options: FactoryExecutionResultFixtureOptions = {},
): FactoryExecutionResult {
  const executionId = options.executionId ?? 'execution-factory-fixture-001';
  const workflowId = options.workflowId ?? 'workflow-factory-fixture-001';
  const startedAtMs = 1_786_320_000_000;
  const executionHashes = {
    executionRequestHash: hash('a'),
    workflowRequestHash: hash('b'),
    workflowHash: hash('c'),
    lineageHash: hash('d'),
    provenanceHash: hash('e'),
    executionHash: hash('f'),
  };
  const sourceLineage = {
    outputs: {
      productOwnerSpecificationHash: prefixedHash('1'),
      technicalSpecificationHash: prefixedHash('2'),
      qaSpecificationHash: prefixedHash('3'),
    },
    handoffs: [
      {
        from: 'PRODUCT_OWNER' as const,
        to: 'DEVELOPER' as const,
        specification: 'PRODUCT_OWNER_SPECIFICATION' as const,
        calculatedHash: prefixedHash('1'),
        declaredHash: prefixedHash('1'),
        verified: true as const,
      },
      {
        from: 'DEVELOPER' as const,
        to: 'QA' as const,
        specification: 'TECHNICAL_SPECIFICATION' as const,
        calculatedHash: prefixedHash('2'),
        declaredHash: prefixedHash('2'),
        verified: true as const,
      },
    ],
  };
  const sourceProvenance = {
    stages: (['PRODUCT_OWNER', 'DEVELOPER', 'QA'] as const).map((agent, index) => ({
      stage: agent,
      agent,
      executionId,
      agentExecutionId: `agent-execution-fixture-${index + 1}`,
      agentVersion: '1.0.0',
      outcome: 'GENERATED' as const,
      readiness: 'READY',
      assetBundleHash: hash(String(index + 4)),
      knowledgeContextHash: prefixedHash(String(index + 4)),
      promptHash: hash(String(index + 7)),
      responseHash: hash(['a', 'b', 'c'][index]!),
      validationHash: hash(['d', 'e', 'f'][index]!),
      generationHash: hash(['1', '2', '3'][index]!),
      artifactHashes: [hash(['4', '5', '6'][index]!)],
    })),
  };
  const stages = FACTORY_PIPELINE_STAGE_IDS.map((stageId, index) => ({
    stageId,
    status: 'SUCCESS' as const,
    startedAt: new Date(startedAtMs + index * 10).toISOString(),
    finishedAt: new Date(startedAtMs + index * 10 + 5).toISOString(),
    durationMs: 5,
    outputHash: hash(((index % 6) + 1).toString()),
    failure: null,
  }));
  const generation = {
    status: 'SUCCESS' as const,
    outcome: 'GENERATED' as const,
    agentVersion: '1.0.0',
    bundleVersion: '1.0.0',
    contractVersion: '1.0.0',
    fileCount: 2,
    totalBytes: 128,
    hashes: {
      bundleContentHash: hash('1'),
      manifestHash: hash('2'),
      lineageHash: hash('3'),
      provenanceHash: hash('4'),
      bundleHash: hash('5'),
      generationHash: hash('6'),
    },
  };
  const workspace = {
    planStatus: 'SUCCESS' as const,
    materializationStatus: 'SUCCESS' as const,
    releaseStatus: 'RELEASED' as const,
    workspaceId: 'workspace-1234567890abcdef1234567890abcdef',
    fileCount: 2,
    totalBytes: 128,
    hashes: {
      sourceBundleHash: generation.hashes.bundleHash,
      planHash: hash('7'),
      workspaceHash: hash('8'),
      policyHash: hash('9'),
      configurationHash: hash('a'),
    },
  };
  const sandboxHashes = {
    policyHash: hash('b'),
    commandPolicyHash: hash('c'),
    limitsHash: hash('d'),
    sandboxRequestHash: hash('e'),
    sandboxResultHash: hash('f'),
  };
  const sandboxProvenance = {
    runnerVersion: SANDBOX_RUNNER_VERSION,
    contractVersion: SANDBOX_RUNNER_CONTRACT_VERSION,
    sanitizerVersion: '1.0.0',
    policyId: 'NODE_WEB_PREVIEW_24_V1',
    policyVersion: '1.0.0',
    packageManager: 'NONE' as const,
    helperAbiVersion: '1.0.0',
    dependencySnapshotHash: null,
    policyHash: sandboxHashes.policyHash,
    commandPolicyHash: sandboxHashes.commandPolicyHash,
    limitsHash: sandboxHashes.limitsHash,
    adapter: 'DOCKER',
    imageReference: `registry.example/brq/sandbox@${prefixedHash('a')}`,
    imageDigest: prefixedHash('a'),
    imageId: prefixedHash('b'),
    platform: 'linux/arm64',
    runtimeName: 'NODE',
    runtimeVersion: '24.19.0',
    toolchainVersions: { TYPESCRIPT: '6.0.3' },
  };
  const sandbox = {
    status: 'SUCCESS' as const,
    sandboxRunId: 'sandbox-1234567890abcdef1234567890abcdef',
    resourceOutcome: 'NONE' as const,
    steps: (['PREPARE', 'TYPECHECK', 'BUILD', 'TEST'] as const).map((stepId, index) => ({
      stepId,
      status: 'SUCCESS' as const,
      startedAt: new Date(startedAtMs + 70 + index * 10).toISOString(),
      finishedAt: new Date(startedAtMs + 75 + index * 10).toISOString(),
      durationMs: 5,
      exitCode: 0,
      resourceOutcome: 'NONE' as const,
      stdout: { observedBytes: 0, observedLines: 0, truncated: false, summaryHash: hash('0') },
      stderr: { observedBytes: 0, observedLines: 0, truncated: false, summaryHash: hash('0') },
      failure: null,
    })),
    hashes: sandboxHashes,
    provenance: sandboxProvenance,
  };
  const lineage = {
    productOwnerSpecificationHash: sourceLineage.outputs.productOwnerSpecificationHash,
    technicalSpecificationHash: sourceLineage.outputs.technicalSpecificationHash,
    qaSpecificationHash: sourceLineage.outputs.qaSpecificationHash,
    executionHash: executionHashes.executionHash,
    workflowHash: executionHashes.workflowHash,
    generatedBundleHash: generation.hashes.bundleHash,
    workspacePlanHash: workspace.hashes.planHash,
    workspaceHash: workspace.hashes.workspaceHash,
    sandboxRequestHash: sandboxHashes.sandboxRequestHash,
    sandboxResultHash: sandboxHashes.sandboxResultHash,
    executionProfileHash: NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE.identity.profileHash,
    generationProjectionHash: projectGenerationProfileConstraints(
      NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE,
    ).generationProjectionHash,
    profileValidationHash: hash('0'),
  };
  const provenance: FactoryPipelineProvenance = {
    pipelineVersion: FACTORY_PIPELINE_VERSION,
    contractVersion: FACTORY_PIPELINE_CONTRACT_VERSION,
    hashAlgorithm: FACTORY_PIPELINE_HASH_ALGORITHM,
    executionEngine: { engineVersion: '1.0.0', contractVersion: '1.0.0' },
    agents: {
      productOwner: '1.0.0',
      developer: '1.0.0',
      qa: '1.0.0',
      codeGenerator: '1.0.0',
    },
    executionProfile: {
      ...NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE.identity,
      generationProjectionHash: lineage.generationProjectionHash,
      profileValidationHash: lineage.profileValidationHash,
    },
    codeGenerator: { contractVersion: '1.0.0', assetBundleHash: hash('4') },
    workspace: {
      workspaceVersion: '1.0.0',
      contractVersion: '1.0.0',
      policyHash: workspace.hashes.policyHash,
      configurationHash: workspace.hashes.configurationHash,
    },
    sandbox: {
      runnerVersion: sandboxProvenance.runnerVersion,
      contractVersion: sandboxProvenance.contractVersion,
      sanitizerVersion: sandboxProvenance.sanitizerVersion,
      policyId: sandboxProvenance.policyId,
      policyVersion: sandboxProvenance.policyVersion,
      helperAbiVersion: sandboxProvenance.helperAbiVersion,
      dependencySnapshotHash: sandboxProvenance.dependencySnapshotHash,
      policyHash: sandboxProvenance.policyHash,
      commandPolicyHash: sandboxProvenance.commandPolicyHash,
      limitsHash: sandboxProvenance.limitsHash,
      adapter: sandboxProvenance.adapter,
      imageDigest: sandboxProvenance.imageDigest,
      imageId: sandboxProvenance.imageId,
      platform: sandboxProvenance.platform,
      runtimeName: sandboxProvenance.runtimeName,
      runtimeVersion: sandboxProvenance.runtimeVersion,
      toolchainVersions: sandboxProvenance.toolchainVersions,
    },
  };
  const lineageHash = calculateFactoryPipelineLineageHash(lineage);
  const provenanceHash = calculateFactoryPipelineProvenanceHash(provenance);
  const hashesWithoutResult = {
    executionHash: executionHashes.executionHash,
    workflowHash: executionHashes.workflowHash,
    generationHash: generation.hashes.generationHash,
    bundleHash: generation.hashes.bundleHash,
    workspacePlanHash: workspace.hashes.planHash,
    workspaceHash: workspace.hashes.workspaceHash,
    sandboxRequestHash: sandboxHashes.sandboxRequestHash,
    sandboxResultHash: sandboxHashes.sandboxResultHash,
    lineageHash,
    provenanceHash,
  };
  const candidate = {
    executionId,
    workflowId,
    status: 'SUCCESS' as const,
    terminalStage: 'WORKSPACE_RELEASE' as const,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(startedAtMs + 120).toISOString(),
    durationMs: 120,
    metadata: {
      pipelineVersion: FACTORY_PIPELINE_VERSION,
      contractVersion: FACTORY_PIPELINE_CONTRACT_VERSION,
      attempt: 1 as const,
    } as const,
    stages,
    execution: {
      status: 'SUCCESS' as const,
      readiness: 'READY',
      hashes: executionHashes,
      lineage: sourceLineage,
      provenance: sourceProvenance,
    },
    agents: {
      productOwner: {
        status: 'SUCCESS' as const,
        outcome: 'GENERATED' as const,
        readiness: 'READY',
        agentVersion: '1.0.0',
        outputHash: hash('1'),
      },
      developer: {
        status: 'SUCCESS' as const,
        outcome: 'GENERATED' as const,
        readiness: 'READY',
        agentVersion: '1.0.0',
        outputHash: hash('2'),
      },
      qa: {
        status: 'SUCCESS' as const,
        outcome: 'GENERATED' as const,
        readiness: 'READY',
        agentVersion: '1.0.0',
        outputHash: hash('3'),
      },
    },
    generation,
    workspace,
    sandbox,
    lineage,
    provenance,
    hashes: hashesWithoutResult,
    failure: null,
  };
  const factoryResultHash = calculateFactoryPipelineResultHash(candidate);
  return immutableClone(
    factoryExecutionResultSchema.parse({
      ...candidate,
      hashes: { ...hashesWithoutResult, factoryResultHash },
    }),
  );
}
