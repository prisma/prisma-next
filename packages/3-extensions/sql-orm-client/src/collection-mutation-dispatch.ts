import { executeCompiledQuery } from '@prisma-next/integration-kysely';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CompiledQuery } from 'kysely';
import { stitchIncludes } from './collection-dispatch';
import {
  acquireRuntimeScope,
  createRowEnvelope,
  mapResultRows,
  mapStorageRowToModelFields,
  stripHiddenMappedFields,
} from './collection-runtime';
import type { CollectionContext, IncludeExpr } from './types';

interface DispatchMutationRowsOptions<Row> {
  readonly contract: SqlContract<SqlStorage>;
  readonly runtime: CollectionContext<SqlContract<SqlStorage>>['runtime'];
  readonly compiled: CompiledQuery;
  readonly tableName: string;
  readonly includes: readonly IncludeExpr[];
  readonly hiddenColumns: readonly string[];
  readonly mapRow: (mapped: Record<string, unknown>) => Row;
}

export function dispatchMutationRows<Row>(
  options: DispatchMutationRowsOptions<Row>,
): AsyncIterableResult<Row> {
  const { contract, runtime, compiled, tableName, includes, hiddenColumns, mapRow } = options;
  const typedCompiled = compiled as CompiledQuery<Record<string, unknown>>;

  if (includes.length === 0) {
    const source = executeCompiledQuery<Record<string, unknown>>(runtime, contract, typedCompiled, {
      lane: 'orm-client',
    });

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
      const rawRows = await executeCompiledQuery<Record<string, unknown>>(
        scope,
        contract,
        typedCompiled,
        {
          lane: 'orm-client',
        },
      ).toArray();
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
  readonly compiled: CompiledQuery;
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
  const typedCompiled = compiled as CompiledQuery<Record<string, unknown>>;

  if (includes.length === 0) {
    const rows = await executeCompiledQuery<Record<string, unknown>>(
      runtime,
      contract,
      typedCompiled,
      {
        lane: 'orm-client',
      },
    ).toArray();
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
    const rows = await executeCompiledQuery<Record<string, unknown>>(
      scope,
      contract,
      typedCompiled,
      {
        lane: 'orm-client',
      },
    ).toArray();
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
