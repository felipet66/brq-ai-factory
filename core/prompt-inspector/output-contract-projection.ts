import { calculateCanonicalJsonHash, type PromptOutputContract } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';

import type { PromptInspectionOutputContract } from './contracts';
import { PROMPT_INSPECTOR_MAX_CONTRACT_DEPTH, PROMPT_INSPECTOR_MAX_CONTRACT_NODES } from './limits';

type SchemaObject = Readonly<Record<string, JsonValue>>;

const CONSTRAINT_KEYS = [
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'additionalProperties',
] as const;

function asObject(value: JsonValue | undefined): SchemaObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as SchemaObject)
    : null;
}

function schemaTypes(schema: SchemaObject): readonly string[] {
  const declared = schema.type;
  if (typeof declared === 'string') return [declared];
  if (Array.isArray(declared)) {
    return declared.filter((value): value is string => typeof value === 'string');
  }
  if (asObject(schema.properties) !== null) return ['object'];
  if (schema.items !== undefined) return ['array'];
  return [];
}

function contractSummary(schema: SchemaObject): PromptInspectionOutputContract['summary'] {
  const nodes: Array<PromptInspectionOutputContract['summary']['nodes'][number]> = [];
  let propertyCount = 0;
  let requiredCount = 0;
  let objectCount = 0;
  let arrayCount = 0;
  let enumCount = 0;
  let truncated = false;

  function visit(
    current: SchemaObject,
    path: string,
    required: boolean,
    depth: number,
    property: boolean,
  ): void {
    if (
      depth > PROMPT_INSPECTOR_MAX_CONTRACT_DEPTH ||
      nodes.length >= PROMPT_INSPECTOR_MAX_CONTRACT_NODES
    ) {
      truncated = true;
      return;
    }

    const types = schemaTypes(current);
    const enumValues = Array.isArray(current.enum) ? [...current.enum] : [];
    const constraints = CONSTRAINT_KEYS.flatMap((key) =>
      current[key] === undefined ? [] : [{ key, value: current[key] }],
    );
    nodes.push({ path, types, required, enumValues, constraints });

    if (property) propertyCount += 1;
    if (property && required) requiredCount += 1;
    if (types.includes('object')) objectCount += 1;
    if (types.includes('array')) arrayCount += 1;
    if (enumValues.length > 0) enumCount += 1;

    const requiredProperties = new Set(
      Array.isArray(current.required)
        ? current.required.filter((value): value is string => typeof value === 'string')
        : [],
    );
    const properties = asObject(current.properties);
    if (properties !== null) {
      for (const key of Object.keys(properties).sort()) {
        const propertySchema = asObject(properties[key]);
        if (propertySchema !== null) {
          visit(propertySchema, `${path}.${key}`, requiredProperties.has(key), depth + 1, true);
        }
      }
    }

    const itemSchema = asObject(current.items);
    if (itemSchema !== null) visit(itemSchema, `${path}[]`, true, depth + 1, false);
  }

  visit(schema, '$', true, 0, false);
  return {
    rootTypes: schemaTypes(schema),
    totalNodes: nodes.length,
    propertyCount,
    requiredCount,
    objectCount,
    arrayCount,
    enumCount,
    truncated,
    nodes,
  };
}

const TEXT_SUMMARY: PromptInspectionOutputContract['summary'] = {
  rootTypes: [],
  totalNodes: 0,
  propertyCount: 0,
  requiredCount: 0,
  objectCount: 0,
  arrayCount: 0,
  enumCount: 0,
  truncated: false,
  nodes: [],
};

export function projectOutputContract(
  outputContract: PromptOutputContract,
  contractHash: string,
): PromptInspectionOutputContract {
  if (outputContract.format === 'TEXT') {
    return {
      id: outputContract.id,
      version: outputContract.version,
      format: outputContract.format,
      contractHash,
      dialect: null,
      schemaHash: null,
      instructions: outputContract.instructions,
      schema: null,
      summary: TEXT_SUMMARY,
    };
  }

  return {
    id: outputContract.id,
    version: outputContract.version,
    format: outputContract.format,
    contractHash,
    dialect: 'DRAFT_2020_12',
    schemaHash: calculateCanonicalJsonHash(outputContract.schema as unknown as JsonValue),
    instructions: outputContract.instructions,
    schema: outputContract.schema,
    summary: contractSummary(outputContract.schema as unknown as SchemaObject),
  };
}
