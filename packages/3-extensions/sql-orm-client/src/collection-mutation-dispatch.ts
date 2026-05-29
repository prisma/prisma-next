import type { Contract } from '@prisma-next/contract/types';
import { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { reloadMutationRowsByIdentities } from './collection-dispatch';
import {
  mapResultRows,
  mapStorageRowToModelFields,
  stripHiddenMappedFields,
} from './collection-runtime';
import { executeQueryPlan } from './execute-query-plan';
import type { CollectionContext, IncludeExpr } from './types';

interface DispatchMutationRowsOptions<Row> {
  readonly contract: Contract<SqlStorage>;
  readonly runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  readonly compiled: SqlQueryPlan<Record<string, unknown>>;
  readonly tableName: string;
  readonly modelName: string;
  readonly includes: readonly IncludeExpr[];
  readonly selectedFields: readonly string[] | undefined;
  readonly hiddenColumns: readonly string[];
  readonly mapRow: (mapped: Record<string, unknown>) => Row;
}

export function dispatchMutationRows<Row>(
  options: DispatchMutationRowsOptions<Row>,
): AsyncIterableResult<Row> {
  const {
    contract,
    runtime,
    compiled,
    tableName,
    modelName,
    includes,
    selectedFields,
    hiddenColumns,
    mapRow,
  } = options;

  if (includes.length === 0) {
    const source = executeQueryPlan<Record<string, unknown>>(runtime, compiled);

    return mapResultRows(source, (rawRow) => {
      const mapped = mapStorageRowToModelFields(contract, modelName, rawRow);
      if (hiddenColumns.length > 0) {
        stripHiddenMappedFields(contract, modelName, mapped, hiddenColumns);
      }
      return mapRow(mapped);
    });
  }

  // With includes the mutation returns identity columns only; the rows
  // are reloaded through the read path so relations resolve via the same
  // single-query builders, decode, and hidden-column stripping the read
  // path uses — no parallel read-back implementation.
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const identityRows = await executeQueryPlan<Record<string, unknown>>(
      runtime,
      compiled,
    ).toArray();
    const rows = await reloadMutationRowsByIdentities<Row>({
      contract,
      runtime,
      tableName,
      modelName,
      identityRows,
      selectedFields,
      includes,
    });
    for (const row of rows) {
      yield row;
    }
  };

  return new AsyncIterableResult(generator());
}

interface DispatchSplitMutationRowsOptions<Row> {
  readonly contract: Contract<SqlStorage>;
  readonly runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  readonly plans: ReadonlyArray<SqlQueryPlan<Record<string, unknown>>>;
  readonly tableName: string;
  readonly modelName: string;
  readonly includes: readonly IncludeExpr[];
  readonly selectedFields: readonly string[] | undefined;
  readonly hiddenColumns: readonly string[];
  readonly mapRow: (mapped: Record<string, unknown>) => Row;
}

export function dispatchSplitMutationRows<Row>(
  options: DispatchSplitMutationRowsOptions<Row>,
): AsyncIterableResult<Row> {
  const {
    contract,
    runtime,
    plans,
    tableName,
    modelName,
    includes,
    selectedFields,
    hiddenColumns,
    mapRow,
  } = options;

  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    if (includes.length > 0) {
      const identityRows: Record<string, unknown>[] = [];
      for (const plan of plans) {
        identityRows.push(
          ...(await executeQueryPlan<Record<string, unknown>>(runtime, plan).toArray()),
        );
      }
      const rows = await reloadMutationRowsByIdentities<Row>({
        contract,
        runtime,
        tableName,
        modelName,
        identityRows,
        selectedFields,
        includes,
      });
      for (const row of rows) {
        yield row;
      }
      return;
    }

    for (const plan of plans) {
      const rows = await executeQueryPlan<Record<string, unknown>>(runtime, plan).toArray();
      for (const rawRow of rows) {
        const mapped = mapStorageRowToModelFields(contract, tableName, rawRow);
        if (hiddenColumns.length > 0) {
          stripHiddenMappedFields(contract, tableName, mapped, hiddenColumns);
        }
        yield mapRow(mapped);
      }
    }
  };

  return new AsyncIterableResult(generator());
}

interface ExecuteSingleMutationOptions<Row> {
  readonly contract: Contract<SqlStorage>;
  readonly runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  readonly compiled: SqlQueryPlan<Record<string, unknown>>;
  readonly tableName: string;
  readonly modelName: string;
  readonly includes: readonly IncludeExpr[];
  readonly selectedFields: readonly string[] | undefined;
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
    modelName,
    includes,
    selectedFields,
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

    const mapped = mapStorageRowToModelFields(contract, modelName, first);
    if (hiddenColumns.length > 0) {
      stripHiddenMappedFields(contract, modelName, mapped, hiddenColumns);
    }
    return mapRow(mapped);
  }

  const identityRows = await executeQueryPlan<Record<string, unknown>>(runtime, compiled).toArray();
  if (identityRows.length === 0) {
    return null;
  }

  const rows = await reloadMutationRowsByIdentities<Row>({
    contract,
    runtime,
    tableName,
    modelName,
    identityRows,
    selectedFields,
    includes,
  });
  const result = rows[0];
  if (!result) {
    throw new Error(onMissingRowMessage);
  }
  return result;
}
