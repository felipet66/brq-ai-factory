import { z } from 'zod';

const HASH = /^[a-f0-9]{64}$/u;
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+$/u;
const PROFILE_ID = /^[A-Z][A-Z0-9_]{2,63}$/u;
const FILE_EXTENSION = /^\.[a-z0-9]+$/u;
const SAFE_PROFILE_PATH = /^[A-Za-z0-9._/-]+$/u;
const RULE_ID = /^[a-z][a-z0-9.-]{2,95}$/u;
const REASON_CODE = /^[A-Z][A-Z0-9_]{1,63}$/u;
const browserCapabilitySchema = z.enum([
  'EventSource',
  'SharedWorker',
  'WebSocket',
  'Worker',
  'eval',
  'importScripts',
  'navigator.sendBeacon',
  'navigator.serviceWorker',
  'new Function',
]);

export const FACTORY_EXECUTION_PROFILE_RULE_IDS = Object.freeze({
  FILES: 'files.allowed-and-media-types',
  SOURCE_REQUIRED: 'source.required',
  TEST_REQUIRED: 'test.required',
  REQUIRED_FILES: 'files.required',
  MODULE_FORMAT: 'module.esm-only',
  IMPORT_POLICY: 'module.import-policy',
  PACKAGE_POLICY: 'package.no-scripts-or-dependencies',
  HTML_ELEMENTS: 'content.html.forbidden-elements',
  HTML_INLINE_ACTIVE: 'content.html.no-inline-active-content',
  HTML_REFERENCES: 'content.html.relative-references',
  CSS_IMPORT: 'content.css.no-import',
  CSS_URLS: 'content.css.relative-urls',
  JAVASCRIPT_CAPABILITIES: 'content.javascript.forbidden-capabilities',
  JAVASCRIPT_REFERENCES: 'content.javascript.relative-references',
  JSON_VALID: 'content.json.valid',
} as const);

export const FACTORY_EXECUTION_PROFILE_REASON_CODES = Object.freeze({
  UNSUPPORTED_SOURCE_PROFILE: 'UNSUPPORTED_SOURCE_PROFILE',
  NO_SUPPORTED_SOURCE: 'NO_SUPPORTED_SOURCE',
  NO_TEST_FILES: 'NO_TEST_FILES',
  INDEX_HTML_REQUIRED: 'INDEX_HTML_REQUIRED',
  DEPENDENCY_UNSUPPORTED: 'DEPENDENCY_UNSUPPORTED',
  PACKAGE_JSON: 'PACKAGE_JSON',
  PACKAGE_POLICY: 'PACKAGE_POLICY',
  UNSUPPORTED_HTML: 'UNSUPPORTED_HTML',
  INLINE_ACTIVE_CONTENT: 'INLINE_ACTIVE_CONTENT',
  EXTERNAL_OR_UNSAFE_REFERENCE: 'EXTERNAL_OR_UNSAFE_REFERENCE',
  UNSUPPORTED_CSS: 'UNSUPPORTED_CSS',
  UNSUPPORTED_BROWSER_CAPABILITY: 'UNSUPPORTED_BROWSER_CAPABILITY',
  INVALID_JSON: 'INVALID_JSON',
} as const);

const ruleIdSchema = z.string().regex(RULE_ID);
export const factoryExecutionProfileReasonCodeSchema = z.string().regex(REASON_CODE);

const reasonRuleSchema = z
  .object({
    ruleId: ruleIdSchema,
    reasonCode: factoryExecutionProfileReasonCodeSchema,
  })
  .strict();

const uniqueStrings = <Schema extends z.ZodType<string>>(schema: Schema, maximum: number) =>
  z
    .array(schema)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, 'Os valores devem ser únicos.');

