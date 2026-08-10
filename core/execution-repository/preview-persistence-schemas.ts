import { isoDateTimeSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export const previewAccessTicketHashSchema = z.string().regex(HASH_PATTERN);

export const previewAccessTicketIssueInputSchema = z
  .object({
    previewId: z.string().regex(/^preview-[a-f0-9]{32}$/u),
    ticketHash: previewAccessTicketHashSchema,
    issuedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((ticket, context) => {
    if (Date.parse(ticket.expiresAt) <= Date.parse(ticket.issuedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'A expiração do ticket deve ser posterior à emissão.',
      });
    }
  });

export const previewAccessTicketConsumeInputSchema = z
  .object({
    ticketHash: previewAccessTicketHashSchema,
    consumedAt: isoDateTimeSchema,
  })
  .strict();

export const previewAccessTicketRevokeInputSchema = z
  .object({
    previewId: z.string().regex(/^preview-[a-f0-9]{32}$/u),
    revokedAt: isoDateTimeSchema,
  })
  .strict();

export const previewAccessTicketMetadataSchema = z
  .object({
    previewId: z.string().regex(/^preview-[a-f0-9]{32}$/u),
    issuedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    consumedAt: isoDateTimeSchema.nullable(),
    revokedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const previewAccessTicketRedemptionSchema = z
  .object({
    previewId: z.string().regex(/^preview-[a-f0-9]{32}$/u),
    executionId: z.string().min(1).max(128),
    ownerUserId: z.string().min(1).max(128),
    expiresAt: isoDateTimeSchema,
  })
  .strict();
