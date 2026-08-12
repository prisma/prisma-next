import type { StructuredError, StructuredErrorOptions } from '@prisma-next/utils/structured-error';
import { structuredError } from '@prisma-next/utils/structured-error';

export type MongoAdapterErrorCode =
  | 'CONFIG.VALIDATION_FAILED'
  | 'CONTRACT.MARKER_ROW_CORRUPT'
  | 'RUNTIME.DECODE_FAILED'
  | 'RUNTIME.TYPE_PARAMS_INVALID';

export function mongoAdapterError(
  code: MongoAdapterErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}

export function describeReceivedValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  return `object with keys [${Object.keys(value).join(', ')}]`;
}
