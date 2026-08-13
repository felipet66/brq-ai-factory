export function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;

  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
