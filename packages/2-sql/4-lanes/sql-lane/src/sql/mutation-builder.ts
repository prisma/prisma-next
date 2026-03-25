import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  ColumnRef,
  DeleteAst,
  InsertAst,
  ParamRef,
  type TableRef,
  TableSource,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type {
  AnyColumnBuilder,
  BinaryBuilder,
  BuildOptions,
  InferReturningRow,
  ParamPlaceholder,
  SqlBuilderOptions,
  UnaryBuilder,
} from '@prisma-next/sql-relational-core/types';
import { checkReturningCapability } from '../utils/capabilities';
import {
  errorFailedToBuildWhereClause,
  errorMissingParameter,
  errorUnknownColumn,
  errorUnknownTable,
  errorWhereMustBeCalledForDelete,
  errorWhereMustBeCalledForUpdate,
} from '../utils/errors';
import type { ProjectionState } from '../utils/state';
import { buildMeta } from './plan';
import { buildWhereExpr } from './predicate-builder';

function deriveParamsFromAst(ast: { collectParamRefs(): ParamRef[] }) {
  const collected = ast.collectParamRefs();
  return {
    paramValues: collected.map((p) => p.value),
    paramDescriptors: collected.map((p) => ({
      name: p.name,
      source: 'dsl' as const,
      ...(p.codecId ? { codecId: p.codecId } : {}),
      ...(p.nativeType ? { nativeType: p.nativeType } : {}),
    })),
  };
}

export interface InsertBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Row = unknown,
> {
  returning<const Columns extends readonly AnyColumnBuilder[]>(
    ...columns: Columns
  ): InsertBuilder<TContract, CodecTypes, InferReturningRow<Columns>>;
  build(options?: BuildOptions): SqlQueryPlan<Row>;
}

export interface UpdateBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Row = unknown,
> {
  where(predicate: BinaryBuilder | UnaryBuilder): UpdateBuilder<TContract, CodecTypes, Row>;
  returning<const Columns extends readonly AnyColumnBuilder[]>(
    ...columns: Columns
  ): UpdateBuilder<TContract, CodecTypes, InferReturningRow<Columns>>;
  build(options?: BuildOptions): SqlQueryPlan<Row>;
}

export interface DeleteBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Row = unknown,
> {
  where(predicate: BinaryBuilder | UnaryBuilder): DeleteBuilder<TContract, CodecTypes, Row>;
  returning<const Columns extends readonly AnyColumnBuilder[]>(
    ...columns: Columns
  ): DeleteBuilder<TContract, CodecTypes, InferReturningRow<Columns>>;
  build(options?: BuildOptions): SqlQueryPlan<Row>;
}

