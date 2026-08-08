export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;

  const pending: object[] = [value];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);

    for (const nestedValue of Object.values(current)) {
      if (nestedValue !== null && typeof nestedValue === 'object') pending.push(nestedValue);
    }
    Object.freeze(current);
  }

  return value;
}
