import type { Contract } from '@prisma-next/contract/types';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { decodeField } from '@prisma-next/sql-runtime';
import {
  getColumnToFieldMap,
  isToOneCardinality,
  resolvePolymorphismInfo,
} from './collection-contract';
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
  RuntimeScope,
} from './types';

export function dispatchCollectionRows<Row>(options: {
  contract: Contract<SqlStorage>;
  context?: CollectionContext<Contract<SqlStorage>>['context'];
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
  context?: CollectionContext<Contract<SqlStorage>>['context'];
  runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
  modelName: string;
}): AsyncIterableResult<Row> {
  const strategy = selectIncludeStrategy(options.contract);

  if (
    hasNestedIncludes(options.state.includes) ||
    hasComplexIncludeDescriptors(options.state.includes)
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
  context?: CollectionContext<Contract<SqlStorage>>['context'];
  runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
  modelName: string;
}): AsyncIterableResult<Row> {
  const { contract, context, runtime, state, tableName, modelName, strategy } = options;
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

      // Precompute one decode plan per included table. Each plan resolves
      // column→codec once and is reused across every parent row and every
      // child of that include, eliminating O(parents × children × columns)
      // registry lookups.
      const includePlans = state.includes.map((include) => {
        if (include.scalar || include.combine) {
          return { include, plan: null };
        }
        const plan = context
          ? buildIncludeDecodePlan(
              contract,
              context,
              include.relatedModelName,
              include.relatedTableName,
            )
          : null;
        return { include, plan };
      });

      for (const parent of parentRows) {
        for (const { include, plan } of includePlans) {
          if (include.scalar || include.combine) {
            throw new Error(
              'single-query include strategy does not support scalar include selectors or combine()',
            );
          }
          const rawChildren = parseIncludedRows(parent.raw[include.relationName]);
          const mappedChildren = rawChildren.map((childRow) =>
            context && plan
              ? decodeIncludedRow(contract, context, plan, childRow)
              : mapStorageRowToModelFields(contract, include.relatedModelName, childRow),
          );
          parent.mapped[include.relationName] = coerceSingleQueryIncludeResult(
            mappedChildren,
            include.cardinality,
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
  context?: CollectionContext<Contract<SqlStorage>>['context'];
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

function hasNestedIncludes(includes: readonly IncludeExpr[]): boolean {
  return includes.some((include) => include.nested.includes.length > 0);
}

function hasComplexIncludeDescriptors(includes: readonly IncludeExpr[]): boolean {
  return includes.some((include) => include.scalar !== undefined || include.combine !== undefined);
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

interface IncludeDecodeColumn {
  readonly columnName: string;
  readonly fieldName: string;
  readonly codec: ReturnType<CollectionContext<Contract<SqlStorage>>['context']['codecs']['get']>;
}

interface IncludeDecodePlan {
  readonly tableName: string;
  readonly modelName: string;
  readonly columns: readonly IncludeDecodeColumn[];
}

/**
 * Precomputes the `{ columnName, fieldName, codec }` triples for every column
 * of an included table. Each included table resolves to a single plan reused
 * across all parent rows, so the per-column `context.codecs.get(codecId)`
 * lookup runs once per query instead of once per (parent, child, column).
 */
function buildIncludeDecodePlan(
  contract: Contract<SqlStorage>,
  context: CollectionContext<Contract<SqlStorage>>['context'],
  modelName: string,
  tableName: string,
): IncludeDecodePlan | null {
  const table = contract.storage.tables[tableName];
  if (!table) return null;

  const columnToField = getColumnToFieldMap(contract, modelName);
  const columns: IncludeDecodeColumn[] = [];
  for (const [columnName, column] of Object.entries(table.columns)) {
    const codecId = column?.codecId;
    const codec = codecId ? context.codecs.get(codecId) : undefined;
    columns.push({
      columnName,
      fieldName: columnToField[columnName] ?? columnName,
      codec,
    });
  }
  return { tableName, modelName, columns };
}

function decodeIncludedRow(
  _contract: Contract<SqlStorage>,
  context: CollectionContext<Contract<SqlStorage>>['context'],
  plan: IncludeDecodePlan,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const { columnName, fieldName, codec } of plan.columns) {
    if (!(columnName in row)) continue;
    seen.add(columnName);
    const wireValue = row[columnName];

    if (wireValue === null || wireValue === undefined) {
      mapped[fieldName] = wireValue;
      continue;
    }

    if (!codec) {
      mapped[fieldName] = wireValue;
      continue;
    }

    mapped[fieldName] = decodeField({
      alias: fieldName,
      wireValue,
      codec,
      jsonValidators: context.jsonSchemaValidators,
      tableName: plan.tableName,
      columnName,
    });
  }

  // Preserve any columns absent from the decode plan (forward-compat with
  // extension packs that ship extra wire-only aggregate fields).
  for (const [columnName, wireValue] of Object.entries(row)) {
    if (!seen.has(columnName) && !Object.hasOwn(mapped, columnName)) {
      mapped[columnName] = wireValue;
    }
  }

  return mapped;
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
