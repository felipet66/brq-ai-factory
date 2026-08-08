import { calculateCanonicalJsonHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';

export interface CodeGeneratorAssetHashReference {
  readonly id: string;
  readonly version: string;
  readonly hash: string;
}

export interface CodeGeneratorAssetBundleHashInput {
  readonly manifest: CodeGeneratorAssetHashReference;
  readonly template: CodeGeneratorAssetHashReference;
  readonly ruleSets: readonly CodeGeneratorAssetHashReference[];
  readonly outputContract: CodeGeneratorAssetHashReference;
  readonly validationContract: CodeGeneratorAssetHashReference;
}

export function calculateCodeGeneratorAssetBundleHash(
  input: CodeGeneratorAssetBundleHashInput,
): string {
  return calculateCanonicalJsonHash({
    manifest: input.manifest,
    assets: [
      { kind: 'TEMPLATE', ...input.template },
      ...input.ruleSets.map((ruleSet) => ({ kind: 'RULE_SET', ...ruleSet })),
      { kind: 'OUTPUT_CONTRACT', ...input.outputContract },
      { kind: 'VALIDATION_CONTRACT', ...input.validationContract },
    ],
  } as unknown as JsonValue);
}
