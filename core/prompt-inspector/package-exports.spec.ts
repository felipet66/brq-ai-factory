import { describe, expect, it } from 'vitest';

import * as publicApi from './index';

describe('prompt inspector package exports', () => {
  it('exports the transport-neutral facade, contracts, schemas and fixed metadata', () => {
    expect(publicApi.createPromptInspector).toBeTypeOf('function');
    expect(publicApi.promptInspectionPreviewRequestSchema).toBeDefined();
    expect(publicApi.promptInspectionValidationResultSchema).toBeDefined();
    expect(publicApi.PROMPT_INSPECTION_STAGES).toHaveLength(7);
    expect(publicApi.PROMPT_INSPECTOR_RETENTION).toBe('EPHEMERAL');
  });
});
