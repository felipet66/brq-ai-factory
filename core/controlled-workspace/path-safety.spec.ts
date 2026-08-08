import { describe, expect, it } from 'vitest';

import { DEFAULT_CONTROLLED_WORKSPACE_LIMITS } from './limits';
import {
  PathSafetyFailure,
  inspectSafeWorkspacePath,
  resolveContainedWorkspacePath,
} from './path-safety';

describe('controlled workspace path containment', () => {
  it('resolves a safe POSIX locator below the trusted root', () => {
    expect(resolveContainedWorkspacePath('/trusted/root', 'src/index.ts')).toBe(
      '/trusted/root/src/index.ts',
    );
  });

  it('rejects a locator that would resolve outside the trusted root', () => {
    expect(() => resolveContainedWorkspacePath('/trusted/root', '../outside.ts')).toThrowError(
      PathSafetyFailure,
    );
  });

  it('returns deterministic collision metadata without normalizing the public value', () => {
    const inspected = inspectSafeWorkspacePath(
      'Src/Índice.ts',
      'text/typescript',
      DEFAULT_CONTROLLED_WORKSPACE_LIMITS,
    );
    expect(inspected.value).toBe('Src/Índice.ts');
    expect(inspected.collisionKey).toBe('src/índice.ts');
    expect(Object.isFrozen(inspected)).toBe(true);
  });
});
