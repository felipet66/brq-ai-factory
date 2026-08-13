import { createHash } from 'node:crypto';

import { generatedCodeBundleSchema, type GeneratedCodeBundle } from '@brq/code-generator-agent';
import { workspacePlanSchema, type WorkspacePlan } from '@brq/controlled-workspace';
import {
  factoryExecutionProfileValidationSchema,
  type FactoryExecutionProfileValidation,
} from '@brq/factory-execution-profile';
import { identifierSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

import type { FactoryPipelineConfiguration, FactoryTechnicalBoundaryIdentity } from './contracts';
import { canonicalJson } from './canonical-json';
import { immutableClone } from './immutability';
import { FACTORY_PIPELINE_CONTRACT_VERSION, FACTORY_PIPELINE_VERSION } from './version';

export const FACTORY_TECHNICAL_CHECKPOINT_VERSION = '1.0.0';
const CHECKPOINT_HASH_DOMAIN = 'brq-factory-pipeline:technical-checkpoint:v1';
const HASH = /^[a-f0-9]{64}$/u;
const PREFIXED_HASH = /^sha256:[a-f0-9]{64}$/u;

export const factoryTechnicalBoundaryIdentitySchema = z
  .object({
    codeGeneratorAssetBundleHash: z.string().regex(HASH),
    workspace: z
      .object({
        version: semanticVersionSchema,
        contractVersion: semanticVersionSchema,
        policyHash: z.string().regex(HASH),
        configurationHash: z.string().regex(HASH),
      })
      .strict(),
    sandbox: z
      .object({
        runnerVersion: semanticVersionSchema,
        contractVersion: semanticVersionSchema,
        policyHash: z.string().regex(HASH),
        commandPolicyHash: z.string().regex(HASH),
        limitsHash: z.string().regex(HASH),
        imageDigest: z.string().regex(PREFIXED_HASH),
        imageId: z.string().regex(PREFIXED_HASH),
        platform: z.enum(['linux/amd64', 'linux/arm64']),
      })
      .strict(),
  })
  .strict();

const factoryTechnicalCheckpointProjectionSchema = z
  .object({
    checkpointVersion: z.literal(FACTORY_TECHNICAL_CHECKPOINT_VERSION),
    pipeline: z
      .object({
        version: semanticVersionSchema,
        contractVersion: semanticVersionSchema,
      })
      .strict(),
    source: z
      .object({
        executionId: identifierSchema,
        workflowId: identifierSchema,
        requestId: identifierSchema.nullable(),
        traceId: identifierSchema.nullable(),
        executionHash: z.string().regex(HASH),
        workflowHash: z.string().regex(HASH),
        lineageHash: z.string().regex(HASH),
        provenanceHash: z.string().regex(HASH),
      })
      .strict(),
    codeGenerator: z
      .object({
        agentVersion: semanticVersionSchema,
        assetBundleHash: z.string().regex(HASH),
      })
      .strict(),
    workspace: z
      .object({
        version: semanticVersionSchema,
        contractVersion: semanticVersionSchema,
        policyHash: z.string().regex(HASH),
        configurationHash: z.string().regex(HASH),
        planHash: z.string().regex(HASH),
      })
      .strict(),
    executionProfile: z
      .object({
        profileId: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
        version: semanticVersionSchema,
        contractVersion: semanticVersionSchema,
        profileHash: z.string().regex(HASH),
        generationProjectionHash: z.string().regex(HASH),
        profileValidationHash: z.string().regex(HASH),
      })
      .strict(),
    sandbox: z
      .object({
        policyId: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
        policyVersion: semanticVersionSchema,
        profileSnapshotHash: z.string().regex(HASH),
        runnerVersion: semanticVersionSchema,
        contractVersion: semanticVersionSchema,
        policyHash: z.string().regex(HASH),
        commandPolicyHash: z.string().regex(HASH),
        limitsHash: z.string().regex(HASH),
        imageDigest: z.string().regex(PREFIXED_HASH),
        imageId: z.string().regex(PREFIXED_HASH),
        platform: z.enum(['linux/amd64', 'linux/arm64']),
      })
      .strict(),
    profileValidation: factoryExecutionProfileValidationSchema,
    bundle: generatedCodeBundleSchema,
  })
  .strict();

export const factoryTechnicalCheckpointSchema = factoryTechnicalCheckpointProjectionSchema
  .extend({ checkpointHash: z.string().regex(HASH) })
  .strict()
  .superRefine((checkpoint, context) => {
    const approval = checkpoint.bundle.provenance.approval;
    const sourceMatches =
      checkpoint.source.executionId === approval.executionId &&
      checkpoint.source.workflowId === approval.workflowId &&
      checkpoint.source.executionHash === approval.executionHash &&
      checkpoint.source.workflowHash === approval.workflowHash &&
      checkpoint.source.lineageHash === approval.lineageHash &&
      checkpoint.source.provenanceHash === approval.provenanceHash;
    if (!sourceMatches) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'A origem do checkpoint deve corresponder à aprovação íntegra do bundle.',
      });
    }
    if (
      checkpoint.codeGenerator.agentVersion !== checkpoint.bundle.provenance.agentVersion ||
      checkpoint.codeGenerator.assetBundleHash !== checkpoint.bundle.provenance.assetBundleHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['codeGenerator'],
        message: 'A identidade do Code Generator deve corresponder ao bundle.',
      });
    }
    const validation = checkpoint.profileValidation;
    if (
      validation.compatible !== true ||
      validation.issues.length !== 0 ||
      validation.bundleHash !== checkpoint.bundle.hashes.bundleHash ||
      validation.executionProfileId !== checkpoint.executionProfile.profileId ||
      validation.executionProfileVersion !== checkpoint.executionProfile.version ||
      validation.executionProfileHash !== checkpoint.executionProfile.profileHash ||
      validation.generationProjectionHash !==
        checkpoint.executionProfile.generationProjectionHash ||
      validation.profileValidationHash !== checkpoint.executionProfile.profileValidationHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['profileValidation'],
        message: 'O checkpoint exige uma validação de profile compatível e correlacionada.',
      });
    }
    const { checkpointHash, ...projection } = checkpoint;
    if (checkpointHash !== calculateFactoryTechnicalCheckpointHash(projection)) {
      context.addIssue({
        code: 'custom',
        path: ['checkpointHash'],
        message: 'checkpointHash não corresponde ao conteúdo canônico.',
      });
    }
  });