export const factoryExecutionProfileDescriptorSchema = z
  .object({
    identity: z
      .object({
        profileId: z.string().regex(PROFILE_ID),
        version: z.string().regex(SEMANTIC_VERSION),
        contractVersion: z.string().regex(SEMANTIC_VERSION),
      })
      .strict(),
    files: z
      .object({
        pathPolicy: z.literal('ASCII_PORTABLE'),
        allowedExtensions: uniqueStrings(z.string().regex(FILE_EXTENSION), 32).min(1),
        forbiddenExtensions: uniqueStrings(z.string().regex(FILE_EXTENSION), 32),
        requiredFiles: uniqueStrings(z.string().regex(SAFE_PROFILE_PATH), 16),
        mediaTypes: z.record(z.string().regex(FILE_EXTENSION), z.string().trim().min(1).max(128)),
        rule: reasonRuleSchema,
        requiredFilesRule: reasonRuleSchema,
      })
      .strict(),
    sourceDiscovery: z
      .object({
        extensions: uniqueStrings(z.string().regex(FILE_EXTENSION), 8).min(1),
        excludedSuffixes: uniqueStrings(z.string().min(2).max(64), 8),
        required: z.literal(true),
        rule: reasonRuleSchema,
      })
      .strict(),
    testDiscovery: z
      .object({
        suffixes: uniqueStrings(z.string().min(2).max(64), 8).min(1),
        required: z.literal(true),
        rule: reasonRuleSchema,
      })
      .strict(),
    modulePolicy: z
      .object({
        format: z.literal('ESM'),
        relativeImportExtensions: uniqueStrings(z.string().regex(FILE_EXTENSION), 8).min(1),
        allowedTestBareImports: uniqueStrings(z.string().trim().min(1).max(128), 16),
        formatRule: reasonRuleSchema,
        importRule: reasonRuleSchema,
      })
      .strict(),
    packagePolicy: z
      .object({
        path: z.literal('package.json'),
        type: z.literal('module'),
        dependencies: z.literal('FORBIDDEN'),
        scripts: z.literal('FORBIDDEN'),
        rule: reasonRuleSchema,
        invalidJsonReasonCode: factoryExecutionProfileReasonCodeSchema,
      })
      .strict(),
    contentRules: z
      .object({
        html: z
          .object({
            forbiddenElements: uniqueStrings(z.string().regex(/^[a-z][a-z0-9-]*$/u), 32),
            forbiddenAttributes: uniqueStrings(z.string().regex(/^[a-z][a-z0-9-]*$/u), 16),
            forbiddenAttributePrefixes: uniqueStrings(z.string().regex(/^[a-z]+$/u), 8),
            forbidInlineScript: z.literal(true),
            forbidStyleElement: z.literal(true),
            referenceAttributes: uniqueStrings(z.string().regex(/^[a-z]+$/u), 16),
            elementsRule: reasonRuleSchema,
            inlineActiveRule: reasonRuleSchema,
            referencesRule: reasonRuleSchema,
          })
          .strict(),
        css: z
          .object({
            forbidImport: z.literal(true),
            relativeUrlsOnly: z.literal(true),
            importRule: reasonRuleSchema,
            urlsRule: reasonRuleSchema,
          })
          .strict(),
        javaScript: z
          .object({
            forbiddenCapabilities: uniqueStrings(browserCapabilitySchema, 32),
            relativeImportsOnly: z.literal(true),
            relativeFetchOnly: z.literal(true),
            capabilitiesRule: reasonRuleSchema,
            referencesRule: reasonRuleSchema,
          })
          .strict(),
        json: z
          .object({
            parseRequired: z.literal(true),
            rule: reasonRuleSchema,
          })
          .strict(),
      })
      .strict(),
    buildSemantics: z
      .object({
        runtime: z.literal('NODE'),
        runtimeVersion: z.string().regex(/^24\.\d+\.\d+$/u),
        typeScriptVersion: z.string().regex(SEMANTIC_VERSION),
        target: z.literal('ES2022'),
        module: z.literal('ES2022'),
        strict: z.literal(true),
        allowJavaScript: z.literal(true),
        checkJavaScript: z.literal(true),
        packageManager: z.literal('NONE'),
      })
      .strict(),
    previewProjection: z
      .object({
        requiredEntrypoint: z.literal('index.html'),
        staticExtensions: uniqueStrings(z.string().regex(FILE_EXTENSION), 16).min(1),
        testVisibility: z.literal('TEST'),
        applicationVisibility: z.literal('PREVIEW'),
      })
      .strict(),
    sandbox: z
      .object({
        policyId: z.string().regex(PROFILE_ID),
        policyVersion: z.string().regex(SEMANTIC_VERSION),
      })
      .strict(),
    publicReasonCodes: z
      .object({
        PREPARE: uniqueStrings(factoryExecutionProfileReasonCodeSchema, 64),
        TYPECHECK: uniqueStrings(factoryExecutionProfileReasonCodeSchema, 64),
        BUILD: uniqueStrings(factoryExecutionProfileReasonCodeSchema, 64),
        TEST: uniqueStrings(factoryExecutionProfileReasonCodeSchema, 64),
      })
      .strict(),
  })
  .strict()
  .superRefine((profile, context) => {
    const allowed = new Set(profile.files.allowedExtensions);
    for (const extension of profile.sourceDiscovery.extensions) {
      if (!allowed.has(extension)) {
        context.addIssue({
          code: 'custom',
          path: ['sourceDiscovery', 'extensions'],
          message: 'Extensões de source devem pertencer à allowlist.',
        });
      }
    }
    for (const extension of profile.files.forbiddenExtensions) {
      if (allowed.has(extension)) {
        context.addIssue({
          code: 'custom',
          path: ['files', 'forbiddenExtensions'],
          message: 'Uma extensão não pode ser permitida e proibida.',
        });
      }
    }
    const mediaTypeExtensions = Object.keys(profile.files.mediaTypes);
    if (
      mediaTypeExtensions.length !== allowed.size ||
      mediaTypeExtensions.some((extension) => !allowed.has(extension))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['files', 'mediaTypes'],
        message: 'Media types devem corresponder exatamente às extensões permitidas.',
      });
    }
    if (profile.identity.profileId !== profile.sandbox.policyId) {
      context.addIssue({
        code: 'custom',
        path: ['sandbox', 'policyId'],
        message: 'A policy do Sandbox deve corresponder ao execution profile.',
      });
    }
    const publicPrepare = new Set(profile.publicReasonCodes.PREPARE);
    const declaredRules = [
      profile.files.rule,
      profile.files.requiredFilesRule,
      profile.sourceDiscovery.rule,
      profile.testDiscovery.rule,
      profile.modulePolicy.formatRule,
      profile.modulePolicy.importRule,
      profile.packagePolicy.rule,
      profile.contentRules.html.elementsRule,
      profile.contentRules.html.inlineActiveRule,
      profile.contentRules.html.referencesRule,
      profile.contentRules.css.importRule,
      profile.contentRules.css.urlsRule,
      profile.contentRules.javaScript.capabilitiesRule,
      profile.contentRules.javaScript.referencesRule,
      profile.contentRules.json.rule,
    ];
    if (new Set(declaredRules.map((rule) => rule.ruleId)).size !== declaredRules.length) {
      context.addIssue({
        code: 'custom',
        path: ['files', 'rule'],
        message: 'Cada regra do execution profile deve possuir ID único.',
      });
    }
    for (const rule of declaredRules) {
      if (!publicPrepare.has(rule.reasonCode)) {
        context.addIssue({
          code: 'custom',
          path: ['publicReasonCodes', 'PREPARE'],
          message: `Reason code não público: ${rule.reasonCode}.`,
        });
      }
    }
    if (!publicPrepare.has(profile.packagePolicy.invalidJsonReasonCode)) {
      context.addIssue({
        code: 'custom',
        path: ['publicReasonCodes', 'PREPARE'],
        message: `Reason code não público: ${profile.packagePolicy.invalidJsonReasonCode}.`,
      });
    }
  });

