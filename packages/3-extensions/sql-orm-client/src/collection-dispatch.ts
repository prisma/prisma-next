/**
 * Collection row dispatch.
 *
 * Per-row decoding is performed upstream in `sql-runtime`'s row-yielding async
 * generator (it `await`s `decodeRow` once per row before yielding). This file
 * never calls codec query-time methods directly; it consumes plain decoded
 * cells through `executeQueryPlan` → `scope.execute(plan)` →
 * `AsyncIterableResult<Row>`. Every `for await` / `.toArray()` consumer below
 * therefore sees plain `T` values, not `Promise<T>`.
 *
 * See `packages/2-sql/5-runtime/src/codecs/decoding.ts` for the decode-once-
 * per-row contract; this file is the consumer side of that contract. See also
 * ADR 030 (codecs registry & decode boundary) and the m3 coverage in
 * `test/integration/codec-async.test.ts` and `test/codec-async.types.test-d.ts`.
 */

import type { Contract } from '@prisma-next/contract/types';
import { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  ListExpression,
  LiteralExpr,
  OrExpr,
} from '@prisma-next/sql-relational-core/ast';
import {
  isToOneCardinality,
  resolvePolymorphismInfo,
  resolveRowIdentityColumns,
} from './collection-contract';
import {
  acquireRuntimeScope,
  mapPolymorphicRow,
  mapResultRows,
  mapStorageRowToModelFields,
  type RowEnvelope,
  stripHiddenMappedFields,
} from './collection-runtime';
import { executeQueryPlan } from './execute-query-plan';
import { compileSelect, compileSelectWithIncludes } from './query-plan';
import { augmentSelectionForJoinColumns } from './selection-shaping';
import {
  type CollectionContext,
  type CollectionState,
  emptyState,
  type IncludeCombineBranch,
  type IncludeExpr,
  type IncludeScalar,
  type RelationCardinalityTag,
} from './types';
import { bindWhereExpr } from './where-binding';

export function dispatchCollectionRows<Row>(options: {
  contract: Contract<SqlStorage>;
  runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
  modelName: string;
}): AsyncIterableResult<Row> {
  const { contract, runtime, state, tableName, modelName } = options;
  const polyInfo = resolvePolymorphismInfo(contract, modelName);

  if (state.includes.length === 0) {
    const compiled = compileSelect(contract, tableName, state, modelName);
    const source = executeQueryPlan<Record<string, unknown>>(runtime, compiled);
    const mapper = polyInfo
      ? (rawRow: Record<string, unknown>) =>
          mapPolymorphicRow(contract, modelName, polyInfo, rawRow, state.variantName) as Row
      : (rawRow: Record<string, unknown>) =>
          mapStorageRowToModelFields(contract, modelName, rawRow) as Row;
    return mapResultRows(source, mapper);
  }

  return dispatchWithIncludes<Row>(options);
}

// The correlated-subquery include builder lowers every include
// descriptor shape (row, scalar reducers, and combine()) at any depth
// into a single query; the read path has no multi-query fallback.
function dispatchWithIncludes<Row>(options: {
  contract: Contract<SqlStorage>;
  runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
  modelName: string;
}): AsyncIterableResult<Row> {
  const { contract, runtime, state, tableName, modelName } = options;
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const { scope, release } = await acquireRuntimeScope(runtime);
    try {
      const parentJoinColumns = state.includes.flatMap((include) =>
        include.through !== undefined ? include.through.parentLocalColumns : [include.localColumn],
      );
      const { selectedForQuery: parentSelectedForQuery, hiddenColumns: hiddenParentColumns } =
        augmentSelectionForJoinColumns(state.selectedFields, parentJoinColumns);
      const compiled = compileSelectWithIncludes(
        contract,
        tableName,
        {
          ...state,
          selectedFields: parentSelectedForQuery,
        },
        modelName,
      );

      const parentRowsRaw = await executeQueryPlan<Record<string, unknown>>(
        scope,
        compiled,
      ).toArray();
      if (parentRowsRaw.length === 0) {
        return;
      }

      const polyInfo = resolvePolymorphismInfo(contract, modelName);
      const parentRows = parentRowsRaw.map((row) => {
        const mapped = polyInfo
          ? mapPolymorphicRow(contract, modelName, polyInfo, row, state.variantName)
          : mapStorageRowToModelFields(contract, modelName, row);
        return { raw: row, mapped } as RowEnvelope;
      });

      for (const parent of parentRows) {
        for (const include of state.includes) {
          parent.mapped[include.relationName] = decodeIncludePayload(
            contract,
            include,
            parent.raw[include.relationName],
          );
        }

        if (hiddenParentColumns.length > 0) {
          stripHiddenMappedFields(contract, modelName, parent.mapped, hiddenParentColumns);
        }
      }

      for (const row of parentRows) {
        yield row.mapped as Row;
      }
    } finally {
      if (release) {
        await release();
      }
    }
  };

  return new AsyncIterableResult(generator());
}

