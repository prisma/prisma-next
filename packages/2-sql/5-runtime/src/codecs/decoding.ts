import { isRuntimeError, runtimeError } from '@prisma-next/framework-components/runtime';
import type {
  AnyQueryAst,
  Codec,
  CodecRegistry,
  ProjectionItem,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import type { JsonSchemaValidatorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import { validateJsonValue } from './json-schema-validation';

type ColumnRef = { table: string; column: string };

interface DecodeContext {
  readonly aliases: ReadonlyArray<string> | undefined;
  readonly codecs: ReadonlyMap<string, Codec>;
  readonly columnRefs: ReadonlyMap<string, ColumnRef>;
  readonly includeAliases: ReadonlySet<string>;
}

const WIRE_PREVIEW_LIMIT = 100;
const EMPTY_INCLUDE_ALIASES: ReadonlySet<string> = new Set<string>();

function isAstBackedPlan(
  plan: SqlExecutionPlan,
): plan is SqlExecutionPlan & { readonly ast: AnyQueryAst } {
  return plan.ast !== undefined;
}

function projectionListFromAst(ast: AnyQueryAst): ReadonlyArray<ProjectionItem> | undefined {
  if (ast.kind === 'select') {
    return ast.projection;
  }
  return ast.returning;
}

function buildDecodeContext(plan: SqlExecutionPlan, registry: CodecRegistry): DecodeContext {
  if (!isAstBackedPlan(plan)) {
    return {
      aliases: undefined,
      codecs: new Map(),
      columnRefs: new Map(),
      includeAliases: EMPTY_INCLUDE_ALIASES,
    };
  }

  const projection = projectionListFromAst(plan.ast);
  if (!projection) {
    return {
      aliases: undefined,
      codecs: new Map(),
      columnRefs: new Map(),
      includeAliases: EMPTY_INCLUDE_ALIASES,
    };
  }

  const aliases: string[] = [];
  const codecs = new Map<string, Codec>();
  const columnRefs = new Map<string, ColumnRef>();
  const includeAliases = new Set<string>();

  for (const item of projection) {
    aliases.push(item.alias);

    if (item.codecId) {
      const codec = registry.get(item.codecId);
      if (codec) {
        codecs.set(item.alias, codec);
      }
    }

    if (item.expr.kind === 'column-ref') {
      columnRefs.set(item.alias, { table: item.expr.table, column: item.expr.column });
    } else if (item.expr.kind === 'subquery' || item.expr.kind === 'json-array-agg') {
      includeAliases.add(item.alias);
    }
  }

  return { aliases, codecs, columnRefs, includeAliases };
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
  return isRuntimeError(error) && error.code === 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED';
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
  ctx: DecodeContext,
  jsonValidators: JsonSchemaValidatorRegistry | undefined,
): Promise<unknown> {
  if (wireValue === null || wireValue === undefined) {
    return wireValue;
  }

  const codec = ctx.codecs.get(alias);
  if (!codec) {
    return wireValue;
  }

  const ref = ctx.columnRefs.get(alias);

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
  plan: SqlExecutionPlan,
  registry: CodecRegistry,
  jsonValidators?: JsonSchemaValidatorRegistry,
): Promise<Record<string, unknown>> {
  const ctx = buildDecodeContext(plan, registry);

  const aliases = ctx.aliases ?? Object.keys(row);

  const tasks: Promise<unknown>[] = [];
  const includeIndices: { index: number; alias: string; value: unknown }[] = [];

  for (let i = 0; i < aliases.length; i++) {
    const alias = aliases[i] as string;
    const wireValue = row[alias];

    if (ctx.includeAliases.has(alias)) {
      includeIndices.push({ index: i, alias, value: wireValue });
      tasks.push(Promise.resolve(undefined));
      continue;
    }

    tasks.push(decodeField(alias, wireValue, ctx, jsonValidators));
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
