import { Buffer } from 'node:buffer';

import { semanticVersionSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

import { calculateKnowledgeHash } from './document-content';

export const knowledgeCategorySchema = z.enum([
  'VISION',
  'PRODUCT',
  'ARCHITECTURE',
  'WORKFLOW',
  'TECHNOLOGY',
  'DOMAIN',
  'DATABASE',
  'API',
  'ORCHESTRATION',
  'ARTIFACT',
  'AGENT',
  'PROMPT',
  'ENGINEERING',
  'TESTING',
  'OBSERVABILITY',
  'SECURITY',
  'GOVERNANCE',
  'GLOSSARY',
  'FAQ',
  'ADR',
]);

export const knowledgeContextKindSchema = z.enum([
  'GLOBAL',
  'PRODUCT_OWNER',
  'DEVELOPER',
  'QA',
  'SECURITY',
  'ARCHITECTURE',
]);

export const knowledgeDocumentIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*$/)
  .refine((id) => id.trim() === id, 'O ID não pode conter espaços externos.');

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

export const knowledgeSourceIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  .refine((id) => id.trim() === id, 'O ID da origem não pode conter espaços externos.');

export const knowledgeLocatorSchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((locator, context) => {
    const segments = locator.split('/');
    const isUnsafe =
      locator.startsWith('/') ||
      locator.trim() !== locator ||
      WINDOWS_DRIVE_PATH.test(locator) ||
      locator.includes('\\') ||
      CONTROL_CHARACTER.test(locator) ||
      !locator.endsWith('.md') ||
      segments.some(
        (segment) =>
          segment.length === 0 || segment === '.' || segment === '..' || segment.startsWith('.'),
      );

    if (isUnsafe) {
      context.addIssue({
        code: 'custom',
        message: 'locator deve ser um caminho Markdown relativo, POSIX e seguro.',
      });
    }
  });

export const knowledgeHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const knowledgeManifestDocumentSchema = z
  .object({
    id: knowledgeDocumentIdSchema,
    locator: knowledgeLocatorSchema,
    category: knowledgeCategorySchema,
    order: z.number().int().nonnegative(),
  })
  .strict();