/**
 * Reload the rows a mutation just wrote (create / createAll / update /
 * updateAll / upsert) through the read-path dispatch, so `.include()`
 * relations resolve via the exact same correlated-subquery builder,
 * decode, hidden-column stripping, and polymorphism mapping a read
 * query uses — there is no parallel mutation read-back implementation.
 *
 * The mutation returns only its identity columns (PK / unique); this
 * re-selects those rows with the caller's projection + includes, keyed
 * by `identity IN (...)`. One round-trip regardless of row count or
 * include depth. The read-back observes the just-written rows because
 * it runs on the same runtime — and therefore the same transaction —
 * the mutation ran on.
 *
 * Delete read-back does NOT come through here: a parent-anchored
 * include query can't observe an already-deleted row, so delete reads
 * its snapshot before issuing the DELETE (see `collection.ts`).
 */
export function reloadMutationRowsByIdentities<Row>(options: {
  contract: Contract<SqlStorage>;
  runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  tableName: string;
  modelName: string;
  identityRows: readonly Record<string, unknown>[];
  selectedFields: readonly string[] | undefined;
  includes: readonly IncludeExpr[];
}): AsyncIterableResult<Row> {
  const { contract, runtime, tableName, modelName, identityRows, selectedFields, includes } =
    options;
  if (identityRows.length === 0) {
    return emptyResult<Row>();
  }

  const identityColumns = resolveRowIdentityColumns(contract, tableName);
  if (identityColumns.length === 0) {
    throw new Error(
      `Cannot load includes for the mutation result on model "${modelName}": table "${tableName}" has no primary key or unique constraint to key the include read-back on.`,
    );
  }

  const identityFilter = buildIdentityInFilter(contract, tableName, identityColumns, identityRows);
  if (!identityFilter) {
    return emptyResult<Row>();
  }

  return dispatchCollectionRows<Row>({
    contract,
    runtime,
    state: {
      ...emptyState(),
      filters: [identityFilter],
      selectedFields,
      includes,
    },
    tableName,
    modelName,
  });
}

function emptyResult<Row>(): AsyncIterableResult<Row> {
  return new AsyncIterableResult((async function* (): AsyncGenerator<Row, void, unknown> {})());
}

// Identity values come straight from the mutation's `RETURNING`, so they
// are unique by construction — no JS-side dedup; the database evaluates
// the `IN` list (or the composite-key `OR` of equality tuples) directly.
function buildIdentityInFilter(
  contract: Contract<SqlStorage>,
  tableName: string,
  identityColumns: readonly string[],
  identityRows: readonly Record<string, unknown>[],
): AnyExpression | undefined {
  const [singleColumn, ...rest] = identityColumns;
  if (singleColumn !== undefined && rest.length === 0) {
    const values = identityRows
      .map((row) => row[singleColumn])
      .filter((value) => value !== undefined);
    if (values.length === 0) {
      return undefined;
    }
    return bindWhereExpr(
      contract,
      BinaryExpr.in(ColumnRef.of(tableName, singleColumn), ListExpression.fromValues(values)),
    );
  }

  if (identityRows.length === 0) {
    return undefined;
  }
  const tuples = identityRows.map((row) =>
    AndExpr.of(
      identityColumns.map((column) =>
        BinaryExpr.eq(ColumnRef.of(tableName, column), LiteralExpr.of(row[column])),
      ),
    ),
  );
  return bindWhereExpr(contract, OrExpr.of(tuples));
}

