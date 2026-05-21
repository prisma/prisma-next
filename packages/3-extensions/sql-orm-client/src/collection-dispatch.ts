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
import type { RuntimeScope } from '@prisma-next/sql-relational-core/types';
import { isToOneCardinality, resolvePolymorphismInfo } from './collection-contract';
import {
  acquireRuntimeScope,
  augmentSelectionForJoinColumns,
  createRowEnvelope,
  mapPolymorphicRow,
  mapResultRows,
  mapStorageRowToModelFields,
  type RowEnvelope,
  stripHiddenMappedFields,
} from './collection-runtime';
import { executeQueryPlan } from './execute-query-plan';
import { selectIncludeStrategy } from './include-strategy';
import {
  compileRelationSelect,
  compileSelect,
  compileSelectWithIncludeStrategy,
} from './query-plan';
import type {
  CollectionContext,
  CollectionState,
  IncludeExpr,
  IncludeScalar,
  RelationCardinalityTag,
} from './types';

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

  return dispatchWithIncludeStrategy<Row>(options);
}

function dispatchWithIncludeStrategy<Row>(options: {
  contract: Contract<SqlStorage>;
  runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
  modelName: string;
}): AsyncIterableResult<Row> {
  const strategy = selectIncludeStrategy(options.contract);

  // Nested row includes (depth >= 2) are emitted recursively by the
  // lateral / correlated builders — they no longer force a fallback to
  // multi-query (TML-2594). Scalar (`count`/`sum`/...) and `combine()`
  // descriptors still do, until TML-2595 lands the matching lowering;
  // the recursive scan below catches them at any depth so a nested
  // `count()` inside a row include doesn't accidentally hit the
  // throw in `compileSelectWithIncludeStrategy`.
  //
  // `distinct()` on a non-leaf include is also forced through multi-query:
  // under the single-query strategies the child SELECT carries nested
  // JSON aggregate columns, and `SELECT DISTINCT` over those fails on
  // Postgres (`json` has no equality operator). The multi-query stitcher
  // applies distinct to scalar-only child rows before grandchildren are
  // joined, which is the semantically correct behavior we preserve.
  if (
    hasComplexIncludeDescriptors(options.state.includes) ||
    hasNonLeafIncludeWithDistinct(options.state.includes)
  ) {
    return dispatchWithMultiQueryIncludes<Row>(options);
  }

  switch (strategy) {
    case 'lateral':
      return dispatchWithSingleQueryIncludes<Row>({
        ...options,
        strategy: 'lateral',
      });
    case 'correlated':
      return dispatchWithSingleQueryIncludes<Row>({
        ...options,
        strategy: 'correlated',
      });
    default:
      return dispatchWithMultiQueryIncludes<Row>(options);
  }
}

