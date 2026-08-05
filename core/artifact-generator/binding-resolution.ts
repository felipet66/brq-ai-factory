import {
  canonicalizeJson,
  cloneJsonValue,
  prettyPrintCanonicalJson,
  type ReadonlyJsonObject,
  type ReadonlyJsonValue,
} from './canonical-json';
import { utf8ByteLength } from './content-hashing';
import type {
  ArtifactBinding,
  ArtifactTemplate,
  BindingPath,
  BindingSerialization,
} from './contracts';
import { ARTIFACT_GENERATOR_ERROR_CODES, ArtifactGeneratorError } from './errors';
import { deepFreeze } from './immutability';
import type { ResolvedArtifactModel } from './resolved-artifact-model';

function bindingError(
  code:
    | typeof ARTIFACT_GENERATOR_ERROR_CODES.BINDING_NOT_FOUND
    | typeof ARTIFACT_GENERATOR_ERROR_CODES.BINDING_TYPE_MISMATCH,
  message: string,
  templateId: string,
  durationMs: number,
): ArtifactGeneratorError {
  return new ArtifactGeneratorError(message, {
    code,
    stage: 'BINDING_RESOLUTION',
    durationMs,
    templateId,
  });
}

function contentLimitError(templateId: string, durationMs: number): ArtifactGeneratorError {
  return new ArtifactGeneratorError('O artifact excede o limite de bytes configurado.', {
    code: ARTIFACT_GENERATOR_ERROR_CODES.CONTENT_LIMIT_EXCEEDED,
    stage: 'BUDGET_VALIDATION',
    durationMs,
    templateId,
  });
}

function resolvePath(
  source: ReadonlyJsonValue,
  path: BindingPath,
  templateId: string,
  durationMs: number,
): ReadonlyJsonValue {
  let current: ReadonlyJsonValue = source;

  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) {
        throw bindingError(
          ARTIFACT_GENERATOR_ERROR_CODES.BINDING_NOT_FOUND,
          'O binding não foi encontrado na saída validada.',
          templateId,
          durationMs,
        );
      }
      current = current[segment]!;
      continue;
    }

    if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      !Object.hasOwn(current, segment)
    ) {
      throw bindingError(
        ARTIFACT_GENERATOR_ERROR_CODES.BINDING_NOT_FOUND,
        'O binding não foi encontrado na saída validada.',
        templateId,
        durationMs,
      );
    }
    current = (current as ReadonlyJsonObject)[segment]!;
  }

  return current;
}

function serializeBinding(
  value: ReadonlyJsonValue,
  serialization: BindingSerialization,
  templateId: string,
  durationMs: number,
): string {
  if (serialization === 'TEXT') {
    if (typeof value !== 'string') {
      throw bindingError(
        ARTIFACT_GENERATOR_ERROR_CODES.BINDING_TYPE_MISMATCH,
        'Bindings TEXT exigem um valor string.',
        templateId,
        durationMs,
      );
    }
    return value;
  }

  return serialization === 'JSON_PRETTY'
    ? prettyPrintCanonicalJson(value)
    : canonicalizeJson(value);
}

function sourceValue(
  validatedOutput:
    | {
        readonly format: 'TEXT';
        readonly content: string;
      }
    | {
        readonly format: 'JSON_SCHEMA';
        readonly data: ReadonlyJsonValue;
      },
): ReadonlyJsonValue {
  return validatedOutput.format === 'TEXT' ? validatedOutput.content : validatedOutput.data;
}

function bindingById(
  bindings: readonly ArtifactBinding[],
  bindingId: string,
  templateId: string,
  durationMs: number,
): ArtifactBinding {
  const binding = bindings.find((candidate) => candidate.id === bindingId);
  if (binding === undefined) {
    throw bindingError(
      ARTIFACT_GENERATOR_ERROR_CODES.BINDING_NOT_FOUND,
      'O template referencia um binding inexistente.',
      templateId,
      durationMs,
    );
  }
  return binding;
}

export function resolveArtifactModel(
  template: ArtifactTemplate,
  validatedOutput:
    | { readonly format: 'TEXT'; readonly content: string }
    | { readonly format: 'JSON_SCHEMA'; readonly data: ReadonlyJsonValue },
  templateHash: string,
  maxArtifactBytes: number,
  durationMs: number,
): ResolvedArtifactModel {
  const source = sourceValue(validatedOutput);
  const base = {
    templateId: template.id,
    name: template.name,
    filename: template.filename,
    type: template.type,
    mediaType: template.mediaType,
    templateHash,
  } as const;

  if (template.format === 'JSON') {
    const rootBinding = bindingById(
      template.bindings,
      template.rootBindingId,
      template.id,
      durationMs,
    );
    const resolved = resolvePath(source, rootBinding.path, template.id, durationMs);
    return deepFreeze({
      ...base,
      format: 'JSON' as const,
      value: cloneJsonValue(resolved),
    });
  }

  const resolvedValues = new Map<string, ReadonlyJsonValue>();
  const serializedValues = new Map<string, Map<BindingSerialization, string>>();
  const fragments: string[] = [];
  let resolvedBytes = 0;

  for (const fragment of template.fragments) {
    let value: string;

    if (fragment.kind === 'LITERAL') {
      value = fragment.value;
    } else {
      let serializedByFormat = serializedValues.get(fragment.bindingId);
      const cached = serializedByFormat?.get(fragment.serialization);

      if (cached !== undefined) {
        value = cached;
      } else {
        let resolved = resolvedValues.get(fragment.bindingId);
        if (resolved === undefined) {
          resolved = resolvePath(
            source,
            bindingById(template.bindings, fragment.bindingId, template.id, durationMs).path,
            template.id,
            durationMs,
          );
          resolvedValues.set(fragment.bindingId, resolved);
        }

        value = serializeBinding(resolved, fragment.serialization, template.id, durationMs);
        serializedByFormat ??= new Map<BindingSerialization, string>();
        serializedByFormat.set(fragment.serialization, value);
        serializedValues.set(fragment.bindingId, serializedByFormat);
      }
    }

    resolvedBytes += utf8ByteLength(value);
    if (resolvedBytes > maxArtifactBytes) {
      throw contentLimitError(template.id, durationMs);
    }
    fragments.push(value);
  }

  return deepFreeze({
    ...base,
    format: 'TEXT' as const,
    fragments,
  });
}