/**
 * Decode a single-query include payload from a parent row's raw cell
 * into the model-shaped value that downstream consumers see. Recurses
 * through `include.nested.includes` so depth-2+ trees — emitted by the
 * recursive correlated-subquery builder — are decoded symmetrically.
 *
 * The shape produced by the SQL side is one JSON column per top-level
 * include; values nested inside that JSON are already-parsed JS values
 * after the outer `JSON.parse`, so `parseIncludedRows` recognises both
 * the string (top-level) and array (nested) forms.
 *
 * Scalar leaves arrive wrapped in a `{ value: <primitive> }` JSON
 * envelope (see `buildIncludeChildScalarSelect`); the branch below
 * unwraps that envelope and passes the value straight through. The
 * empty-relation default is driven by SQL semantics, not the decoder:
 * `COUNT(*)` over an empty input set is `0`; `SUM` / `AVG` / `MIN` /
 * `MAX` over an empty input set are SQL `NULL`, which surfaces as
 * `null` in TS — the documented contract for those reducers.
 *
 * Combine descriptors arrive as a JSON object keyed by branch name;
 * each branch is dispatched to the row or scalar decoder per its
 * declared shape (see `decodeCombineIncludePayload`).
 */
function decodeIncludePayload(
  contract: Contract<SqlStorage>,
  include: IncludeExpr,
  raw: unknown,
): unknown {
  if (include.scalar) {
    return decodeScalarIncludePayload(include, include.scalar, raw);
  }
  if (include.combine) {
    return decodeCombineIncludePayload(contract, include, include.combine, raw);
  }
  const rawChildren = parseIncludedRows(raw);
  const mappedChildren = rawChildren.map((childRow) => {
    const mapped = mapStorageRowToModelFields(contract, include.relatedModelName, childRow);
    for (const nestedInclude of include.nested.includes) {
      mapped[nestedInclude.relationName] = decodeIncludePayload(
        contract,
        nestedInclude,
        mapped[nestedInclude.relationName],
      );
    }
    return mapped;
  });
  return coerceSingleQueryIncludeResult(mappedChildren, include.cardinality);
}

/**
 * Decode the combine payload produced by `buildIncludeChildCombineSelect`.
 *
 * The raw value is a JSON object (already parsed by the SQL layer when
 * top-level, or already a JS object when nested) whose keys are branch
 * names. Each branch value is decoded per its declared kind:
 *  - row branch -> recurse via `decodeIncludePayload` with a synthetic
 *    IncludeExpr carrying the branch's state in `nested`. This walks
 *    nested row-level includes the same way a plain row include would.
 *  - scalar branch -> unwrap the `{value: ...}` envelope via the
 *    standalone scalar decoder.
 *
 * On a parent with zero matching child rows the correlated subquery
 * still produces one row (aggregates collapse the empty input to a
 * single row), so the combine envelope here is always present in the
 * read path. The
 * mutation read-back's `assignEmptyMutationIncludes` writes the empty
 * per-branch shape directly to `parent.mapped[relationName]` for any
 * parent absent from the read-back result and never enters the decoder,
 * so a missing or non-object envelope here is always a planner/decoder
 * bug — `parseCombineEnvelope` throws loudly rather than papering over
 * it with an empty shape.
 */
