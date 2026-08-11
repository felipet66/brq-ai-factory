import { describe, expect, it } from 'vitest';

import { extractSandboxHelperReasonCode } from './reason-codes';

function extract(
  stderr: string,
  stepId: 'PREPARE' | 'TYPECHECK' | 'BUILD' | 'TEST' = 'PREPARE',
): string | null {
  return extractSandboxHelperReasonCode({
    policyId: 'NODE_WEB_PREVIEW_24_V1',
    stepId,
    stderr,
  });
}

describe('safe Sandbox helper reason codes', () => {
  it('accepts only the final exact, bounded and allowlisted helper marker', () => {
    expect(extract('diagnostic\nBRQ_PREPARE_FAILED code=INLINE_ACTIVE_CONTENT\n')).toBe(
      'INLINE_ACTIVE_CONTENT',
    );
    expect(
      extract('BRQ_PREPARE_FAILED code=UNKNOWN_SPOOF\nBRQ_PREPARE_FAILED code=NO_TEST_FILES'),
    ).toBe('NO_TEST_FILES');
  });

  it.each([
    ['spoof after marker', 'BRQ_PREPARE_FAILED code=NO_TEST_FILES\ngenerated-code says success'],
    ['embedded marker', 'prefix BRQ_PREPARE_FAILED code=NO_TEST_FILES'],
    ['wrong step', 'BRQ_TEST_FAILED code=NO_TEST_FILES'],
    ['unknown code', 'BRQ_PREPARE_FAILED code=MODEL_SAYS_DELETE_ALL'],
    ['path payload', 'BRQ_PREPARE_FAILED code=/private/tmp/secret'],
    ['arbitrary text', 'BRQ_PREPARE_FAILED code=NO_TEST_FILES details=generated'],
    ['oversized marker', `BRQ_PREPARE_FAILED code=${'A'.repeat(110)}`],
  ])('degrades %s to null', (_name, stderr) => {
    expect(extract(stderr)).toBeNull();
  });

  it('requires an exact known policy and a code allowlisted for the current step', () => {
    expect(extract('BRQ_BUILD_FAILED code=BUILD_EMIT', 'BUILD')).toBe('BUILD_EMIT');
    expect(extract('BRQ_PREPARE_FAILED code=BUILD_EMIT')).toBeNull();
    expect(
      extractSandboxHelperReasonCode({
        policyId: 'UNKNOWN_POLICY',
        stepId: 'PREPARE',
        stderr: 'BRQ_PREPARE_FAILED code=NO_TEST_FILES',
      }),
    ).toBeNull();
  });
});
