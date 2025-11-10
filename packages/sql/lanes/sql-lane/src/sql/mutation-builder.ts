import type { ParamDescriptor, Plan } from '@prisma-next/contract/types';
import {
  createColumnRef,
  createDeleteAst,
  createInsertAst,
  createParamRef,
  createTableRef,
  createUpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import type {
  AnyColumnBuilder,
  BinaryBuilder,
  BuildOptions,
  InferReturningRow,
  ParamPlaceholder,
  SqlBuilderOptions,
} from '@prisma-next/sql-relational-core/types';
import type { RuntimeContext } from '@prisma-next/sql-runtime';
import type {
  Adapter,
  ColumnRef,
  LoweredStatement,
  ParamRef,
  QueryAst,
  SqlContract,
  SqlStorage,
  TableRef,
} from '@prisma-next/sql-target';
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
  build(options?: BuildOptions): Plan<Row>;
}

export interface UpdateBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Row = unknown,
> {
  where(predicate: BinaryBuilder): UpdateBuilder<TContract, CodecTypes, Row>;
  returning<const Columns extends readonly AnyColumnBuilder[]>(
    ...columns: Columns
  ): UpdateBuilder<TContract, CodecTypes, InferReturningRow<Columns>>;
  build(options?: BuildOptions): Plan<Row>;
}

export interface DeleteBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Row = unknown,
> {
  where(predicate: BinaryBuilder): DeleteBuilder<TContract, CodecTypes, Row>;
  returning<const Columns extends readonly AnyColumnBuilder[]>(
    ...columns: Columns
  ): DeleteBuilder<TContract, CodecTypes, InferReturningRow<Columns>>;
  build(options?: BuildOptions): Plan<Row>;
}

export class InsertBuilderImpl<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Row = unknown,
> implements InsertBuilder<TContract, CodecTypes, Row>
{
  private readonly contract: TContract;
  private readonly adapter: Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;
  private readonly context: RuntimeContext<TContract>;
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
    this.adapter = options.context.adapter;
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

  build(options?: BuildOptions): Plan<Row> {
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
      const codecId = columnMeta?.type;
      if (codecId && paramName) {
        paramCodecs[paramName] = codecId;
      }

      paramDescriptors.push({
        name: paramName,
        source: 'dsl',
        refs: { table: this.table.name, column: columnName },
        ...(codecId ? { type: codecId } : {}),
        ...(columnMeta?.nullable !== undefined ? { nullable: columnMeta.nullable } : {}),
      });

      values[columnName] = createParamRef(index, paramName);
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

    const lowered = this.adapter.lower(ast, {
      contract: this.contract,
      params: paramValues,
    });
    const loweredBody = lowered.body as LoweredStatement;

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

    const plan: Plan<Row> = Object.freeze({
      ast,
      sql: loweredBody.sql,
      params: loweredBody.params ?? paramValues,
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

    return plan;
  }
}

export class UpdateBuilderImpl<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Row = unknown,
> implements UpdateBuilder<TContract, CodecTypes, Row>
{
  private readonly contract: TContract;
  private readonly adapter: Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;
  private readonly context: RuntimeContext<TContract>;
  private readonly table: TableRef;
  private readonly set: Record<string, ParamPlaceholder>;
  private wherePredicate?: BinaryBuilder;
  private returningColumns: AnyColumnBuilder[] = [];

  constructor(
    options: SqlBuilderOptions<TContract>,
    table: TableRef,
    set: Record<string, ParamPlaceholder>,
  ) {
    this.context = options.context;
    this.contract = options.context.contract;
    this.adapter = options.context.adapter;
    this.table = table;
    this.set = set;
  }

  where(predicate: BinaryBuilder): UpdateBuilder<TContract, CodecTypes, Row> {
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

  build(options?: BuildOptions): Plan<Row> {
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
      const codecId = columnMeta?.type;
      if (codecId && paramName) {
        paramCodecs[paramName] = codecId;
      }

      paramDescriptors.push({
        name: paramName,
        source: 'dsl',
        refs: { table: this.table.name, column: columnName },
        ...(codecId ? { type: codecId } : {}),
        ...(columnMeta?.nullable !== undefined ? { nullable: columnMeta.nullable } : {}),
      });

      set[columnName] = createParamRef(index, paramName);
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

    const lowered = this.adapter.lower(ast, {
      contract: this.contract,
      params: paramValues,
    });
    const loweredBody = lowered.body as LoweredStatement;

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

    const plan: Plan<Row> = Object.freeze({
      ast,
      sql: loweredBody.sql,
      params: loweredBody.params ?? paramValues,
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

    return plan;
  }
}

export class DeleteBuilderImpl<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  Row = unknown,
> implements DeleteBuilder<TContract, CodecTypes, Row>
{
  private readonly contract: TContract;
  private readonly adapter: Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;
  private readonly context: RuntimeContext<TContract>;
  private readonly table: TableRef;
  private wherePredicate?: BinaryBuilder;
  private returningColumns: AnyColumnBuilder[] = [];

  constructor(options: SqlBuilderOptions<TContract>, table: TableRef) {
    this.context = options.context;
    this.contract = options.context.contract;
    this.adapter = options.context.adapter;
    this.table = table;
  }

  where(predicate: BinaryBuilder): DeleteBuilder<TContract, CodecTypes, Row> {
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

  build(options?: BuildOptions): Plan<Row> {
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

    const lowered = this.adapter.lower(ast, {
      contract: this.contract,
      params: paramValues,
    });
    const loweredBody = lowered.body as LoweredStatement;

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

    const plan: Plan<Row> = Object.freeze({
      ast,
      sql: loweredBody.sql,
      params: loweredBody.params ?? paramValues,
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

    return plan;
  }
}
