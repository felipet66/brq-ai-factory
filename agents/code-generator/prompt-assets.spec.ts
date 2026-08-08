import { calculateCanonicalJsonHash } from '@brq/prompt-builder';
import type { JsonValue } from '@brq/shared/types/json-value';
import { describe, expect, it } from 'vitest';

import rawCodeGeneratorRules from '../../prompts/code-generator/1.0.0/code-generator-rules.json' with { type: 'json' };
import rawGlobalRules from '../../prompts/code-generator/1.0.0/global-rules.json' with { type: 'json' };
import rawManifest from '../../prompts/code-generator/1.0.0/manifest.json' with { type: 'json' };
import rawOutputContract from '../../prompts/code-generator/1.0.0/output-contract.json' with { type: 'json' };
import rawSecurityRules from '../../prompts/code-generator/1.0.0/security-rules.json' with { type: 'json' };
import rawTemplate from '../../prompts/code-generator/1.0.0/template.json' with { type: 'json' };
import {
  CodeGeneratorPromptAssetsError,
  loadCodeGeneratorPromptAssets,
  parseCodeGeneratorPromptAssets,
  validateCodeGeneratorPromptAssets,
  type CodeGeneratorPromptAssetSources,
} from './prompt-assets';

const RELEASE_HASH = 'df968b649b607d7bd7c34ad05f4e7f2d1bb22880aab8582250ecffc443c88504';

function sources(): CodeGeneratorPromptAssetSources {
  return structuredClone({
    manifest: rawManifest,
    template: rawTemplate,
    globalRules: rawGlobalRules,
    securityRules: rawSecurityRules,
    codeGeneratorRules: rawCodeGeneratorRules,
    outputContract: rawOutputContract,
  });
}

interface MutablePromptManifest {
  assets: {
    template: { id: string; filename: string };
    ruleSets: Array<{ id: string; filename: string }>;
  };
  contexts: { knowledge: string; technicalSpecification: string };
}

function mutableManifest(): MutablePromptManifest {
  return structuredClone(rawManifest) as unknown as MutablePromptManifest;
}

function strictObjectSchemaViolations(value: unknown, path = '$'): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      strictObjectSchemaViolations(entry, `${path}[${index}]`),
    );
  }
  if (value === null || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const violations: string[] = [];
  if (record['type'] === 'object') {
    const properties = record['properties'];
    const names =
      properties !== null && typeof properties === 'object' && !Array.isArray(properties)
        ? Object.keys(properties)
        : [];
    const required = Array.isArray(record['required']) ? record['required'] : [];
    if (record['additionalProperties'] !== false) violations.push(`${path}.additionalProperties`);
    if (required.length !== names.length || names.some((name) => !required.includes(name))) {
      violations.push(`${path}.required`);
    }
  }
  return [
    ...violations,
    ...Object.entries(record).flatMap(([key, nested]) =>
      strictObjectSchemaViolations(nested, `${path}.${key}`),
    ),
  ];
}

