import type OpenAI from 'openai';

import { createPromptBuilder } from '@brq/prompt-builder';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it, vi } from 'vitest';

import { toAIRequest } from '../../core/agent-runner/ai-request-mapper';
import { createAgentRunRequest } from '../../core/agent-runner/testing/agent-runner-fixtures';
import { OpenAIProvider } from '../../core/ai-provider/openai/openai-provider';
import { loadDeveloperPromptAssets } from './prompt-assets';

describe('Developer 1.0.4 structured output transport', () => {
  it('preserves the exact active schema and strict mode through Agent Runner and OpenAI adapter', async () => {
    const assets = loadDeveloperPromptAssets();
    const base = createAgentRunRequest();
    const prompt = createPromptBuilder({
      logger: createLogger({ sink: () => undefined }),
      now: () => 0,
    }).build({
      ...base.prompt,
      outputContract: assets.outputContract,
    });

    const aiRequest = toAIRequest(prompt, 'local-transport-audit');

    expect(assets.manifest.version).toBe('1.0.4');
    expect(aiRequest.responseFormat).toMatchObject({
      type: 'json_schema',
      strict: true,
      schema: assets.outputContract.schema,
    });
    if (aiRequest.responseFormat.type !== 'json_schema') {
      throw new TypeError('The Developer request must use JSON Schema.');
    }
    expect(aiRequest.responseFormat.schema).toEqual(assets.validationContract.schema);
    expect(aiRequest.responseFormat.schema).not.toBe(assets.outputContract.schema);

    const create = vi.fn().mockRejectedValue(new Error('LOCAL_TRANSPORT_AUDIT_STOP'));
    const provider = new OpenAIProvider(
      { apiKey: 'local-test-key', timeoutMs: 60_000, maxRetries: 0 },
      {
        client: {
          responses: { create } as unknown as OpenAI['responses'],
        },
        logger: createLogger({ sink: () => undefined }),
        now: () => 0,
      },
    );

    await expect(provider.generate(aiRequest)).rejects.toBeDefined();

    expect(create).toHaveBeenCalledOnce();
    const adapterRequest = create.mock.calls[0]?.[0] as
      | {
          readonly text?: {
            readonly format?: {
              readonly type?: string;
              readonly strict?: boolean;
              readonly schema?: unknown;
            };
          };
        }
      | undefined;
    expect(adapterRequest?.text?.format).toMatchObject({
      type: 'json_schema',
      strict: true,
      schema: assets.outputContract.schema,
    });
    expect(adapterRequest?.text?.format?.schema).toEqual(aiRequest.responseFormat.schema);

    const transportedSchema = adapterRequest?.text?.format?.schema as {
      readonly additionalProperties?: boolean;
      readonly required?: readonly string[];
      readonly $defs?: {
        readonly module?: {
          readonly properties?: { readonly path?: { readonly pattern?: string } };
        };
        readonly implementationPhase?: {
          readonly properties?: { readonly order?: { readonly maximum?: number } };
        };
      };
    };
    expect(transportedSchema.additionalProperties).toBe(false);
    expect(transportedSchema.required).toEqual(
      expect.arrayContaining(['modules', 'implementationPhases']),
    );
    expect(transportedSchema.$defs?.module?.properties?.path?.pattern).toBeTypeOf('string');
    expect(transportedSchema.$defs?.implementationPhase?.properties?.order?.maximum).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});