export const factoryExecutionProfileSchema = factoryExecutionProfileDescriptorSchema.safeExtend({
  identity: factoryExecutionProfileDescriptorSchema.shape.identity.extend({
    profileHash: z.string().regex(HASH),
  }),
});

export const generationProfileConstraintsSchema = z
  .object({
    projectionVersion: z.literal('1.1.0'),
    profile: z
      .object({
        profileId: z.string().regex(PROFILE_ID),
        version: z.string().regex(SEMANTIC_VERSION),
        contractVersion: z.string().regex(SEMANTIC_VERSION),
        profileHash: z.string().regex(HASH),
      })
      .strict(),
    rules: z
      .array(
        z
          .object({
            id: ruleIdSchema,
            requirement: z.string().trim().min(1).max(768),
            parameters: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .min(1)
      .max(32),
    buildSemantics: factoryExecutionProfileDescriptorSchema.shape.buildSemantics,
    previewProjection: factoryExecutionProfileDescriptorSchema.shape.previewProjection,
    generationProjectionHash: z.string().regex(HASH),
  })
  .strict();

export const sandboxExecutionProfileSnapshotSchema = z
  .object({
    snapshotVersion: z.literal('1.0.0'),
    profileId: z.string().regex(PROFILE_ID),
    profileVersion: z.string().regex(SEMANTIC_VERSION),
    profileHash: z.string().regex(HASH),
    rules: z.record(z.string(), z.unknown()),
    publicReasonCodes: factoryExecutionProfileDescriptorSchema.shape.publicReasonCodes,
    snapshotHash: z.string().regex(HASH),
  })
  .strict();

export const factoryExecutionProfileValidationSchema = z
  .object({
    executionProfileId: z.string().regex(PROFILE_ID),
    executionProfileVersion: z.string().regex(SEMANTIC_VERSION),
    executionProfileHash: z.string().regex(HASH),
    generationProjectionHash: z.string().regex(HASH),
    bundleHash: z.string().regex(HASH),
    compatible: z.boolean(),
    issues: z
      .array(
        z
          .object({
            ruleId: ruleIdSchema,
            reasonCode: factoryExecutionProfileReasonCodeSchema,
          })
          .strict(),
      )
      .max(32),
    profileValidationHash: z.string().regex(HASH),
  })
  .strict()
  .superRefine((validation, context) => {
    if (validation.compatible !== (validation.issues.length === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['compatible'],
        message: 'Resultado inconsistente.',
      });
    }
  });

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type FactoryExecutionProfileDescriptor = DeepReadonly<
  z.infer<typeof factoryExecutionProfileDescriptorSchema>
>;
export type FactoryExecutionProfile = DeepReadonly<z.infer<typeof factoryExecutionProfileSchema>>;
export type GenerationProfileConstraints = DeepReadonly<
  z.infer<typeof generationProfileConstraintsSchema>
>;
export type SandboxExecutionProfileSnapshot = DeepReadonly<
  z.infer<typeof sandboxExecutionProfileSnapshotSchema>
>;
export type FactoryExecutionProfileValidation = DeepReadonly<
  z.infer<typeof factoryExecutionProfileValidationSchema>
>;
