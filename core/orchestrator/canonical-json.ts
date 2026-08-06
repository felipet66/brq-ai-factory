import type { JsonValue } from '@brq/shared/types/json-value';

function serializeJsonValue(value: JsonValue, ancestors: WeakSet<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON accepts only finite numbers.');
    return JSON.stringify(value);
  }
  if (ancestors.has(value)) throw new TypeError('Canonical JSON does not accept cyclic values.');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => serializeJsonValue(item, ancestors)).join(',')}]`;
    }
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${serializeJsonValue(value[key] as JsonValue, ancestors)}`,
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeJson(value: JsonValue): string {
  return serializeJsonValue(value, new WeakSet<object>());
}

export function normalizeJson(value: unknown): JsonValue {
  const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (typeof nestedValue === 'number' && !Number.isFinite(nestedValue)) {
      throw new TypeError('Canonical JSON accepts only finite numbers.');
    }
    return nestedValue;
  });
  if (serialized === undefined) throw new TypeError('The value is not JSON serializable.');
  return JSON.parse(serialized) as JsonValue;
}
