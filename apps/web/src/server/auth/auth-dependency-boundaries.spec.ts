// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function productionTypeScript(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScript(absolute);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.spec.') ? [absolute] : [];
  });
}

describe('authentication architecture boundary', () => {
  it('keeps authentication libraries, sessions and roles outside functional workspaces', () => {
    const workspaceRoot = path.resolve(process.cwd(), '../..');
    const functionalRoots = ['agents', 'core', 'shared'].map((directory) =>
      path.join(workspaceRoot, directory),
    );
    const source = functionalRoots
      .flatMap(productionTypeScript)
      .map((filename) => readFileSync(filename, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/from ['"](?:better-auth|@better-auth\/|@node-rs\/argon2)/);
    expect(source).not.toMatch(/from ['"][^'"]*server\/auth/);
    expect(source).not.toMatch(/\b(?:AuthenticatedPrincipal|Authentication|SessionCookie)\b/);
  });
});
