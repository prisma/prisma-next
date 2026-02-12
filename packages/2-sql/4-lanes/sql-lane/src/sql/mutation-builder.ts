import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ColumnRef, ParamRef, TableRef } from '@prisma-next/sql-relational-core/ast';
import {
  createColumnRef,
  createDeleteAst,
  createInsertAst,
  createParamRef,
  createTableRef,
  createUpdateAst,
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
    const paramDescriptors: ParamDescriptor[] = [];
    const paramValues: unknown[] = [];
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
      const index = paramValues.push(value);

      const columnMeta = contractTable.columns[columnName];
      const codecId = columnMeta?.codecId;
      if (paramName && codecId) {
        paramCodecs[paramName] = codecId;
      }

      paramDescriptors.push({
        name: paramName,
        source: 'dsl',
        refs: { table: this.table.name, column: columnName },
        ...(codecId ? { codecId } : {}),
        ...(columnMeta?.nativeType ? { nativeType: columnMeta.nativeType } : {}),
        ...(columnMeta?.nullable !== undefined ? { nullable: columnMeta.nullable } : {}),
      });

      values[columnName] = createParamRef(index, paramName);
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

      const index = paramValues.push(defaultValue.value);
      paramCodecs[defaultValue.column] = columnMeta.codecId;
      paramDescriptors.push({
        name: defaultValue.column,
        source: 'dsl',
        refs: { table: this.table.name, column: defaultValue.column },
        codecId: columnMeta.codecId,
        nativeType: columnMeta.nativeType,
        nullable: columnMeta.nullable,
      });
      values[defaultValue.column] = createParamRef(index, defaultValue.column);
    }

    const returning: ColumnRef[] = this.returningColumns.map((col) => {
      // TypeScript can't narrow ColumnBuilder properly
      const c = col as unknown as { table: string; column: string };
      return createColumnRef(c.table, c.column);
    });

    const ast = createInsertAst({
      table: createTableRef(this.table.name),
      values,
      returning,
    });

    const returningProjection: ProjectionState = {
      aliases: this.returningColumns.map((col) => {
        // TypeScript can't narrow ColumnBuilder properly
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
    const paramDescriptors: ParamDescriptor[] = [];
    const paramValues: unknown[] = [];
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
      const index = paramValues.push(value);

      const columnMeta = contractTable.columns[columnName];
      const codecId = columnMeta?.codecId;
      if (paramName && codecId) {
        paramCodecs[paramName] = codecId;
      }

      paramDescriptors.push({
        name: paramName,
        source: 'dsl',
        refs: { table: this.table.name, column: columnName },
        ...(codecId ? { codecId } : {}),
        ...(columnMeta?.nativeType ? { nativeType: columnMeta.nativeType } : {}),
        ...(columnMeta?.nullable !== undefined ? { nullable: columnMeta.nullable } : {}),
      });

      set[columnName] = createParamRef(index, paramName);
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

      const index = paramValues.push(defaultValue.value);
      paramCodecs[defaultValue.column] = columnMeta.codecId;
      paramDescriptors.push({
        name: defaultValue.column,
        source: 'dsl',
        refs: { table: this.table.name, column: defaultValue.column },
        codecId: columnMeta.codecId,
        nativeType: columnMeta.nativeType,
        nullable: columnMeta.nullable,
      });
      set[defaultValue.column] = createParamRef(index, defaultValue.column);
    }

    const whereResult = buildWhereExpr(
      this.contract,
      this.wherePredicate,
      paramsMap,
      paramDescriptors,
      paramValues,
    );
    const whereExpr = whereResult.expr;
    if (!whereExpr) {
      errorFailedToBuildWhereClause();
    }

    if (whereResult.codecId && whereResult.paramName) {
      paramCodecs[whereResult.paramName] = whereResult.codecId;
    }

    const returning: ColumnRef[] = this.returningColumns.map((col) => {
      // TypeScript can't narrow ColumnBuilder properly
      const c = col as unknown as { table: string; column: string };
      return createColumnRef(c.table, c.column);
    });

    const ast = createUpdateAst({
      table: createTableRef(this.table.name),
      set,
      where: whereExpr,
      returning,
    });

    const returningProjection: ProjectionState = {
      aliases: this.returningColumns.map((col) => {
        // TypeScript can't narrow ColumnBuilder properly
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
    const paramDescriptors: ParamDescriptor[] = [];
    const paramValues: unknown[] = [];
    const paramCodecs: Record<string, string> = {};

    const contractTable = this.contract.storage.tables[this.table.name];
    if (!contractTable) {
      errorUnknownTable(this.table.name);
    }

    const whereResult = buildWhereExpr(
      this.contract,
      this.wherePredicate,
      paramsMap,
      paramDescriptors,
      paramValues,
    );
    const whereExpr = whereResult.expr;
    if (!whereExpr) {
      errorFailedToBuildWhereClause();
    }

    if (whereResult.codecId && whereResult.paramName) {
      paramCodecs[whereResult.paramName] = whereResult.codecId;
    }

    const returning: ColumnRef[] = this.returningColumns.map((col) => {
      // TypeScript can't narrow ColumnBuilder properly
      const c = col as unknown as { table: string; column: string };
      return createColumnRef(c.table, c.column);
    });

    const ast = createDeleteAst({
      table: createTableRef(this.table.name),
      where: whereExpr,
      returning,
    });

    const returningProjection: ProjectionState = {
      aliases: this.returningColumns.map((col) => {
        // TypeScript can't narrow ColumnBuilder properly
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