export type FactoryTechnicalCheckpoint = Readonly<z.infer<typeof factoryTechnicalCheckpointSchema>>;
type FactoryTechnicalCheckpointProjection = z.infer<
  typeof factoryTechnicalCheckpointProjectionSchema
>;

export function calculateFactoryTechnicalCheckpointHash(
  projection: FactoryTechnicalCheckpointProjection,
): string {
  return createHash('sha256')
    .update(`${CHECKPOINT_HASH_DOMAIN}\u0000${canonicalJson(projection)}`)
    .digest('hex');
}

export function parseFactoryTechnicalCheckpoint(value: unknown): FactoryTechnicalCheckpoint {
  return immutableClone(factoryTechnicalCheckpointSchema.parse(value));
}

export function createFactoryTechnicalCheckpoint(input: {
  readonly requestContext: {
    readonly requestId?: string;
    readonly traceId?: string;
  };
  readonly bundle: GeneratedCodeBundle;
  readonly profileValidation: FactoryExecutionProfileValidation;
  readonly configuration: FactoryPipelineConfiguration;
  readonly boundaryIdentity: FactoryTechnicalBoundaryIdentity;
  readonly workspacePlan: WorkspacePlan;
}): FactoryTechnicalCheckpoint {
  const bundle = generatedCodeBundleSchema.parse(input.bundle);
  const validation = factoryExecutionProfileValidationSchema.parse(input.profileValidation);
  const workspacePlan = workspacePlanSchema.parse(input.workspacePlan);
  const boundaryIdentity = factoryTechnicalBoundaryIdentitySchema.parse(input.boundaryIdentity);
  if (
    workspacePlan.metadata.workspaceVersion !== boundaryIdentity.workspace.version ||
    workspacePlan.metadata.contractVersion !== boundaryIdentity.workspace.contractVersion ||
    workspacePlan.metadata.policyHash !== boundaryIdentity.workspace.policyHash ||
    workspacePlan.metadata.configurationHash !== boundaryIdentity.workspace.configurationHash
  ) {
    throw new TypeError('O plano não corresponde à identidade do Controlled Workspace.');
  }
  const approval = bundle.provenance.approval;
  const projection = factoryTechnicalCheckpointProjectionSchema.parse({
    checkpointVersion: FACTORY_TECHNICAL_CHECKPOINT_VERSION,
    pipeline: {
      version: FACTORY_PIPELINE_VERSION,
      contractVersion: FACTORY_PIPELINE_CONTRACT_VERSION,
    },
    source: {
      executionId: approval.executionId,
      workflowId: approval.workflowId,
      requestId: input.requestContext.requestId ?? null,
      traceId: input.requestContext.traceId ?? null,
      executionHash: approval.executionHash,
      workflowHash: approval.workflowHash,
      lineageHash: approval.lineageHash,
      provenanceHash: approval.provenanceHash,
    },
    codeGenerator: {
      agentVersion: bundle.provenance.agentVersion,
      assetBundleHash: boundaryIdentity.codeGeneratorAssetBundleHash,
    },
    workspace: {
      ...boundaryIdentity.workspace,
      planHash: workspacePlan.metadata.planHash,
    },
    executionProfile: {
      profileId: input.configuration.executionProfile.identity.profileId,
      version: input.configuration.executionProfile.identity.version,
      contractVersion: input.configuration.executionProfile.identity.contractVersion,
      profileHash: input.configuration.executionProfile.identity.profileHash,
      generationProjectionHash: validation.generationProjectionHash,
      profileValidationHash: validation.profileValidationHash,
    },
    sandbox: {
      policyId: input.configuration.sandbox.policyId,
      policyVersion: input.configuration.sandbox.policyVersion,
      profileSnapshotHash: input.configuration.sandbox.profileSnapshotHash,
      runnerVersion: boundaryIdentity.sandbox.runnerVersion,
      contractVersion: boundaryIdentity.sandbox.contractVersion,
      policyHash: boundaryIdentity.sandbox.policyHash,
      commandPolicyHash: boundaryIdentity.sandbox.commandPolicyHash,
      limitsHash: boundaryIdentity.sandbox.limitsHash,
      imageDigest: boundaryIdentity.sandbox.imageDigest,
      imageId: boundaryIdentity.sandbox.imageId,
      platform: boundaryIdentity.sandbox.platform,
    },
    profileValidation: validation,
    bundle,
  });
  return parseFactoryTechnicalCheckpoint({
    ...projection,
    checkpointHash: calculateFactoryTechnicalCheckpointHash(projection),
  });
}
