import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json';
import { immutableClone } from './immutability';
import { calculateFactoryExecutionProfileHash } from './profile';
import {
  factoryExecutionProfileSchema,
  generationProfileConstraintsSchema,
  sandboxExecutionProfileSnapshotSchema,
  type FactoryExecutionProfile,
  type GenerationProfileConstraints,
  type SandboxExecutionProfileSnapshot,
} from './schemas';

function domainHash(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(`${domain}\u0000${canonicalJson(value)}`)
    .digest('hex');
}

const RELATIVE_REFERENCE_POLICY = Object.freeze({
  trimWhitespace: true,
  requireNonEmpty: true,
  forbiddenLeadingSchemePattern: '^[A-Za-z][A-Za-z0-9+.-]*:',
  forbiddenLeadingSchemeCaseInsensitive: true,
  forbidLeadingDoubleSlash: true,
  forbidLeadingSlash: true,
  forbidLeadingHash: true,
  forbidBackslash: true,
  forbidParentTraversalSegment: true,
  parentTraversalScope: 'PATH_BEFORE_FIRST_QUERY_OR_FRAGMENT',
});

const RELATIVE_REFERENCE_REQUIREMENT =
  'Trim each reference before validation. The trimmed reference MUST be non-empty; MUST NOT begin with a URI scheme matching ^[A-Za-z][A-Za-z0-9+.-]*: case-insensitively, //, /, or #; MUST NOT contain a backslash; and its path before the first ? or # MUST NOT contain a complete .. segment.';

export function projectGenerationProfileConstraints(
  rawProfile: FactoryExecutionProfile,
): GenerationProfileConstraints {
  const profile = factoryExecutionProfileSchema.parse(rawProfile);
  const rules = [
    {
      id: profile.files.rule.ruleId,
      requirement:
        'Every files[].path MUST satisfy pathPolicy, MUST end in an allowedExtensions value, MUST NOT end in a forbiddenExtensions value, and mediaType MUST equal the mediaTypes value for that extension.',
      parameters: {
        allowedExtensions: profile.files.allowedExtensions,
        forbiddenExtensions: profile.files.forbiddenExtensions,
        mediaTypes: profile.files.mediaTypes,
        pathPolicy: profile.files.pathPolicy,
      },
    },
    {
      id: profile.files.requiredFilesRule.ruleId,
      requirement: 'Every path listed in files MUST exist exactly once in the generated bundle.',
      parameters: { files: profile.files.requiredFiles },
    },
    {
      id: profile.sourceDiscovery.rule.ruleId,
      requirement:
        'When required is true, the bundle MUST contain at least one source file ending in an extensions value and MUST ignore paths ending in excludedSuffixes for this requirement.',
      parameters: {
        extensions: profile.sourceDiscovery.extensions,
        excludedSuffixes: profile.sourceDiscovery.excludedSuffixes,
        required: profile.sourceDiscovery.required,
      },
    },
    {
      id: profile.testDiscovery.rule.ruleId,
      requirement:
        'When required is true, the bundle MUST contain at least one file whose path ends exactly in one of the supplied suffixes. A bundle without such a file is invalid.',
      parameters: {
        suffixes: profile.testDiscovery.suffixes,
        required: profile.testDiscovery.required,
      },
    },
    {
      id: profile.modulePolicy.formatRule.ruleId,
      requirement: 'Generated modules MUST use exactly the supplied format.',
      parameters: { format: profile.modulePolicy.format },
    },
    {
      id: profile.modulePolicy.importRule.ruleId,
      requirement:
        'Relative module imports MUST use one of relativeExtensions. Bare imports are forbidden except for test files using a value listed in testBareImports. An allowed bare import grants only the exact test API surface supplied by the TypeScript compatibility rule, never unlisted exports, hooks or members.',
      parameters: {
        relativeExtensions: profile.modulePolicy.relativeImportExtensions,
        testBareImports: profile.modulePolicy.allowedTestBareImports,
      },
    },
    {
      id: 'build.typescript-zero-diagnostics',
      requirement:
        'Every generated .ts and .js source or test file MUST produce exactly zero TypeScript diagnostics under the supplied buildSemantics. When strict, allowJavaScript and checkJavaScript are true, JavaScript is strictly type-checked: every parameter MUST have an inferred type or JSDoc, nullable DOM results MUST be narrowed before use, and tests MUST use only the exact supplied API surface. Unlisted test exports, hooks and assertion members are forbidden. Verify the complete bundle before emitting the final JSON.',
      parameters: profile.buildSemantics.typeCheck,
    },
    {
      id: profile.packagePolicy.rule.ruleId,
      requirement:
        'If the package file is generated, it MUST use the supplied type and MUST obey the dependencies and scripts policies exactly.',
      parameters: {
        path: profile.packagePolicy.path,
        type: profile.packagePolicy.type,
        dependencies: profile.packagePolicy.dependencies,
        scripts: profile.packagePolicy.scripts,
      },
    },
    {
      id: profile.contentRules.html.elementsRule.ruleId,
      requirement: 'HTML content MUST NOT contain any element listed in forbidden.',
      parameters: { forbidden: profile.contentRules.html.forbiddenElements },
    },
    {
      id: profile.contentRules.html.inlineActiveRule.ruleId,
      requirement:
        'HTML content MUST obey the supplied forbidden attributes, attribute prefixes, inline script and style element flags.',
      parameters: {
        forbiddenAttributes: profile.contentRules.html.forbiddenAttributes,
        forbiddenAttributePrefixes: profile.contentRules.html.forbiddenAttributePrefixes,
        forbidInlineScript: profile.contentRules.html.forbidInlineScript,
        forbidStyleElement: profile.contentRules.html.forbidStyleElement,
      },
    },
    {
      id: profile.contentRules.html.referencesRule.ruleId,
      requirement: `Every HTML reference in the supplied attributes MUST obey the supplied reference policy. ${RELATIVE_REFERENCE_REQUIREMENT}`,
      parameters: {
        attributes: profile.contentRules.html.referenceAttributes,
        policy: 'RELATIVE_ONLY',
        relativeReferencePolicy: RELATIVE_REFERENCE_POLICY,
      },
    },
    {
      id: profile.contentRules.css.importRule.ruleId,
      requirement: 'CSS @import MUST be absent when forbidden is true.',
      parameters: { forbidden: profile.contentRules.css.forbidImport },
    },
    {
      id: profile.contentRules.css.urlsRule.ruleId,
      requirement: `Every CSS url() reference MUST be relative when relativeOnly is true. ${RELATIVE_REFERENCE_REQUIREMENT}`,
      parameters: {
        relativeOnly: profile.contentRules.css.relativeUrlsOnly,
        relativeReferencePolicy: RELATIVE_REFERENCE_POLICY,
      },
    },
    {
      id: profile.contentRules.javaScript.capabilitiesRule.ruleId,
      requirement: 'JavaScript content MUST NOT use any capability listed in forbidden.',
      parameters: { forbidden: profile.contentRules.javaScript.forbiddenCapabilities },
    },
    {
      id: profile.contentRules.javaScript.referencesRule.ruleId,
      requirement: `JavaScript imports and fetch references MUST obey the supplied relative-only flags. ${RELATIVE_REFERENCE_REQUIREMENT} If sibling modules would require a .. segment, generate a shared or root-level composition module so every import remains permitted without parent traversal. Verify this condition before emitting the final bundle JSON.`,
      parameters: {
        relativeImportsOnly: profile.contentRules.javaScript.relativeImportsOnly,
        relativeFetchOnly: profile.contentRules.javaScript.relativeFetchOnly,
        relativeReferencePolicy: RELATIVE_REFERENCE_POLICY,
        siblingModuleComposition: 'ROOT_OR_SHARED_MODULE_WITHOUT_PARENT_TRAVERSAL',
      },
    },
    {
      id: profile.contentRules.json.rule.ruleId,
      requirement: 'Every JSON file MUST parse successfully when parseRequired is true.',
      parameters: { parseRequired: profile.contentRules.json.parseRequired },
    },
  ];
  const projectionWithoutHash = {
    projectionVersion: '1.3.0' as const,
    profile: profile.identity,
    rules,
    buildSemantics: profile.buildSemantics,
    previewProjection: profile.previewProjection,
  };
  return immutableClone(
    generationProfileConstraintsSchema.parse({
      ...projectionWithoutHash,
      generationProjectionHash: domainHash(
        'brq-factory-execution-profile:generation-projection:v4',
        projectionWithoutHash,
      ),
    }),
  );
}

