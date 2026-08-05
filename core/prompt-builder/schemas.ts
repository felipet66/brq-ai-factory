import { Buffer } from 'node:buffer';

import { agentNameSchema, semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { jsonObjectSchema, jsonValueSchema } from '@brq/shared/schemas/json-value.schema';
import { z } from 'zod';

import { canonicalizeJson } from './canonical-json';
import { calculateCanonicalJsonHash, calculatePromptHash } from './hashing';
import { ABSOLUTE_PROMPT_MAX_CONTEXT_REFERENCES } from './limits';
import { renderPromptDocument } from './prompt-renderer';

const NON_EMPTY_CONTENT = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'O conteúdo não pode conter apenas espaços.');

export const promptNodeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  .refine((value) => value.trim() === value, 'O ID não pode conter espaços externos.');

export const promptSlotNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
export const promptHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const promptSourceHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const promptChannelSchema = z.enum(['INSTRUCTIONS', 'INPUT']);
export const promptTrustSchema = z.enum(['TRUSTED', 'UNTRUSTED']);
export const promptSerializationSchema = z.enum(['TEXT', 'JSON']);

export const promptSectionKindSchema = z.enum([
  'GLOBAL_RULES',
  'SECURITY_RULES',
  'AGENT_IDENTITY',
  'AGENT_RULES',
  'OBJECTIVE',
  'RESPONSIBILITIES',
  'PROCESS',
  'CONSTRAINTS',
  'KNOWLEDGE_CONTEXT',
  'EXECUTION_CONTEXT',
  'USER_INPUT',
  'OUTPUT_CONTRACT',
  'FINAL_INSTRUCTION',
]);

export const promptBlockKindSchema = z.enum([
  'CONTENT',
  'RULES',
  'CONTEXT',
  'CONSTRAINTS',
  'OUTPUT_CONTRACT',
]);

const fragmentBase = { id: promptNodeIdSchema };

export const promptTemplateFragmentSchema = z.discriminatedUnion('type', [
  z.object({ ...fragmentBase, type: z.literal('TEXT'), value: NON_EMPTY_CONTENT }).strict(),
  z
    .object({
      ...fragmentBase,
      type: z.literal('VARIABLE_SLOT'),
      name: promptSlotNameSchema,
      serialization: promptSerializationSchema,
    })
    .strict(),
  z
    .object({
      ...fragmentBase,
      type: z.literal('CONTEXT_SLOT'),
      contextId: promptNodeIdSchema,
    })
    .strict(),
  z
    .object({
      ...fragmentBase,
      type: z.literal('RULE_SET_SLOT'),
      ruleSetId: promptNodeIdSchema,
    })
    .strict(),
  z.object({ ...fragmentBase, type: z.literal('CONSTRAINTS_SLOT') }).strict(),
  z.object({ ...fragmentBase, type: z.literal('OUTPUT_CONTRACT_SLOT') }).strict(),
]);

const ALLOWED_FRAGMENT_TYPES = {
  CONTENT: new Set(['TEXT', 'VARIABLE_SLOT']),
  RULES: new Set(['TEXT', 'RULE_SET_SLOT']),
  CONTEXT: new Set(['TEXT', 'VARIABLE_SLOT', 'CONTEXT_SLOT']),
  CONSTRAINTS: new Set(['TEXT', 'CONSTRAINTS_SLOT']),
  OUTPUT_CONTRACT: new Set(['TEXT', 'OUTPUT_CONTRACT_SLOT']),
} as const;

export const promptTemplateBlockSchema = z
  .object({
    id: promptNodeIdSchema,
    kind: promptBlockKindSchema,
    fragments: z.array(promptTemplateFragmentSchema).min(1),
  })
  .strict()
  .superRefine((block, context) => {
    const seen = new Set<string>();

    block.fragments.forEach((fragment, index) => {
      if (seen.has(fragment.id)) {
        context.addIssue({
          code: 'custom',
          message: 'IDs de fragmentos devem ser únicos dentro do bloco.',
          path: ['fragments', index, 'id'],
        });
      }
      seen.add(fragment.id);

      if (!ALLOWED_FRAGMENT_TYPES[block.kind].has(fragment.type)) {
        context.addIssue({
          code: 'custom',
          message: 'O tipo do fragmento não é compatível com o tipo do bloco.',
          path: ['fragments', index, 'type'],
        });
      }
    });
  });

