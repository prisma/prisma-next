import type { StructuredError, StructuredErrorOptions } from '@prisma-next/utils/structured-error';
import { structuredError } from '@prisma-next/utils/structured-error';

export type MongoTargetErrorCode = `MIGRATION.${MigrationSubcode}`;

type MigrationSubcode = 'INVALID_OPERATION_ENTRY' | 'OPERATION_UNSUPPORTED';

export function mongoTargetError(
  code: MongoTargetErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
