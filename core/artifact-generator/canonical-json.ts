import type { JsonPrimitive } from '@brq/shared/types/json-value';

export interface ReadonlyJsonObject {
  readonly [key: string]: ReadonlyJsonValue;
}

export type ReadonlyJsonValue = JsonPrimitive | ReadonlyJsonObject | readonly ReadonlyJsonValue[];

type SerializationFrame =
  | { readonly kind: 'VALUE'; readonly value: ReadonlyJsonValue }
  | { readonly kind: 'RAW'; readonly value: string }
  | { readonly kind: 'LEAVE'; readonly value: object };

function primitiveJson(value: JsonPrimitive): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Canonical JSON aceita somente números finitos.');
  }

  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('Valor primitivo não suportado em JSON canônico.');
  }

  return serialized;
}

export function canonicalizeJson(value: ReadonlyJsonValue): string {
  const chunks: string[] = [];
  const activeAncestors = new WeakSet<object>();
  const stack: SerializationFrame[] = [{ kind: 'VALUE', value }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;

    if (frame.kind === 'RAW') {
      chunks.push(frame.value);
      continue;
    }

    if (frame.kind === 'LEAVE') {
      activeAncestors.delete(frame.value);
      continue;
    }

    const current = frame.value;
    if (current === null || typeof current !== 'object') {
      chunks.push(primitiveJson(current));
      continue;
    }

    if (activeAncestors.has(current)) {
      throw new TypeError('JSON canônico não aceita valores cíclicos.');
    }
    activeAncestors.add(current);

    if (Array.isArray(current)) {
      chunks.push('[');
      stack.push({ kind: 'LEAVE', value: current });
      stack.push({ kind: 'RAW', value: ']' });

      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({ kind: 'VALUE', value: current[index]! });
        if (index > 0) stack.push({ kind: 'RAW', value: ',' });
      }
      continue;
    }

    const objectValue = current as ReadonlyJsonObject;
    const keys = Object.keys(objectValue).sort();
    chunks.push('{');
    stack.push({ kind: 'LEAVE', value: objectValue });
    stack.push({ kind: 'RAW', value: '}' });

    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!;
      stack.push({ kind: 'VALUE', value: objectValue[key]! });
      stack.push({ kind: 'RAW', value: `${JSON.stringify(key)}:` });
      if (index > 0) stack.push({ kind: 'RAW', value: ',' });
    }
  }

  return chunks.join('');
}

export function prettyPrintCanonicalJson(value: ReadonlyJsonValue): string {
  return JSON.stringify(JSON.parse(canonicalizeJson(value)) as unknown, null, 2);
}

export function cloneJsonValue(value: ReadonlyJsonValue): ReadonlyJsonValue {
  return JSON.parse(canonicalizeJson(value)) as ReadonlyJsonValue;
}

export function measureJsonNestingDepth(value: ReadonlyJsonValue): number {
  if (value === null || typeof value !== 'object') return 0;

  let maximumDepth = 0;
  const stack: { readonly value: ReadonlyJsonValue; readonly depth: number }[] = [
    { value, depth: 1 },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    maximumDepth = Math.max(maximumDepth, current.depth);

    if (current.value === null || typeof current.value !== 'object') continue;
    const nestedValues = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value);

    for (const nestedValue of nestedValues) {
      if (nestedValue !== null && typeof nestedValue === 'object') {
        stack.push({ value: nestedValue, depth: current.depth + 1 });
      }
    }
  }

  return maximumDepth;
}
