function freezeRecursively(value: unknown, visited: WeakSet<object>): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  for (const nested of Object.values(value)) freezeRecursively(nested, visited);
  Object.freeze(value);
}

export function immutableClone<T>(value: T): T {
  const clone = structuredClone(value);
  freezeRecursively(clone, new WeakSet<object>());
  return clone;
}
