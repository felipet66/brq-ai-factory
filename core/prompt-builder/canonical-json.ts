import type { JsonValue } from '@brq/shared/types/json-value';

function serializeJsonValue(value: JsonValue, ancestors: WeakSet<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON accepts only finite numbers.');
    }

    return JSON.stringify(value);
  }

  if (ancestors.has(value)) {
    throw new TypeError('Canonical JSON does not accept cyclic values.');
  }

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

/**
 * Serializes a JSON value deterministically without mutating it.
 * Object keys are recursively sorted and array order remains significant.
 */
export function canonicalizeJson(value: JsonValue): string {
  return serializeJsonValue(value, new WeakSet<object>());
}
