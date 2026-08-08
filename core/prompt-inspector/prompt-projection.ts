import { getKnowledgeSelectionRule, type KnowledgeContext } from '@brq/knowledge-loader';
import type { PromptResult } from '@brq/prompt-builder';

import type {
  PromptInspectionKnowledge,
  PromptInspectionPipelineNode,
  PromptInspectionSection,
} from './projection-types';
import { PROMPT_INSPECTOR_BUDGET_WARNING_RATIO } from './limits';

export const PROMPT_INSPECTION_STAGES = [
  'KNOWLEDGE',
  'RULES',
  'TEMPLATE',
  'RESOLUTION',
  'RENDERING',
  'BUDGET',
  'CONTRACT',
] as const;

export function idleInspectionPipeline(): readonly PromptInspectionPipelineNode[] {
  return PROMPT_INSPECTION_STAGES.map((stage) => ({ stage, status: 'IDLE', detail: null }));
}

export function projectPromptSections(result: PromptResult): readonly PromptInspectionSection[] {
  return result.document.sections.map((section) => ({
    id: section.id,
    kind: section.kind,
    channel: section.channel,
    trust: section.trust,
    hash: section.hash,
    sizeBytes: section.sizeBytes,
    blocks: section.blocks.map((block) => ({
      id: block.id,
      kind: block.kind,
      hash: block.hash,
      sizeBytes: block.sizeBytes,
      fragments: block.fragments.map((fragment) => ({
        id: fragment.id,
        type: fragment.type,
        sourceId: fragment.sourceId,
        sourceItemId: fragment.sourceItemId,
        hash: fragment.hash,
        sizeBytes: fragment.sizeBytes,
        content: fragment.content,
      })),
    })),
  }));
}

export function projectKnowledgeContext(context: KnowledgeContext): PromptInspectionKnowledge {
  if (
    context.context !== 'PRODUCT_OWNER' &&
    context.context !== 'DEVELOPER' &&
    context.context !== 'QA'
  ) {
    throw new Error('O contexto não pertence a um agente inspecionável.');
  }

  const selection = getKnowledgeSelectionRule(context.context);
  const requiredIds = new Set(selection.required);

  return {
    context: context.context,
    manifestVersion: context.manifestVersion,
    policyVersion: context.policyVersion,
    contextHash: context.contextHash,
    budget: context.budget,
    documents: context.includedDocuments.map((document) => ({
      id: document.id,
      title: document.title,
      category: document.category,
      order: document.order,
      hash: document.hash,
      sizeBytes: document.sizeBytes,
      selection: requiredIds.has(document.id) ? 'REQUIRED' : 'OPTIONAL',
    })),
    ignored: context.ignoredDocuments.map((document) => ({
      id: document.id,
      reason: document.reason,
    })),
    missing: context.missingDocuments.map((document) => ({
      id: document.id,
      required: document.required,
    })),
  };
}

export function completedInspectionPipeline(
  result: PromptResult,
  knowledge: KnowledgeContext,
): readonly PromptInspectionPipelineNode[] {
  const budgetRatio = result.budget.usedBytes / result.budget.maxBytes;
  const knowledgeHasWarnings =
    knowledge.ignoredDocuments.some((document) => document.reason === 'BUDGET_EXCEEDED') ||
    knowledge.missingDocuments.length > 0;

  return [
    {
      stage: 'KNOWLEDGE',
      status: knowledgeHasWarnings ? 'WARNING' : 'VALID',
      detail: `${knowledge.budget.usedDocuments} document(s), ${knowledge.budget.usedBytes} bytes`,
    },
    {
      stage: 'RULES',
      status: 'VALID',
      detail: `${result.metadata.ruleSetHashes.length} rule set(s)`,
    },
    {
      stage: 'TEMPLATE',
      status: 'VALID',
      detail: `${result.document.sections.length} section(s)`,
    },
    {
      stage: 'RESOLUTION',
      status: 'VALID',
      detail: `${result.metadata.sectionHashes.length} resolved section(s)`,
    },
    {
      stage: 'RENDERING',
      status: 'VALID',
      detail: `${result.budget.instructionsBytes + result.budget.inputBytes} rendered bytes`,
    },
    {
      stage: 'BUDGET',
      status: budgetRatio >= PROMPT_INSPECTOR_BUDGET_WARNING_RATIO ? 'WARNING' : 'VALID',
      detail: `${result.budget.usedBytes} of ${result.budget.maxBytes} bytes`,
    },
    {
      stage: 'CONTRACT',
      status: 'VALID',
      detail: `${result.outputContract.id}@${result.outputContract.version}`,
    },
  ];
}
