import { AppError } from '@brq/shared/errors/app-error';
import { ERROR_CODES } from '@brq/shared/errors/error-codes';
import { Prisma } from '../../generated/prisma/client';
import { z } from 'zod';

export function parseRepositoryInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new AppError('Dados de persistência inválidos.', {
      code: ERROR_CODES.INVALID_INPUT,
      statusCode: 400,
      expose: true,
      cause: result.error,
    });
  }

  return result.data;
}

export function entityNotFound(entity: string, id: string): AppError {
  return new AppError(`${entity} não encontrado: ${id}.`, {
    code: ERROR_CODES.ENTITY_NOT_FOUND,
    statusCode: 404,
    expose: true,
  });
}

export function invalidRelation(message: string): AppError {
  return new AppError(message, {
    code: ERROR_CODES.INVALID_INPUT,
    statusCode: 400,
    expose: true,
  });
}

function translatePersistenceError(error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      throw new AppError('Registro não encontrado durante a persistência.', {
        code: ERROR_CODES.ENTITY_NOT_FOUND,
        statusCode: 404,
        expose: true,
        cause: error,
      });
    }

    if (error.code === 'P2002' || error.code === 'P2003') {
      throw new AppError('Conflito ao persistir o registro.', {
        code: ERROR_CODES.PERSISTENCE_CONFLICT,
        statusCode: 409,
        expose: true,
        cause: error,
      });
    }
  }

  throw new AppError('Falha na camada de persistência.', {
    code: ERROR_CODES.PERSISTENCE_ERROR,
    cause: error,
  });
}

export async function runPersistenceOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return translatePersistenceError(error);
  }
}
