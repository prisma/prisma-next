import type { ExecutionPlan } from '@prisma-next/contract/types';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { Codec, CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { JsonSchemaValidatorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import { validateJsonValue } from './json-schema-validation';

type ColumnRef = { table: string; column: string };
type ColumnRefIndex = Map<string, ColumnRef>;

const WIRE_PREVIEW_LIMIT = 100;

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

function buildColumnRefIndex(plan: ExecutionPlan): ColumnRefIndex | null {
  const columns = plan.meta.refs?.columns;
  if (!columns) return null;

  const index: ColumnRefIndex = new Map();
  for (const ref of columns) {
    index.set(ref.column, ref);
  }
  return index;
}

function parseProjectionRef(value: string): ColumnRef | null {
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
): ColumnRef | undefined {
  if (projection && !Array.isArray(projection)) {
    const mappedRef = (projection as Record<string, string>)[alias];
    if (typeof mappedRef !== 'string') {
      return undefined;
    }
    return parseProjectionRef(mappedRef) ?? undefined;
  }

  return fallbackColumnRefIndex?.get(alias);
}

function previewWireValue(wireValue: unknown): string {
  if (typeof wireValue === 'string') {
    return wireValue.length > WIRE_PREVIEW_LIMIT
      ? `${wireValue.substring(0, WIRE_PREVIEW_LIMIT)}...`
      : wireValue;
  }
  return String(wireValue).substring(0, WIRE_PREVIEW_LIMIT);
}

function isJsonSchemaValidationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code: string }).code === 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED'
  );
}

function wrapDecodeFailure(
  error: unknown,
  alias: string,
  ref: ColumnRef | undefined,
  codec: Codec,
  wireValue: unknown,
): never {
  const message = error instanceof Error ? error.message : String(error);
  const target = ref ? `${ref.table}.${ref.column}` : alias;
  const wrapped = runtimeError(
    'RUNTIME.DECODE_FAILED',
    `Failed to decode column ${target} with codec '${codec.id}': ${message}`,
    {
      ...(ref ? { table: ref.table, column: ref.column } : { alias }),
      codec: codec.id,
      wirePreview: previewWireValue(wireValue),
    },
  );
  wrapped.cause = error;
  throw wrapped;
}

function wrapIncludeAggregateFailure(error: unknown, alias: string, wireValue: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = runtimeError(
    'RUNTIME.DECODE_FAILED',
    `Failed to parse JSON array for include alias '${alias}': ${message}`,
    {
      alias,
      wirePreview: previewWireValue(wireValue),
    },
  );
  wrapped.cause = error;
  throw wrapped;
}

function decodeIncludeAggregate(alias: string, wireValue: unknown): unknown {
  if (wireValue === null || wireValue === undefined) {
    return [];
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

    return parsed;
  } catch (error) {
    wrapIncludeAggregateFailure(error, alias, wireValue);
  }
}

/**
 * Decodes a single field. Single-armed: every cell takes the same path —
 * `codec.decode → await → JSON-Schema validate → return plain value` — so
 * sync- and async-authored codecs are indistinguishable to callers.
 */
async function decodeField(
  alias: string,
  wireValue: unknown,
  plan: ExecutionPlan,
  registry: CodecRegistry,
  jsonValidators: JsonSchemaValidatorRegistry | undefined,
  projection: ExecutionPlan['meta']['projection'],
  fallbackColumnRefIndex: ColumnRefIndex | null,
): Promise<unknown> {
  if (wireValue === null || wireValue === undefined) {
    return wireValue;
  }

  const codec = resolveRowCodec(alias, plan, registry);
  if (!codec) {
    return wireValue;
  }

  const ref = resolveColumnRefForAlias(alias, projection, fallbackColumnRefIndex);

  let decoded: unknown;
  try {
    decoded = await codec.decode(wireValue);
  } catch (error) {
    wrapDecodeFailure(error, alias, ref, codec, wireValue);
  }

  if (jsonValidators && ref) {
    try {
      validateJsonValue(jsonValidators, ref.table, ref.column, decoded, 'decode', codec.id);
    } catch (error) {
      if (isJsonSchemaValidationError(error)) throw error;
      wrapDecodeFailure(error, alias, ref, codec, wireValue);
    }
  }

  return decoded;
}

/**
 * Decodes a row by dispatching all per-cell codec calls concurrently via
 * `Promise.all`. Each cell follows the single-armed `decodeField` path.
 * Failures are wrapped in `RUNTIME.DECODE_FAILED` with `{ table, column,
 * codec }` (or `{ alias, codec }` when no column ref is resolvable) and the
 * original error attached on `cause`.
 */
export async function decodeRow(
  row: Record<string, unknown>,
  plan: ExecutionPlan,
  registry: CodecRegistry,
  jsonValidators?: JsonSchemaValidatorRegistry,
): Promise<Record<string, unknown>> {
  const projection = plan.meta.projection;

  // Build a column-ref index when the projection alias-to-ref mapping is
  // unavailable so that decode failures and JSON-Schema validation can both
  // surface { table, column } from `meta.refs.columns` when present.
  const fallbackColumnRefIndex =
    !projection || Array.isArray(projection) ? buildColumnRefIndex(plan) : null;

  let aliases: readonly string[];
  if (projection && !Array.isArray(projection)) {
    aliases = Object.keys(projection);
  } else if (projection && Array.isArray(projection)) {
    aliases = projection;
  } else {
    aliases = Object.keys(row);
  }

  const tasks: Promise<unknown>[] = [];
  const includeIndices: { index: number; alias: string; value: unknown }[] = [];

  for (let i = 0; i < aliases.length; i++) {
    const alias = aliases[i] as string;
    const wireValue = row[alias];

    const projectionValue =
      projection && typeof projection === 'object' && !Array.isArray(projection)
        ? (projection as Record<string, string>)[alias]
        : undefined;

    if (typeof projectionValue === 'string' && projectionValue.startsWith('include:')) {
      includeIndices.push({ index: i, alias, value: wireValue });
      tasks.push(Promise.resolve(undefined));
      continue;
    }

    tasks.push(
      decodeField(
        alias,
        wireValue,
        plan,
        registry,
        jsonValidators,
        projection,
        fallbackColumnRefIndex,
      ),
    );
  }

  const settled = await Promise.all(tasks);

  // Include aggregates are decoded synchronously after concurrent codec
  // dispatch settles, so any decode failures upstream propagate first.
  for (const entry of includeIndices) {
    settled[entry.index] = decodeIncludeAggregate(entry.alias, entry.value);
  }

  const decoded: Record<string, unknown> = {};
  for (let i = 0; i < aliases.length; i++) {
    decoded[aliases[i] as string] = settled[i];
  }
  return decoded;
}
