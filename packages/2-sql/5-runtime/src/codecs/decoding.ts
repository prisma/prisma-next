import type { ExecutionPlan } from '@prisma-next/contract/types';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { Codec, CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { JsonSchemaValidatorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import { validateJsonValue } from './json-schema-validation';

function resolveRowCodec(
  alias: string,
  plan: ExecutionPlan,
  registry: CodecRegistry,
): Codec | null {
  const planCodecId = plan.meta.annotations?.codecs?.[alias] as string | undefined;
  if (planCodecId) {
    const codec = registry.get(planCodecId);
    if (codec) {
      return codec;
    }
  }

  if (plan.meta.projectionTypes) {
    const typeId = plan.meta.projectionTypes[alias];
    if (typeId) {
      const codec = registry.get(typeId);
      if (codec) {
        return codec;
      }
    }
  }

  return null;
}

type ColumnRefIndex = Map<string, { table: string; column: string }>;

/**
 * Builds a lookup index from column name → { table, column } ref.
 * Called once per decodeRow invocation to avoid O(aliases × refs) linear scans.
 */
function buildColumnRefIndex(plan: ExecutionPlan): ColumnRefIndex | null {
  const columns = plan.meta.refs?.columns;
  if (!columns) return null;

  const index: ColumnRefIndex = new Map();
  for (const ref of columns) {
    index.set(ref.column, ref);
  }
  return index;
}

function parseProjectionRef(value: string): { table: string; column: string } | null {
  if (value.startsWith('include:') || value.startsWith('operation:')) {
    return null;
  }

  const separatorIndex = value.indexOf('.');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null;
  }

  return {
    table: value.slice(0, separatorIndex),
    column: value.slice(separatorIndex + 1),
  };
}

function resolveColumnRefForAlias(
  alias: string,
  projection: ExecutionPlan['meta']['projection'],
  fallbackColumnRefIndex: ColumnRefIndex | null,
): { table: string; column: string } | undefined {
  if (projection && !Array.isArray(projection)) {
    const mappedRef = (projection as Record<string, string>)[alias];
    if (typeof mappedRef !== 'string') {
      return undefined;
    }
    return parseProjectionRef(mappedRef) ?? undefined;
  }

  return fallbackColumnRefIndex?.get(alias);
}

export function isJsonSchemaValidationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code: string }).code === 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED'
  );
}

export function wirePreview(value: unknown): string {
  return typeof value === 'string' && value.length > 100
    ? `${value.substring(0, 100)}...`
    : String(value).substring(0, 100);
}

export function decodeFailure(
  alias: string,
  codecId: string,
  wireValue: unknown,
  error: unknown,
): Error {
  // Codec-authored error messages may embed the decrypted value (e.g.
  // `Error("bad tag for <plaintext>")`). Keep the human message bounded to
  // the alias + codec ID and surface the original error through `cause` so
  // diagnostics stay available to debuggers but never flow into telemetry.
  const envelope = runtimeError(
    'RUNTIME.DECODE_FAILED',
    `Failed to decode row alias '${alias}' with codec '${codecId}'`,
    {
      alias,
      codec: codecId,
      wirePreview: wirePreview(wireValue),
    },
  );
  (envelope as Error).cause = error;
  return envelope;
}

export interface DecodeFieldOptions {
  readonly alias: string;
  readonly wireValue: unknown;
  readonly codec: Codec;
  readonly jsonValidators?: JsonSchemaValidatorRegistry | undefined;
  readonly tableName?: string | undefined;
  readonly columnName?: string | undefined;
}

/**
 * Runs codec.decode on a single wire value, threading JSON-schema validation
 * and error redaction through a single place. Sync codecs return the decoded
 * value directly; async codecs return a `Promise<unknown>` with unread
 * rejections silenced so floating promise fields don't trigger Node's
 * `unhandledRejection` for rows whose async field is never awaited. Consumers
 * that do await the promise still receive the rejection.
 *
 * Schema-validation errors for async-decode codecs are redacted (validator
 * `message` strings are dropped) so decrypted plaintext cannot flow into
 * telemetry. See ADR 030.
 */
