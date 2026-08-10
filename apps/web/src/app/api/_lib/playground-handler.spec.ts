// @vitest-environment node

import {
  PROMPT_INSPECTOR_ERROR_CODES,
  PromptInspectorError,
  promptInspectionCatalogSchema,
  promptInspectionPreviewResultSchema,
  promptInspectionValidationResultSchema,
  type PromptInspectionAgent,
  type PromptInspector,
} from '@brq/prompt-inspector';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '@/server/auth/contracts';
import { AuthenticationError } from '@/server/auth/errors';
import { FIXED_REQUEST_ID, capturedLogger, jsonRequest } from '@/test/api-fixtures';

import {
  createPlaygroundAgentsHandler,
  createPlaygroundPreviewHandler,
  createPlaygroundValidateHandler,
} from './playground-handler';

const HASH = 'a'.repeat(64);
const SOURCE_HASH = `sha256:${'b'.repeat(64)}`;
const ORIGIN = 'http://localhost';

const ADMIN_PRINCIPAL: AuthenticatedPrincipal = Object.freeze({
  userId: 'admin-playground',
  role: 'ADMIN',
  user: Object.freeze({
    id: 'admin-playground',
    name: 'Playground Admin',
    email: 'admin@example.test',
    role: 'ADMIN',
    createdAt: '2026-08-07T09:00:00.000Z',
    updatedAt: '2026-08-07T09:00:00.000Z',
  }),
});

const USER_PRINCIPAL: AuthenticatedPrincipal = Object.freeze({
  ...ADMIN_PRINCIPAL,
  userId: 'user-playground',
  role: 'USER',
  user: Object.freeze({ ...ADMIN_PRINCIPAL.user, id: 'user-playground', role: 'USER' }),
});

const PIPELINE_STAGES = [
  'KNOWLEDGE',
  'RULES',
  'TEMPLATE',
  'RESOLUTION',
  'RENDERING',
  'BUDGET',
  'CONTRACT',
] as const;

const VALIDATION_STAGES = [
  'RESPONSE_VALIDATOR',
  'JSON_SCHEMA',
  'AGENT_CONTRACT',
  'BUSINESS_VALIDATION',
] as const;

function versions() {
  return {
    inspectorVersion: '1.0.0',
    contractVersion: '1.0.0',
    agentVersion: '1.0.0',
    promptVersion: '1.0.0',
    promptSchemaVersion: '1.0.0',
    outputContractVersion: '1.0.0',
  };
}

function outputContract() {
  return {
    id: 'output:playground',
    version: '1.0.0',
    format: 'JSON_SCHEMA' as const,
    contractHash: HASH,
    dialect: 'DRAFT_2020_12' as const,
    schemaHash: HASH,
    instructions: ['Return JSON.'],
    schema: { type: 'object' },
    summary: {
      rootTypes: ['object'],
      totalNodes: 1,
      propertyCount: 0,
      requiredCount: 0,
      objectCount: 1,
      arrayCount: 0,
      enumCount: 0,
      truncated: false,
      nodes: [
        {
          path: '$',
          types: ['object'],
          required: true,
          enumValues: [],
          constraints: [],
        },
      ],
    },
  };
}

function catalog() {
  return promptInspectionCatalogSchema.parse({
    contractVersion: '1.0.0',
    retention: 'EPHEMERAL',
    pipeline: PIPELINE_STAGES.map((stage) => ({ stage, status: 'IDLE', detail: null })),
    agents: [
      {
        agent: 'PRODUCT_OWNER',
        label: 'Product Owner',
        description: 'Product Owner prompt inspection.',
        inputKind: 'HUMAN_DEMAND',
        versions: versions(),
        activeBundleHash: HASH,
        examples: [
          {
            id: 'example-po',
            label: 'Example',
            description: 'Synthetic example.',
            input: { projectName: 'Portal', objective: 'Inspect a safe demand.' },
            candidate: '{}',
          },
        ],
      },
    ],
  });
}

