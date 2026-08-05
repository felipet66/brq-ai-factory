import { Buffer } from 'node:buffer';

import { createLogger } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';
import type { z } from 'zod';

import { assemblePromptDocument } from './prompt-assembler';
import { canonicalizeJson } from './canonical-json';
import type {
  CreatePromptBuilderOptions,
  PromptBuildInput,
  PromptBuildOptions,
  PromptBuilder,
  PromptResult,
} from './contracts';
import {
  PROMPT_BUILDER_ERROR_CODES,
  PromptBuilderError,
  type PromptBuilderErrorCode,
} from './errors';
import { calculateCanonicalJsonHash, calculatePromptHash } from './hashing';
import { deepFreeze } from './immutability';
import { DEFAULT_PROMPT_MAX_BYTES, DEFAULT_PROMPT_MAX_CONTEXT_REFERENCES } from './limits';
import { assertPromptPreflightBudget } from './prompt-budget';
import { renderPromptDocument } from './prompt-renderer';
import {
  promptBuilderConfigurationSchema,
  promptBuildInputSchema,
  promptBuildOptionsSchema,
  promptResultSchema,
} from './schemas';
import { parsePromptTemplate } from './prompt-template';

export { DEFAULT_PROMPT_MAX_BYTES, DEFAULT_PROMPT_MAX_CONTEXT_REFERENCES } from './limits';

function validationErrorCode(error: z.ZodError): PromptBuilderErrorCode {
  const firstPath = error.issues[0]?.path[0];

  if (firstPath === 'template') return PROMPT_BUILDER_ERROR_CODES.INVALID_TEMPLATE;
  if (firstPath === 'outputContract') {
    return PROMPT_BUILDER_ERROR_CODES.INVALID_OUTPUT_CONTRACT;
  }
  return PROMPT_BUILDER_ERROR_CODES.INVALID_INPUT;
}

