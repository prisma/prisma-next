import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { createColumnAccessor } from './column-accessor';
import { compileRelationSelect, compileSelect, createExecutionPlan } from './kysely-compiler';
import type {
  CollectionState,
  ColumnAccessor,
  DefaultModelRow,
  FilterExpr,
  IncludeExpr,
  OrderExpr,
  RelatedModelName,
  RelationNames,
  RepositoryContext,
  RuntimeConnection,
  RuntimeScope,
} from './types';
import { emptyState } from './types';

interface RowEnvelope {
  readonly raw: Record<string, unknown>;
  readonly mapped: Record<string, unknown>;
}

export class Collection<TContract extends SqlContract<SqlStorage>, ModelName extends string, Row> {
  /** @internal */
  readonly ctx: RepositoryContext<TContract>;
  /** @internal */
  readonly modelName: ModelName;
  /** @internal */
  readonly tableName: string;
  /** @internal */
  readonly state: CollectionState;

  protected constructor(
    ctx: RepositoryContext<TContract>,
    modelName: ModelName,
    tableName: string,
    state: CollectionState,
  ) {
    this.ctx = ctx;
    this.modelName = modelName;
    this.tableName = tableName;
    this.state = state;
  }

  where(
    fn: (model: ColumnAccessor<TContract, ModelName>) => FilterExpr,
  ): Collection<TContract, ModelName, Row> {
    const accessor = createColumnAccessor(this.ctx.contract, this.modelName);
    const filter = fn(accessor as ColumnAccessor<TContract, ModelName>);
    return this.#clone({
      filters: [...this.state.filters, filter],
    });
  }

  include<
    RelName extends RelationNames<TContract, ModelName>,
    RelatedName extends RelatedModelName<TContract, ModelName, RelName> & string = RelatedModelName<
      TContract,
      ModelName,
      RelName
    > &
      string,
    IncludedRow = DefaultModelRow<TContract, RelatedName>,
  >(
    relationName: RelName,
    refineFn?: (
      collection: Collection<TContract, RelatedName, DefaultModelRow<TContract, RelatedName>>,
    ) => Collection<TContract, RelatedName, IncludedRow>,
  ): Collection<
    TContract,
    ModelName,
    Row & {
      [K in RelName]: IncludedRow[];
    }
  > {
    const relation = resolveIncludeRelation(
      this.ctx.contract,
      this.modelName,
      relationName as string,
    );

    // Build nested state from refine callback
    let nestedState = emptyState();
    if (refineFn) {
      const nestedCollection = new Collection<
        TContract,
        RelatedName,
        DefaultModelRow<TContract, RelatedName>
      >(
        this.ctx,
        relation.relatedModelName as RelatedName,
        relation.relatedTableName,
        emptyState(),
      );
      const refined = refineFn(nestedCollection);
      nestedState = refined.state;
    }

    const includeExpr: IncludeExpr = {
      relationName: relationName as string,
      relatedModelName: relation.relatedModelName,
      relatedTableName: relation.relatedTableName,
      fkColumn: relation.fkColumn,
      parentPkColumn: relation.parentPkColumn,
      nested: nestedState,
    };

    return this.#clone({
      includes: [...this.state.includes, includeExpr],
    }) as Collection<
      TContract,
      ModelName,
      Row & {
        [K in RelName]: IncludedRow[];
      }
    >;
  }

  orderBy(
    fn: (model: ColumnAccessor<TContract, ModelName>) => {
      column: string;
      direction: 'asc' | 'desc';
    },
  ): Collection<TContract, ModelName, Row> {
    const accessor = createColumnAccessor(this.ctx.contract, this.modelName);
    const order = fn(accessor as ColumnAccessor<TContract, ModelName>);
    const orderExpr: OrderExpr = {
      column: order.column,
      direction: order.direction,
    };
    const existing = this.state.orderBy ?? [];
    return this.#clone({
      orderBy: [...existing, orderExpr],
    });
  }

  take(n: number): Collection<TContract, ModelName, Row> {
    return this.#clone({ limit: n });
  }

  skip(n: number): Collection<TContract, ModelName, Row> {
    return this.#clone({ offset: n });
  }

  findMany(): AsyncIterableResult<Row> {
    return this.#dispatch();
  }

  findFirst(): AsyncIterableResult<Row> {
    const limited = this.#clone({ limit: 1 });
    return limited.#dispatch();
  }

  #clone(overrides: Partial<CollectionState>): Collection<TContract, ModelName, Row> {
    return new Collection(this.ctx, this.modelName, this.tableName, {
      ...this.state,
      ...overrides,
    });
  }

  #dispatch(): AsyncIterableResult<Row> {
    const { state, tableName, ctx } = this;
    const contract = ctx.contract;
    const runtime = ctx.runtime;

    if (state.includes.length === 0) {
      const compiled = compileSelect(tableName, state);
      const plan = createExecutionPlan<Record<string, unknown>>(compiled, contract);
      const source = runtime.execute(plan);
      return mapResultRows(
        source,
        (rawRow) => mapStorageRowToModelFields(contract, tableName, rawRow) as Row,
      );
    }

    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const { scope, release } = await acquireRuntimeScope(runtime);
      try {
        const parentCompiled = compileSelect(tableName, {
          ...state,
          includes: [],
        });
        const parentPlan = createExecutionPlan<Record<string, unknown>>(parentCompiled, contract);
        const parentRowsRaw = await scope.execute(parentPlan).toArray();
        if (parentRowsRaw.length === 0) {
          return;
        }

        const parentRows = parentRowsRaw.map((row) => createRowEnvelope(contract, tableName, row));
        await stitchIncludes(scope, contract, parentRows, state.includes);

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
}