function preview(agent: PromptInspectionAgent = 'PRODUCT_OWNER') {
  return promptInspectionPreviewResultSchema.parse({
    status: 'BUILT',
    agent,
    retention: 'EPHEMERAL',
    versions: versions(),
    pipeline: PIPELINE_STAGES.map((stage) => ({ stage, status: 'VALID', detail: 'ok' })),
    sections: [],
    trustBoundaries: { trustedSectionIds: [], untrustedSectionIds: [] },
    prompt: { instructions: 'safe instructions', input: 'safe input' },
    budget: {
      maxBytes: 512 * 1024,
      usedBytes: 100,
      remainingBytes: 512 * 1024 - 100,
      utilizationPercent: 0.02,
      instructionsBytes: 40,
      inputBytes: 30,
      outputContractBytes: 30,
      status: 'VALID',
    },
    knowledge: {
      context: agent,
      manifestVersion: '1.0.0',
      policyVersion: '1.0.0',
      contextHash: SOURCE_HASH,
      budget: { maxDocuments: 24, maxBytes: 65_536, usedDocuments: 0, usedBytes: 0 },
      documents: [],
      ignored: [],
      missing: [],
    },
    hashes: {
      bundleHash: HASH,
      templateHash: HASH,
      promptHash: HASH,
      instructionsHash: HASH,
      inputHash: HASH,
      outputContractHash: HASH,
      ruleSetHashes: [],
      contextHashes: [],
    },
    outputContract: outputContract(),
  });
}

function validation(agent: PromptInspectionAgent = 'PRODUCT_OWNER') {
  return promptInspectionValidationResultSchema.parse({
    status: 'PASS',
    agent,
    retention: 'EPHEMERAL',
    candidateHash: HASH,
    contract: outputContract(),
    stages: VALIDATION_STAGES.map((stage) => ({
      stage,
      status: 'PASS',
      issues: [],
      issuesTruncated: false,
    })),
  });
}

function fakeInspector(): PromptInspector & {
  catalog: ReturnType<typeof vi.fn>;
  preview: ReturnType<typeof vi.fn>;
  validate: ReturnType<typeof vi.fn>;
} {
  return {
    catalog: vi.fn(() => catalog()),
    preview: vi.fn(async (request) => preview(request.agent)),
    validate: vi.fn(async (request) => validation(request.agent)),
  } as unknown as PromptInspector & {
    catalog: ReturnType<typeof vi.fn>;
    preview: ReturnType<typeof vi.fn>;
    validate: ReturnType<typeof vi.fn>;
  };
}

function options(inspector = fakeInspector(), principal = ADMIN_PRINCIPAL) {
  const { logger, records } = capturedLogger();
  const getPromptInspector = vi.fn(async () => inspector);
  return {
    inspector,
    getPromptInspector,
    logger,
    records,
    handlerOptions: {
      authenticate: vi.fn(async () => principal),
      getPromptInspector,
      expectedOrigin: ORIGIN,
      requestIdFactory: () => FIXED_REQUEST_ID,
      logger,
      now: () => 100,
    },
  };
}