export function decodeField(options: DecodeFieldOptions): unknown {
  const { alias, wireValue, codec, jsonValidators, tableName, columnName } = options;
  const redactValues = codec.runtime?.decode === 'async';
  const runValidation = (value: unknown): void => {
    if (!jsonValidators || !tableName || !columnName) return;
    validateJsonValue(
      jsonValidators,
      tableName,
      columnName,
      value,
      'decode',
      codec.id,
      redactValues,
    );
  };

  try {
    const decoded = codec.decode(wireValue);
    if (decoded instanceof Promise) {
      const promise = (async () => {
        try {
          const resolved = await decoded;
          runValidation(resolved);
          return resolved;
        } catch (error) {
          if (isJsonSchemaValidationError(error)) throw error;
          throw decodeFailure(alias, codec.id, wireValue, error);
        }
      })();
      // Silence unread async fields; consumers that await still see the rejection.
      promise.catch(() => {});
      return promise;
    }

    runValidation(decoded);
    return decoded;
  } catch (error) {
    if (isJsonSchemaValidationError(error)) throw error;
    throw decodeFailure(alias, codec.id, wireValue, error);
  }
}

export function decodeRow(
  row: Record<string, unknown>,
  plan: ExecutionPlan,
  registry: CodecRegistry,
  jsonValidators?: JsonSchemaValidatorRegistry,
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  const projection = plan.meta.projection;

  // Fallback for plans that do not provide projection alias -> table.column mapping.
  const fallbackColumnRefIndex =
    jsonValidators && (!projection || Array.isArray(projection)) ? buildColumnRefIndex(plan) : null;

  let aliases: readonly string[];
  if (projection && !Array.isArray(projection)) {
    aliases = Object.keys(projection);
  } else if (projection && Array.isArray(projection)) {
    aliases = projection;
  } else {
    aliases = Object.keys(row);
  }

  for (const alias of aliases) {
    const wireValue = row[alias];

    const projectionValue =
      projection && typeof projection === 'object' && !Array.isArray(projection)
        ? (projection as Record<string, string>)[alias]
        : undefined;

    if (typeof projectionValue === 'string' && projectionValue.startsWith('include:')) {
      if (wireValue === null || wireValue === undefined) {
        decoded[alias] = [];
        continue;
      }

      try {
        let parsed: unknown;
        if (typeof wireValue === 'string') {
          parsed = JSON.parse(wireValue);
        } else if (Array.isArray(wireValue)) {
          parsed = wireValue;
        } else {
          parsed = JSON.parse(String(wireValue));
        }

        if (!Array.isArray(parsed)) {
          throw new Error(`Expected array for include alias '${alias}', got ${typeof parsed}`);
        }

        decoded[alias] = parsed;
      } catch (error) {
        const decodeError = new Error(
          `Failed to parse JSON array for include alias '${alias}': ${error instanceof Error ? error.message : String(error)}`,
        ) as Error & {
          code: string;
          category: string;
          severity: string;
          details?: Record<string, unknown>;
        };
        decodeError.code = 'RUNTIME.DECODE_FAILED';
        decodeError.category = 'RUNTIME';
        decodeError.severity = 'error';
        decodeError.details = {
          alias,
          wirePreview:
            typeof wireValue === 'string' && wireValue.length > 100
              ? `${wireValue.substring(0, 100)}...`
              : String(wireValue).substring(0, 100),
        };
        throw decodeError;
      }
      continue;
    }

    if (wireValue === null || wireValue === undefined) {
      decoded[alias] = wireValue;
      continue;
    }

    const codec = resolveRowCodec(alias, plan, registry);

    if (!codec) {
      decoded[alias] = wireValue;
      continue;
    }

    const ref = jsonValidators
      ? resolveColumnRefForAlias(alias, projection, fallbackColumnRefIndex)
      : undefined;
    decoded[alias] = decodeField({
      alias,
      wireValue,
      codec,
      jsonValidators,
      tableName: ref?.table,
      columnName: ref?.column,
    });
  }

  return decoded;
}
