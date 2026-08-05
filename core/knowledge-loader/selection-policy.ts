import type {
  KnowledgeContextKind,
  KnowledgeManifest,
  KnowledgeSelectionPolicy,
  KnowledgeSelectionRule,
} from './contracts';
import { KnowledgeLoaderError, KNOWLEDGE_ERROR_CODES } from './errors';
import { deepFreeze } from './immutability';
import { KNOWLEDGE_MANIFEST, parseKnowledgeManifest } from './manifest';
import { knowledgeContextKindSchema, knowledgeSelectionPolicySchema } from './schemas';

const POLICY_SOURCE_ID = 'knowledge-selection-policy';
const ADR_IDS = [
  'adr:001',
  'adr:002',
  'adr:003',
  'adr:004',
  'adr:005',
  'adr:006',
  'adr:007',
  'adr:008',
  'adr:009',
  'adr:010',
  'adr:011',
  'adr:012',
  'adr:013',
  'adr:014',
  'adr:015',
  'adr:016',
  'adr:017',
  'adr:018',
  'adr:019',
] as const;

const rawKnowledgeSelectionPolicy = {
  version: '1.6.0',
  contexts: {
    GLOBAL: {
      required: [
        'knowledge:vision',
        'knowledge:project-context',
        'knowledge:workflow',
        'knowledge:agents',
        'knowledge:security',
      ],
      optional: ['knowledge:glossary', 'adr:002', 'adr:003', 'adr:004', 'adr:005', 'adr:010'],
    },
    PRODUCT_OWNER: {
      required: [
        'knowledge:vision',
        'knowledge:project-context',
        'knowledge:workflow',
        'knowledge:agents',
        'knowledge:product-owner-agent',
        'knowledge:security',
      ],
      optional: ['knowledge:glossary', 'adr:002', 'adr:003', 'adr:004', 'adr:005', 'adr:010'],
    },
    DEVELOPER: {
      required: [
        'knowledge:architecture',
        'knowledge:tech-stack',
        'knowledge:domain-model',
        'knowledge:agents',
        'knowledge:developer-agent',
        'knowledge:coding-standards',
        'knowledge:testing',
        'knowledge:security',
        'knowledge:system-design',
        'knowledge:repository-structure',
      ],
      optional: ['knowledge:workflow', ...ADR_IDS],
    },
    QA: {
      required: [
        'knowledge:workflow',
        'knowledge:artifacts',
        'knowledge:agents',
        'knowledge:qa-agent',
        'knowledge:testing',
        'knowledge:security',
      ],
      optional: [
        'knowledge:project-context',
        'knowledge:domain-model',
        'knowledge:coding-standards',
        'knowledge:glossary',
        'adr:002',
        'adr:003',
        'adr:004',
        'adr:005',
        'adr:010',
      ],
    },
    SECURITY: {
      required: ['knowledge:security'],
      optional: [
        'knowledge:agents',
        'knowledge:prompts',
        'knowledge:observability',
        'knowledge:system-design',
        'adr:003',
        'adr:004',
        'adr:010',
        'adr:013',
        'adr:014',
        'adr:015',
        'adr:016',
        'adr:017',
        'adr:018',
        'adr:019',
      ],
    },
    ARCHITECTURE: {
      required: [
        'knowledge:architecture',
        'knowledge:tech-stack',
        'knowledge:domain-model',
        'knowledge:orchestrator',
        'knowledge:security',
        'knowledge:system-design',
        'knowledge:repository-structure',
      ],
      optional: [
        'knowledge:sequence-diagrams',
        'knowledge:prompt-builder-flow',
        'knowledge:agent-runner-flow',
        'knowledge:response-validator-flow',
        'knowledge:artifact-generator-flow',
        'knowledge:artifact-lifecycle',
        'knowledge:product-owner-agent-flow',
        'knowledge:pipeline-overview',
        ...ADR_IDS,
      ],
    },
  },
};

export function parseKnowledgeSelectionPolicy(
  input: unknown,
  manifest: KnowledgeManifest = KNOWLEDGE_MANIFEST,
): KnowledgeSelectionPolicy {
  const validManifest = parseKnowledgeManifest(manifest);
  const result = knowledgeSelectionPolicySchema.safeParse(input);

  if (!result.success) {
    throw new KnowledgeLoaderError('Política de seleção da Knowledge Layer inválida.', {
      code: KNOWLEDGE_ERROR_CODES.INVALID_MANIFEST,
      sourceId: POLICY_SOURCE_ID,
      cause: result.error,
    });
  }

  const manifestIds = new Set(validManifest.documents.map((document) => document.id));
  const unknownDocumentId = Object.values(result.data.contexts)
    .flatMap((rule) => [...rule.required, ...rule.optional])
    .find((documentId) => !manifestIds.has(documentId));

  if (unknownDocumentId !== undefined) {
    throw new KnowledgeLoaderError(
      'A política de seleção referencia um documento ausente do manifesto.',
      {
        code: KNOWLEDGE_ERROR_CODES.INVALID_MANIFEST,
        sourceId: POLICY_SOURCE_ID,
        documentId: unknownDocumentId,
      },
    );
  }

  return deepFreeze(result.data);
}

export const KNOWLEDGE_SELECTION_POLICY = parseKnowledgeSelectionPolicy(
  rawKnowledgeSelectionPolicy,
);

export function getKnowledgeSelectionRule(
  context: KnowledgeContextKind | string,
  policy: KnowledgeSelectionPolicy = KNOWLEDGE_SELECTION_POLICY,
): KnowledgeSelectionRule {
  const parsedContext = knowledgeContextKindSchema.safeParse(context);

  if (!parsedContext.success) {
    throw new KnowledgeLoaderError('Contexto da Knowledge Layer desconhecido.', {
      code: KNOWLEDGE_ERROR_CODES.UNKNOWN_CONTEXT,
      sourceId: POLICY_SOURCE_ID,
    });
  }

  return policy.contexts[parsedContext.data];
}
