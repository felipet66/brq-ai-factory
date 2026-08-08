import {
  calculatePromptHash,
  canonicalizeJson,
  type PromptOutputContract,
} from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import { projectOutputContract } from './output-contract-projection';

describe('output contract projection', () => {
  it('summarizes nested objects, arrays, enums and constraints deterministically', () => {
    const contract: PromptOutputContract = {
      id: 'contract:nested',
      version: '1.0.0',
      format: 'JSON_SCHEMA',
      instructions: ['Return JSON.'],
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'items'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          status: { type: 'string', enum: ['READY', 'BLOCKED'] },
          items: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['id'],
              properties: { id: { type: 'string', pattern: '^ITEM-' } },
            },
          },
        },
      },
    };

    const contractHash = calculatePromptHash(canonicalizeJson(contract as unknown as JsonValue));
    const first = projectOutputContract(contract, contractHash);
    const second = projectOutputContract(structuredClone(contract), contractHash);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      format: 'JSON_SCHEMA',
      contractHash,
      dialect: 'DRAFT_2020_12',
      summary: {
        rootTypes: ['object'],
        totalNodes: 6,
        propertyCount: 4,
        requiredCount: 3,
        objectCount: 2,
        arrayCount: 1,
        enumCount: 1,
        truncated: false,
      },
    });
    expect(first.summary.nodes.map((node) => node.path)).toEqual([
      '$',
      '$.items',
      '$.items[]',
      '$.items[].id',
      '$.name',
      '$.status',
    ]);
    expect(first.summary.nodes.find((node) => node.path === '$.name')?.constraints).toEqual([
      { key: 'minLength', value: 1 },
      { key: 'maxLength', value: 120 },
    ]);
    expect(first.schema).toEqual(contract.schema);
    expect(first.schemaHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns an explicit empty summary for a text contract', () => {
    const contract = {
      id: 'contract:text',
      version: '1.0.0',
      format: 'TEXT',
      instructions: ['Return text.'],
    } as const;
    const contractHash = calculatePromptHash(canonicalizeJson(contract as unknown as JsonValue));
    const result = projectOutputContract(contract, contractHash);

    expect(result).toEqual({
      id: 'contract:text',
      version: '1.0.0',
      format: 'TEXT',
      contractHash,
      dialect: null,
      schemaHash: null,
      instructions: ['Return text.'],
      schema: null,
      summary: {
        rootTypes: [],
        totalNodes: 0,
        propertyCount: 0,
        requiredCount: 0,
        objectCount: 0,
        arrayCount: 0,
        enumCount: 0,
        truncated: false,
        nodes: [],
      },
    });
  });

  it('bounds traversal depth without mutating the raw JSON Schema', () => {
    let nested: Record<string, unknown> = { type: 'string' };
    for (let depth = 0; depth < 20; depth += 1) {
      nested = {
        type: 'object',
        required: [`level${depth}`],
        properties: { [`level${depth}`]: nested },
      };
    }
    const original = structuredClone(nested);
    const contract = {
      id: 'contract:deep',
      version: '1.0.0',
      format: 'JSON_SCHEMA',
      instructions: ['Return JSON.'],
      schema: nested,
    } as unknown as PromptOutputContract;

    const contractHash = calculatePromptHash(canonicalizeJson(contract as unknown as JsonValue));
    const result = projectOutputContract(contract, contractHash);

    expect(result.summary.truncated).toBe(true);
    expect(result.summary.totalNodes).toBeLessThanOrEqual(256);
    expect(result.schema).toEqual(original);
    if (contract.format !== 'JSON_SCHEMA') throw new Error('Expected the JSON Schema fixture.');
    expect(contract.schema).toEqual(original);
  });

  it('infers undeclared object and array types and enforces the node-count bound', () => {
    const properties = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [
        `field${String(index).padStart(3, '0')}`,
        index === 0
          ? { items: { type: ['string', 'null'] } }
          : index === 1
            ? { properties: { nested: { enum: ['A'] } } }
            : index === 2
              ? true
              : {},
      ]),
    );
    const contract = {
      id: 'contract:wide',
      version: '1.0.0',
      format: 'JSON_SCHEMA',
      instructions: ['Return JSON.'],
      schema: { properties },
    } as unknown as PromptOutputContract;
    const contractHash = calculatePromptHash(canonicalizeJson(contract as unknown as JsonValue));

    const result = projectOutputContract(contract, contractHash);

    expect(result.summary.rootTypes).toEqual(['object']);
    expect(result.summary.nodes.find((node) => node.path === '$.field000')?.types).toEqual([
      'array',
    ]);
    expect(result.summary.nodes.find((node) => node.path === '$.field000[]')?.types).toEqual([
      'string',
      'null',
    ]);
    expect(result.summary.nodes.find((node) => node.path === '$.field001')?.types).toEqual([
      'object',
    ]);
    expect(result.summary.truncated).toBe(true);
    expect(result.summary.totalNodes).toBe(256);
  });
});