describe('Prompt Playground HTTP handlers', () => {
  it('returns the ephemeral catalog only to an ADMIN with no-store headers', async () => {
    const fixture = options();
    const response = await createPlaygroundAgentsHandler(fixture.handlerOptions)(
      new Request(`${ORIGIN}/api/playground/agents`),
      undefined,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(FIXED_REQUEST_ID);
    expect(body).toMatchObject({
      success: true,
      data: { retention: 'EPHEMERAL' },
      metadata: { requestId: FIXED_REQUEST_ID, apiVersion: '3.1.0' },
      errors: [],
    });
    expect(fixture.inspector.catalog).toHaveBeenCalledOnce();
  });

  it('fails closed for USER before resolving the inspector or reading request data', async () => {
    const fixture = options(fakeInspector(), USER_PRINCIPAL);
    const response = await createPlaygroundPreviewHandler(fixture.handlerOptions)(
      jsonRequest(`${ORIGIN}/api/playground/preview`, {
        agent: 'PRODUCT_OWNER',
        input: { objective: 'sensitive' },
      }),
      undefined,
    );

    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe('AUTHORIZATION_DENIED');
    expect(fixture.getPromptInspector).not.toHaveBeenCalled();
    expect(fixture.inspector.preview).not.toHaveBeenCalled();
    expect(JSON.stringify(fixture.records)).not.toContain('sensitive');
  });

  it('returns 401 for an anonymous request without resolving the inspector', async () => {
    const fixture = options();
    fixture.handlerOptions.authenticate.mockRejectedValueOnce(
      new AuthenticationError('Autenticação obrigatória.', 'AUTHENTICATION_REQUIRED'),
    );
    const response = await createPlaygroundAgentsHandler(fixture.handlerOptions)(
      new Request(`${ORIGIN}/api/playground/agents`),
      undefined,
    );

    expect(response.status).toBe(401);
    expect((await response.json()).errors[0].code).toBe('AUTHENTICATION_REQUIRED');
    expect(fixture.getPromptInspector).not.toHaveBeenCalled();
  });

  it.each(['PRODUCT_OWNER', 'DEVELOPER', 'QA'] as const)(
    'builds a %s preview and propagates only the Request AbortSignal as an option',
    async (agent) => {
      const fixture = options();
      const input = { safe: `${agent}-input` };
      const request = jsonRequest(`${ORIGIN}/api/playground/preview`, { agent, input });
      const response = await createPlaygroundPreviewHandler(fixture.handlerOptions)(
        request,
        undefined,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toMatchObject({ agent, status: 'BUILT', retention: 'EPHEMERAL' });
      expect(fixture.inspector.preview).toHaveBeenCalledWith(
        { agent, input },
        { signal: request.signal },
      );
    },
  );

  it.each(['PRODUCT_OWNER', 'DEVELOPER', 'QA'] as const)(
    'validates a manual %s candidate without adding transport fields to the DTO',
    async (agent) => {
      const fixture = options();
      const request = jsonRequest(`${ORIGIN}/api/playground/validate`, {
        agent,
        input: { safe: true },
        candidate: { content: '{}' },
      });
      const response = await createPlaygroundValidateHandler(fixture.handlerOptions)(
        request,
        undefined,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toMatchObject({ agent, status: 'PASS', retention: 'EPHEMERAL' });
      expect(fixture.inspector.validate).toHaveBeenCalledWith(
        { agent, input: { safe: true }, candidate: { content: '{}' } },
        { signal: request.signal },
      );
    },
  );

  it.each([
    ['unknown field', { agent: 'PRODUCT_OWNER', input: {}, extra: true }],
    ['unknown agent', { agent: 'DESIGNER', input: {} }],
    ['missing input', { agent: 'QA' }],
  ])('rejects invalid preview input (%s) before resolving the inspector', async (_label, body) => {
    const fixture = options();
    const response = await createPlaygroundPreviewHandler(fixture.handlerOptions)(
      jsonRequest(`${ORIGIN}/api/playground/preview`, body),
      undefined,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code).toBe('INVALID_REQUEST');
    expect(fixture.getPromptInspector).not.toHaveBeenCalled();
  });

  it.each([
    [
      'missing JSON media type',
      () =>
        new Request(`${ORIGIN}/api/playground/preview`, {
          method: 'POST',
          headers: { origin: ORIGIN, 'content-type': 'text/plain' },
          body: '{}',
        }),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    ],
    [
      'unsupported content encoding',
      () =>
        new Request(`${ORIGIN}/api/playground/preview`, {
          method: 'POST',
          headers: {
            origin: ORIGIN,
            'content-type': 'application/json',
            'content-encoding': 'gzip',
          },
          body: '{}',
        }),
      415,
      'UNSUPPORTED_CONTENT_ENCODING',
    ],
    [
      'malformed JSON',
      () =>
        new Request(`${ORIGIN}/api/playground/preview`, {
          method: 'POST',
          headers: { origin: ORIGIN, 'content-type': 'application/json' },
          body: '{',
        }),
      400,
      'API_INVALID_JSON',
    ],
  ] as const)(
    'rejects $label before resolving the inspector',
    async (_label, request, status, code) => {
      const fixture = options();
      const response = await createPlaygroundPreviewHandler(fixture.handlerOptions)(
        request(),
        undefined,
      );

      expect(response.status).toBe(status);
      expect((await response.json()).errors[0].code).toBe(code);
      expect(fixture.getPromptInspector).not.toHaveBeenCalled();
    },
  );

  it('enforces the 512 KiB preview and 2 MiB validation HTTP limits', async () => {
    const fixture = options();
    const previewResponse = await createPlaygroundPreviewHandler(fixture.handlerOptions)(
      jsonRequest(
        `${ORIGIN}/api/playground/preview`,
        {},
        {
          headers: { 'content-length': String(512 * 1024 + 1) },
        },
      ),
      undefined,
    );
    const validateResponse = await createPlaygroundValidateHandler(fixture.handlerOptions)(
      jsonRequest(
        `${ORIGIN}/api/playground/validate`,
        {},
        {
          headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
        },
      ),
      undefined,
    );

    expect(previewResponse.status).toBe(413);
    expect(validateResponse.status).toBe(413);
    expect((await previewResponse.json()).errors[0].code).toBe('PAYLOAD_TOO_LARGE');
    expect((await validateResponse.json()).errors[0].code).toBe('PAYLOAD_TOO_LARGE');
    expect(fixture.getPromptInspector).not.toHaveBeenCalled();
  });

  it('enforces the 1 MiB UTF-8 candidate limit inside the 2 MiB validation envelope', async () => {
    const fixture = options();
    const response = await createPlaygroundValidateHandler(fixture.handlerOptions)(
      jsonRequest(`${ORIGIN}/api/playground/validate`, {
        agent: 'PRODUCT_OWNER',
        input: { safe: true },
        candidate: { content: 'á'.repeat(600_000) },
      }),
      undefined,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0]).toMatchObject({
      code: 'INVALID_REQUEST',
      path: 'candidate.content',
    });
    expect(fixture.getPromptInspector).not.toHaveBeenCalled();
  });

  it('rejects cross-origin mutation, query parameters and a body on the catalog endpoint', async () => {
    const fixture = options();
    const crossOrigin = jsonRequest(
      `${ORIGIN}/api/playground/preview`,
      {
        agent: 'PRODUCT_OWNER',
        input: {},
      },
      { headers: { origin: 'https://attacker.example.test' } },
    );
    const withQuery = jsonRequest(`${ORIGIN}/api/playground/validate?persist=true`, {
      agent: 'PRODUCT_OWNER',
      input: {},
      candidate: { content: '{}' },
    });
    const catalogWithBody = new Request(`${ORIGIN}/api/playground/agents`, {
      method: 'GET',
      headers: { 'content-length': '1' },
    });

    const responses = await Promise.all([
      createPlaygroundPreviewHandler(fixture.handlerOptions)(crossOrigin, undefined),
      createPlaygroundValidateHandler(fixture.handlerOptions)(withQuery, undefined),
      createPlaygroundAgentsHandler(fixture.handlerOptions)(catalogWithBody, undefined),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 400, 400]);
    expect(fixture.getPromptInspector).not.toHaveBeenCalled();
  });

  it('maps inspector input, cancellation, inspection and availability errors safely', async () => {
    const cases = [
      [PROMPT_INSPECTOR_ERROR_CODES.INVALID_INPUT, 400, 'INVALID_REQUEST'],
      [PROMPT_INSPECTOR_ERROR_CODES.CANCELLED, 408, 'REQUEST_ABORTED'],
      [PROMPT_INSPECTOR_ERROR_CODES.INSPECTION_FAILED, 422, 'PLAYGROUND_INSPECTION_FAILED'],
      [PROMPT_INSPECTOR_ERROR_CODES.INVALID_CONFIGURATION, 503, 'PLAYGROUND_UNAVAILABLE'],
    ] as const;

    for (const [coreCode, status, httpCode] of cases) {
      const inspector = fakeInspector();
      inspector.preview.mockRejectedValueOnce(
        new PromptInspectorError('private-input-or-configuration-detail', { code: coreCode }),
      );
      const fixture = options(inspector);
      const response = await createPlaygroundPreviewHandler(fixture.handlerOptions)(
        jsonRequest(`${ORIGIN}/api/playground/preview`, {
          agent: 'PRODUCT_OWNER',
          input: { safe: true },
        }),
        undefined,
      );
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(status);
      expect(serialized).toContain(httpCode);
      expect(serialized).not.toContain('private-input-or-configuration-detail');
      expect(JSON.stringify(fixture.records)).not.toContain(
        'private-input-or-configuration-detail',
      );
    }
  });

  it('maps runtime construction and response-contract failures to unavailable', async () => {
    const unavailable = options();
    unavailable.getPromptInspector.mockRejectedValueOnce(new Error('OPENAI_API_KEY=secret'));
    const invalid = fakeInspector();
    invalid.catalog.mockReturnValueOnce({ private: 'invalid-contract' });
    const invalidFixture = options(invalid);

    for (const fixture of [unavailable, invalidFixture]) {
      const response = await createPlaygroundAgentsHandler(fixture.handlerOptions)(
        new Request(`${ORIGIN}/api/playground/agents`),
        undefined,
      );
      const serialized = JSON.stringify(await response.json());
      expect(response.status).toBe(503);
      expect(serialized).toContain('PLAYGROUND_UNAVAILABLE');
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('invalid-contract');
      expect(JSON.stringify(fixture.records)).not.toContain('secret');
      expect(JSON.stringify(fixture.records)).not.toContain('invalid-contract');
    }
  });

  it('never places ADMIN prompt input or manual candidate content in HTTP logs', async () => {
    const fixture = options();
    const sensitiveInput = 'SECRET_INPUT_PLAYGROUND';
    const sensitiveCandidate = 'SECRET_CANDIDATE_PLAYGROUND';

    await createPlaygroundPreviewHandler(fixture.handlerOptions)(
      jsonRequest(`${ORIGIN}/api/playground/preview`, {
        agent: 'PRODUCT_OWNER',
        input: { objective: sensitiveInput },
      }),
      undefined,
    );
    await createPlaygroundValidateHandler(fixture.handlerOptions)(
      jsonRequest(`${ORIGIN}/api/playground/validate`, {
        agent: 'PRODUCT_OWNER',
        input: { objective: sensitiveInput },
        candidate: { content: sensitiveCandidate },
      }),
      undefined,
    );

    const serialized = JSON.stringify(fixture.records);
    expect(serialized).not.toContain(sensitiveInput);
    expect(serialized).not.toContain(sensitiveCandidate);
    expect(serialized).toContain(FIXED_REQUEST_ID);
  });

  it('stops a request already aborted before resolving the inspector', async () => {
    const controller = new AbortController();
    controller.abort();
    const fixture = options();
    const request = new Request(`${ORIGIN}/api/playground/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ agent: 'PRODUCT_OWNER', input: {} }),
      signal: controller.signal,
    });
    const response = await createPlaygroundPreviewHandler(fixture.handlerOptions)(
      request,
      undefined,
    );

    expect(response.status).toBe(408);
    expect((await response.json()).errors[0].code).toBe('REQUEST_ABORTED');
    expect(fixture.getPromptInspector).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods before authentication', async () => {
    const fixture = options();
    const response = await createPlaygroundPreviewHandler(fixture.handlerOptions)(
      new Request(`${ORIGIN}/api/playground/preview`, { method: 'DELETE' }),
      undefined,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(fixture.handlerOptions.authenticate).not.toHaveBeenCalled();
  });
});