function decodeCombineIncludePayload(
  contract: Contract<SqlStorage>,
  include: IncludeExpr,
  branches: Readonly<Record<string, IncludeCombineBranch>>,
  raw: unknown,
): Record<string, unknown> {
  const parsed = parseCombineEnvelope(include, raw);
  const result: Record<string, unknown> = {};
  for (const [branchName, branch] of Object.entries(branches)) {
    const branchRaw = parsed[branchName];
    if (branch.kind === 'rows') {
      const syntheticInclude: IncludeExpr = {
        ...include,
        nested: branch.state,
        scalar: undefined,
        combine: undefined,
      };
      result[branchName] = decodeIncludePayload(contract, syntheticInclude, branchRaw);
    } else {
      result[branchName] = decodeScalarIncludePayload(include, branch.selector, branchRaw);
    }
  }
  return result;
}

function parseCombineEnvelope(include: IncludeExpr, raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) {
    throw new Error(
      `combine() envelope for include "${include.relationName}" is missing (got ${raw === null ? 'null' : 'undefined'}); the correlated subquery should always produce a JSON object — this indicates a planner or decoder bug.`,
    );
  }
  const parsed = parseIncludePayload(raw);
  if (!isPlainObjectEnvelope(parsed)) {
    throw new Error(
      `combine() envelope for include "${include.relationName}" has unexpected shape (expected object, got ${describeEnvelopeShape(parsed)}); this indicates a planner or decoder bug.`,
    );
  }
  return parsed;
}

function isPlainObjectEnvelope(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeEnvelopeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Pull the primitive scalar value out of the JSON envelope emitted by
 * the correlated scalar builder.
 *
 * Contract: the envelope is always either
 *   - a `{ value: <primitive> }` JSON object (the SQL path), or
 *   - `null` / `undefined` (the mutation read-back's
 *     `assignEmptyMutationIncludes` short-circuit before this decoder
 *     runs, for a parent absent from the read-back result).
 *
 * Any other shape — array, primitive, string that JSON-parses to
 * non-object — indicates a planner / decoder bug, so we throw
 * loudly naming the include relation rather than soft-handling.
 * Mirrors `parseCombineEnvelope`'s strict shape gate.
 *
 * Values are passed through unchanged — no JS-side `Number()` coercion
 * and no JS-side empty-relation defaulting. SQL semantics drive the
 * empty-relation case: `COUNT(*)` over an empty input set is `0`;
 * `SUM` / `AVG` / `MIN` / `MAX` over an empty input set return SQL
 * `NULL`, which surfaces as `null` here. The outer `raw === null`
 * fallback is defensive cover for an empty parent set; in single-query
 * dispatch the correlated subquery always produces a row, so the inner
 * envelope's `value` is always set by SQL.
 */
function decodeScalarIncludePayload(
  include: IncludeExpr,
  scalar: IncludeScalar<unknown>,
  raw: unknown,
): unknown {
  if (raw === null || raw === undefined) {
    return emptyScalarResult(scalar.fn);
  }
  const parsed = parseIncludePayload(raw);
  if (!isPlainObjectEnvelope(parsed)) {
    throw new Error(
      `scalar() envelope for include "${include.relationName}" has unexpected shape (expected object, got ${describeEnvelopeShape(parsed)}); this indicates a planner or decoder bug.`,
    );
  }
  return parsed['value'];
}

function parseIncludedRows(value: unknown): Record<string, unknown>[] {
  if (value === null || value === undefined) {
    return [];
  }

  const parsed = parseIncludePayload(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const rows: Record<string, unknown>[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    rows.push({ ...(item as Record<string, unknown>) });
  }

  return rows;
}

function parseIncludePayload(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function coerceSingleQueryIncludeResult(
  rows: Record<string, unknown>[],
  cardinality: RelationCardinalityTag | undefined,
): Record<string, unknown>[] | Record<string, unknown> | null {
  return isToOneCardinality(cardinality) ? (rows[0] ?? null) : rows;
}

function emptyScalarResult(fn: IncludeScalar<unknown>['fn']): number | null {
  return fn === 'count' ? 0 : null;
}