const INSTRUCTION_SECTION_KINDS = new Set([
  'GLOBAL_RULES',
  'SECURITY_RULES',
  'AGENT_IDENTITY',
  'AGENT_RULES',
  'OBJECTIVE',
  'RESPONSIBILITIES',
  'PROCESS',
  'OUTPUT_CONTRACT',
  'FINAL_INSTRUCTION',
]);
const INPUT_SECTION_KINDS = new Set([
  'CONSTRAINTS',
  'KNOWLEDGE_CONTEXT',
  'EXECUTION_CONTEXT',
  'USER_INPUT',
]);
const DYNAMIC_INPUT_FRAGMENT_TYPES = new Set(['VARIABLE_SLOT', 'CONTEXT_SLOT', 'CONSTRAINTS_SLOT']);
const TRUSTED_FRAGMENT_TYPES = new Set(['RULE_SET_SLOT', 'OUTPUT_CONTRACT_SLOT']);
const ALLOWED_BLOCK_KINDS: Readonly<Record<z.infer<typeof promptSectionKindSchema>, Set<string>>> =
  {
    GLOBAL_RULES: new Set(['RULES']),
    SECURITY_RULES: new Set(['RULES']),
    AGENT_IDENTITY: new Set(['CONTENT']),
    AGENT_RULES: new Set(['RULES']),
    OBJECTIVE: new Set(['CONTENT']),
    RESPONSIBILITIES: new Set(['CONTENT']),
    PROCESS: new Set(['CONTENT']),
    CONSTRAINTS: new Set(['CONSTRAINTS']),
    KNOWLEDGE_CONTEXT: new Set(['CONTEXT']),
    EXECUTION_CONTEXT: new Set(['CONTEXT']),
    USER_INPUT: new Set(['CONTENT', 'CONTEXT']),
    OUTPUT_CONTRACT: new Set(['OUTPUT_CONTRACT']),
    FINAL_INSTRUCTION: new Set(['CONTENT']),
  };

function sectionBoundaryIsCompatible(
  kind: z.infer<typeof promptSectionKindSchema>,
  channel: z.infer<typeof promptChannelSchema>,
  trust: z.infer<typeof promptTrustSchema>,
): boolean {
  return (
    (INSTRUCTION_SECTION_KINDS.has(kind) && channel === 'INSTRUCTIONS' && trust === 'TRUSTED') ||
    (INPUT_SECTION_KINDS.has(kind) && channel === 'INPUT' && trust === 'UNTRUSTED')
  );
}

export const promptTemplateSectionSchema = z
  .object({
    id: promptNodeIdSchema,
    kind: promptSectionKindSchema,
    channel: promptChannelSchema,
    trust: promptTrustSchema,
    blocks: z.array(promptTemplateBlockSchema).min(1),
  })
  .strict()
  .superRefine((section, context) => {
    if (!sectionBoundaryIsCompatible(section.kind, section.channel, section.trust)) {
      context.addIssue({
        code: 'custom',
        message: 'Canal e confiança não são compatíveis com o tipo da seção.',
        path: ['channel'],
      });
    }

    const seen = new Set<string>();
    section.blocks.forEach((block, blockIndex) => {
      if (seen.has(block.id)) {
        context.addIssue({
          code: 'custom',
          message: 'IDs de blocos devem ser únicos dentro da seção.',
          path: ['blocks', blockIndex, 'id'],
        });
      }
      seen.add(block.id);

      if (!ALLOWED_BLOCK_KINDS[section.kind].has(block.kind)) {
        context.addIssue({
          code: 'custom',
          message: 'O tipo do bloco não é compatível com o tipo da seção.',
          path: ['blocks', blockIndex, 'kind'],
        });
      }

      block.fragments.forEach((fragment, fragmentIndex) => {
        if (DYNAMIC_INPUT_FRAGMENT_TYPES.has(fragment.type) && section.channel !== 'INPUT') {
          context.addIssue({
            code: 'custom',
            message: 'Dados dinâmicos não confiáveis só podem entrar no canal INPUT.',
            path: ['blocks', blockIndex, 'fragments', fragmentIndex],
          });
        }

        if (TRUSTED_FRAGMENT_TYPES.has(fragment.type) && section.channel !== 'INSTRUCTIONS') {
          context.addIssue({
            code: 'custom',
            message: 'Regras e contratos pertencem ao canal INSTRUCTIONS.',
            path: ['blocks', blockIndex, 'fragments', fragmentIndex],
          });
        }

        const semanticSlotMismatch =
          (fragment.type === 'VARIABLE_SLOT' &&
            section.kind !== 'USER_INPUT' &&
            section.kind !== 'EXECUTION_CONTEXT') ||
          (fragment.type === 'CONTEXT_SLOT' &&
            section.kind !== 'KNOWLEDGE_CONTEXT' &&
            section.kind !== 'EXECUTION_CONTEXT' &&
            section.kind !== 'USER_INPUT') ||
          (fragment.type === 'RULE_SET_SLOT' &&
            section.kind !== 'GLOBAL_RULES' &&
            section.kind !== 'SECURITY_RULES' &&
            section.kind !== 'AGENT_RULES') ||
          (fragment.type === 'CONSTRAINTS_SLOT' && section.kind !== 'CONSTRAINTS') ||
          (fragment.type === 'OUTPUT_CONTRACT_SLOT' && section.kind !== 'OUTPUT_CONTRACT');

        if (semanticSlotMismatch) {
          context.addIssue({
            code: 'custom',
            message: 'O slot não é compatível com o tipo da seção.',
            path: ['blocks', blockIndex, 'fragments', fragmentIndex],
          });
        }
      });
    });
  });