function dispatchWithSingleQueryIncludes<Row>(options: {
  strategy: 'lateral' | 'correlated';
  contract: Contract<SqlStorage>;
  runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
  modelName: string;
}): AsyncIterableResult<Row> {
  const { contract, runtime, state, tableName, modelName, strategy } = options;
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const { scope, release } = await acquireRuntimeScope(runtime);
    try {
      const parentJoinColumns = state.includes.map((include) => include.localColumn);
      const { selectedForQuery: parentSelectedForQuery, hiddenColumns: hiddenParentColumns } =
        augmentSelectionForJoinColumns(state.selectedFields, parentJoinColumns);
      const compiled = compileSelectWithIncludeStrategy(
        contract,
        tableName,
        {
          ...state,
          selectedFields: parentSelectedForQuery,
        },
        strategy,
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

function dispatchWithMultiQueryIncludes<Row>(options: {
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
      const parentJoinColumns = state.includes.map((include) => include.localColumn);
      const { selectedForQuery: parentSelectedForQuery, hiddenColumns: hiddenParentColumns } =
        augmentSelectionForJoinColumns(state.selectedFields, parentJoinColumns);
      const parentCompiled = compileSelect(
        contract,
        tableName,
        {
          ...state,
          includes: [],
          selectedFields: parentSelectedForQuery,
        },
        modelName,
      );
      const parentRowsRaw = await executeQueryPlan<Record<string, unknown>>(
        scope,
        parentCompiled,
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
      await stitchIncludes(scope, contract, parentRows, state.includes);

      if (hiddenParentColumns.length > 0) {
        for (const row of parentRows) {
          stripHiddenMappedFields(contract, modelName, row.mapped, hiddenParentColumns);
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

export async function stitchIncludes(
  scope: RuntimeScope,
  contract: Contract<SqlStorage>,
  parentRows: RowEnvelope[],
  includes: readonly IncludeExpr[],
): Promise<void> {
  for (const include of includes) {
    const parentJoinValues = uniqueValues(
      parentRows.map((row) => row.raw[include.localColumn]).filter((value) => value !== undefined),
    );

    if (parentJoinValues.length === 0) {
      assignEmptyIncludeResult(parentRows, include);
      continue;
    }

    if (include.combine) {
      await stitchCombinedInclude(scope, contract, parentRows, include, parentJoinValues);
      continue;
    }

    if (include.scalar) {
      await stitchScalarInclude(
        scope,
        contract,
        parentRows,
        include,
        include.scalar,
        parentJoinValues,
      );
      continue;
    }

    await stitchRowInclude(scope, contract, parentRows, include, include.nested, parentJoinValues);
  }
}

async function stitchCombinedInclude(
  scope: RuntimeScope,
  contract: Contract<SqlStorage>,
  parentRows: RowEnvelope[],
  include: IncludeExpr,
  parentJoinValues: readonly unknown[],
): Promise<void> {
  const branches = include.combine ?? {};

  for (const parent of parentRows) {
    parent.mapped[include.relationName] = {};
  }

  for (const [branchName, branch] of Object.entries(branches)) {
    if (branch.kind === 'rows') {
      const rowsByParent = await resolveRowsByParent(
        scope,
        contract,
        include,
        branch.state,
        parentJoinValues,
      );
      for (const parent of parentRows) {
        const parentJoinValue = parent.raw[include.localColumn];
        const relatedRows = rowsByParent.get(parentJoinValue) ?? [];
        const combined = parent.mapped[include.relationName] as Record<string, unknown>;
        combined[branchName] = coerceIncludeResult(relatedRows, branch.state, include.cardinality);
      }
      continue;
    }

    const scalarByParent = await resolveScalarByParent(
      scope,
      contract,
      include,
      branch.selector,
      parentJoinValues,
    );
    for (const parent of parentRows) {
      const parentJoinValue = parent.raw[include.localColumn];
      const combined = parent.mapped[include.relationName] as Record<string, unknown>;
      combined[branchName] =
        scalarByParent.get(parentJoinValue) ?? emptyScalarResult(branch.selector.fn);
    }
  }
}

async function stitchScalarInclude(
  scope: RuntimeScope,
  contract: Contract<SqlStorage>,
  parentRows: RowEnvelope[],
  include: IncludeExpr,
  selector: IncludeScalar<unknown>,
  parentJoinValues: readonly unknown[],
): Promise<void> {
  const scalarByParent = await resolveScalarByParent(
    scope,
    contract,
    include,
    selector,
    parentJoinValues,
  );

  for (const parent of parentRows) {
    const parentJoinValue = parent.raw[include.localColumn];
    parent.mapped[include.relationName] =
      scalarByParent.get(parentJoinValue) ?? emptyScalarResult(selector.fn);
  }
}

async function stitchRowInclude(
  scope: RuntimeScope,
  contract: Contract<SqlStorage>,
  parentRows: RowEnvelope[],
  include: IncludeExpr,
  state: CollectionState,
  parentJoinValues: readonly unknown[],
): Promise<void> {
  const rowsByParent = await resolveRowsByParent(scope, contract, include, state, parentJoinValues);

  for (const parent of parentRows) {
    const parentJoinValue = parent.raw[include.localColumn];
    const relatedRows = rowsByParent.get(parentJoinValue) ?? [];
    parent.mapped[include.relationName] = coerceIncludeResult(
      relatedRows,
      state,
      include.cardinality,
    );
  }
}

async function resolveRowsByParent(
  scope: RuntimeScope,
  contract: Contract<SqlStorage>,
  include: IncludeExpr,
  state: CollectionState,
  parentJoinValues: readonly unknown[],
): Promise<Map<unknown, Record<string, unknown>[]>> {
  const { selectedForQuery: childSelectedForQuery, hiddenColumns: hiddenChildColumns } =
    augmentSelectionForJoinColumns(state.selectedFields, [include.targetColumn]);

  const childCompiled = compileRelationSelect(
    contract,
    include.relatedTableName,
    include.targetColumn,
    parentJoinValues,
    {
      ...state,
      selectedFields: childSelectedForQuery,
    },
  );
  const childRowsRaw = await executeQueryPlan<Record<string, unknown>>(
    scope,
    childCompiled,
  ).toArray();
  const childRows = childRowsRaw.map((row) =>
    createRowEnvelope(contract, include.relatedModelName, row),
  );

  if (state.includes.length > 0) {
    await stitchIncludes(scope, contract, childRows, state.includes);
  }

  const childByParentJoin = new Map<unknown, Record<string, unknown>[]>();
  for (const child of childRows) {
    const joinValue = child.raw[include.targetColumn];

    if (hiddenChildColumns.length > 0) {
      stripHiddenMappedFields(contract, include.relatedModelName, child.mapped, hiddenChildColumns);
    }

    let bucket = childByParentJoin.get(joinValue);
    if (!bucket) {
      bucket = [];
      childByParentJoin.set(joinValue, bucket);
    }
    bucket.push(child.mapped);
  }

  return childByParentJoin;
}

async function resolveScalarByParent(
  scope: RuntimeScope,
  contract: Contract<SqlStorage>,
  include: IncludeExpr,
  selector: IncludeScalar<unknown>,
  parentJoinValues: readonly unknown[],
): Promise<Map<unknown, unknown>> {
  const requiredColumns = selector.column
    ? [include.targetColumn, selector.column]
    : [include.targetColumn];
  const { selectedForQuery } = augmentSelectionForJoinColumns(
    selector.state.selectedFields,
    requiredColumns,
  );

  const childCompiled = compileRelationSelect(
    contract,
    include.relatedTableName,
    include.targetColumn,
    parentJoinValues,
    {
      ...selector.state,
      selectedFields: selectedForQuery,
      includes: [],
    },
  );
  const childRowsRaw = await executeQueryPlan<Record<string, unknown>>(
    scope,
    childCompiled,
  ).toArray();

  const rowsByParent = new Map<unknown, Record<string, unknown>[]>();
  for (const row of childRowsRaw) {
    const joinValue = row[include.targetColumn];
    let bucket = rowsByParent.get(joinValue);
    if (!bucket) {
      bucket = [];
      rowsByParent.set(joinValue, bucket);
    }
    bucket.push(row);
  }

  const scalarByParent = new Map<unknown, unknown>();
  for (const [joinValue, rows] of rowsByParent) {
    const scopedRows = slicePerParent(rows, selector.state);
    scalarByParent.set(joinValue, computeScalarValue(selector, scopedRows));
  }

  return scalarByParent;
}

function uniqueValues(values: unknown[]): unknown[] {
  return [...new Set(values)];
}

function hasComplexIncludeDescriptors(includes: readonly IncludeExpr[]): boolean {
  // Walks the include tree recursively. A nested scalar selector or
  // combine() at any depth must gate the entire dispatch to multi-query
  // until TML-2595 teaches the lateral/correlated builders to lower
  // those descriptors. Without the recursion, a depth-2+ row include
  // containing a depth-3 `count()` would fall through to
  // `compileSelectWithIncludeStrategy` and hit its explicit `throw`.
  return includes.some(
    (include) =>
      include.scalar !== undefined ||
      include.combine !== undefined ||
      hasComplexIncludeDescriptors(include.nested.includes),
  );
}

function hasNonLeafIncludeWithDistinct(includes: readonly IncludeExpr[]): boolean {
  // Walks the include tree recursively. An include whose nested state
  // carries both `distinct` and further nested includes cannot be
  // lowered into the single-query strategies: the child SELECT would
  // emit `SELECT DISTINCT <scalars>, json_agg(<nested>) FROM ...`,
  // and Postgres rejects equality on `json`. Routing to multi-query
  // applies distinct to scalar-only rows before grandchildren stitch
  // in JS. `distinctOn` is intentionally not included here: Postgres
  // only compares the `ON (...)` expressions for equality, so a
  // hashable key column plus json projections is well-defined.
  return includes.some(
    (include) =>
      (include.nested.distinct !== undefined &&
        include.nested.distinct.length > 0 &&
        include.nested.includes.length > 0) ||
      hasNonLeafIncludeWithDistinct(include.nested.includes),
  );
}

/**
 * Decode a single-query include payload from a parent row's raw cell
 * into the model-shaped value that downstream consumers see. Recurses
 * through `include.nested.includes` so depth-2+ trees — emitted by the
 * recursive lateral / correlated builders — are decoded symmetrically.
 *
 * The shape produced by the SQL side is one JSON column per top-level
 * include; values nested inside that JSON are already-parsed JS values
 * after the outer `JSON.parse`, so `parseIncludedRows` recognises both
 * the string (top-level) and array (nested) forms.
 */
function decodeIncludePayload(
  contract: Contract<SqlStorage>,
  include: IncludeExpr,
  raw: unknown,
): Record<string, unknown>[] | Record<string, unknown> | null {
  const rawChildren = parseIncludedRows(raw);
  const mappedChildren = rawChildren.map((childRow) => {
    const mapped = mapStorageRowToModelFields(contract, include.relatedModelName, childRow);
    for (const nestedInclude of include.nested.includes) {
      // Defence in depth: the dispatch gate filters scalar/combine at
      // any depth via `hasComplexIncludeDescriptors`. This branch is
      // unreachable in production but documents the contract the
      // recursion relies on.
      if (nestedInclude.scalar || nestedInclude.combine) {
        throw new Error(
          'single-query include strategy does not support nested scalar include selectors or combine()',
        );
      }
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

function assignEmptyIncludeResult(parentRows: RowEnvelope[], include: IncludeExpr): void {
  if (include.combine) {
    for (const parent of parentRows) {
      const combined: Record<string, unknown> = {};
      for (const [branchName, branch] of Object.entries(include.combine)) {
        combined[branchName] =
          branch.kind === 'rows'
            ? emptyIncludeResult(include.cardinality)
            : emptyScalarResult(branch.selector.fn);
      }
      parent.mapped[include.relationName] = combined;
    }
    return;
  }

  if (include.scalar) {
    for (const parent of parentRows) {
      parent.mapped[include.relationName] = emptyScalarResult(include.scalar.fn);
    }
    return;
  }

  for (const parent of parentRows) {
    parent.mapped[include.relationName] = emptyIncludeResult(include.cardinality);
  }
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

function slicePerParent(
  rows: Record<string, unknown>[],
  state: CollectionState,
): Record<string, unknown>[] {
  const offset = state.offset ?? 0;
  if (state.limit === undefined) {
    return rows.slice(offset);
  }
  return rows.slice(offset, offset + state.limit);
}

function emptyIncludeResult(
  cardinality: RelationCardinalityTag | undefined,
): Record<string, unknown>[] | Record<string, unknown> | null {
  return isToOneCardinality(cardinality) ? null : [];
}

function coerceIncludeResult(
  rows: Record<string, unknown>[],
  state: CollectionState,
  cardinality: RelationCardinalityTag | undefined,
): Record<string, unknown>[] | Record<string, unknown> | null {
  const sliced = slicePerParent(rows, state);
  return isToOneCardinality(cardinality) ? (sliced[0] ?? null) : sliced;
}

function emptyScalarResult(fn: IncludeScalar<unknown>['fn']): number | null {
  return fn === 'count' ? 0 : null;
}

function computeScalarValue(
  selector: IncludeScalar<unknown>,
  rows: readonly Record<string, unknown>[],
): number | null {
  if (selector.fn === 'count') {
    return rows.length;
  }

  const column = selector.column;
  if (!column) {
    return null;
  }

  const numericValues = rows
    .map((row) => coerceNumericValue(row[column]))
    .filter((value): value is number => value !== null);

  if (numericValues.length === 0) {
    return null;
  }

  if (selector.fn === 'sum') {
    return numericValues.reduce((total, value) => total + value, 0);
  }

  if (selector.fn === 'avg') {
    const total = numericValues.reduce((sum, value) => sum + value, 0);
    return total / numericValues.length;
  }

  if (selector.fn === 'min') {
    return Math.min(...numericValues);
  }

  if (selector.fn === 'max') {
    return Math.max(...numericValues);
  }

  return null;
}

function coerceNumericValue(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    return Number.isNaN(numeric) ? null : numeric;
  }

  return null;
}
