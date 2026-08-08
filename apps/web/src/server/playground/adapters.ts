import {
  developerAgentRequestSchema,
  loadDeveloperPromptAssets,
  projectDeveloperPromptContexts,
  technicalSpecificationStructureSchema,
  validateDeveloperBusinessRules,
} from '@brq/developer-agent';
import type { PromptInspectorAgentAdapter } from '@brq/prompt-inspector';
import {
  loadProductOwnerPromptAssets,
  productOwnerAgentRequestSchema,
  productOwnerSpecificationSchema,
  productOwnerSpecificationStructureSchema,
  projectProductOwnerPromptContexts,
  validateProductOwnerBusinessRules,
} from '@brq/product-owner-agent';
import {
  loadQAPromptAssets,
  projectQAPromptContexts,
  qaAgentRequestSchema,
  qaSpecificationStructureSchema,
  validateQABusinessRules,
} from '@brq/qa-agent';
import { z } from 'zod';

import {
  PLAYGROUND_PRODUCT_OWNER_SPECIFICATION,
  PLAYGROUND_QA_SPECIFICATION,
  PLAYGROUND_TECHNICAL_SPECIFICATION,
} from './examples';

const PLAYGROUND_MODEL = 'inspection-only';
const PLAYGROUND_AGENT_VERSION = '1.0.0';

export const productOwnerPlaygroundInputSchema = z
  .object({
    projectName: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(16_000),
  })
  .strict();

export const developerPlaygroundInputSchema = z
  .object({ productOwnerSpecification: productOwnerSpecificationSchema })
  .strict();

export const qaPlaygroundInputSchema = z
  .object({
    productOwnerSpecification: productOwnerSpecificationSchema,
    technicalSpecification: technicalSpecificationStructureSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const compatibility = validateDeveloperBusinessRules(
      input.technicalSpecification,
      input.productOwnerSpecification,
    );
    if (!compatibility.valid) {
      context.addIssue({
        code: 'custom',
        path: ['technicalSpecification'],
        message: 'A especificação técnica não é compatível com a especificação funcional.',
      });
    }
  });

function requestContext(agent: 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA', version: string) {
  return {
    executionId: 'playground-inspection',
    agentExecutionId: `playground-inspection-${agent.toLowerCase()}`,
    attempt: 1,
    agentVersion: version,
  };
}