async function stitchIncludes(
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
        parent.mapped[include.relationName] = [];
      }
      continue;
    }

    const childCompiled = compileRelationSelect(
      include.relatedTableName,
      include.fkColumn,
      parentJoinValues,
      include.nested,
    );
    const childPlan = createExecutionPlan<Record<string, unknown>>(childCompiled, contract);
    const childRowsRaw = await scope.execute(childPlan).toArray();
    const childRows = childRowsRaw.map((row) =>
      createRowEnvelope(contract, include.relatedTableName, row),
    );

    if (include.nested.includes.length > 0) {
      await stitchIncludes(scope, contract, childRows, include.nested.includes);
    }

    const childByParentJoin = new Map<unknown, Record<string, unknown>[]>();
    for (const child of childRows) {
      const joinValue = child.raw[include.fkColumn];
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
      parent.mapped[include.relationName] = slicePerParent(relatedRows, include.nested);
    }
  }
}

function createRowEnvelope(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  raw: Record<string, unknown>,
): RowEnvelope {
  return {
    raw,
    mapped: mapStorageRowToModelFields(contract, tableName, raw),
  };
}

function mapStorageRowToModelFields(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const columnToField = contract.mappings.columnToField?.[tableName];
  if (!columnToField) {
    return { ...row };
  }

  const mapped: Record<string, unknown> = {};
  for (const [columnName, value] of Object.entries(row)) {
    mapped[columnToField[columnName] ?? columnName] = value;
  }
  return mapped;
}

function mapResultRows<TIn, TOut>(
  result: AsyncIterableResult<TIn>,
  mapper: (value: TIn) => TOut,
): AsyncIterableResult<TOut> {
  const generator = async function* (): AsyncGenerator<TOut, void, unknown> {
    for await (const value of result) {
      yield mapper(value);
    }
  };
  return new AsyncIterableResult(generator());
}

