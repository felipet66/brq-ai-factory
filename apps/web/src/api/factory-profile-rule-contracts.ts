export const PUBLIC_FACTORY_PROFILE_RULE_IDS = Object.freeze([
  'files.allowed-and-media-types',
  'files.required',
  'source.required',
  'test.required',
  'module.esm-only',
  'module.import-policy',
  'package.no-scripts-or-dependencies',
  'content.html.forbidden-elements',
  'content.html.no-inline-active-content',
  'content.html.relative-references',
  'content.css.no-import',
  'content.css.relative-urls',
  'content.javascript.forbidden-capabilities',
  'content.javascript.relative-references',
  'content.json.valid',
] as const);

export type PublicFactoryProfileRuleId = (typeof PUBLIC_FACTORY_PROFILE_RULE_IDS)[number];

const PUBLIC_FACTORY_PROFILE_RULE_ID_SET: ReadonlySet<string> = new Set(
  PUBLIC_FACTORY_PROFILE_RULE_IDS,
);

export function safePublicFactoryProfileRuleId(
  value: string | null | undefined,
): PublicFactoryProfileRuleId | null {
  return value !== null && value !== undefined && PUBLIC_FACTORY_PROFILE_RULE_ID_SET.has(value)
    ? (value as PublicFactoryProfileRuleId)
    : null;
}
