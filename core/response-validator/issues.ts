import type { ErrorObject } from 'ajv';

import type { ValidationIssue } from './contracts';
import { VALIDATION_ISSUE_CODES } from './schemas';

const MAX_TECHNICAL_PATH_LENGTH = 1_024;

export function boundedTechnicalPath(value: string): string {
  return value.slice(0, MAX_TECHNICAL_PATH_LENGTH);
}

function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

export function schemaIssuePath(error: ErrorObject): string {
  const basePath = error.instancePath.length === 0 ? '' : error.instancePath;
  const missingProperty =
    error.keyword === 'required' && typeof error.params.missingProperty === 'string'
      ? `/${escapeJsonPointerSegment(error.params.missingProperty)}`
      : '';

  return boundedTechnicalPath(`${basePath}${missingProperty}` || '/');
}

export function finishReasonIssue(
  finishReason: 'MAX_OUTPUT_TOKENS' | 'CONTENT_FILTER' | 'REFUSAL',
): ValidationIssue {
  if (finishReason === 'MAX_OUTPUT_TOKENS') {
    return {
      code: VALIDATION_ISSUE_CODES.FINISH_REASON_MAX_OUTPUT_TOKENS,
      severity: 'ERROR',
      category: 'FINISH_REASON',
      message: 'A resposta foi interrompida pelo limite de saída.',
    };
  }

  if (finishReason === 'CONTENT_FILTER') {
    return {
      code: VALIDATION_ISSUE_CODES.FINISH_REASON_CONTENT_FILTER,
      severity: 'ERROR',
      category: 'FINISH_REASON',
      message: 'A resposta foi interrompida por filtro de conteúdo.',
    };
  }

  return {
    code: VALIDATION_ISSUE_CODES.FINISH_REASON_REFUSAL,
    severity: 'ERROR',
    category: 'FINISH_REASON',
    message: 'O provider retornou uma recusa funcional.',
  };
}

export function contentMissingIssue(): ValidationIssue {
  return {
    code: VALIDATION_ISSUE_CODES.CONTENT_MISSING,
    severity: 'ERROR',
    category: 'CONTENT',
    message: 'A resposta concluída não contém conteúdo.',
  };
}

export function contentTooLargeIssue(): ValidationIssue {
  return {
    code: VALIDATION_ISSUE_CODES.CONTENT_TOO_LARGE,
    severity: 'ERROR',
    category: 'CONTENT',
    message: 'O conteúdo excede o limite configurado para validação.',
  };
}

export function contentNestingTooDeepIssue(): ValidationIssue {
  return {
    code: VALIDATION_ISSUE_CODES.CONTENT_NESTING_TOO_DEEP,
    severity: 'ERROR',
    category: 'CONTENT',
    message: 'O conteúdo JSON excede a profundidade máxima configurada.',
  };
}

export function malformedJsonIssue(): ValidationIssue {
  return {
    code: VALIDATION_ISSUE_CODES.MALFORMED_JSON,
    severity: 'ERROR',
    category: 'JSON_SYNTAX',
    message: 'O conteúdo não é um JSON válido.',
  };
}

export function schemaMismatchIssue(error: ErrorObject): ValidationIssue {
  return {
    code: VALIDATION_ISSUE_CODES.SCHEMA_MISMATCH,
    severity: 'ERROR',
    category: 'SCHEMA',
    instancePath: schemaIssuePath(error),
    schemaPath: boundedTechnicalPath(error.schemaPath),
    keyword: error.keyword,
    message: 'O conteúdo JSON não atende ao schema no caminho informado.',
  };
}

export function structuredDataNestingTooDeepIssue(): ValidationIssue {
  return {
    code: VALIDATION_ISSUE_CODES.STRUCTURED_DATA_NESTING_TOO_DEEP,
    severity: 'ERROR',
    category: 'INTEGRITY',
    message: 'O structured output excede a profundidade máxima configurada.',
  };
}

export function structuredDataUnavailableIssue(): ValidationIssue {
  return {
    code: VALIDATION_ISSUE_CODES.STRUCTURED_DATA_UNAVAILABLE,
    severity: 'WARNING',
    category: 'INTEGRITY',
    message: 'O structured output não está disponível; o conteúdo local validado foi preservado.',
  };
}

export function structuredDataSchemaMismatchIssue(error: ErrorObject): ValidationIssue {
  return {
    code: VALIDATION_ISSUE_CODES.STRUCTURED_DATA_SCHEMA_MISMATCH,
    severity: 'ERROR',
    category: 'INTEGRITY',
    instancePath: schemaIssuePath(error),
    schemaPath: boundedTechnicalPath(error.schemaPath),
    keyword: error.keyword,
    message: 'O structured output não atende ao schema no caminho informado.',
  };
}

export function structuredDataMismatchIssue(): ValidationIssue {
  return {
    code: VALIDATION_ISSUE_CODES.STRUCTURED_DATA_MISMATCH,
    severity: 'ERROR',
    category: 'INTEGRITY',
    message: 'O structured output diverge do conteúdo JSON interpretado localmente.',
  };
}
