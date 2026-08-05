import { describe, expect, it } from 'vitest';

import { createResponseValidator } from './response-validator';
import {
  contractFor,
  createJsonRunResult,
  deterministicNow,
  quietLogger,
} from './testing/response-validator-fixtures';

describe('response validator logging', () => {
  it('logs only allowlisted technical metadata on success', () => {
    const lines: string[] = [];
    const privateContent = 'private-response-marker';
    const runResult = createJsonRunResult({
      content: JSON.stringify({ summary: privateContent }),
      structuredData: { summary: privateContent },
    });
    const contract = contractFor(runResult);

    createResponseValidator({
      logger: quietLogger(lines),
      now: deterministicNow(),
    }).validate({ runResult, contract });

    const serialized = lines.join('\n');
    expect(lines.map((line) => JSON.parse(line).event)).toEqual([
      'response.validation.started',
      'response.validation.accepted',
    ]);
    expect(serialized).not.toContain(privateContent);
    expect(serialized).not.toContain(JSON.stringify(contract));
    expect(serialized).not.toContain('structuredData');
    expect(serialized).not.toContain('validatedOutput');
    expect(serialized).not.toContain('schemaPath');
    expect(serialized).not.toContain('instancePath');
  });

  it('does not log issue paths, response content or schema on rejection', () => {
    const lines: string[] = [];
    const runResult = createJsonRunResult({ content: '{}', structuredData: {} });

    createResponseValidator({ logger: quietLogger(lines) }).validate({
      runResult,
      contract: contractFor(runResult),
    });

    const serialized = lines.join('\n');
    expect(serialized).toContain('response.validation.rejected');
    expect(serialized).toContain('SCHEMA_MISMATCH');
    expect(serialized).not.toContain('/summary');
    expect(serialized).not.toContain('#/required');
    expect(serialized).not.toContain('properties');
  });

  it('logs a sanitized technical event when contract validation fails', () => {
    const lines: string[] = [];
    const runResult = createJsonRunResult();
    const contract = { ...contractFor(runResult), expectedOutputContractHash: 'c'.repeat(64) };

    expect(() =>
      createResponseValidator({ logger: quietLogger(lines) }).validate({ runResult, contract }),
    ).toThrow();

    const serialized = lines.join('\n');
    expect(serialized).toContain('response.validation.failed');
    expect(serialized).toContain('RESPONSE_VALIDATOR_INVALID_CONTRACT');
    expect(serialized).not.toContain(JSON.stringify(contract));
  });
});
