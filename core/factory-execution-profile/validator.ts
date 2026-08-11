import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json';
import { immutableClone } from './immutability';
import { projectGenerationProfileConstraints } from './projections';
import {
  factoryExecutionProfileSchema,
  factoryExecutionProfileValidationSchema,
  type FactoryExecutionProfile,
  type FactoryExecutionProfileValidation,
} from './schemas';

const SAFE_PROFILE_PATH = /^[A-Za-z0-9._/-]+$/u;
const PACKAGE_POLICY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

export interface ExecutionProfileBundleFile {
  readonly path: string;
  readonly content: string;
  readonly mediaType: string;
}

export interface ExecutionProfileBundle {
  readonly bundleHash: string;
  readonly files: readonly ExecutionProfileBundleFile[];
}

export interface FactoryExecutionProfileValidator {
  readonly profile: FactoryExecutionProfile;
  readonly generationProjectionHash: string;
  validate(bundle: ExecutionProfileBundle): FactoryExecutionProfileValidation;
}

function domainHash(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(`${domain}\u0000${canonicalJson(value)}`)
    .digest('hex');
}

function extensionOf(filePath: string): string {
  const filename = filePath.split('/').at(-1) ?? filePath;
  const index = filename.lastIndexOf('.');
  return index <= 0 ? '' : filename.slice(index).toLowerCase();
}