export class InsertBuilderImpl<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Row = unknown,
> implements InsertBuilder<TContract, CodecTypes, Row>
{
  private readonly contract: TContract;
  private readonly context: ExecutionContext<TContract>;
  private readonly table: TableRef;
  private readonly values: Record<string, ParamPlaceholder>;
  private returningColumns: AnyColumnBuilder[] = [];

  constructor(
    options: SqlBuilderOptions<TContract>,
    table: TableRef,
    values: Record<string, ParamPlaceholder>,
  ) {
    this.context = options.context;
    this.contract = options.context.contract;
    this.table = table;
    this.values = values;
  }

  returning<const Columns extends readonly AnyColumnBuilder[]>(
    ...columns: Columns
  ): InsertBuilder<TContract, CodecTypes, InferReturningRow<Columns>> {
    checkReturningCapability(this.contract);

    const builder = new InsertBuilderImpl<TContract, CodecTypes, InferReturningRow<Columns>>(
      {
        context: this.context,
      },
      this.table,
      this.values,
    );
    builder.returningColumns = [...this.returningColumns, ...columns];
    return builder;
  }

  build(options?: BuildOptions): SqlQueryPlan<Row> {
    const paramsMap = (options?.params ?? {}) as Record<string, unknown>;
    const paramCodecs: Record<string, string> = {};

    const contractTable = this.contract.storage.tables[this.table.name];
    if (!contractTable) {
      errorUnknownTable(this.table.name);
    }

    const values: Record<string, ColumnRef | ParamRef> = {};
    for (const [columnName, placeholder] of Object.entries(this.values)) {
      if (!contractTable.columns[columnName]) {
        errorUnknownColumn(columnName, this.table.name);
      }

      const paramName = placeholder.name;
      if (!Object.hasOwn(paramsMap, paramName)) {
        errorMissingParameter(paramName);
      }

      const value = paramsMap[paramName];
      const columnMeta = contractTable.columns[columnName];
      const codecId = columnMeta?.codecId;
      if (paramName && codecId) {
        paramCodecs[paramName] = codecId;
      }

      values[columnName] = ParamRef.of(value, {
        name: paramName,
        codecId,
        nativeType: columnMeta?.nativeType,
      });
    }

    const appliedDefaults = this.context.applyMutationDefaults({
      op: 'create',
      table: this.table.name,
      values,
    });

    for (const defaultValue of appliedDefaults) {
      const columnMeta = contractTable.columns[defaultValue.column];
      if (!columnMeta) {
        errorUnknownColumn(defaultValue.column, this.table.name);
      }

      paramCodecs[defaultValue.column] = columnMeta.codecId;
      values[defaultValue.column] = ParamRef.of(defaultValue.value, {
        name: defaultValue.column,
        codecId: columnMeta.codecId,
        nativeType: columnMeta.nativeType,
      });
    }

    const returning: ColumnRef[] = this.returningColumns.map((col) => {
      const c = col as unknown as { table: string; column: string };
      return ColumnRef.of(c.table, c.column);
    });

    let ast = InsertAst.into(TableSource.named(this.table.name)).withValues(values);
    if (returning.length > 0) {
      ast = ast.withReturning(returning);
    }

    const { paramValues, paramDescriptors } = deriveParamsFromAst(ast);

    const returningProjection: ProjectionState = {
      aliases: this.returningColumns.map((col) => {
        const c = col as unknown as { column: string };
        return c.column;
      }),
      columns: this.returningColumns,
    };

    const planMeta = buildMeta({
      contract: this.contract,
      table: this.table,
      projection: returning.length > 0 ? returningProjection : { aliases: [], columns: [] },
      paramDescriptors,
      ...(Object.keys(paramCodecs).length > 0 ? { paramCodecs } : {}),
    });

    const queryPlan: SqlQueryPlan<Row> = Object.freeze({
      ast,
      params: paramValues,
      meta: {
        ...planMeta,
        lane: 'dsl',
        annotations: {
          ...planMeta.annotations,
          intent: 'write',
          isMutation: true,
        },
      },
    });

    return queryPlan;
  }
}

