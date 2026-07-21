import {
  type StructuredError,
  type StructuredErrorOptions,
  structuredError,
} from '@prisma-next/utils/structured-error';

type OrmSubcode =
  | 'MODEL_UNKNOWN'
  | 'RELATION_UNKNOWN'
  | 'WHERE_MISSING'
  | 'OPERATION_UNSUPPORTED'
  | 'INCLUDE_UNSUPPORTED'
  | 'FIELD_IMMUTABLE';

export type OrmCode = `ORM.${OrmSubcode}`;

export function ormError(
  code: OrmCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