export const promptTemplateSchema = z
  .object({
    id: promptNodeIdSchema,
    agent: agentNameSchema,
    version: semanticVersionSchema,
    schemaVersion: semanticVersionSchema,
    sections: z.array(promptTemplateSectionSchema).min(2),
  })
  .strict()
  .superRefine((template, context) => {
    const sectionIds = new Set<string>();
    const slotReferences = new Set<string>();
    let outputContractSlots = 0;
    let constraintsSlots = 0;

    template.sections.forEach((section, sectionIndex) => {
      if (sectionIds.has(section.id)) {
        context.addIssue({
          code: 'custom',
          message: 'IDs de seções devem ser únicos no documento.',
          path: ['sections', sectionIndex, 'id'],
        });
      }
      sectionIds.add(section.id);

      section.blocks.forEach((block, blockIndex) => {
        block.fragments.forEach((fragment, fragmentIndex) => {
          let reference: string | undefined;

          if (fragment.type === 'VARIABLE_SLOT') reference = `variable:${fragment.name}`;
          if (fragment.type === 'CONTEXT_SLOT') reference = `context:${fragment.contextId}`;
          if (fragment.type === 'RULE_SET_SLOT') reference = `rules:${fragment.ruleSetId}`;
          if (fragment.type === 'CONSTRAINTS_SLOT') constraintsSlots += 1;
          if (fragment.type === 'OUTPUT_CONTRACT_SLOT') outputContractSlots += 1;

          if (reference !== undefined) {
            if (slotReferences.has(reference)) {
              context.addIssue({
                code: 'custom',
                message: 'Cada valor dinâmico deve possuir uma única referência no template.',
                path: ['sections', sectionIndex, 'blocks', blockIndex, 'fragments', fragmentIndex],
              });
            }
            slotReferences.add(reference);
          }
        });
      });
    });

    if (!template.sections.some((section) => section.channel === 'INSTRUCTIONS')) {
      context.addIssue({ code: 'custom', message: 'O template deve possuir instruções.' });
    }
    if (!template.sections.some((section) => section.channel === 'INPUT')) {
      context.addIssue({ code: 'custom', message: 'O template deve possuir entrada.' });
    }
    if (outputContractSlots !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'O template deve possuir exatamente um OUTPUT_CONTRACT_SLOT.',
      });
    }
    if (constraintsSlots > 1) {
      context.addIssue({
        code: 'custom',
        message: 'O template pode possuir no máximo um CONSTRAINTS_SLOT.',
      });
    }
  });

export const promptRuleSchema = z
  .object({ id: promptNodeIdSchema, content: NON_EMPTY_CONTENT })
  .strict();

const promptRuleSetBase = {
  id: promptNodeIdSchema,
  version: semanticVersionSchema,
  rules: z.array(promptRuleSchema).min(1),
};

export const promptRuleSetSchema = z
  .discriminatedUnion('scope', [
    z.object({ ...promptRuleSetBase, scope: z.literal('GLOBAL'), agent: z.null() }).strict(),
    z.object({ ...promptRuleSetBase, scope: z.literal('SECURITY'), agent: z.null() }).strict(),
    z.object({ ...promptRuleSetBase, scope: z.literal('AGENT'), agent: agentNameSchema }).strict(),
  ])
  .superRefine((ruleSet, context) => {
    const seen = new Set<string>();
    ruleSet.rules.forEach((rule, index) => {
      if (seen.has(rule.id)) {
        context.addIssue({
          code: 'custom',
          message: 'IDs de regras devem ser únicos no rule set.',
          path: ['rules', index, 'id'],
        });
      }
      seen.add(rule.id);
    });
  });

