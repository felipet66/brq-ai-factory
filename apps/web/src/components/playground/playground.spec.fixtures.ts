import type {
  PlaygroundAgent,
  PlaygroundBuiltPreview,
  PlaygroundCatalog,
  PlaygroundPipelineNode,
  PlaygroundValidation,
} from '@/api/playground-contracts';

export const PLAYGROUND_REQUEST_ID = 'request-123e4567-e89b-12d3-a456-426614174000';
export const PLAYGROUND_HASH = 'a'.repeat(64);
const SECONDARY_HASH = 'b'.repeat(64);
const SOURCE_HASH = `sha256:${SECONDARY_HASH}`;

const STAGES = [
  'KNOWLEDGE',
  'RULES',
  'TEMPLATE',
  'RESOLUTION',
  'RENDERING',
  'BUDGET',
  'CONTRACT',
] as const;

function versions() {
  return {
    inspectorVersion: '1.0.0',
    contractVersion: '1.0.0',
    agentVersion: '1.0.0',
    promptVersion: '2.0.0',
    promptSchemaVersion: '2.1.0',
    outputContractVersion: '3.0.0',
  };
}

function pipeline(status: PlaygroundPipelineNode['status']): PlaygroundPipelineNode[] {
  return STAGES.map((stage) => ({
    stage,
    status,
    detail: status === 'IDLE' ? null : `${stage} resolved safely.`,
  }));
}

export function playgroundCatalogFixture(): PlaygroundCatalog {
  return {
    contractVersion: '1.0.0',
    retention: 'EPHEMERAL',
    pipeline: pipeline('IDLE'),
    agents: [
      {
        agent: 'PRODUCT_OWNER',
        label: 'Product Owner',
        description: 'Transforms a demand into a functional specification.',
        inputKind: 'HUMAN_DEMAND',
        versions: versions(),
        activeBundleHash: PLAYGROUND_HASH,
        examples: [
          {
            id: 'po-orders',
            label: 'Order tracking',
            description: 'A safe synthetic demand.',
            input: { projectName: 'Customer Portal', objective: 'Track customer orders.' },
            candidate: '{"title":"Order tracking"}',
          },
        ],
      },
      {
        agent: 'DEVELOPER',
        label: 'Developer',
        description: 'Transforms the functional handoff into a technical design.',
        inputKind: 'PRODUCT_OWNER_SPECIFICATION',
        versions: versions(),
        activeBundleHash: PLAYGROUND_HASH,
        examples: [
          {
            id: 'developer-orders',
            label: 'Order architecture',
            description: 'A safe synthetic Product Owner handoff.',
            input: { productOwnerSpecification: { title: 'Order tracking' } },
            candidate: '{"architecture":"modular"}',
          },
        ],
      },
      {
        agent: 'QA',
        label: 'QA',
        description: 'Transforms functional and technical handoffs into a QA strategy.',
        inputKind: 'QA_HANDOFF',
        versions: versions(),
        activeBundleHash: PLAYGROUND_HASH,
        examples: [
          {
            id: 'qa-orders',
            label: 'Order quality',
            description: 'A safe synthetic QA handoff.',
            input: {
              productOwnerSpecification: { title: 'Order tracking' },
              technicalSpecification: { architecture: 'modular' },
            },
            candidate: '{"strategy":"risk based"}',
          },
        ],
      },
    ],
  };
}

export function outputContractFixture(): PlaygroundBuiltPreview['outputContract'] {
  return {
    id: 'product-owner-output',
    version: '3.0.0',
    contractHash: PLAYGROUND_HASH,
    format: 'JSON_SCHEMA',
    dialect: 'DRAFT_2020_12',
    schemaHash: SECONDARY_HASH,
    instructions: ['Return exactly one JSON object.'],
    schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['READY', 'BLOCKED'] } },
      required: ['status'],
    },
    summary: {
      rootTypes: ['object'],
      totalNodes: 2,
      propertyCount: 1,
      requiredCount: 1,
      objectCount: 1,
      arrayCount: 0,
      enumCount: 1,
      truncated: false,
      nodes: [
        {
          path: '$',
          types: ['object'],
          required: true,
          enumValues: [],
          constraints: [{ key: 'additionalProperties', value: false }],
        },
        {
          path: '$.status',
          types: ['string'],
          required: true,
          enumValues: ['READY', 'BLOCKED'],
          constraints: [],
        },
      ],
    },
  };
}