function duration(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

export function createPromptBuilder(options: CreatePromptBuilderOptions = {}): PromptBuilder {
  const configurationResult = promptBuilderConfigurationSchema.safeParse({
    maxBytes: options.configuration?.maxBytes ?? DEFAULT_PROMPT_MAX_BYTES,
    maxContextReferences:
      options.configuration?.maxContextReferences ?? DEFAULT_PROMPT_MAX_CONTEXT_REFERENCES,
  });

  if (!configurationResult.success) {
    throw new PromptBuilderError('Configuração do Prompt Builder inválida.', {
      code: PROMPT_BUILDER_ERROR_CODES.INVALID_CONFIGURATION,
      cause: configurationResult.error,
    });
  }

  const configuration = configurationResult.data;
  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => performance.now());

  return Object.freeze({
    build(input: PromptBuildInput, buildOptions: PromptBuildOptions = {}): PromptResult {
      const startedAt = now();
      const optionsResult = promptBuildOptionsSchema.safeParse(buildOptions);

      if (!optionsResult.success) {
        const promptError = new PromptBuilderError('Opções do Prompt Builder inválidas.', {
          code: PROMPT_BUILDER_ERROR_CODES.INVALID_INPUT,
          cause: optionsResult.error,
        });

        logger.error('prompt.validation.failed', {
          errorCode: promptError.code,
          durationMs: duration(now, startedAt),
        });
        throw promptError;
      }

      const validOptions = optionsResult.data;
      const maxBytes = validOptions.maxBytes ?? configuration.maxBytes;

      if (maxBytes > configuration.maxBytes) {
        const budgetError = new PromptBuilderError(
          'O limite da chamada não pode ampliar o orçamento configurado na instância.',
          {
            code: PROMPT_BUILDER_ERROR_CODES.BUDGET_EXCEEDED,
          },
        );

        logger.error('prompt.budget.exceeded', {
          maxBytes: configuration.maxBytes,
          requestedMaxBytes: maxBytes,
          errorCode: budgetError.code,
          durationMs: duration(now, startedAt),
        });
        throw budgetError;
      }

      try {
        assertPromptPreflightBudget(input, maxBytes, configuration.maxContextReferences);
      } catch (error) {
        const promptError =
          error instanceof PromptBuilderError
            ? error
            : new PromptBuilderError('Não foi possível pré-validar o orçamento do prompt.', {
                code: PROMPT_BUILDER_ERROR_CODES.INVALID_INPUT,
                cause: error,
              });

        logger.error(
          promptError.code === PROMPT_BUILDER_ERROR_CODES.BUDGET_EXCEEDED
            ? 'prompt.budget.exceeded'
            : 'prompt.validation.failed',
          {
            maxBytes,
            maxContextReferences: configuration.maxContextReferences,
            errorCode: promptError.code,
            durationMs: duration(now, startedAt),
            requestId: validOptions.requestId,
            traceId: validOptions.traceId,
          },
        );
        throw promptError;
      }

      const inputResult = promptBuildInputSchema.safeParse(input);

      if (!inputResult.success) {
        const promptError = new PromptBuilderError('Entrada do Prompt Builder inválida.', {
          code: validationErrorCode(inputResult.error),
          cause: inputResult.error,
        });

        logger.error('prompt.validation.failed', {
          errorCode: promptError.code,
          durationMs: duration(now, startedAt),
        });
        throw promptError;
      }

      const validInput = deepFreeze(inputResult.data) as PromptBuildInput;
      const promptId = validInput.template.id;
      const contextReferenceCount = validInput.contexts.reduce(
        (totalReferences, context) => totalReferences + context.references.length,
        0,
      );

      logger.info('prompt.build.started', {
        promptId,
        agent: validInput.template.agent,
        version: validInput.template.version,
        schemaVersion: validInput.template.schemaVersion,
        sectionCount: validInput.template.sections.length,
        contextCount: validInput.contexts.length,
        contextReferenceCount,
        maxBytes,
        maxContextReferences: configuration.maxContextReferences,
        requestId: validOptions.requestId,
        traceId: validOptions.traceId,
      });

      try {
        const parsedTemplate = parsePromptTemplate(validInput.template);
        const document = assemblePromptDocument(validInput);
        const rendered = renderPromptDocument(document);
        const outputContractCanonical = canonicalizeJson(
          validInput.outputContract as unknown as JsonValue,
        );
        const instructionsBytes = Buffer.byteLength(rendered.instructions, 'utf8');
        const inputBytes = Buffer.byteLength(rendered.input, 'utf8');
        const outputContractBytes = Buffer.byteLength(outputContractCanonical, 'utf8');
        const usedBytes = instructionsBytes + inputBytes + outputContractBytes;

        if (usedBytes > maxBytes) {
          throw new PromptBuilderError('O prompt excede o orçamento configurado.', {
            code: PROMPT_BUILDER_ERROR_CODES.BUDGET_EXCEEDED,
            promptId,
          });
        }

        const outputContractHash = calculatePromptHash(outputContractCanonical);
        const metadata = {
          promptId,
          agent: validInput.template.agent,
          version: validInput.template.version,
          schemaVersion: validInput.template.schemaVersion,
          templateHash: parsedTemplate.hash,
          instructionsHash: calculatePromptHash(rendered.instructions),
          inputHash: calculatePromptHash(rendered.input),
          outputContractHash,
          promptHash: calculateCanonicalJsonHash({
            promptId,
            agent: validInput.template.agent,
            version: validInput.template.version,
            schemaVersion: validInput.template.schemaVersion,
            instructions: rendered.instructions,
            input: rendered.input,
            outputContract: validInput.outputContract,
          } as unknown as JsonValue),
          sectionHashes: document.sections.map((section) => ({
            sectionId: section.id,
            hash: section.hash,
          })),
          ruleSetHashes: document.sources.ruleSets,
          contextHashes: document.sources.contexts,
        };
        const resultCandidate = {
          document,
          rendered,
          metadata,
          budget: {
            maxBytes,
            usedBytes,
            instructionsBytes,
            inputBytes,
            outputContractBytes,
          },
          outputContract: validInput.outputContract,
        };
        const result = promptResultSchema.parse(resultCandidate) as PromptResult;
        const immutableResult = deepFreeze(result);

        logger.info('prompt.build.completed', {
          promptId,
          agent: metadata.agent,
          version: metadata.version,
          schemaVersion: metadata.schemaVersion,
          templateHash: metadata.templateHash,
          promptHash: metadata.promptHash,
          instructionsHash: metadata.instructionsHash,
          inputHash: metadata.inputHash,
          outputContractHash,
          sectionCount: document.sections.length,
          contextCount: validInput.contexts.length,
          contextReferenceCount,
          instructionsBytes,
          inputBytes,
          outputContractBytes,
          usedBytes,
          maxBytes,
          maxContextReferences: configuration.maxContextReferences,
          durationMs: duration(now, startedAt),
          requestId: validOptions.requestId,
          traceId: validOptions.traceId,
        });

        return immutableResult;
      } catch (error) {
        const promptError =
          error instanceof PromptBuilderError
            ? error
            : new PromptBuilderError('Não foi possível montar o prompt.', {
                code: PROMPT_BUILDER_ERROR_CODES.RENDER_FAILED,
                promptId,
                cause: error,
              });
        const event =
          promptError.code === PROMPT_BUILDER_ERROR_CODES.BUDGET_EXCEEDED
            ? 'prompt.budget.exceeded'
            : 'prompt.build.failed';

        logger.error(event, {
          promptId,
          agent: validInput.template.agent,
          version: validInput.template.version,
          schemaVersion: validInput.template.schemaVersion,
          errorCode: promptError.code,
          maxBytes,
          maxContextReferences: configuration.maxContextReferences,
          durationMs: duration(now, startedAt),
          requestId: validOptions.requestId,
          traceId: validOptions.traceId,
        });
        throw promptError;
      }
    },
  });
}