export const promptVariableSchema = z
  .object({ name: promptSlotNameSchema, value: jsonValueSchema })
  .strict();

export const promptContextReferenceSchema = z
  .object({
    id: promptNodeIdSchema,
    category: z.string().trim().min(1).max(128).nullable(),
    hash: promptSourceHashSchema,
  })
  .strict();

export const promptContextInputSchema = z
  .object({
    id: promptNodeIdSchema,
    kind: z.enum(['KNOWLEDGE', 'EXECUTION', 'USER_INPUT', 'ARTIFACT']),
    serialization: promptSerializationSchema,
    content: jsonValueSchema,
    contentHash: promptSourceHashSchema,
    references: z.array(promptContextReferenceSchema).max(ABSOLUTE_PROMPT_MAX_CONTEXT_REFERENCES),
  })
  .strict()
  .superRefine((promptContext, context) => {
    if (
      promptContext.serialization === 'TEXT' &&
      (typeof promptContext.content !== 'string' || promptContext.content.trim().length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Contexto TEXT exige conteúdo textual.',
        path: ['content'],
      });
    }

    const seen = new Set<string>();
    promptContext.references.forEach((reference, index) => {
      if (seen.has(reference.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Referências de contexto devem possuir IDs únicos.',
          path: ['references', index, 'id'],
        });
      }
      seen.add(reference.id);
    });
  });

export const promptConstraintSchema = z
  .object({
    id: promptNodeIdSchema,
    serialization: promptSerializationSchema,
    value: jsonValueSchema,
  })
  .strict()
  .superRefine((constraint, context) => {
    if (
      constraint.serialization === 'TEXT' &&
      (typeof constraint.value !== 'string' || constraint.value.trim().length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Constraint TEXT exige valor textual.',
        path: ['value'],
      });
    }
  });

const outputContractBase = {
  id: promptNodeIdSchema,
  version: semanticVersionSchema,
  instructions: z.array(NON_EMPTY_CONTENT).min(1),
};

export const promptOutputContractSchema = z.discriminatedUnion('format', [
  z.object({ ...outputContractBase, format: z.literal('TEXT') }).strict(),
  z
    .object({
      ...outputContractBase,
      format: z.literal('JSON_SCHEMA'),
      schema: jsonObjectSchema,
    })
    .strict(),
]);

function addDuplicateIssues(
  values: readonly { readonly id?: string; readonly name?: string }[],
  field: 'id' | 'name',
  path: string,
  context: z.core.$RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const identifier = value[field];
    if (identifier !== undefined && seen.has(identifier)) {
      context.addIssue({
        code: 'custom',
        message: `${field} deve ser único em ${path}.`,
        path: [path, index, field],
      });
    }
    if (identifier !== undefined) seen.add(identifier);
  });
}

export const promptBuildInputSchema = z
  .object({
    template: promptTemplateSchema,
    ruleSets: z.array(promptRuleSetSchema),
    contexts: z.array(promptContextInputSchema),
    variables: z.array(promptVariableSchema),
    constraints: z.array(promptConstraintSchema),
    outputContract: promptOutputContractSchema,
  })
  .strict()
  .superRefine((input, context) => {
    addDuplicateIssues(input.ruleSets, 'id', 'ruleSets', context);
    addDuplicateIssues(input.contexts, 'id', 'contexts', context);
    addDuplicateIssues(input.variables, 'name', 'variables', context);
    addDuplicateIssues(input.constraints, 'id', 'constraints', context);

    if (
      input.contexts.reduce(
        (totalReferences, promptContext) => totalReferences + promptContext.references.length,
        0,
      ) > ABSOLUTE_PROMPT_MAX_CONTEXT_REFERENCES
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A entrada excede o teto absoluto de referências de proveniência.',
        path: ['contexts'],
      });
    }
  });

export const promptBuildOptionsSchema = z
  .object({
    maxBytes: z.number().int().positive().optional(),
    requestId: promptNodeIdSchema.optional(),
    traceId: promptNodeIdSchema.optional(),
  })
  .strict();

export const promptBuilderConfigurationSchema = z
  .object({
    maxBytes: z.number().int().positive(),
    maxContextReferences: z.number().int().positive().max(ABSOLUTE_PROMPT_MAX_CONTEXT_REFERENCES),
  })
  .strict();

