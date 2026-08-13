function serialize(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON accepts finite numbers only.');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError('Value is not JSON serializable.');
  if (ancestors.has(value)) throw new TypeError('Canonical JSON does not accept cyclic values.');

  ancestors.add(value);
  try {
    if (Array.isArray(value))
      return `[${value.map((item) => serialize(item, ancestors)).join(',')}]`;
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serialize(Reflect.get(value, key), ancestors)}`)
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, new WeakSet<object>());
}
