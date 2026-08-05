import { Buffer } from 'node:buffer';

import type { JsonValue } from '@brq/shared/types/json-value';

import { canonicalizeJson } from './canonical-json';
import { serializeAndVerifyPromptContext } from './context-injector';
import type {
  PromptBuildInput,
  PromptContextInput,
  PromptRuleSet,
  PromptTemplateBlock,
  PromptTemplateFragment,
  PromptTemplateSection,
  ResolvedPromptBlock,
  ResolvedPromptDocument,
  ResolvedPromptFragment,
  ResolvedPromptSection,
} from './contracts';
import { PROMPT_BUILDER_ERROR_CODES, PromptBuilderError } from './errors';
import { calculateCanonicalJsonHash } from './hashing';
import { deepFreeze } from './immutability';
import { resolvePromptVariable, serializePromptValue } from './variable-resolver';

interface ResolutionState {
  readonly input: PromptBuildInput;
  readonly variables: ReadonlyMap<string, PromptBuildInput['variables'][number]>;
  readonly contexts: ReadonlyMap<string, PromptContextInput>;
  readonly ruleSets: ReadonlyMap<string, PromptRuleSet>;
  readonly usedVariables: Set<string>;
  readonly usedContexts: Set<string>;
  readonly usedRuleSets: Set<string>;
  constraintsUsed: boolean;
  outputContractUsed: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolvedFragment(
  id: string,
  type: ResolvedPromptFragment['type'],
  sourceId: string | null,
  sourceItemId: string | null,
  content: string,
): ResolvedPromptFragment {
  const hash = calculateCanonicalJsonHash({ id, type, sourceId, sourceItemId, content });

  return deepFreeze({
    id,
    type,
    sourceId,
    sourceItemId,
    content,
    hash,
    sizeBytes: Buffer.byteLength(content, 'utf8'),
  });
}

function derivedItemFragmentId(slotId: string, itemId: string): string {
  const suffix = calculateCanonicalJsonHash({ slotId, itemId });
  return `${slotId}:item-${suffix}`;
}

function ruleSetScopeFor(section: PromptTemplateSection): PromptRuleSet['scope'] | undefined {
  if (section.kind === 'GLOBAL_RULES') return 'GLOBAL';
  if (section.kind === 'SECURITY_RULES') return 'SECURITY';
  if (section.kind === 'AGENT_RULES') return 'AGENT';
  return undefined;
}

function contextKindIsCompatible(
  section: PromptTemplateSection,
  context: PromptContextInput,
): boolean {
  if (section.kind === 'KNOWLEDGE_CONTEXT') return context.kind === 'KNOWLEDGE';
  if (section.kind === 'EXECUTION_CONTEXT') {
    return context.kind === 'EXECUTION' || context.kind === 'ARTIFACT';
  }
  if (section.kind === 'USER_INPUT') return context.kind === 'USER_INPUT';
  return false;
}

function resolveRuleSet(
  fragment: Extract<PromptTemplateFragment, { type: 'RULE_SET_SLOT' }>,
  section: PromptTemplateSection,
  state: ResolutionState,
): readonly ResolvedPromptFragment[] {
  const ruleSet = state.ruleSets.get(fragment.ruleSetId);

  if (ruleSet === undefined) {
    throw new PromptBuilderError('Um rule set exigido pelo template não foi fornecido.', {
      code: PROMPT_BUILDER_ERROR_CODES.MISSING_SLOT_VALUE,
      promptId: state.input.template.id,
      sectionId: section.id,
      slotName: fragment.ruleSetId,
    });
  }

  const expectedScope = ruleSetScopeFor(section);
  if (
    expectedScope === undefined ||
    ruleSet.scope !== expectedScope ||
    (ruleSet.scope === 'AGENT' && ruleSet.agent !== state.input.template.agent)
  ) {
    throw new PromptBuilderError('O rule set não é compatível com a seção ou o agente.', {
      code:
        ruleSet.scope === 'AGENT'
          ? PROMPT_BUILDER_ERROR_CODES.AGENT_MISMATCH
          : PROMPT_BUILDER_ERROR_CODES.INVALID_SECTION,
      promptId: state.input.template.id,
      sectionId: section.id,
      slotName: fragment.ruleSetId,
    });
  }

  state.usedRuleSets.add(ruleSet.id);
  return ruleSet.rules.map((rule) =>
    resolvedFragment(
      derivedItemFragmentId(fragment.id, rule.id),
      'RULE',
      ruleSet.id,
      rule.id,
      rule.content,
    ),
  );
}

function resolveContext(
  fragment: Extract<PromptTemplateFragment, { type: 'CONTEXT_SLOT' }>,
  section: PromptTemplateSection,
  state: ResolutionState,
): readonly ResolvedPromptFragment[] {
  const context = state.contexts.get(fragment.contextId);

  if (context === undefined) {
    throw new PromptBuilderError('Um contexto exigido pelo template não foi fornecido.', {
      code: PROMPT_BUILDER_ERROR_CODES.MISSING_SLOT_VALUE,
      promptId: state.input.template.id,
      sectionId: section.id,
      slotName: fragment.contextId,
    });
  }

  if (!contextKindIsCompatible(section, context)) {
    throw new PromptBuilderError('O tipo do contexto não é compatível com a seção.', {
      code: PROMPT_BUILDER_ERROR_CODES.INVALID_CONTEXT,
      promptId: state.input.template.id,
      sectionId: section.id,
      slotName: context.id,
    });
  }

  state.usedContexts.add(context.id);
  return [
    resolvedFragment(
      fragment.id,
      'CONTEXT',
      context.id,
      null,
      serializeAndVerifyPromptContext(context),
    ),
  ];
}

function resolveFragment(
  fragment: PromptTemplateFragment,
  section: PromptTemplateSection,
  state: ResolutionState,
): readonly ResolvedPromptFragment[] {
  switch (fragment.type) {
    case 'TEXT':
      return [resolvedFragment(fragment.id, 'STATIC_TEXT', null, null, fragment.value)];
    case 'VARIABLE_SLOT': {
      const content = resolvePromptVariable(state.variables, fragment.name, fragment.serialization);
      state.usedVariables.add(fragment.name);
      return [resolvedFragment(fragment.id, 'VARIABLE', fragment.name, null, content)];
    }
    case 'CONTEXT_SLOT':
      return resolveContext(fragment, section, state);
    case 'RULE_SET_SLOT':
      return resolveRuleSet(fragment, section, state);
    case 'CONSTRAINTS_SLOT': {
      state.constraintsUsed = true;

      if (state.input.constraints.length === 0) {
        throw new PromptBuilderError('O slot de constraints exige ao menos uma constraint.', {
          code: PROMPT_BUILDER_ERROR_CODES.MISSING_SLOT_VALUE,
          promptId: state.input.template.id,
          sectionId: section.id,
          slotName: fragment.id,
        });
      }

      return state.input.constraints.map((constraint) =>
        resolvedFragment(
          derivedItemFragmentId(fragment.id, constraint.id),
          'CONSTRAINT',
          constraint.id,
          null,
          serializePromptValue(constraint.value, constraint.serialization, constraint.id),
        ),
      );
    }
    case 'OUTPUT_CONTRACT_SLOT': {
      state.outputContractUsed = true;
      return [
        resolvedFragment(
          fragment.id,
          'OUTPUT_CONTRACT',
          state.input.outputContract.id,
          null,
          canonicalizeJson(state.input.outputContract as unknown as JsonValue),
        ),
      ];
    }
  }
}

function resolveBlock(
  block: PromptTemplateBlock,
  section: PromptTemplateSection,
  state: ResolutionState,
): ResolvedPromptBlock {
  const fragments = block.fragments.flatMap((fragment) =>
    resolveFragment(fragment, section, state),
  );
  const hash = calculateCanonicalJsonHash({
    id: block.id,
    kind: block.kind,
    fragments: fragments.map((fragment) => ({ id: fragment.id, hash: fragment.hash })),
  });

  return deepFreeze({
    id: block.id,
    kind: block.kind,
    fragments,
    hash,
    sizeBytes: fragments.reduce((sum, fragment) => sum + fragment.sizeBytes, 0),
  });
}

function resolveSection(
  section: PromptTemplateSection,
  state: ResolutionState,
): ResolvedPromptSection {
  const blocks = section.blocks.map((block) => resolveBlock(block, section, state));
  const hash = calculateCanonicalJsonHash({
    id: section.id,
    kind: section.kind,
    channel: section.channel,
    trust: section.trust,
    blocks: blocks.map((block) => ({ id: block.id, hash: block.hash })),
  });

  return deepFreeze({
    id: section.id,
    kind: section.kind,
    channel: section.channel,
    trust: section.trust,
    blocks,
    hash,
    sizeBytes: blocks.reduce((sum, block) => sum + block.sizeBytes, 0),
  });
}

function assertAllValuesUsed(state: ResolutionState): void {
  const unknown = [
    ...state.input.variables
      .filter((variable) => !state.usedVariables.has(variable.name))
      .map((variable) => variable.name),
    ...state.input.contexts
      .filter((context) => !state.usedContexts.has(context.id))
      .map((context) => context.id),
    ...state.input.ruleSets
      .filter((ruleSet) => !state.usedRuleSets.has(ruleSet.id))
      .map((ruleSet) => ruleSet.id),
  ];

  if (unknown.length > 0 || (!state.constraintsUsed && state.input.constraints.length > 0)) {
    const slotName = unknown[0] ?? state.input.constraints[0]?.id;
    throw new PromptBuilderError('Foram fornecidos valores que o template não referencia.', {
      code: PROMPT_BUILDER_ERROR_CODES.UNKNOWN_SLOT_VALUE,
      promptId: state.input.template.id,
      ...(slotName === undefined ? {} : { slotName }),
    });
  }

  if (!state.outputContractUsed) {
    throw new PromptBuilderError('O template não referencia o contrato de saída.', {
      code: PROMPT_BUILDER_ERROR_CODES.MISSING_SLOT_VALUE,
      promptId: state.input.template.id,
      slotName: state.input.outputContract.id,
    });
  }
}

export function assemblePromptDocument(input: PromptBuildInput): ResolvedPromptDocument {
  const state: ResolutionState = {
    input,
    variables: new Map(input.variables.map((variable) => [variable.name, variable])),
    contexts: new Map(input.contexts.map((context) => [context.id, context])),
    ruleSets: new Map(input.ruleSets.map((ruleSet) => [ruleSet.id, ruleSet])),
    usedVariables: new Set(),
    usedContexts: new Set(),
    usedRuleSets: new Set(),
    constraintsUsed: false,
    outputContractUsed: false,
  };
  const sections = input.template.sections.map((section) => resolveSection(section, state));

  assertAllValuesUsed(state);

  const ruleSets = input.ruleSets
    .map((ruleSet) => ({
      ruleSetId: ruleSet.id,
      version: ruleSet.version,
      scope: ruleSet.scope,
      agent: ruleSet.agent,
      hash: calculateCanonicalJsonHash(ruleSet as unknown as JsonValue),
    }))
    .toSorted((left, right) => compareText(left.ruleSetId, right.ruleSetId));
  const contexts = input.contexts
    .map((context) => ({
      contextId: context.id,
      kind: context.kind,
      serialization: context.serialization,
      contentHash: context.contentHash,
      descriptorHash: calculateCanonicalJsonHash({
        id: context.id,
        kind: context.kind,
        serialization: context.serialization,
        contentHash: context.contentHash,
        references: context.references,
      } as unknown as JsonValue),
      references: context.references,
    }))
    .toSorted((left, right) => compareText(left.contextId, right.contextId));

  return deepFreeze({
    promptId: input.template.id,
    agent: input.template.agent,
    version: input.template.version,
    schemaVersion: input.template.schemaVersion,
    sections,
    sources: { ruleSets, contexts },
  });
}