export const resolvedPromptFragmentSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(384)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    type: z.enum(['STATIC_TEXT', 'VARIABLE', 'CONTEXT', 'RULE', 'CONSTRAINT', 'OUTPUT_CONTRACT']),
    sourceId: promptNodeIdSchema.nullable(),
    sourceItemId: promptNodeIdSchema.nullable(),
    content: z.string(),
    hash: promptHashSchema,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((fragment, context) => {
    const sourceIsCoherent =
      (fragment.type === 'STATIC_TEXT' &&
        fragment.sourceId === null &&
        fragment.sourceItemId === null) ||
      (fragment.type === 'RULE' && fragment.sourceId !== null && fragment.sourceItemId !== null) ||
      (fragment.type !== 'STATIC_TEXT' &&
        fragment.type !== 'RULE' &&
        fragment.sourceId !== null &&
        fragment.sourceItemId === null);

    if (!sourceIsCoherent) {
      context.addIssue({ code: 'custom', message: 'A origem do fragmento é incoerente.' });
    }

    if (fragment.sizeBytes !== Buffer.byteLength(fragment.content, 'utf8')) {
      context.addIssue({ code: 'custom', message: 'O tamanho do fragmento é incoerente.' });
    }
    if (
      fragment.hash !==
      calculateCanonicalJsonHash({
        id: fragment.id,
        type: fragment.type,
        sourceId: fragment.sourceId,
        sourceItemId: fragment.sourceItemId,
        content: fragment.content,
      })
    ) {
      context.addIssue({ code: 'custom', message: 'O hash do fragmento é incoerente.' });
    }
  });

const ALLOWED_RESOLVED_FRAGMENT_TYPES = {
  CONTENT: new Set(['STATIC_TEXT', 'VARIABLE']),
  RULES: new Set(['STATIC_TEXT', 'RULE']),
  CONTEXT: new Set(['STATIC_TEXT', 'VARIABLE', 'CONTEXT']),
  CONSTRAINTS: new Set(['STATIC_TEXT', 'CONSTRAINT']),
  OUTPUT_CONTRACT: new Set(['STATIC_TEXT', 'OUTPUT_CONTRACT']),
} as const;

const DYNAMIC_RESOLVED_INPUT_FRAGMENT_TYPES = new Set(['VARIABLE', 'CONTEXT', 'CONSTRAINT']);
const TRUSTED_RESOLVED_FRAGMENT_TYPES = new Set(['RULE', 'OUTPUT_CONTRACT']);