export class UpdateBuilderImpl<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Row = unknown,
> implements UpdateBuilder<TContract, CodecTypes, Row>
{
  private readonly contract: TContract;
  private readonly context: ExecutionContext<TContract>;
  private readonly table: TableRef;
  private readonly set: Record<string, ParamPlaceholder>;
  private wherePredicate?: BinaryBuilder | UnaryBuilder;
  private returningColumns: AnyColumnBuilder[] = [];

  constructor(
    options: SqlBuilderOptions<TContract>,
    table: TableRef,
    set: Record<string, ParamPlaceholder>,
  ) {
    this.context = options.context;
    this.contract = options.context.contract;
    this.table = table;
    this.set = set;
  }

  where(predicate: BinaryBuilder | UnaryBuilder): UpdateBuilder<TContract, CodecTypes, Row> {
    const builder = new UpdateBuilderImpl<TContract, CodecTypes, Row>(
      {
        context: this.context,
      },
      this.table,
      this.set,
    );
    builder.wherePredicate = predicate;
    builder.returningColumns = [...this.returningColumns];
    return builder;
  }

  returning<const Columns extends readonly AnyColumnBuilder[]>(
    ...columns: Columns
  ): UpdateBuilder<TContract, CodecTypes, InferReturningRow<Columns>> {
    checkReturningCapability(this.contract);

    const builder = new UpdateBuilderImpl<TContract, CodecTypes, InferReturningRow<Columns>>(
      {
        context: this.context,
      },
      this.table,
      this.set,
    );
    if (this.wherePredicate) {
      builder.wherePredicate = this.wherePredicate;
    }
    builder.returningColumns = [...this.returningColumns, ...columns];
    return builder;
  }

  build(options?: BuildOptions): SqlQueryPlan<Row> {
    if (!this.wherePredicate) {
      errorWhereMustBeCalledForUpdate();
    }

    const paramsMap = (options?.params ?? {}) as Record<string, unknown>;
    const paramCodecs: Record<string, string> = {};

    const contractTable = this.contract.storage.tables[this.table.name];
    if (!contractTable) {
      errorUnknownTable(this.table.name);
    }

    const set: Record<string, ColumnRef | ParamRef> = {};
    for (const [columnName, placeholder] of Object.entries(this.set)) {
      if (!contractTable.columns[columnName]) {
        errorUnknownColumn(columnName, this.table.name);
      }

      const paramName = placeholder.name;
      if (!Object.hasOwn(paramsMap, paramName)) {
        errorMissingParameter(paramName);
      }

      const value = paramsMap[paramName];
      const columnMeta = contractTable.columns[columnName];
      const codecId = columnMeta?.codecId;
      if (paramName && codecId) {
        paramCodecs[paramName] = codecId;
      }

      set[columnName] = ParamRef.of(value, {
        name: paramName,
        codecId,
        nativeType: columnMeta?.nativeType,
      });
    }

    const appliedDefaults = this.context.applyMutationDefaults({
      op: 'update',
      table: this.table.name,
      values: set,
    });

    for (const defaultValue of appliedDefaults) {
      const columnMeta = contractTable.columns[defaultValue.column];
      if (!columnMeta) {
        errorUnknownColumn(defaultValue.column, this.table.name);
      }

      paramCodecs[defaultValue.column] = columnMeta.codecId;
      set[defaultValue.column] = ParamRef.of(defaultValue.value, {
        name: defaultValue.column,
        codecId: columnMeta.codecId,
        nativeType: columnMeta.nativeType,
      });
    }

    const whereResult = buildWhereExpr(this.contract, this.wherePredicate, paramsMap);
    const whereExpr = whereResult.expr;
    if (!whereExpr) {
      errorFailedToBuildWhereClause();
    }

    if (whereResult.codecId && whereResult.paramName) {
      paramCodecs[whereResult.paramName] = whereResult.codecId;
    }

    const returning: ColumnRef[] = this.returningColumns.map((col) => {
      const c = col as unknown as { table: string; column: string };
      return ColumnRef.of(c.table, c.column);
    });

    let ast = UpdateAst.table(TableSource.named(this.table.name)).withSet(set).withWhere(whereExpr);
    if (returning.length > 0) {
      ast = ast.withReturning(returning);
    }

    const { paramValues, paramDescriptors } = deriveParamsFromAst(ast);

    const returningProjection: ProjectionState = {
      aliases: this.returningColumns.map((col) => {
        const c = col as unknown as { column: string };
        return c.column;
      }),
      columns: this.returningColumns,
    };

    const planMeta = buildMeta({
      contract: this.contract,
      table: this.table,
      projection: returning.length > 0 ? returningProjection : { aliases: [], columns: [] },
      paramDescriptors,
      ...(Object.keys(paramCodecs).length > 0 ? { paramCodecs } : {}),
      where: this.wherePredicate,
    });

    const queryPlan: SqlQueryPlan<Row> = Object.freeze({
      ast,
      params: paramValues,
      meta: {
        ...planMeta,
        lane: 'dsl',
        annotations: {
          ...planMeta.annotations,
          intent: 'write',
          isMutation: true,
          hasWhere: true,
        },
      },
    });

    return queryPlan;
  }
}