export function createPlaygroundAgentAdapters(): readonly PromptInspectorAgentAdapter[] {
  const productOwnerAssets = loadProductOwnerPromptAssets();
  const developerAssets = loadDeveloperPromptAssets();
  const qaAssets = loadQAPromptAssets();

  const productOwnerAdapter: PromptInspectorAgentAdapter = {
    agent: 'PRODUCT_OWNER',
    label: 'Product Owner',
    description: 'Inspeciona a transformação de uma demanda em especificação funcional.',
    inputKind: 'HUMAN_DEMAND',
    versions: {
      agentVersion: PLAYGROUND_AGENT_VERSION,
      promptVersion: productOwnerAssets.template.version,
      promptSchemaVersion: productOwnerAssets.manifest.schemaVersion,
      outputContractVersion: productOwnerAssets.outputContract.version,
    },
    activeBundleHash: productOwnerAssets.hashes.bundleHash,
    examples: [
      {
        id: 'product-owner-order-query',
        label: 'Consulta de pedidos',
        description: 'Demanda sintética para consultar o andamento de um pedido nacional.',
        input: {
          projectName: 'Portal do cliente',
          objective: 'Permitir que clientes consultem o andamento de seus pedidos nacionais.',
        },
        candidate: JSON.stringify(PLAYGROUND_PRODUCT_OWNER_SPECIFICATION, null, 2),
      },
    ],
    knowledgeContext: 'PRODUCT_OWNER',
    validationContract: productOwnerAssets.validationContract,
    inputSchema: productOwnerPlaygroundInputSchema,
    agentContractSchema: productOwnerSpecificationStructureSchema,
    buildPromptInput(rawInput, knowledgeContext) {
      const input = productOwnerPlaygroundInputSchema.parse(rawInput);
      const request = productOwnerAgentRequestSchema.parse({
        context: requestContext('PRODUCT_OWNER', PLAYGROUND_AGENT_VERSION),
        demand: { title: input.projectName, description: input.objective },
        model: PLAYGROUND_MODEL,
      });
      return {
        template: productOwnerAssets.template,
        ruleSets: productOwnerAssets.ruleSets,
        contexts: projectProductOwnerPromptContexts(
          knowledgeContext,
          request,
          productOwnerAssets.manifest,
        ),
        variables: [],
        constraints: [],
        outputContract: productOwnerAssets.outputContract,
      };
    },
    validateBusiness(candidate) {
      return validateProductOwnerBusinessRules(
        productOwnerSpecificationStructureSchema.parse(candidate),
      );
    },
  };

  const developerAdapter: PromptInspectorAgentAdapter = {
    agent: 'DEVELOPER',
    label: 'Developer',
    description: 'Inspeciona a transformação da especificação funcional em desenho técnico.',
    inputKind: 'PRODUCT_OWNER_SPECIFICATION',
    versions: {
      agentVersion: PLAYGROUND_AGENT_VERSION,
      promptVersion: developerAssets.template.version,
      promptSchemaVersion: developerAssets.manifest.schemaVersion,
      outputContractVersion: developerAssets.outputContract.version,
    },
    activeBundleHash: developerAssets.hashes.bundleHash,
    examples: [
      {
        id: 'developer-order-query',
        label: 'Arquitetura da consulta',
        description: 'Handoff sintético do Product Owner para desenho técnico da consulta.',
        input: { productOwnerSpecification: PLAYGROUND_PRODUCT_OWNER_SPECIFICATION },
        candidate: JSON.stringify(PLAYGROUND_TECHNICAL_SPECIFICATION, null, 2),
      },
    ],
    knowledgeContext: 'DEVELOPER',
    validationContract: developerAssets.validationContract,
    inputSchema: developerPlaygroundInputSchema,
    agentContractSchema: technicalSpecificationStructureSchema,
    buildPromptInput(rawInput, knowledgeContext) {
      const input = developerPlaygroundInputSchema.parse(rawInput);
      const request = developerAgentRequestSchema.parse({
        context: requestContext('DEVELOPER', PLAYGROUND_AGENT_VERSION),
        productOwnerSpecification: input.productOwnerSpecification,
        model: PLAYGROUND_MODEL,
      });
      return {
        template: developerAssets.template,
        ruleSets: developerAssets.ruleSets,
        contexts: projectDeveloperPromptContexts(
          knowledgeContext,
          request,
          developerAssets.manifest,
        ),
        variables: [],
        constraints: [],
        outputContract: developerAssets.outputContract,
      };
    },
    validateBusiness(candidate, rawInput) {
      const input = developerPlaygroundInputSchema.parse(rawInput);
      return validateDeveloperBusinessRules(
        technicalSpecificationStructureSchema.parse(candidate),
        input.productOwnerSpecification,
      );
    },
  };

  const qaAdapter: PromptInspectorAgentAdapter = {
    agent: 'QA',
    label: 'QA',
    description: 'Inspeciona a transformação dos handoffs funcional e técnico em estratégia QA.',
    inputKind: 'QA_HANDOFF',
    versions: {
      agentVersion: PLAYGROUND_AGENT_VERSION,
      promptVersion: qaAssets.template.version,
      promptSchemaVersion: qaAssets.manifest.schemaVersion,
      outputContractVersion: qaAssets.outputContract.version,
    },
    activeBundleHash: qaAssets.hashes.bundleHash,
    examples: [
      {
        id: 'qa-order-query',
        label: 'Qualidade da consulta',
        description: 'Handoff sintético completo para planejar a qualidade da consulta.',
        input: {
          productOwnerSpecification: PLAYGROUND_PRODUCT_OWNER_SPECIFICATION,
          technicalSpecification: PLAYGROUND_TECHNICAL_SPECIFICATION,
        },
        candidate: JSON.stringify(PLAYGROUND_QA_SPECIFICATION, null, 2),
      },
    ],
    knowledgeContext: 'QA',
    validationContract: qaAssets.validationContract,
    inputSchema: qaPlaygroundInputSchema,
    agentContractSchema: qaSpecificationStructureSchema,
    buildPromptInput(rawInput, knowledgeContext) {
      const input = qaPlaygroundInputSchema.parse(rawInput);
      const request = qaAgentRequestSchema.parse({
        context: requestContext('QA', PLAYGROUND_AGENT_VERSION),
        productOwnerSpecification: input.productOwnerSpecification,
        technicalSpecification: input.technicalSpecification,
        model: PLAYGROUND_MODEL,
      });
      return {
        template: qaAssets.template,
        ruleSets: qaAssets.ruleSets,
        contexts: projectQAPromptContexts(knowledgeContext, request, qaAssets.manifest),
        variables: [],
        constraints: [],
        outputContract: qaAssets.outputContract,
      };
    },
    validateBusiness(candidate, rawInput) {
      const input = qaPlaygroundInputSchema.parse(rawInput);
      return validateQABusinessRules(
        qaSpecificationStructureSchema.parse(candidate),
        input.productOwnerSpecification,
        input.technicalSpecification,
      );
    },
  };

  return Object.freeze([
    Object.freeze(productOwnerAdapter),
    Object.freeze(developerAdapter),
    Object.freeze(qaAdapter),
  ]);
}