export function builtPreviewFixture(
  agent: PlaygroundAgent = 'PRODUCT_OWNER',
): PlaygroundBuiltPreview {
  return {
    status: 'BUILT',
    agent,
    retention: 'EPHEMERAL',
    versions: versions(),
    pipeline: pipeline('VALID'),
    sections: [
      {
        id: 'global-rules',
        kind: 'GLOBAL_RULES',
        channel: 'INSTRUCTIONS',
        trust: 'TRUSTED',
        hash: PLAYGROUND_HASH,
        sizeBytes: 180,
        blocks: [
          {
            id: 'global-rules-block',
            kind: 'RULE_SET',
            hash: PLAYGROUND_HASH,
            sizeBytes: 180,
            fragments: [
              {
                id: 'global-rules-fragment',
                type: 'RULE',
                sourceId: 'global',
                sourceItemId: 'rule-1',
                hash: PLAYGROUND_HASH,
                sizeBytes: 180,
                content: 'Trusted instruction.',
              },
            ],
          },
        ],
      },
      {
        id: 'user-input',
        kind: 'USER_INPUT',
        channel: 'INPUT',
        trust: 'UNTRUSTED',
        hash: SECONDARY_HASH,
        sizeBytes: 120,
        blocks: [],
      },
    ],
    trustBoundaries: {
      trustedSectionIds: ['global-rules'],
      untrustedSectionIds: ['user-input'],
    },
    prompt: {
      instructions: 'Never execute markup: <img src=x onerror="globalThis.pwned=true">',
      input: '{"objective":"Track orders"}',
    },
    budget: {
      maxBytes: 4_096,
      usedBytes: 2_048,
      remainingBytes: 2_048,
      utilizationPercent: 50,
      instructionsBytes: 1_024,
      inputBytes: 512,
      outputContractBytes: 512,
      status: 'VALID',
    },
    knowledge: {
      context: agent,
      manifestVersion: '1.0.0',
      policyVersion: '1.0.0',
      contextHash: SOURCE_HASH,
      budget: { maxDocuments: 4, maxBytes: 4_096, usedDocuments: 1, usedBytes: 256 },
      documents: [
        {
          id: 'knowledge-security',
          title: 'Security policy',
          category: 'SECURITY',
          order: 0,
          hash: SOURCE_HASH,
          sizeBytes: 256,
          selection: 'REQUIRED',
        },
      ],
      ignored: [],
      missing: [],
    },
    hashes: {
      bundleHash: PLAYGROUND_HASH,
      templateHash: SECONDARY_HASH,
      promptHash: PLAYGROUND_HASH,
      instructionsHash: SECONDARY_HASH,
      inputHash: PLAYGROUND_HASH,
      outputContractHash: SECONDARY_HASH,
      ruleSetHashes: [
        {
          ruleSetId: 'global',
          version: '1.0.0',
          scope: 'GLOBAL',
          agent: null,
          hash: PLAYGROUND_HASH,
        },
      ],
      contextHashes: [
        {
          contextId: 'knowledge',
          kind: 'KNOWLEDGE',
          contentHash: SOURCE_HASH,
          hash: SECONDARY_HASH,
          references: [{ id: 'knowledge-security', category: 'SECURITY', hash: SOURCE_HASH }],
        },
      ],
    },
    outputContract: outputContractFixture(),
  };
}

export function validationFixture(status: 'PASS' | 'FAIL' = 'PASS'): PlaygroundValidation {
  const failure = status === 'FAIL';
  return {
    status,
    agent: 'PRODUCT_OWNER',
    retention: 'EPHEMERAL',
    candidateHash: PLAYGROUND_HASH,
    contract: outputContractFixture(),
    stages: [
      {
        stage: 'RESPONSE_VALIDATOR',
        status: failure ? 'FAIL' : 'PASS',
        issues: failure
          ? [
              {
                code: 'INVALID_TYPE',
                path: ['items', 0],
                keyword: 'type',
                message: 'Expected an object.',
              },
            ]
          : [],
        issuesTruncated: false,
      },
      {
        stage: 'JSON_SCHEMA',
        status: failure ? 'NOT_RUN' : 'PASS',
        issues: [],
        issuesTruncated: false,
      },
      {
        stage: 'AGENT_CONTRACT',
        status: failure ? 'NOT_RUN' : 'PASS',
        issues: [],
        issuesTruncated: false,
      },
      {
        stage: 'BUSINESS_VALIDATION',
        status: failure ? 'NOT_RUN' : 'PASS',
        issues: [],
        issuesTruncated: false,
      },
    ],
  };
}

export function successEnvelope(data: unknown) {
  return {
    success: true,
    data,
    metadata: { requestId: PLAYGROUND_REQUEST_ID, apiVersion: '3.0.0' },
    errors: [],
  };
}