async function acquireRuntimeScope(
  runtime: RepositoryContext<SqlContract<SqlStorage>>['runtime'],
): Promise<{
  scope: RuntimeScope;
  release?: () => Promise<void>;
}> {
  if (typeof runtime.connection !== 'function') {
    return { scope: runtime };
  }

  const connection = await runtime.connection();
  if (typeof connection.release === 'function') {
    return {
      scope: connection,
      release: () => (connection as RuntimeConnection).release?.() ?? Promise.resolve(),
    };
  }

  return { scope: connection };
}

function uniqueValues(values: unknown[]): unknown[] {
  return [...new Set(values)];
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

interface RelationWithOn {
  readonly to: string;
  readonly on: {
    readonly parentCols: readonly string[];
    readonly childCols: readonly string[];
  };
}

interface LegacyRelation {
  readonly model: string;
  readonly foreignKey: string;
}

interface ResolvedIncludeRelation {
  readonly relatedModelName: string;
  readonly relatedTableName: string;
  readonly fkColumn: string;
  readonly parentPkColumn: string;
}

function resolveIncludeRelation(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  relationName: string,
): ResolvedIncludeRelation {
  const parentTableName = resolveModelTableName(contract, modelName);
  const relation = resolveContractRelation(contract, parentTableName, relationName);
  if (relation) {
    const relatedTableName = resolveModelTableName(contract, relation.to);
    const parentPkColumn = relation.on.parentCols[0];
    const fkColumn = relation.on.childCols[0];
    if (parentPkColumn && fkColumn) {
      return {
        relatedModelName: relation.to,
        relatedTableName,
        fkColumn,
        parentPkColumn,
      };
    }
  }

  const legacy = resolveLegacyModelRelation(contract, modelName, relationName);
  if (legacy) {
    const parentTable = contract.storage.tables[parentTableName];
    const parentPkColumn = parentTable?.primaryKey?.columns[0] ?? 'id';
    return {
      relatedModelName: legacy.model,
      relatedTableName: resolveModelTableName(contract, legacy.model),
      fkColumn: legacy.foreignKey,
      parentPkColumn,
    };
  }

  throw new Error(`Relation '${relationName}' not found on model '${modelName}'`);
}

function resolveContractRelation(
  contract: SqlContract<SqlStorage>,
  parentTableName: string,
  relationName: string,
): RelationWithOn | undefined {
  const tableRelations = contract.relations as Record<string, Record<string, unknown>>;
  const relation = tableRelations[parentTableName]?.[relationName];
  if (!relation || typeof relation !== 'object') {
    return undefined;
  }

  const relationObj = relation as {
    to?: unknown;
    on?: {
      parentCols?: unknown;
      childCols?: unknown;
    };
  };
  const parentCols = relationObj.on?.parentCols;
  const childCols = relationObj.on?.childCols;

  if (
    typeof relationObj.to !== 'string' ||
    !Array.isArray(parentCols) ||
    !Array.isArray(childCols)
  ) {
    return undefined;
  }

  return {
    to: relationObj.to,
    on: {
      parentCols: parentCols as readonly string[],
      childCols: childCols as readonly string[],
    },
  };
}

function resolveLegacyModelRelation(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  relationName: string,
): LegacyRelation | undefined {
  const models = contract.models as Record<
    string,
    { relations?: Record<string, { model?: unknown; foreignKey?: unknown }> }
  >;
  const relation = models[modelName]?.relations?.[relationName];
  if (!relation) {
    return undefined;
  }

  if (typeof relation.model !== 'string' || typeof relation.foreignKey !== 'string') {
    return undefined;
  }

  return {
    model: relation.model,
    foreignKey: relation.foreignKey,
  };
}

function resolveModelTableName(contract: SqlContract<SqlStorage>, modelName: string): string {
  const mappedTable = contract.mappings.modelToTable?.[modelName];
  if (mappedTable) {
    return mappedTable;
  }

  const modelStorage = (contract.models as Record<string, { storage?: { table?: unknown } }>)[
    modelName
  ]?.storage;
  if (modelStorage && typeof modelStorage.table === 'string') {
    return modelStorage.table;
  }

  return modelName.toLowerCase();
}