export function projectSandboxExecutionProfileSnapshot(
  rawProfile: FactoryExecutionProfile,
): SandboxExecutionProfileSnapshot {
  const profile = factoryExecutionProfileSchema.parse(rawProfile);
  const rules = {
    files: profile.files,
    sourceDiscovery: profile.sourceDiscovery,
    testDiscovery: profile.testDiscovery,
    modulePolicy: profile.modulePolicy,
    packagePolicy: profile.packagePolicy,
    contentRules: profile.contentRules,
    buildSemantics: profile.buildSemantics,
    previewProjection: profile.previewProjection,
  };
  const snapshotWithoutHash = {
    snapshotVersion: '1.1.0' as const,
    profileId: profile.identity.profileId,
    profileVersion: profile.identity.version,
    profileHash: profile.identity.profileHash,
    rules,
    publicReasonCodes: profile.publicReasonCodes,
  };
  return immutableClone(
    sandboxExecutionProfileSnapshotSchema.parse({
      ...snapshotWithoutHash,
      snapshotHash: domainHash(
        'brq-factory-execution-profile:sandbox-snapshot:v2',
        snapshotWithoutHash,
      ),
    }),
  );
}

export function assertFactoryExecutionProfilePreflight(input: {
  readonly profile: FactoryExecutionProfile;
  readonly sandboxPolicyId: string;
  readonly sandboxPolicyVersion: string;
  readonly sandboxProfileSnapshotHash: string;
}): {
  readonly generation: GenerationProfileConstraints;
  readonly sandbox: SandboxExecutionProfileSnapshot;
} {
  const profile = factoryExecutionProfileSchema.parse(input.profile);
  const identity = {
    profileId: profile.identity.profileId,
    version: profile.identity.version,
    contractVersion: profile.identity.contractVersion,
  };
  const expectedProfileHash = calculateFactoryExecutionProfileHash({
    ...profile,
    identity,
  });
  const generation = projectGenerationProfileConstraints(profile);
  const sandbox = projectSandboxExecutionProfileSnapshot(profile);
  if (
    profile.identity.profileHash !== expectedProfileHash ||
    profile.sandbox.policyId !== input.sandboxPolicyId ||
    profile.sandbox.policyVersion !== input.sandboxPolicyVersion ||
    sandbox.snapshotHash !== input.sandboxProfileSnapshotHash
  ) {
    throw new TypeError('Factory Execution Profile e Sandbox não estão correlacionados.');
  }
  return immutableClone({ generation, sandbox });
}
