import {
  checkAborted,
  isRuntimeError,
  raceAgainstAbort,
  runtimeError,
} from '@prisma-next/framework-components/runtime';
import type {
  AnyQueryAst,
  Codec,
  ContractCodecRegistry,
  ProjectionItem,
  SqlCodecCallContext,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';

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

/**
 * Resolve the per-cell codec for a projection item.
 *
 * When a `(table, column)` ref is available — either implicit on a `column-ref` expression or carried explicitly via `item.refs` for column-bound non-`column-ref` projections — prefer `contractCodecs.forColumn(table, column)`: that returns the per-instance codec materialized from the descriptor's factory for that column, encoding any per-instance state (typeParams like vector length, schema validators, etc.).
 *
 * The wrong-instance risk for parameterized codecs that F22 originally flagged is closed off structurally:
 *
 * 1. `buildContractCodecRegistry` pre-populates `byCodecId` with one canonical instance per non-parameterized descriptor; parameterized descriptors are intentionally absent. 2. `forCodecId` rejects ambiguous parameterized fallbacks (`ambiguousCodecIds`). 3. The non-ambiguous parameterized case stores the column-correct per-instance codec under `byCodecId`, so the fall-through still resolves to the right instance.
 *
 * The `forCodecId` fallback otherwise covers projections that are *not* column-bound (computed projections, raw SQL aliases) but still carry a `codecId` (ADR 205 stamps every `ProjectionItem` with the producer's codec id).
 *
 * Codec-registry-unification spec § AC-4 / AC-5.
 */
function resolveProjectionCodec(
  item: ProjectionItem,
  contractCodecs: ContractCodecRegistry | undefined,
): Codec | undefined {
  if (contractCodecs) {
    if (item.expr.kind === 'column-ref') {
      const byColumn = contractCodecs.forColumn(item.expr.table, item.expr.column);
      if (byColumn) return byColumn;
    } else if (item.refs) {
      const byColumn = contractCodecs.forColumn(item.refs.table, item.refs.column);
      if (byColumn) return byColumn;
    }
  }
  if (item.codecId) {
    return contractCodecs?.forCodecId(item.codecId);
  }
  return undefined;
}

function buildDecodeContext(
  plan: SqlExecutionPlan,
  contractCodecs: ContractCodecRegistry | undefined,
): DecodeContext {
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

    const codec = resolveProjectionCodec(item, contractCodecs);
    if (codec) {
      codecs.set(item.alias, codec);
    }

    if (item.expr.kind === 'column-ref') {
      columnRefs.set(item.alias, { table: item.expr.table, column: item.expr.column });
    } else if (item.refs) {
      columnRefs.set(item.alias, { table: item.refs.table, column: item.refs.column });
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
 * Decodes a single field. Single-armed: every cell takes the same path — `codec.decode → await → return plain value` — so sync- and async-authored codecs are indistinguishable to callers. JSON-Schema validation, when required, lives inside the resolved codec's `decode` body (e.g. `arktype-json` validates against its rehydrated schema and throws `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` from `decode` directly); there is
 * no separate validator-registry pass.
 *
 * The row-level `rowCtx` is repackaged into a per-cell `SqlCodecCallContext` whose `column = { table, name }` is a structural projection of the per-cell `ColumnRef = { table, column }` resolved from the AST-backed `DecodeContext` (the same resolution `wrapDecodeFailure` uses for envelope construction — one resolution per cell, two consumers). Cells the runtime cannot resolve to a single underlying column (aggregate
 * aliases, computed projections without a simple ref) get `column: undefined`, matching the spec contract that the runtime never silently defaults this field.
 */
async function decodeField(
  alias: string,
  wireValue: unknown,
  decodeCtx: DecodeContext,
  rowCtx: SqlCodecCallContext,
): Promise<unknown> {
  if (wireValue === null) {
    return null;
  }

  const codec = decodeCtx.codecs.get(alias);
  if (!codec) {
    return wireValue;
  }

  const ref = decodeCtx.columnRefs.get(alias);

  // Per-cell ctx: the cell-level `column` is a `SqlColumnRef = { table, name }` projection of the resolved `ColumnRef = { table, column }` (same resolution `wrapDecodeFailure` uses below — no double work). Cells the runtime cannot resolve (aggregate aliases, computed projections without a simple ref) drop the `column` field entirely — explicitly cleared so a previously-populated `rowCtx.column` cannot leak through to
  // unrelated cells. Destructuring (rather than `column: undefined`) is required because `SqlCodecCallContext.column` is declared `column?: SqlColumnRef` under `exactOptionalPropertyTypes`.
  let cellCtx: SqlCodecCallContext;
  if (ref) {
    cellCtx = { ...rowCtx, column: { table: ref.table, name: ref.column } };
  } else {
    const { column: _drop, ...rowCtxWithoutColumn } = rowCtx;
    cellCtx = rowCtxWithoutColumn;
  }

  try {
    return await codec.decode(wireValue, cellCtx);
  } catch (error) {
    // Codec-authored runtime envelopes (e.g. `RUNTIME.DECODE_FAILED` thrown from inside the codec body, or `RUNTIME.ABORTED` raised via `CodecCallContext.signal` per ADR 207) carry their own per-codec context — wrapping them again would erase that context and coerce the abort intent into a generic decode failure. Pass them through unchanged; only foreign errors get the `wrapDecodeFailure` envelope.
    if (isRuntimeError(error)) {
      throw error;
    }
    wrapDecodeFailure(error, alias, ref, codec, wireValue);
  }
}

/**
 * Decodes a row by dispatching all per-cell codec calls concurrently via `Promise.all`. Each cell follows the single-armed `decodeField` path. Failures are wrapped in `RUNTIME.DECODE_FAILED` with `{ table, column, codec }` (or `{ alias, codec }` when no column ref is resolvable) and the original error attached on `cause`.
 *
 * When `rowCtx.signal` is provided:
 *
 * - **Already-aborted at entry** short-circuits with `RUNTIME.ABORTED` (`{ phase: 'decode' }`) before any `codec.decode` call is made.
 * - **Mid-flight aborts** race the per-cell `Promise.all` against the signal so the runtime returns promptly even when codec bodies ignore it. In-flight bodies that ignore the signal complete in the background (cooperative cancellation).
 * - Existing `RUNTIME.DECODE_FAILED` envelopes from codec bodies pass through unchanged (no double wrap).
 */
export async function decodeRow(
  row: Record<string, unknown>,
  plan: SqlExecutionPlan,
  rowCtx: SqlCodecCallContext,
  contractCodecs?: ContractCodecRegistry,
): Promise<Record<string, unknown>> {
  checkAborted(rowCtx, 'decode');
  const signal = rowCtx.signal;

  const decodeCtx = buildDecodeContext(plan, contractCodecs);

  const aliases = decodeCtx.aliases ?? Object.keys(row);

  if (decodeCtx.aliases !== undefined) {
    for (const alias of decodeCtx.aliases) {
      if (!Object.hasOwn(row, alias)) {
        throw runtimeError('RUNTIME.DECODE_FAILED', `Row missing projection alias "${alias}"`, {
          alias,
          expectedAliases: decodeCtx.aliases,
          presentKeys: Object.keys(row),
        });
      }
    }
  }

  const tasks: Promise<unknown>[] = [];
  const includeIndices: { index: number; alias: string; value: unknown }[] = [];

  for (let i = 0; i < aliases.length; i++) {
    const alias = aliases[i] as string;
    const wireValue = row[alias];

    if (decodeCtx.includeAliases.has(alias)) {
      includeIndices.push({ index: i, alias, value: wireValue });
      tasks.push(Promise.resolve(undefined));
      continue;
    }

    tasks.push(decodeField(alias, wireValue, decodeCtx, rowCtx));
  }

  const settled = await raceAgainstAbort(Promise.all(tasks), signal, 'decode');

  // Include aggregates are decoded synchronously after concurrent codec dispatch settles, so any decode failures upstream propagate first.
  for (const entry of includeIndices) {
    settled[entry.index] = decodeIncludeAggregate(entry.alias, entry.value);
  }

  const decoded: Record<string, unknown> = {};
  for (let i = 0; i < aliases.length; i++) {
    decoded[aliases[i] as string] = settled[i];
  }
  return decoded;
}
