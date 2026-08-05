import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type { ResponseValidatorConfiguration } from './configuration';
import type {
  validatedOutputSchema,
  jsonSchemaDialectSchema,
  validationContractFormatSchema,
  validationContractSchema,
  validationIssueCategorySchema,
  validationIssueCodeSchema,
  validationIssueSchema,
  validationIssueSeveritySchema,
  validationMetadataSchema,
  validationRequestSchema,
  validationResultSchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ValidationContractFormat = DeepReadonly<z.infer<typeof validationContractFormatSchema>>;
export type JsonSchemaDialect = DeepReadonly<z.infer<typeof jsonSchemaDialectSchema>>;
export type ValidationContract = DeepReadonly<z.infer<typeof validationContractSchema>>;
export type ValidationRequest = DeepReadonly<z.infer<typeof validationRequestSchema>>;
export type ValidationIssueSeverity = DeepReadonly<z.infer<typeof validationIssueSeveritySchema>>;
export type ValidationIssueCategory = DeepReadonly<z.infer<typeof validationIssueCategorySchema>>;
export type ValidationIssueCode = DeepReadonly<z.infer<typeof validationIssueCodeSchema>>;
export type ValidationIssue = DeepReadonly<z.infer<typeof validationIssueSchema>>;
export type ValidatedOutput = DeepReadonly<z.infer<typeof validatedOutputSchema>>;
export type ValidationMetadata = DeepReadonly<z.infer<typeof validationMetadataSchema>>;
export type ValidationResult = DeepReadonly<z.infer<typeof validationResultSchema>>;

export interface CreateResponseValidatorOptions {
  readonly configuration?: Partial<ResponseValidatorConfiguration>;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface ResponseValidator {
  validate(request: ValidationRequest): ValidationResult;
}