function emptyRecord(value: unknown): boolean {
  return (
    value === undefined ||
    (value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  );
}

function importedSpecifiers(content: string): readonly string[] {
  const expressions = [
    /\bfrom\s+["']([^"']+)["']/gu,
    /\bimport\s+["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  return expressions.flatMap((expression) =>
    [...content.matchAll(expression)].map((match) => match[1]!),
  );
}

function relativeReference(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length > 0 &&
    !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/iu.test(normalized) &&
    !normalized.includes('\\') &&
    !normalized.split(/[?#]/u, 1)[0]!.split('/').includes('..')
  );
}

function usesBrowserCapability(content: string, capability: string): boolean {
  const expressions: Readonly<Record<string, RegExp>> = {
    EventSource: /\bEventSource\s*\(/u,
    SharedWorker: /\bSharedWorker\s*\(/u,
    WebSocket: /\bWebSocket\s*\(/u,
    Worker: /\bWorker\s*\(/u,
    eval: /\beval\s*\(/u,
    importScripts: /\bimportScripts\s*\(/u,
    'navigator.sendBeacon': /\bnavigator\.sendBeacon\s*\(/u,
    'navigator.serviceWorker': /\bnavigator\.serviceWorker\b/u,
    'new Function': /\bnew\s+Function\s*\(/u,
  };
  return expressions[capability]?.test(content) ?? false;
}

type Issue = FactoryExecutionProfileValidation['issues'][number];

export function createFactoryExecutionProfileValidator(
  rawProfile: FactoryExecutionProfile,
): FactoryExecutionProfileValidator {
  const profile = immutableClone(factoryExecutionProfileSchema.parse(rawProfile));
  const generationProjectionHash =
    projectGenerationProfileConstraints(profile).generationProjectionHash;
  const allowedExtensions = new Set(profile.files.allowedExtensions);
  const forbiddenExtensions = new Set(profile.files.forbiddenExtensions);
  const testSuffixes = profile.testDiscovery.suffixes;
  const sourceExtensions = new Set(profile.sourceDiscovery.extensions);

  return Object.freeze({
    profile,
    generationProjectionHash,
    validate(bundle: ExecutionProfileBundle): FactoryExecutionProfileValidation {
      if (!/^[a-f0-9]{64}$/u.test(bundle.bundleHash)) {
        throw new TypeError('bundleHash inválido para validação do execution profile.');
      }
      const issues = new Map<string, Issue>();
      const add = (ruleId: string, reasonCode: string): void => {
        if (!issues.has(ruleId)) issues.set(ruleId, { ruleId, reasonCode });
      };
      const paths = new Set(bundle.files.map((file) => file.path));

      for (const file of bundle.files) {
        const extension = extensionOf(file.path);
        if (
          !SAFE_PROFILE_PATH.test(file.path) ||
          forbiddenExtensions.has(extension) ||
          !allowedExtensions.has(extension) ||
          profile.files.mediaTypes[extension] !== file.mediaType
        ) {
          add(profile.files.rule.ruleId, profile.files.rule.reasonCode);
        }

        if (file.path.endsWith('.json')) {
          try {
            JSON.parse(file.content);
          } catch {
            add(profile.contentRules.json.rule.ruleId, profile.contentRules.json.rule.reasonCode);
          }
        }

        if (file.path === profile.packagePolicy.path) {
          let document: unknown;
          try {
            document = JSON.parse(file.content);
          } catch {
            add(profile.packagePolicy.rule.ruleId, profile.packagePolicy.invalidJsonReasonCode);
            continue;
          }
          if (document === null || typeof document !== 'object' || Array.isArray(document)) {
            add(profile.packagePolicy.rule.ruleId, profile.packagePolicy.rule.reasonCode);
          } else {
            const record = document as Record<string, unknown>;
            if (
              (record['type'] !== undefined && record['type'] !== profile.packagePolicy.type) ||
              !emptyRecord(record['scripts']) ||
              PACKAGE_POLICY_FIELDS.some((field) => !emptyRecord(record[field]))
            ) {
              add(profile.packagePolicy.rule.ruleId, profile.packagePolicy.rule.reasonCode);
            }
          }
        }

        const isSource = sourceExtensions.has(extension);
        const isTest = testSuffixes.some((suffix) => file.path.endsWith(suffix));
        if (isSource) {
          if (/\b(?:require\s*\(|module\.exports\b|exports\.[A-Za-z_$])/u.test(file.content)) {
            add(profile.modulePolicy.formatRule.ruleId, profile.modulePolicy.formatRule.reasonCode);
          }
          const allowedRelative = new Set(profile.modulePolicy.relativeImportExtensions);
          const allowedBare = new Set(profile.modulePolicy.allowedTestBareImports);
          if (
            importedSpecifiers(file.content).some((specifier) => {
              if (specifier.startsWith('./') || specifier.startsWith('../')) {
                return !allowedRelative.has(extensionOf(specifier));
              }
              return !isTest || !allowedBare.has(specifier);
            })
          ) {
            add(profile.modulePolicy.importRule.ruleId, profile.modulePolicy.importRule.reasonCode);
          }
        }

        if (file.path.endsWith('.html')) {
          const elements = profile.contentRules.html.forbiddenElements.join('|');
          if (new RegExp(`<(?:${elements})\\b`, 'iu').test(file.content)) {
            add(
              profile.contentRules.html.elementsRule.ruleId,
              profile.contentRules.html.elementsRule.reasonCode,
            );
          }
          const prefixes = profile.contentRules.html.forbiddenAttributePrefixes.join('|');
          const attributes = profile.contentRules.html.forbiddenAttributes.join('|');
          if (profile.contentRules.html.forbidStyleElement && /<style\b/iu.test(file.content)) {
            add(
              profile.contentRules.html.inlineActiveRule.ruleId,
              profile.contentRules.html.inlineActiveRule.reasonCode,
            );
          }
          if (
            new RegExp(`\\s(?:${prefixes})[a-z]+\\s*=|\\s(?:${attributes})\\s*=`, 'iu').test(
              file.content,
            )
          ) {
            add(
              profile.contentRules.html.inlineActiveRule.ruleId,
              profile.contentRules.html.inlineActiveRule.reasonCode,
            );
          }
          if (
            profile.contentRules.html.forbidInlineScript &&
            /<script\b(?![^>]*\bsrc\s*=)[^>]*>/iu.test(file.content)
          ) {
            add(
              profile.contentRules.html.inlineActiveRule.ruleId,
              profile.contentRules.html.inlineActiveRule.reasonCode,
            );
          }
          const referenceAttributes = profile.contentRules.html.referenceAttributes.join('|');
          const expression = new RegExp(
            `\\b(?:${referenceAttributes})\\s*=\\s*["']([^"']+)["']`,
            'giu',
          );
          for (const match of file.content.matchAll(expression)) {
            if (!relativeReference(match[1]!)) {
              add(
                profile.contentRules.html.referencesRule.ruleId,
                profile.contentRules.html.referencesRule.reasonCode,
              );
            }
          }
        }

        if (file.path.endsWith('.css')) {
          if (profile.contentRules.css.forbidImport && /@import\b/iu.test(file.content)) {
            add(
              profile.contentRules.css.importRule.ruleId,
              profile.contentRules.css.importRule.reasonCode,
            );
          }
          for (const match of file.content.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)) {
            if (profile.contentRules.css.relativeUrlsOnly && !relativeReference(match[1]!)) {
              add(
                profile.contentRules.css.urlsRule.ruleId,
                profile.contentRules.css.urlsRule.reasonCode,
              );
            }
          }
        }

        if (isSource && !isTest) {
          if (
            profile.contentRules.javaScript.forbiddenCapabilities.some((capability) =>
              usesBrowserCapability(file.content, capability),
            )
          ) {
            add(
              profile.contentRules.javaScript.capabilitiesRule.ruleId,
              profile.contentRules.javaScript.capabilitiesRule.reasonCode,
            );
          }
          const importReferences = [
            ...file.content.matchAll(/(?:\bfrom\s+|\bimport\s*\()\s*["']([^"']+)["']/gu),
          ];
          const fetchReferences = [...file.content.matchAll(/\bfetch\s*\(\s*["']([^"']+)["']/gu)];
          if (
            (profile.contentRules.javaScript.relativeImportsOnly &&
              importReferences.some((match) => !relativeReference(match[1]!))) ||
            (profile.contentRules.javaScript.relativeFetchOnly &&
              fetchReferences.some((match) => !relativeReference(match[1]!)))
          ) {
            add(
              profile.contentRules.javaScript.referencesRule.ruleId,
              profile.contentRules.javaScript.referencesRule.reasonCode,
            );
          }
        }
      }

      const sources = bundle.files.filter((file) => {
        const source = sourceExtensions.has(extensionOf(file.path));
        return (
          source &&
          !profile.sourceDiscovery.excludedSuffixes.some((suffix) => file.path.endsWith(suffix))
        );
      });
      if (sources.length === 0) {
        add(profile.sourceDiscovery.rule.ruleId, profile.sourceDiscovery.rule.reasonCode);
      }
      if (!sources.some((file) => testSuffixes.some((suffix) => file.path.endsWith(suffix)))) {
        add(profile.testDiscovery.rule.ruleId, profile.testDiscovery.rule.reasonCode);
      }
      if (profile.files.requiredFiles.some((required) => !paths.has(required))) {
        add(profile.files.requiredFilesRule.ruleId, profile.files.requiredFilesRule.reasonCode);
      }

      const orderedIssues = projectGenerationProfileConstraints(profile).rules.flatMap((rule) => {
        const issue = issues.get(rule.id);
        return issue === undefined ? [] : [issue];
      });
      const validationWithoutHash = {
        executionProfileId: profile.identity.profileId,
        executionProfileVersion: profile.identity.version,
        executionProfileHash: profile.identity.profileHash,
        generationProjectionHash,
        bundleHash: bundle.bundleHash,
        compatible: orderedIssues.length === 0,
        issues: orderedIssues,
      };
      return immutableClone(
        factoryExecutionProfileValidationSchema.parse({
          ...validationWithoutHash,
          profileValidationHash: domainHash(
            'brq-factory-execution-profile:validation:v1',
            validationWithoutHash,
          ),
        }),
      );
    },
  });
}