export const knowledgeManifestSchema = z
  .object({
    version: semanticVersionSchema,
    documents: z.array(knowledgeManifestDocumentSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const fields = ['id', 'locator', 'order'] as const;

    for (const field of fields) {
      const seen = new Set<string | number>();

      manifest.documents.forEach((document, index) => {
        const value = document[field];

        if (seen.has(value)) {
          context.addIssue({
            code: 'custom',
            message: `${field} deve ser único no manifesto.`,
            path: ['documents', index, field],
          });
        }

        seen.add(value);
      });
    }
  });

export const knowledgeSelectionRuleSchema = z
  .object({
    required: z.array(knowledgeDocumentIdSchema),
    optional: z.array(knowledgeDocumentIdSchema),
  })
  .strict()
  .superRefine((rule, context) => {
    const required = new Set<string>();
    const optional = new Set<string>();

    rule.required.forEach((id, index) => {
      if (required.has(id)) {
        context.addIssue({
          code: 'custom',
          message: 'Documentos obrigatórios não podem conter IDs duplicados.',
          path: ['required', index],
        });
      }
      required.add(id);
    });

    rule.optional.forEach((id, index) => {
      if (optional.has(id)) {
        context.addIssue({
          code: 'custom',
          message: 'Documentos opcionais não podem conter IDs duplicados.',
          path: ['optional', index],
        });
      }

      if (required.has(id)) {
        context.addIssue({
          code: 'custom',
          message: 'Um documento não pode ser obrigatório e opcional no mesmo contexto.',
          path: ['optional', index],
        });
      }

      optional.add(id);
    });
  });

export const knowledgeSelectionPolicySchema = z
  .object({
    version: semanticVersionSchema,
    contexts: z
      .object({
        GLOBAL: knowledgeSelectionRuleSchema,
        PRODUCT_OWNER: knowledgeSelectionRuleSchema,
        DEVELOPER: knowledgeSelectionRuleSchema,
        QA: knowledgeSelectionRuleSchema,
        SECURITY: knowledgeSelectionRuleSchema,
        ARCHITECTURE: knowledgeSelectionRuleSchema,
      })
      .strict(),
  })
  .strict();

export const knowledgeSourceEntryKindSchema = z.literal('FILE');

export const knowledgeSourceEntrySchema = z
  .object({
    locator: knowledgeLocatorSchema,
    kind: knowledgeSourceEntryKindSchema,
    sizeBytes: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const knowledgeDocumentOriginSchema = z
  .object({
    sourceId: knowledgeSourceIdSchema,
    locator: knowledgeLocatorSchema,
  })
  .strict();

export const knowledgeDocumentMetadataSchema = z
  .object({
    id: knowledgeDocumentIdSchema,
    title: z.string().trim().min(1).max(512),
    origin: knowledgeDocumentOriginSchema,
    category: knowledgeCategorySchema,
    order: z.number().int().nonnegative(),
    hash: knowledgeHashSchema,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const knowledgeIndexSchema = z
  .object({
    manifestVersion: semanticVersionSchema,
    sourceId: knowledgeSourceIdSchema,
    availableDocuments: z.array(knowledgeDocumentMetadataSchema),
    missingDocuments: z.array(knowledgeManifestDocumentSchema),
    unmanifestedLocators: z.array(knowledgeLocatorSchema),
  })
  .strict()
  .superRefine((index, context) => {
    const ids = new Set<string>();
    const locators = new Set<string>();

    index.availableDocuments.forEach((document, documentIndex) => {
      if (ids.has(document.id)) {
        context.addIssue({
          code: 'custom',
          message: 'O índice não pode conter IDs duplicados.',
          path: ['availableDocuments', documentIndex, 'id'],
        });
      }
      ids.add(document.id);

      if (locators.has(document.origin.locator)) {
        context.addIssue({
          code: 'custom',
          message: 'O índice não pode conter locators duplicados.',
          path: ['availableDocuments', documentIndex, 'origin', 'locator'],
        });
      }
      locators.add(document.origin.locator);

      if (document.origin.sourceId !== index.sourceId) {
        context.addIssue({
          code: 'custom',
          message: 'A origem do documento deve corresponder à origem do índice.',
          path: ['availableDocuments', documentIndex, 'origin', 'sourceId'],
        });
      }
    });

    index.missingDocuments.forEach((document, documentIndex) => {
      if (ids.has(document.id) || locators.has(document.locator)) {
        context.addIssue({
          code: 'custom',
          message: 'Um documento não pode estar disponível e ausente no mesmo índice.',
          path: ['missingDocuments', documentIndex],
        });
      }
      ids.add(document.id);
      locators.add(document.locator);
    });
  });

export const knowledgeLoadRequestSchema = z
  .object({
    context: knowledgeContextKindSchema,
    maxDocuments: z.number().int().positive().optional(),
    maxBytes: z.number().int().positive().optional(),
  })
  .strict();

export const knowledgeIgnoredReasonSchema = z.enum([
  'NOT_SELECTED',
  'NOT_IN_MANIFEST',
  'BUDGET_EXCEEDED',
]);

export const knowledgeIgnoredDocumentSchema = z
  .object({
    id: knowledgeDocumentIdSchema.nullable(),
    locator: knowledgeLocatorSchema,
    reason: knowledgeIgnoredReasonSchema,
  })
  .strict();

export const knowledgeMissingDocumentSchema = z
  .object({
    id: knowledgeDocumentIdSchema,
    locator: knowledgeLocatorSchema,
    required: z.boolean(),
  })
  .strict();

export const knowledgeContextBudgetSchema = z
  .object({
    maxDocuments: z.number().int().positive(),
    maxBytes: z.number().int().positive(),
    usedDocuments: z.number().int().nonnegative(),
    usedBytes: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((budget, context) => {
    if (budget.usedDocuments > budget.maxDocuments) {
      context.addIssue({
        code: 'custom',
        message: 'usedDocuments não pode exceder maxDocuments.',
        path: ['usedDocuments'],
      });
    }

    if (budget.usedBytes > budget.maxBytes) {
      context.addIssue({
        code: 'custom',
        message: 'usedBytes não pode exceder maxBytes.',
        path: ['usedBytes'],
      });
    }
  });

export const knowledgeContextSchema = z
  .object({
    context: knowledgeContextKindSchema,
    manifestVersion: semanticVersionSchema,
    policyVersion: semanticVersionSchema,
    sourceId: knowledgeSourceIdSchema,
    content: z.string().min(1),
    contextHash: knowledgeHashSchema,
    includedDocuments: z.array(knowledgeDocumentMetadataSchema),
    ignoredDocuments: z.array(knowledgeIgnoredDocumentSchema),
    missingDocuments: z.array(knowledgeMissingDocumentSchema),
    budget: knowledgeContextBudgetSchema,
  })
  .strict()
  .superRefine((knowledgeContext, context) => {
    if (knowledgeContext.budget.usedDocuments !== knowledgeContext.includedDocuments.length) {
      context.addIssue({
        code: 'custom',
        message: 'usedDocuments deve corresponder aos documentos incluídos.',
        path: ['budget', 'usedDocuments'],
      });
    }

    if (knowledgeContext.budget.usedBytes !== Buffer.byteLength(knowledgeContext.content, 'utf8')) {
      context.addIssue({
        code: 'custom',
        message: 'usedBytes deve corresponder ao tamanho UTF-8 do contexto.',
        path: ['budget', 'usedBytes'],
      });
    }

    if (knowledgeContext.contextHash !== calculateKnowledgeHash(knowledgeContext.content)) {
      context.addIssue({
        code: 'custom',
        message: 'contextHash deve corresponder ao conteúdo composto.',
        path: ['contextHash'],
      });
    }

    const representedIds = new Set<string>();
    const representedLocators = new Set<string>();

    knowledgeContext.includedDocuments.forEach((document, documentIndex) => {
      if (
        representedIds.has(document.id) ||
        representedLocators.has(document.origin.locator) ||
        document.origin.sourceId !== knowledgeContext.sourceId
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Documentos incluídos devem ser únicos e pertencer à origem do contexto.',
          path: ['includedDocuments', documentIndex],
        });
      }
      representedIds.add(document.id);
      representedLocators.add(document.origin.locator);
    });

    knowledgeContext.ignoredDocuments.forEach((document, documentIndex) => {
      if (
        (document.id !== null && representedIds.has(document.id)) ||
        representedLocators.has(document.locator)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Um documento ignorado não pode estar representado em outra lista.',
          path: ['ignoredDocuments', documentIndex],
        });
      }
      if (document.id !== null) {
        representedIds.add(document.id);
      }
      representedLocators.add(document.locator);
    });

    knowledgeContext.missingDocuments.forEach((document, documentIndex) => {
      if (representedIds.has(document.id) || representedLocators.has(document.locator)) {
        context.addIssue({
          code: 'custom',
          message: 'Um documento ausente não pode estar representado em outra lista.',
          path: ['missingDocuments', documentIndex],
        });
      }
      representedIds.add(document.id);
      representedLocators.add(document.locator);
    });
  });