export const resolvedPromptBlockSchema = z
  .object({
    id: promptNodeIdSchema,
    kind: promptBlockKindSchema,
    fragments: z.array(resolvedPromptFragmentSchema).min(1),
    hash: promptHashSchema,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((block, context) => {
    const fragmentIds = new Set<string>();

    block.fragments.forEach((fragment, index) => {
      if (fragmentIds.has(fragment.id)) {
        context.addIssue({
          code: 'custom',
          message: 'IDs de fragmentos resolvidos devem ser únicos no bloco.',
          path: ['fragments', index, 'id'],
        });
      }
      fragmentIds.add(fragment.id);

      if (!ALLOWED_RESOLVED_FRAGMENT_TYPES[block.kind].has(fragment.type)) {
        context.addIssue({
          code: 'custom',
          message: 'O fragmento resolvido não é compatível com o bloco.',
          path: ['fragments', index, 'type'],
        });
      }
    });

    if (block.sizeBytes !== block.fragments.reduce((sum, item) => sum + item.sizeBytes, 0)) {
      context.addIssue({ code: 'custom', message: 'O tamanho do bloco é incoerente.' });
    }
    if (
      block.hash !==
      calculateCanonicalJsonHash({
        id: block.id,
        kind: block.kind,
        fragments: block.fragments.map((fragment) => ({
          id: fragment.id,
          hash: fragment.hash,
        })),
      })
    ) {
      context.addIssue({ code: 'custom', message: 'O hash do bloco é incoerente.' });
    }
  });

export const resolvedPromptSectionSchema = z
  .object({
    id: promptNodeIdSchema,
    kind: promptSectionKindSchema,
    channel: promptChannelSchema,
    trust: promptTrustSchema,
    blocks: z.array(resolvedPromptBlockSchema).min(1),
    hash: promptHashSchema,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((section, context) => {
    const blockIds = new Set<string>();

    if (!sectionBoundaryIsCompatible(section.kind, section.channel, section.trust)) {
      context.addIssue({
        code: 'custom',
        message: 'Canal e confiança da seção resolvida são incoerentes.',
      });
    }

    section.blocks.forEach((block, index) => {
      if (blockIds.has(block.id)) {
        context.addIssue({
          code: 'custom',
          message: 'IDs de blocos resolvidos devem ser únicos na seção.',
          path: ['blocks', index, 'id'],
        });
      }
      blockIds.add(block.id);

      if (!ALLOWED_BLOCK_KINDS[section.kind].has(block.kind)) {
        context.addIssue({
          code: 'custom',
          message: 'O bloco resolvido não é compatível com a seção.',
          path: ['blocks', index, 'kind'],
        });
      }

      block.fragments.forEach((fragment, fragmentIndex) => {
        if (
          DYNAMIC_RESOLVED_INPUT_FRAGMENT_TYPES.has(fragment.type) &&
          section.channel !== 'INPUT'
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Dados dinâmicos resolvidos só podem entrar no canal INPUT.',
            path: ['blocks', index, 'fragments', fragmentIndex],
          });
        }

        if (
          TRUSTED_RESOLVED_FRAGMENT_TYPES.has(fragment.type) &&
          section.channel !== 'INSTRUCTIONS'
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Regras e contratos resolvidos pertencem ao canal INSTRUCTIONS.',
            path: ['blocks', index, 'fragments', fragmentIndex],
          });
        }

        const semanticFragmentMismatch =
          (fragment.type === 'VARIABLE' &&
            section.kind !== 'USER_INPUT' &&
            section.kind !== 'EXECUTION_CONTEXT') ||
          (fragment.type === 'CONTEXT' &&
            section.kind !== 'KNOWLEDGE_CONTEXT' &&
            section.kind !== 'EXECUTION_CONTEXT' &&
            section.kind !== 'USER_INPUT') ||
          (fragment.type === 'RULE' &&
            section.kind !== 'GLOBAL_RULES' &&
            section.kind !== 'SECURITY_RULES' &&
            section.kind !== 'AGENT_RULES') ||
          (fragment.type === 'CONSTRAINT' && section.kind !== 'CONSTRAINTS') ||
          (fragment.type === 'OUTPUT_CONTRACT' && section.kind !== 'OUTPUT_CONTRACT');

        if (semanticFragmentMismatch) {
          context.addIssue({
            code: 'custom',
            message: 'O fragmento resolvido não é compatível com o tipo da seção.',
            path: ['blocks', index, 'fragments', fragmentIndex],
          });
        }
      });
    });

    if (section.sizeBytes !== section.blocks.reduce((sum, item) => sum + item.sizeBytes, 0)) {
      context.addIssue({ code: 'custom', message: 'O tamanho da seção é incoerente.' });
    }
    if (
      section.hash !==
      calculateCanonicalJsonHash({
        id: section.id,
        kind: section.kind,
        channel: section.channel,
        trust: section.trust,
        blocks: section.blocks.map((block) => ({ id: block.id, hash: block.hash })),
      })
    ) {
      context.addIssue({ code: 'custom', message: 'O hash da seção é incoerente.' });
    }
  });

export const promptRuleSetProvenanceSchema = z
  .object({
    ruleSetId: promptNodeIdSchema,
    version: semanticVersionSchema,
    scope: z.enum(['GLOBAL', 'SECURITY', 'AGENT']),
    agent: agentNameSchema.nullable(),
    hash: promptHashSchema,
  })
  .strict()
  .superRefine((source, context) => {
    if (
      (source.scope === 'AGENT' && source.agent === null) ||
      (source.scope !== 'AGENT' && source.agent !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'O agente da proveniência não corresponde ao escopo do rule set.',
      });
    }
  });

export const promptContextProvenanceSchema = z
  .object({
    contextId: promptNodeIdSchema,
    kind: z.enum(['KNOWLEDGE', 'EXECUTION', 'USER_INPUT', 'ARTIFACT']),
    serialization: promptSerializationSchema,
    contentHash: promptSourceHashSchema,
    descriptorHash: promptHashSchema,
    references: z.array(promptContextReferenceSchema).max(ABSOLUTE_PROMPT_MAX_CONTEXT_REFERENCES),
  })
  .strict()
  .superRefine((source, context) => {
    const descriptorHash = calculateCanonicalJsonHash({
      id: source.contextId,
      kind: source.kind,
      serialization: source.serialization,
      contentHash: source.contentHash,
      references: source.references,
    });

    if (descriptorHash !== source.descriptorHash) {
      context.addIssue({
        code: 'custom',
        message: 'O hash do descritor de contexto é incoerente.',
      });
    }

    const referenceIds = new Set<string>();
    source.references.forEach((reference, index) => {
      if (referenceIds.has(reference.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Referências de proveniência devem possuir IDs únicos.',
          path: ['references', index, 'id'],
        });
      }
      referenceIds.add(reference.id);
    });
  });