describe('Code Generator prompt assets', () => {
  it('loads one immutable and deterministic 1.0.0 bundle', () => {
    const bundle = loadCodeGeneratorPromptAssets();

    expect(bundle.manifest).toMatchObject({
      id: 'assets:code-generator',
      version: '1.0.0',
      schemaVersion: '1.0.0',
      agent: 'CODE_GENERATOR',
      contexts: {
        knowledge: 'context:code-generator-knowledge',
        technicalSpecification: 'context:code-generator-technical-specification',
      },
    });
    expect(bundle.hashes.bundleHash).toBe(RELEASE_HASH);
    expect(bundle.validationContract).toMatchObject({
      id: bundle.outputContract.id,
      version: bundle.outputContract.version,
      format: 'JSON_SCHEMA',
      expectedOutputContractHash: bundle.hashes.outputContractHash,
    });
    expect(loadCodeGeneratorPromptAssets()).toBe(bundle);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.ruleSets)).toBe(true);
    expect(Object.isFrozen(bundle.outputContract.schema)).toBe(true);
  });

  it('pins every asset hash and the exact release bundle hash', () => {
    const first = parseCodeGeneratorPromptAssets(sources());
    const second = parseCodeGeneratorPromptAssets(sources());

    expect(first.hashes).toEqual(second.hashes);
    expect(first.hashes.bundleHash).toBe(RELEASE_HASH);
    expect(first.hashes.manifestHash).toBe(
      calculateCanonicalJsonHash(rawManifest as unknown as JsonValue),
    );
    expect(Object.values(first.hashes).flat()).not.toContain(expect.stringContaining('sha256:'));
  });

  it('keeps every JSON Schema object closed and required for strict Structured Outputs', () => {
    const schema = loadCodeGeneratorPromptAssets().outputContract.schema;
    expect(strictObjectSchemaViolations(schema)).toEqual([]);
  });

  it('keeps the model output restricted to files and entrypoints without authoritative metadata', () => {
    const contract = loadCodeGeneratorPromptAssets().outputContract;
    const schema = contract.schema as Record<string, unknown>;
    const serializedSchema = JSON.stringify(schema);

    expect(Object.keys(schema['properties'] as object)).toEqual(['files', 'entrypoints']);
    expect(serializedSchema).not.toMatch(
      /bundleHash|generationHash|lineage|provenance|contentHash/,
    );
    expect(contract.instructions.join(' ')).toContain('ao menos um entrypoint');
  });

  it('states trust, safe paths, source references, CREATE coverage and byte ceilings normatively', () => {
    const rules = [...rawSecurityRules.rules, ...rawCodeGeneratorRules.rules]
      .map((rule) => rule.content)
      .join('\n');

    expect(rules).toContain('dados não confiáveis');
    expect(rules).toContain('MUST NOT gerar .env');
    expect(rules).toContain('Todo Module com changeType CREATE MUST');
    expect(rules).toContain('sourcePlanItemIds');
    expect(rules).toContain('65536 bytes UTF-8');
    expect(rules).toContain('ao menos um entrypoint');
  });

  it('rejects asset drift, wiring changes and forged injected hashes', () => {
    const changedRules = structuredClone(rawCodeGeneratorRules);
    changedRules.rules[0]!.content = 'drift';
    expect(() =>
      parseCodeGeneratorPromptAssets({ ...sources(), codeGeneratorRules: changedRules }),
    ).toThrow(CodeGeneratorPromptAssetsError);

    const changedTemplate = structuredClone(rawTemplate);
    changedTemplate.sections[0]!.blocks[0]!.fragments[0] = {
      id: 'global-rules:slot',
      type: 'RULE_SET_SLOT',
      ruleSetId: 'rules:code-generator-security',
    };
    changedTemplate.sections[1]!.blocks[0]!.fragments[0] = {
      id: 'security-rules:slot',
      type: 'RULE_SET_SLOT',
      ruleSetId: 'rules:code-generator-global',
    };
    expect(() =>
      parseCodeGeneratorPromptAssets({ ...sources(), template: changedTemplate }),
    ).toThrow(CodeGeneratorPromptAssetsError);

    const loaded = structuredClone(loadCodeGeneratorPromptAssets()) as unknown as {
      hashes: { bundleHash: string };
    };
    loaded.hashes.bundleHash = '0'.repeat(64);
    expect(() => validateCodeGeneratorPromptAssets(loaded)).toThrow(CodeGeneratorPromptAssetsError);
  });

  it('rejects duplicate manifest identities, filenames and context bindings', () => {
    const duplicateId = mutableManifest();
    duplicateId.assets.ruleSets[0]!.id = duplicateId.assets.template.id;

    const duplicateFilename = mutableManifest();
    duplicateFilename.assets.ruleSets[0]!.filename = duplicateFilename.assets.template.filename;

    const duplicateContext = mutableManifest();
    duplicateContext.contexts.technicalSpecification = duplicateContext.contexts.knowledge;

    for (const manifest of [duplicateId, duplicateFilename, duplicateContext]) {
      expect(() => parseCodeGeneratorPromptAssets({ ...sources(), manifest })).toThrow(
        CodeGeneratorPromptAssetsError,
      );
    }
  });

  it('rejects a structurally valid TEXT output contract and malformed injected bundles', () => {
    const textContract = {
      id: rawOutputContract.id,
      version: rawOutputContract.version,
      format: 'TEXT',
      instructions: rawOutputContract.instructions,
    } as const;

    expect(() =>
      parseCodeGeneratorPromptAssets({ ...sources(), outputContract: textContract }),
    ).toThrow(CodeGeneratorPromptAssetsError);
    expect(() => validateCodeGeneratorPromptAssets({})).toThrow(CodeGeneratorPromptAssetsError);
  });
});
