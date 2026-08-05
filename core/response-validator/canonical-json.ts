import type { JsonPrimitive } from '@brq/shared/types/json-value';

export interface ReadonlyJsonObject {
  readonly [key: string]: ReadonlyJsonValue;
}

export type ReadonlyJsonValue = JsonPrimitive | ReadonlyJsonObject | readonly ReadonlyJsonValue[];

function serializeJsonValue(value: ReadonlyJsonValue, ancestors: WeakSet<object>): string {
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
      return `[${value
        .map((item) => serializeJsonValue(item as ReadonlyJsonValue, ancestors))
        .join(',')}]`;
    }

    const objectValue = value as ReadonlyJsonObject;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeJsonValue(objectValue[key]!, ancestors)}`)
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeJson(value: ReadonlyJsonValue): string {
  return serializeJsonValue(value, new WeakSet<object>());
}