export const resolvedPromptDocumentSchema = z
  .object({
    promptId: promptNodeIdSchema,
    agent: agentNameSchema,
    version: semanticVersionSchema,
    schemaVersion: semanticVersionSchema,
    sections: z.array(resolvedPromptSectionSchema).min(2),
    sources: z
      .object({
        ruleSets: z.array(promptRuleSetProvenanceSchema),
        contexts: z.array(promptContextProvenanceSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((document, context) => {
    const sectionIds = new Set<string>();
    document.sections.forEach((section, index) => {
      if (sectionIds.has(section.id)) {
        context.addIssue({
          code: 'custom',
          message: 'IDs de seções resolvidas devem ser únicos.',
          path: ['sections', index, 'id'],
        });
      }
      sectionIds.add(section.id);
    });

    for (const [field, sources] of Object.entries(document.sources)) {
      const ids = sources.map((source) =>
        'ruleSetId' in source ? source.ruleSetId : source.contextId,
      );
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id, index) => index > 0 && id <= ids[index - 1]!)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Fontes resolvidas devem possuir IDs únicos e ordem canônica.',
          path: ['sources', field],
        });
      }
    }
  });

export const promptRenderedOutputSchema = z
  .object({ instructions: z.string().min(1), input: z.string().min(1) })
  .strict();

