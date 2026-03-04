import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { stitchIncludes } from './collection-dispatch';
import {
  acquireRuntimeScope,
  createRowEnvelope,
  mapResultRows,
  mapStorageRowToModelFields,
  stripHiddenMappedFields,
} from './collection-runtime';
import { executeQueryPlan } from './execute-query-plan';
import type { CollectionContext, IncludeExpr } from './types';

interface DispatchMutationRowsOptions<Row> {
  readonly contract: SqlContract<SqlStorage>;
  readonly runtime: CollectionContext<SqlContract<SqlStorage>>['runtime'];
  readonly compiled: SqlQueryPlan<Record<string, unknown>>;
  readonly tableName: string;
  readonly includes: readonly IncludeExpr[];
  readonly hiddenColumns: readonly string[];
  readonly mapRow: (mapped: Record<string, unknown>) => Row;
}

export function dispatchMutationRows<Row>(
  options: DispatchMutationRowsOptions<Row>,
): AsyncIterableResult<Row> {
  const { contract, runtime, compiled, tableName, includes, hiddenColumns, mapRow } = options;

  if (includes.length === 0) {
    const source = executeQueryPlan<Record<string, unknown>>(runtime, compiled);

    return mapResultRows(source, (rawRow) => {
      const mapped = mapStorageRowToModelFields(contract, tableName, rawRow);
      if (hiddenColumns.length > 0) {
        stripHiddenMappedFields(contract, tableName, mapped, hiddenColumns);
      }
      return mapRow(mapped);
    });
  }

  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const { scope, release } = await acquireRuntimeScope(runtime);
    try {
      const rawRows = await executeQueryPlan<Record<string, unknown>>(scope, compiled).toArray();
      if (rawRows.length === 0) {
        return;
      }

      const wrappedRows = rawRows.map((row) => createRowEnvelope(contract, tableName, row));
      await stitchIncludes(scope, contract, wrappedRows, includes);

      for (const row of wrappedRows) {
        if (hiddenColumns.length > 0) {
          stripHiddenMappedFields(contract, tableName, row.mapped, hiddenColumns);
        }
        yield mapRow(row.mapped);
      }
    } finally {
      if (release) {
        await release();
      }
    }
  };

  return new AsyncIterableResult(generator());
}

interface ExecuteSingleMutationOptions<Row> {
  readonly contract: SqlContract<SqlStorage>;
  readonly runtime: CollectionContext<SqlContract<SqlStorage>>['runtime'];
  readonly compiled: SqlQueryPlan<Record<string, unknown>>;
  readonly tableName: string;
  readonly includes: readonly IncludeExpr[];
  readonly hiddenColumns: readonly string[];
  readonly mapRow: (mapped: Record<string, unknown>) => Row;
  readonly onMissingRowMessage: string;
}

export async function executeMutationReturningSingleRow<Row>(
  options: ExecuteSingleMutationOptions<Row>,
): Promise<Row | null> {
  const {
    contract,
    runtime,
    compiled,
    tableName,
    includes,
    hiddenColumns,
    mapRow,
    onMissingRowMessage,
  } = options;

  if (includes.length === 0) {
    const rows = await executeQueryPlan<Record<string, unknown>>(runtime, compiled).toArray();
    const first = rows[0];
    if (!first) {
      return null;
    }

    const mapped = mapStorageRowToModelFields(contract, tableName, first);
    if (hiddenColumns.length > 0) {
      stripHiddenMappedFields(contract, tableName, mapped, hiddenColumns);
    }
    return mapRow(mapped);
  }

  const { scope, release } = await acquireRuntimeScope(runtime);
  try {
    const rows = await executeQueryPlan<Record<string, unknown>>(scope, compiled).toArray();
    const first = rows[0];
    if (!first) {
      return null;
    }

    const wrappedRows = [createRowEnvelope(contract, tableName, first)];
    await stitchIncludes(scope, contract, wrappedRows, includes);

    const result = wrappedRows[0];
    if (!result) {
      throw new Error(onMissingRowMessage);
    }

    if (hiddenColumns.length > 0) {
      stripHiddenMappedFields(contract, tableName, result.mapped, hiddenColumns);
    }

    return mapRow(result.mapped);
  } finally {
    if (release) {
      await release();
    }
  }
}
