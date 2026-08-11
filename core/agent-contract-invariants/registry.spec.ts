import { readFile } from 'node:fs/promises';

import { CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES } from '@brq/code-generator-agent';
import { DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES } from '@brq/developer-agent';
import {
  FACTORY_EXECUTION_PROFILE_REASON_CODES,
  FACTORY_EXECUTION_PROFILE_RULE_IDS,
  NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE,
} from '@brq/factory-execution-profile';
import { PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES } from '@brq/product-owner-agent';
import { QA_BUSINESS_VALIDATION_ISSUE_CODES } from '@brq/qa-agent';
import { describe, expect, it } from 'vitest';

import codeGeneratorRules from '../../prompts/code-generator/1.0.4/code-generator-rules.json' with { type: 'json' };
import codeGeneratorManifest from '../../prompts/code-generator/1.0.4/manifest.json' with { type: 'json' };
import developerRules from '../../prompts/developer/1.0.3/developer-rules.json' with { type: 'json' };
import developerManifest from '../../prompts/developer/1.0.3/manifest.json' with { type: 'json' };
import productOwnerRules from '../../prompts/product-owner/1.0.1/product-owner-rules.json' with { type: 'json' };
import productOwnerManifest from '../../prompts/product-owner/1.0.1/manifest.json' with { type: 'json' };
import qaRules from '../../prompts/qa/1.0.4/qa-rules.json' with { type: 'json' };
import qaManifest from '../../prompts/qa/1.0.4/manifest.json' with { type: 'json' };
import {
  AGENT_CONTRACT_INVARIANT_CATALOG,
  findAgentContractInvariant,
  listAgentContractInvariants,
} from './index';

const EXPECTED_CODES = {
  PRODUCT_OWNER: Object.values(PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES),
  DEVELOPER: Object.values(DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES),
  QA: Object.values(QA_BUSINESS_VALIDATION_ISSUE_CODES),
  CODE_GENERATOR: Object.values(CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES),
  FACTORY_EXECUTION_PROFILE: Object.values(FACTORY_EXECUTION_PROFILE_RULE_IDS),
} as const;

const PROMPT_ASSETS = {
  PRODUCT_OWNER: { manifest: productOwnerManifest, rules: productOwnerRules.rules },
  DEVELOPER: { manifest: developerManifest, rules: developerRules.rules },
  QA: { manifest: qaManifest, rules: qaRules.rules },
  CODE_GENERATOR: { manifest: codeGeneratorManifest, rules: codeGeneratorRules.rules },
} as const;

describe('Agent Contract Invariant Catalog', () => {
  it('covers every authoritative Business Validation and profile rule exactly once', () => {
    for (const [layer, expectedCodes] of Object.entries(EXPECTED_CODES)) {
      expect(
        listAgentContractInvariants(layer as keyof typeof EXPECTED_CODES).map(({ code }) => code),
      ).toHaveLength(expectedCodes.length);
      expect(
        [
          ...listAgentContractInvariants(layer as keyof typeof EXPECTED_CODES).map(
            ({ code }) => code,
          ),
        ].sort(),
      ).toEqual([...expectedCodes].sort());
    }
    expect(
      new Set(
        AGENT_CONTRACT_INVARIANT_CATALOG.invariants.map(({ layer, code }) => `${layer}:${code}`),
      ).size,
    ).toBe(AGENT_CONTRACT_INVARIANT_CATALOG.invariants.length);
  });

  it('binds prompt coverage to immutable active bundle versions and real rule IDs', () => {
    for (const contract of AGENT_CONTRACT_INVARIANT_CATALOG.promptContracts) {
      const assets = PROMPT_ASSETS[contract.layer];
      expect(assets.manifest.version).toBe(contract.bundleVersion);
      const ruleIds = assets.rules.map(({ id }) => id);
      expect(ruleIds).toEqual(expect.arrayContaining([...contract.requiredRuleIds]));
    }
  });

  it('binds every Factory Profile rule and every public reason code to the active profile', () => {
    expect(
      AGENT_CONTRACT_INVARIANT_CATALOG.factoryProfile.rules.map(({ ruleId }) => ruleId).sort(),
    ).toEqual(Object.values(FACTORY_EXECUTION_PROFILE_RULE_IDS).sort());
    const publicReasonCodes = new Set(
      AGENT_CONTRACT_INVARIANT_CATALOG.factoryProfile.publicReasonCodes,
    );
    expect(publicReasonCodes).toEqual(
      new Set(Object.values(NODE_WEB_PREVIEW_24_V1_EXECUTION_PROFILE.publicReasonCodes).flat()),
    );
    expect([...publicReasonCodes]).toEqual(
      expect.arrayContaining(Object.values(FACTORY_EXECUTION_PROFILE_REASON_CODES)),
    );
    expect(
      AGENT_CONTRACT_INVARIANT_CATALOG.factoryProfile.rules.every(({ reasonCode }) =>
        AGENT_CONTRACT_INVARIANT_CATALOG.factoryProfile.publicReasonCodes.includes(reasonCode),
      ),
    ).toBe(true);
  });

  it('classifies derived, relational, structural and profile-owned invariants explicitly', () => {
    expect(
      findAgentContractInvariant('QA', QA_BUSINESS_VALIDATION_ISSUE_CODES.READINESS_MISMATCH),
    ).toMatchObject({
      classifications: ['SYSTEM_DERIVED', 'REDUNDANT'],
      authoritativeOwner: 'BACKEND_DERIVATION',
    });
    expect(
      findAgentContractInvariant(
        'CODE_GENERATOR',
        CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.MODULE_PATH_MISMATCH,
      ),
    ).toMatchObject({
      classifications: ['CROSS_REFERENCE'],
      authoritativeOwner: 'BUSINESS_VALIDATION',
    });
    expect(
      findAgentContractInvariant(
        'PRODUCT_OWNER',
        PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.INVALID_SPECIFICATION_STRUCTURE,
      ),
    ).toMatchObject({ classifications: ['STRUCTURAL'], authoritativeOwner: 'SCHEMA' });
    expect(
      findAgentContractInvariant(
        'FACTORY_EXECUTION_PROFILE',
        FACTORY_EXECUTION_PROFILE_RULE_IDS.TEST_REQUIRED,
      ),
    ).toMatchObject({
      classifications: ['PROFILE_CONSTRAINT'],
      authoritativeOwner: 'EXECUTION_PROFILE',
    });
  });

  it('is deterministic, deeply immutable and isolated from prompt assets in production', async () => {
    expect(AGENT_CONTRACT_INVARIANT_CATALOG.catalogVersion).toBe('1.0.0');
    expect(Object.isFrozen(AGENT_CONTRACT_INVARIANT_CATALOG)).toBe(true);
    expect(Object.isFrozen(AGENT_CONTRACT_INVARIANT_CATALOG.invariants)).toBe(true);
    expect(Object.isFrozen(AGENT_CONTRACT_INVARIANT_CATALOG.invariants[0])).toBe(true);
    expect(listAgentContractInvariants()).toBe(AGENT_CONTRACT_INVARIANT_CATALOG.invariants);

    const source = await readFile(new URL('./registry.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/prompts\/|node:fs|openai|docker|prisma/iu);
  });
});