export const promptResultSchema = z
  .object({
    document: resolvedPromptDocumentSchema,
    rendered: promptRenderedOutputSchema,
    metadata: z
      .object({
        promptId: promptNodeIdSchema,
        agent: agentNameSchema,
        version: semanticVersionSchema,
        schemaVersion: semanticVersionSchema,
        templateHash: promptHashSchema,
        promptHash: promptHashSchema,
        instructionsHash: promptHashSchema,
        inputHash: promptHashSchema,
        outputContractHash: promptHashSchema,
        sectionHashes: z.array(
          z.object({ sectionId: promptNodeIdSchema, hash: promptHashSchema }).strict(),
        ),
        ruleSetHashes: z.array(promptRuleSetProvenanceSchema),
        contextHashes: z.array(promptContextProvenanceSchema),
      })
      .strict(),
    budget: z
      .object({
        maxBytes: z.number().int().positive(),
        usedBytes: z.number().int().nonnegative(),
        instructionsBytes: z.number().int().nonnegative(),
        inputBytes: z.number().int().nonnegative(),
        outputContractBytes: z.number().int().nonnegative(),
      })
      .strict(),
    outputContract: promptOutputContractSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const outputContractCanonical = canonicalizeJson(result.outputContract);
    const expectedRendered = renderPromptDocument(result.document);
    const expectedPromptHash = calculateCanonicalJsonHash({
      promptId: result.metadata.promptId,
      agent: result.metadata.agent,
      version: result.metadata.version,
      schemaVersion: result.metadata.schemaVersion,
      instructions: result.rendered.instructions,
      input: result.rendered.input,
      outputContract: result.outputContract,
    });
    const expectedSectionHashes = result.document.sections.map((section) => ({
      sectionId: section.id,
      hash: section.hash,
    }));
    const contextFragments = result.document.sections.flatMap((section) =>
      section.blocks.flatMap((block) =>
        block.fragments
          .filter((fragment) => fragment.type === 'CONTEXT')
          .map((fragment) => ({ fragment, sectionKind: section.kind })),
      ),
    );
    const ruleFragments = result.document.sections.flatMap((section) =>
      section.blocks.flatMap((block) =>
        block.fragments
          .filter((fragment) => fragment.type === 'RULE')
          .map((fragment) => ({ fragment, sectionKind: section.kind })),
      ),
    );
    const outputContractFragments = result.document.sections.flatMap((section) =>
      section.blocks.flatMap((block) =>
        block.fragments.filter((fragment) => fragment.type === 'OUTPUT_CONTRACT'),
      ),
    );

    if (
      expectedRendered.instructions !== result.rendered.instructions ||
      expectedRendered.input !== result.rendered.input
    ) {
      context.addIssue({
        code: 'custom',
        message: 'O texto renderizado não corresponde ao documento resolvido.',
      });
    }

    const contextSourcesAreCoherent =
      contextFragments.length === result.document.sources.contexts.length &&
      result.document.sources.contexts.every((source) =>
        contextFragments.some(
          ({ fragment, sectionKind }) =>
            fragment.sourceId === source.contextId &&
            `sha256:${calculatePromptHash(fragment.content)}` === source.contentHash &&
            ((sectionKind === 'KNOWLEDGE_CONTEXT' && source.kind === 'KNOWLEDGE') ||
              (sectionKind === 'USER_INPUT' && source.kind === 'USER_INPUT') ||
              (sectionKind === 'EXECUTION_CONTEXT' &&
                (source.kind === 'EXECUTION' || source.kind === 'ARTIFACT'))),
        ),
      );
    const ruleSourcesAreCoherent =
      result.document.sources.ruleSets.every((source) =>
        ruleFragments.some(({ fragment }) => fragment.sourceId === source.ruleSetId),
      ) &&
      ruleFragments.every(({ fragment, sectionKind }) =>
        result.document.sources.ruleSets.some(
          (source) =>
            fragment.sourceId === source.ruleSetId &&
            ((sectionKind === 'GLOBAL_RULES' && source.scope === 'GLOBAL') ||
              (sectionKind === 'SECURITY_RULES' && source.scope === 'SECURITY') ||
              (sectionKind === 'AGENT_RULES' &&
                source.scope === 'AGENT' &&
                source.agent === result.document.agent)),
        ),
      );
    const ruleSetHashesAreCoherent = result.document.sources.ruleSets.every((source) => {
      const rules = ruleFragments
        .filter(({ fragment }) => fragment.sourceId === source.ruleSetId)
        .map(({ fragment }) => ({ id: fragment.sourceItemId!, content: fragment.content }));

      return (
        source.hash ===
        calculateCanonicalJsonHash({
          id: source.ruleSetId,
          version: source.version,
          scope: source.scope,
          agent: source.agent,
          rules,
        })
      );
    });
    const outputContractIsCoherent =
      outputContractFragments.length === 1 &&
      outputContractFragments[0]?.sourceId === result.outputContract.id &&
      outputContractFragments[0]?.content === outputContractCanonical;

    if (!contextSourcesAreCoherent || !ruleSourcesAreCoherent || !ruleSetHashesAreCoherent) {
      context.addIssue({
        code: 'custom',
        message: 'A proveniência não corresponde às fontes resolvidas no documento.',
      });
    }

    if (!outputContractIsCoherent) {
      context.addIssue({
        code: 'custom',
        message: 'O contrato de saída não corresponde ao fragmento renderizado.',
      });
    }

    if (
      result.budget.usedBytes !==
      result.budget.instructionsBytes + result.budget.inputBytes + result.budget.outputContractBytes
    ) {
      context.addIssue({ code: 'custom', message: 'O uso total do orçamento é incoerente.' });
    }
    if (result.budget.usedBytes > result.budget.maxBytes) {
      context.addIssue({ code: 'custom', message: 'O resultado excede o orçamento.' });
    }
    if (
      result.budget.instructionsBytes !== Buffer.byteLength(result.rendered.instructions, 'utf8') ||
      result.budget.inputBytes !== Buffer.byteLength(result.rendered.input, 'utf8') ||
      result.budget.outputContractBytes !== Buffer.byteLength(outputContractCanonical, 'utf8')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A contagem de bytes do resultado é incoerente.',
      });
    }
    if (
      result.document.promptId !== result.metadata.promptId ||
      result.document.agent !== result.metadata.agent ||
      result.document.version !== result.metadata.version ||
      result.document.schemaVersion !== result.metadata.schemaVersion
    ) {
      context.addIssue({ code: 'custom', message: 'Metadados e documento devem ser coerentes.' });
    }
    if (
      JSON.stringify(result.metadata.ruleSetHashes) !==
        JSON.stringify(result.document.sources.ruleSets) ||
      JSON.stringify(result.metadata.contextHashes) !==
        JSON.stringify(result.document.sources.contexts)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A proveniência do resultado e do documento deve ser coerente.',
      });
    }
    if (
      result.metadata.instructionsHash !== calculatePromptHash(result.rendered.instructions) ||
      result.metadata.inputHash !== calculatePromptHash(result.rendered.input) ||
      result.metadata.outputContractHash !== calculatePromptHash(outputContractCanonical) ||
      result.metadata.promptHash !== expectedPromptHash
    ) {
      context.addIssue({ code: 'custom', message: 'Os hashes do resultado são incoerentes.' });
    }
    if (JSON.stringify(result.metadata.sectionHashes) !== JSON.stringify(expectedSectionHashes)) {
      context.addIssue({ code: 'custom', message: 'Os hashes de seção são incoerentes.' });
    }
  });