export class DeleteBuilderImpl<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  Row = unknown,
> implements DeleteBuilder<TContract, CodecTypes, Row>
{
  private readonly contract: TContract;
  private readonly context: ExecutionContext<TContract>;
  private readonly table: TableRef;
  private wherePredicate?: BinaryBuilder | UnaryBuilder;
  private returningColumns: AnyColumnBuilder[] = [];

  constructor(options: SqlBuilderOptions<TContract>, table: TableRef) {
    this.context = options.context;
    this.contract = options.context.contract;
    this.table = table;
  }

  where(predicate: BinaryBuilder | UnaryBuilder): DeleteBuilder<TContract, CodecTypes, Row> {
    const builder = new DeleteBuilderImpl<TContract, CodecTypes, Row>(
      {
        context: this.context,
      },
      this.table,
    );
    builder.wherePredicate = predicate;
    builder.returningColumns = [...this.returningColumns];
    return builder;
  }

  returning<const Columns extends readonly AnyColumnBuilder[]>(
    ...columns: Columns
  ): DeleteBuilder<TContract, CodecTypes, InferReturningRow<Columns>> {
    checkReturningCapability(this.contract);

    const builder = new DeleteBuilderImpl<TContract, CodecTypes, InferReturningRow<Columns>>(
      {
        context: this.context,
      },
      this.table,
    );
    if (this.wherePredicate) {
      builder.wherePredicate = this.wherePredicate;
    }
    builder.returningColumns = [...this.returningColumns, ...columns];
    return builder;
  }

  build(options?: BuildOptions): SqlQueryPlan<Row> {
    if (!this.wherePredicate) {
      errorWhereMustBeCalledForDelete();
    }

    const paramsMap = (options?.params ?? {}) as Record<string, unknown>;
    const paramCodecs: Record<string, string> = {};

    const contractTable = this.contract.storage.tables[this.table.name];
    if (!contractTable) {
      errorUnknownTable(this.table.name);
    }

    const whereResult = buildWhereExpr(this.contract, this.wherePredicate, paramsMap);
    const whereExpr = whereResult.expr;
    if (!whereExpr) {
      errorFailedToBuildWhereClause();
    }

    if (whereResult.codecId && whereResult.paramName) {
      paramCodecs[whereResult.paramName] = whereResult.codecId;
    }

    const returning: ColumnRef[] = this.returningColumns.map((col) => {
      const c = col as unknown as { table: string; column: string };
      return ColumnRef.of(c.table, c.column);
    });

    let ast = DeleteAst.from(TableSource.named(this.table.name)).withWhere(whereExpr);
    if (returning.length > 0) {
      ast = ast.withReturning(returning);
    }

    const { paramValues, paramDescriptors } = deriveParamsFromAst(ast);

    const returningProjection: ProjectionState = {
      aliases: this.returningColumns.map((col) => {
        const c = col as unknown as { column: string };
        return c.column;
      }),
      columns: this.returningColumns,
    };

    const planMeta = buildMeta({
      contract: this.contract,
      table: this.table,
      projection: returning.length > 0 ? returningProjection : { aliases: [], columns: [] },
      paramDescriptors,
      ...(Object.keys(paramCodecs).length > 0 ? { paramCodecs } : {}),
      where: this.wherePredicate,
    });

    const queryPlan: SqlQueryPlan<Row> = Object.freeze({
      ast,
      params: paramValues,
      meta: {
        ...planMeta,
        lane: 'dsl',
        annotations: {
          ...planMeta.annotations,
          intent: 'write',
          isMutation: true,
          hasWhere: true,
        },
      },
    });

    return queryPlan;
  }
}
