import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  productOwnerSpecificationSchema,
  type ProductOwnerSpecification,
} from '@brq/product-owner-agent';
import { jsonValueSchema } from '@brq/shared/schemas/json-value.schema';
import type { JsonObject, JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import { createProductOwnerSpecification } from '../product-owner/testing/product-owner-fixtures';
import {
  diagnoseDeveloperOutput,
  type DeveloperOutputDiagnosticReport,
} from './testing/developer-output-harness';
import { createTechnicalSpecification } from './testing/developer-fixtures';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ALLOWED_INPUT_DIRECTORY = path.join(REPOSITORY_ROOT, '.ai', 'debug', 'structured-output');
const INPUT_ENVIRONMENT_VARIABLE = 'AI_FACTORY_DEVELOPER_OUTPUT_FILE';
const RAW_DEBUG_FLAG = 'AI_FACTORY_STRUCTURED_OUTPUT_RAW_DEBUG';
const REPORT_ENVIRONMENT_VARIABLE = 'AI_FACTORY_DEVELOPER_OUTPUT_REPORT_FILE';

function candidate(): JsonObject {
  return structuredClone(createTechnicalSpecification()) as unknown as JsonObject;
}

function firstObject(value: JsonObject, collectionName: string): JsonObject {
  const collection = value[collectionName];
  const first = Array.isArray(collection) ? collection[0] : undefined;
  if (first === null || typeof first !== 'object' || Array.isArray(first)) {
    throw new TypeError(`Expected the canonical Developer ${collectionName} fixture.`);
  }
  return first;
}

function diagnose(value: JsonValue): DeveloperOutputDiagnosticReport {
  return diagnoseDeveloperOutput({
    candidate: value,
    productOwnerSpecification: createProductOwnerSpecification(),
    businessContextSource: 'DEFAULT_FIXTURE',
  });
}

describe('Developer output local diagnostic harness', () => {
  it('passes a valid response through the real validation pipeline and freezes the report', () => {
    const result = diagnose(candidate());

    expect(result).toMatchObject({
      stage: 'PASSED',
      issueCount: 0,
      issues: [],
      metadata: {
        contractId: 'contract:developer-technical-specification',
        contractVersion: '1.0.2',
        contractHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        schemaHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        candidateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        businessContextSource: 'DEFAULT_FIXTURE',
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
  });

  it('accepts direct and wrapped local diagnostic inputs without changing the candidate', () => {
    const direct = diagnosticFileInput(candidate());
    const wrapped = diagnosticFileInput({
      candidate: candidate(),
      productOwnerSpecification: createProductOwnerSpecification(),
    });

    expect(diagnoseDeveloperOutput(direct).stage).toBe('PASSED');
    expect(diagnoseDeveloperOutput(wrapped).stage).toBe('PASSED');
    expect(direct.businessContextSource).toBe('DEFAULT_FIXTURE');
    expect(wrapped.businessContextSource).toBe('PROVIDED');
  });

  it('requires development, explicit raw access and the ignored local directory for file input', () => {
    const outsidePath = path.join(REPOSITORY_ROOT, 'README.md');

    expect(() =>
      diagnosticFilePath({
        NODE_ENV: 'development',
        [INPUT_ENVIRONMENT_VARIABLE]: outsidePath,
      }),
    ).toThrow(RAW_DEBUG_FLAG);
    expect(() =>
      diagnosticFilePath({
        NODE_ENV: 'production',
        [RAW_DEBUG_FLAG]: 'true',
        [INPUT_ENVIRONMENT_VARIABLE]: outsidePath,
      }),
    ).toThrow('development');
    expect(() =>
      diagnosticFilePath({
        NODE_ENV: 'development',
        [RAW_DEBUG_FLAG]: 'true',
        [INPUT_ENVIRONMENT_VARIABLE]: outsidePath,
      }),
    ).toThrow('.ai/debug/structured-output');
  });

  it('reports exactly two relevant JSON Schema limit mismatches without exposing the payload', () => {
    const invalid = candidate();
    firstObject(invalid, 'modules')['path'] = '/absolute/path';
    firstObject(invalid, 'implementationPhases')['order'] = Number.MAX_SAFE_INTEGER + 1;

    const result = diagnose(invalid);

    expect(result.stage).toBe('RESPONSE_VALIDATOR');
    expect(result.issueCount).toBe(2);
    expect(result.issues).toEqual([
      {
        code: 'SCHEMA_MISMATCH',
        path: '/modules/0/path',
        schemaPath: '#/$defs/module/properties/path/pattern',
        keyword: 'pattern',
      },
      {
        code: 'SCHEMA_MISMATCH',
        path: '/implementationPhases/0/order',
        schemaPath: '#/$defs/implementationPhase/properties/order/maximum',
        keyword: 'maximum',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('Arquitetura da consulta de pedidos');
    expect(Object.isFrozen(result.issues[0])).toBe(true);
  });

  it('isolates the documented NFC divergence at the public Zod boundary', () => {
    const invalid = candidate();
    firstObject(invalid, 'modules')['path'] = 'cafe\u0301';

    const result = diagnose(invalid);

    expect(result.stage).toBe('ZOD');
    expect(result.issues).toContainEqual({
      code: 'ZOD_SCHEMA_MISMATCH',
      path: '/modules/0/path',
      schemaPath: null,
      keyword: 'custom',
    });
  });

  it('isolates a readiness mismatch at the real Business Validation boundary', () => {
    const invalid = candidate();
    invalid['readiness'] = 'PARTIALLY_READY';

    const result = diagnose(invalid);

    expect(result).toMatchObject({
      stage: 'BUSINESS_VALIDATION',
      issueCount: 1,
      issues: [
        {
          code: 'DEVELOPER_READINESS_MISMATCH',
          path: '/readiness',
          schemaPath: null,
          keyword: null,
        },
      ],
    });
  });
});

function diagnosticFileInput(value: unknown): {
  readonly candidate: JsonValue;
  readonly productOwnerSpecification: ProductOwnerSpecification;
  readonly businessContextSource: 'DEFAULT_FIXTURE' | 'PROVIDED';
} {
  const parsed = jsonValueSchema.parse(value);
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    'candidate' in parsed
  ) {
    return {
      candidate: jsonValueSchema.parse(parsed['candidate']),
      productOwnerSpecification:
        parsed['productOwnerSpecification'] === undefined
          ? createProductOwnerSpecification()
          : productOwnerSpecificationSchema.parse(parsed['productOwnerSpecification']),
      businessContextSource:
        parsed['productOwnerSpecification'] === undefined ? 'DEFAULT_FIXTURE' : 'PROVIDED',
    };
  }

  return {
    candidate: parsed,
    productOwnerSpecification: createProductOwnerSpecification(),
    businessContextSource: 'DEFAULT_FIXTURE',
  };
}

function isInside(parent: string, candidatePath: string): boolean {
  const relativePath = path.relative(parent, candidatePath);
  return (
    relativePath.length > 0 &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

function diagnosticFilePath(environment: NodeJS.ProcessEnv): string | undefined {
  const configured = environment[INPUT_ENVIRONMENT_VARIABLE];
  if (configured === undefined) return undefined;
  if (environment.NODE_ENV !== 'development') {
    throw new Error('O harness de payload bruto exige NODE_ENV=development.');
  }
  if (environment[RAW_DEBUG_FLAG] !== 'true') {
    throw new Error(`${RAW_DEBUG_FLAG}=true é obrigatório para ler o payload local.`);
  }

  const configuredPath = path.resolve(REPOSITORY_ROOT, configured);
  if (!isInside(ALLOWED_INPUT_DIRECTORY, configuredPath)) {
    throw new Error('O payload deve ser um JSON dentro de .ai/debug/structured-output/.');
  }
  const allowedDirectory = realpathSync(ALLOWED_INPUT_DIRECTORY);
  const inputPath = realpathSync(configuredPath);
  if (
    !isInside(allowedDirectory, inputPath) ||
    path.extname(inputPath).toLowerCase() !== '.json' ||
    !statSync(inputPath).isFile()
  ) {
    throw new Error('O payload deve ser um JSON dentro de .ai/debug/structured-output/.');
  }
  return inputPath;
}

function diagnosticReportPath(environment: NodeJS.ProcessEnv): string {
  const configured = environment[REPORT_ENVIRONMENT_VARIABLE];
  if (configured === undefined) {
    throw new Error('O arquivo técnico do relatório local não foi configurado.');
  }
  const reportPath = path.resolve(configured);
  const temporaryRoot = realpathSync(tmpdir());
  const reportDirectory = realpathSync(path.dirname(reportPath));
  if (!isInside(temporaryRoot, reportDirectory) || path.basename(reportPath) !== 'report.json') {
    throw new Error('O relatório sanitizado deve usar o diretório temporário do harness.');
  }
  return reportPath;
}

const developerOutputFile = diagnosticFilePath(process.env);
if (developerOutputFile !== undefined) {
  const developerOutputReportFile = diagnosticReportPath(process.env);
  describe('Developer output local diagnostic file', () => {
    it('writes only the immutable sanitized diagnostic report', () => {
      const input = diagnosticFileInput(JSON.parse(readFileSync(developerOutputFile, 'utf8')));
      const result = diagnoseDeveloperOutput(input);

      writeFileSync(developerOutputReportFile, `${JSON.stringify(result)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      expect(Object.isFrozen(result)).toBe(true);
    });
  });
}
