import { executeCompiledQuery } from '@prisma-next/integration-kysely';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { isToOneCardinality } from './collection-contract';
import {
  acquireRuntimeScope,
  augmentSelectionForJoinColumns,
  createRowEnvelope,
  mapResultRows,
  mapStorageRowToModelFields,
  type RowEnvelope,
  stripHiddenMappedFields,
} from './collection-runtime';
import { selectIncludeStrategy } from './include-strategy';
import {
  compileRelationSelect,
  compileSelect,
  compileSelectWithIncludeStrategy,
} from './kysely-compiler';
import type {
  CollectionContext,
  CollectionState,
  IncludeExpr,
  RelationCardinalityTag,
  RuntimeScope,
} from './types';

export function dispatchCollectionRows<Row>(options: {
  contract: SqlContract<SqlStorage>;
  runtime: CollectionContext<SqlContract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
}): AsyncIterableResult<Row> {
  const { contract, runtime, state, tableName } = options;

  if (state.includes.length === 0) {
    const compiled = compileSelect(tableName, state);
    const source = executeCompiledQuery<Record<string, unknown>>(runtime, contract, compiled, {
      lane: 'orm-client',
    });
    return mapResultRows(
      source,
      (rawRow) => mapStorageRowToModelFields(contract, tableName, rawRow) as Row,
    );
  }

  return dispatchWithIncludeStrategy<Row>(options);
}

function dispatchWithIncludeStrategy<Row>(options: {
  contract: SqlContract<SqlStorage>;
  runtime: CollectionContext<SqlContract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
}): AsyncIterableResult<Row> {
  const strategy = selectIncludeStrategy(options.contract);

  if (hasNestedIncludes(options.state.includes)) {
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
  contract: SqlContract<SqlStorage>;
  runtime: CollectionContext<SqlContract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
}): AsyncIterableResult<Row> {
  const { contract, runtime, state, tableName, strategy } = options;
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const { scope, release } = await acquireRuntimeScope(runtime);
    try {
      const parentJoinColumns = state.includes.map((include) => include.parentPkColumn);
      const { selectedForQuery: parentSelectedForQuery, hiddenColumns: hiddenParentColumns } =
        augmentSelectionForJoinColumns(state.selectedFields, parentJoinColumns);
      const compiled = compileSelectWithIncludeStrategy(
        tableName,
        {
          ...state,
          selectedFields: parentSelectedForQuery,
        },
        strategy,
      );

      const parentRowsRaw = await executeCompiledQuery<Record<string, unknown>>(
        scope,
        contract,
        compiled,
        { lane: 'orm-client' },
      ).toArray();
      if (parentRowsRaw.length === 0) {
        return;
      }

      const parentRows = parentRowsRaw.map((row) => createRowEnvelope(contract, tableName, row));

      for (const parent of parentRows) {
        for (const include of state.includes) {
          const rawChildren = parseIncludedRows(parent.raw[include.relationName]);
          const mappedChildren = rawChildren.map((childRow) =>
            mapStorageRowToModelFields(contract, include.relatedTableName, childRow),
          );
          parent.mapped[include.relationName] = coerceSingleQueryIncludeResult(
            mappedChildren,
            include.cardinality,
          );
        }

        if (hiddenParentColumns.length > 0) {
          stripHiddenMappedFields(contract, tableName, parent.mapped, hiddenParentColumns);
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
  contract: SqlContract<SqlStorage>;
  runtime: CollectionContext<SqlContract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
}): AsyncIterableResult<Row> {
  const { contract, runtime, state, tableName } = options;
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const { scope, release } = await acquireRuntimeScope(runtime);
    try {
      const parentJoinColumns = state.includes.map((include) => include.parentPkColumn);
      const { selectedForQuery: parentSelectedForQuery, hiddenColumns: hiddenParentColumns } =
        augmentSelectionForJoinColumns(state.selectedFields, parentJoinColumns);
      const parentCompiled = compileSelect(tableName, {
        ...state,
        includes: [],
        selectedFields: parentSelectedForQuery,
      });
      const parentRowsRaw = await executeCompiledQuery<Record<string, unknown>>(
        scope,
        contract,
        parentCompiled,
        { lane: 'orm-client' },
      ).toArray();
      if (parentRowsRaw.length === 0) {
        return;
      }

      const parentRows = parentRowsRaw.map((row) => createRowEnvelope(contract, tableName, row));
      await stitchIncludes(scope, contract, parentRows, state.includes);

      if (hiddenParentColumns.length > 0) {
        for (const row of parentRows) {
          stripHiddenMappedFields(contract, tableName, row.mapped, hiddenParentColumns);
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
  contract: SqlContract<SqlStorage>,
  parentRows: RowEnvelope[],
  includes: readonly IncludeExpr[],
): Promise<void> {
  for (const include of includes) {
    const parentJoinValues = uniqueValues(
      parentRows
        .map((row) => row.raw[include.parentPkColumn])
        .filter((value) => value !== undefined),
    );

    if (parentJoinValues.length === 0) {
      for (const parent of parentRows) {
        parent.mapped[include.relationName] = emptyIncludeResult(include.cardinality);
      }
      continue;
    }

    const { selectedForQuery: childSelectedForQuery, hiddenColumns: hiddenChildColumns } =
      augmentSelectionForJoinColumns(include.nested.selectedFields, [include.fkColumn]);

    const childCompiled = compileRelationSelect(
      include.relatedTableName,
      include.fkColumn,
      parentJoinValues,
      {
        ...include.nested,
        selectedFields: childSelectedForQuery,
      },
    );
    const childRowsRaw = await executeCompiledQuery<Record<string, unknown>>(
      scope,
      contract,
      childCompiled,
      { lane: 'orm-client' },
    ).toArray();
    const childRows = childRowsRaw.map((row) =>
      createRowEnvelope(contract, include.relatedTableName, row),
    );

    if (include.nested.includes.length > 0) {
      await stitchIncludes(scope, contract, childRows, include.nested.includes);
    }

    const childByParentJoin = new Map<unknown, Record<string, unknown>[]>();
    for (const child of childRows) {
      const joinValue = child.raw[include.fkColumn];

      if (hiddenChildColumns.length > 0) {
        stripHiddenMappedFields(
          contract,
          include.relatedTableName,
          child.mapped,
          hiddenChildColumns,
        );
      }

      let bucket = childByParentJoin.get(joinValue);
      if (!bucket) {
        bucket = [];
        childByParentJoin.set(joinValue, bucket);
      }
      bucket.push(child.mapped);
    }

    for (const parent of parentRows) {
      const parentJoinValue = parent.raw[include.parentPkColumn];
      const relatedRows = childByParentJoin.get(parentJoinValue) ?? [];
      parent.mapped[include.relationName] = coerceIncludeResult(
        relatedRows,
        include.nested,
        include.cardinality,
      );
    }
  }
}

function uniqueValues(values: unknown[]): unknown[] {
  return [...new Set(values)];
}

function hasNestedIncludes(includes: readonly IncludeExpr[]): boolean {
  return includes.some((include) => include.nested.includes.length > 0);
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
