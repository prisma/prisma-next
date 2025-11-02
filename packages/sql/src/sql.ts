import { planInvalid } from './errors';
import { createRawFactory } from './raw';
import type { SqlContract } from '@prisma-next/contract/types';
import type {
  BinaryBuilder,
  BuildOptions,
  ColumnBuilder,
  ColumnRef,
  DslPlan,
  DslPlanMeta,
  Direction,
  InferProjectionRow,
  LoweredStatement,
  ParamDescriptor,
  RawFactory,
  SelectAst,
  SqlBuilderOptions,
  TableRef,
} from './types';

interface BuilderState {
  from?: TableRef;
  projection?: ProjectionState;
  where?: BinaryBuilder;
  orderBy?: ReturnType<ColumnBuilder['asc']>;
  limit?: number;
}

interface ProjectionState {
  readonly aliases: string[];
  readonly columns: ColumnBuilder[];
}

class SelectBuilderImpl<Row = unknown> {
  private readonly contract: SqlContract;
  private readonly adapter: SqlBuilderOptions['adapter'];
  private state: BuilderState = {};

  constructor(options: SqlBuilderOptions, state?: BuilderState) {
    this.contract = options.contract;
    this.adapter = options.adapter;
    if (state) {
      this.state = state;
    }
  }

  from(table: TableRef): SelectBuilderImpl<unknown> {
    return new SelectBuilderImpl<unknown>(
      {
        contract: this.contract,
        adapter: this.adapter,
      },
      { ...this.state, from: table },
    );
  }

  where(expr: BinaryBuilder): SelectBuilderImpl<Row> {
    return new SelectBuilderImpl<Row>(
      {
        contract: this.contract,
        adapter: this.adapter,
      },
      { ...this.state, where: expr },
    );
  }

  select<P extends Record<string, ColumnBuilder>>(
    projection: P,
  ): SelectBuilderImpl<InferProjectionRow<P>> {
    const table = this.ensureFrom();
    const projectionState = buildProjectionState(table, projection);

    return new SelectBuilderImpl<InferProjectionRow<P>>(
      {
        contract: this.contract,
        adapter: this.adapter,
      },
      { ...this.state, projection: projectionState },
    );
  }

  orderBy(order: ReturnType<ColumnBuilder['asc']>): SelectBuilderImpl<Row> {
    return new SelectBuilderImpl<Row>(
      {
        contract: this.contract,
        adapter: this.adapter,
      },
      { ...this.state, orderBy: order },
    );
  }

  limit(count: number): SelectBuilderImpl<Row> {
    if (!Number.isInteger(count) || count < 0) {
      throw planInvalid('Limit must be a non-negative integer');
    }

    return new SelectBuilderImpl<Row>(
      {
        contract: this.contract,
        adapter: this.adapter,
      },
      { ...this.state, limit: count },
    );
  }

  build(options?: BuildOptions): DslPlan<Row> {
    const table = this.ensureFrom();
    const projection = this.ensureProjection();

    const paramsMap = (options?.params ?? {}) as Record<string, unknown>;
    const contractTable = this.contract.storage.tables[table.name];

    if (!contractTable) {
      throw planInvalid(`Unknown table ${table.name}`);
    }

    const paramDescriptors: ParamDescriptor[] = [];
    const paramValues: unknown[] = [];

    const whereExpr = this.state.where
      ? buildWhereExpr(this.state.where, paramsMap, paramDescriptors, paramValues)
      : undefined;

    const orderByClause = this.state.orderBy
      ? ([
          {
            expr: {
              kind: 'col',
              table: this.state.orderBy.expr.table,
              column: this.state.orderBy.expr.column,
            },
            dir: this.state.orderBy.dir,
          },
        ] as ReadonlyArray<{ expr: ColumnRef; dir: Direction }>)
      : undefined;

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: table.name },
      project: projection.aliases.map((alias, idx) => {
        const column = projection.columns[idx];
        if (!column) {
          throw planInvalid(`Missing column for alias ${alias} at index ${idx}`);
        }
        return {
          alias,
          expr: {
            kind: 'col',
            table: column.table,
            column: column.column,
          },
        };
      }),
      ...(whereExpr ? { where: whereExpr } : {}),
      ...(orderByClause ? { orderBy: orderByClause } : {}),
      ...(typeof this.state.limit === 'number' ? { limit: this.state.limit } : {}),
    };

    const lowered = this.adapter.lower(ast, {
      contract: this.contract,
      params: paramValues,
    });
    const loweredBody = lowered.body as LoweredStatement;

    const planMeta = buildMeta({
      contract: this.contract,
      table,
      projection,
      paramDescriptors,
      ...(this.state.where ? { where: this.state.where } : {}),
      ...(this.state.orderBy ? { orderBy: this.state.orderBy } : {}),
    });

    const plan: DslPlan<Row> = Object.freeze({
      ast,
      sql: loweredBody.sql,
      params: loweredBody.params ?? paramValues,
      meta: planMeta,
    });

    return plan;
  }

  private ensureFrom() {
    if (!this.state.from) {
      throw planInvalid('from() must be called before building a query');
    }

    return this.state.from;
  }

  private ensureProjection() {
    if (!this.state.projection) {
      throw planInvalid('select() must be called before build()');
    }

    return this.state.projection;
  }
}

function buildProjectionState(
  _table: TableRef,
  projection: Record<string, ColumnBuilder>,
): ProjectionState {
  const aliases: string[] = [];
  const columns: ColumnBuilder[] = [];

  for (const [alias, column] of Object.entries(projection)) {
    if (!column || column.kind !== 'column') {
      throw planInvalid(`Invalid column projection for alias ${alias}`);
    }
    aliases.push(alias);
    columns.push(column);
  }

  if (aliases.length === 0) {
    throw planInvalid('select() requires at least one column');
  }

  return { aliases, columns };
}

function buildWhereExpr(
  where: BinaryBuilder,
  paramsMap: Record<string, unknown>,
  descriptors: ParamDescriptor[],
  values: unknown[],
): {
  readonly kind: 'bin';
  readonly op: 'eq';
  readonly left: { kind: 'col'; table: string; column: string };
  readonly right: { kind: 'param'; index: number; name?: string };
} {
  const placeholder = where.right;
  const paramName = placeholder.name;

  if (!Object.prototype.hasOwnProperty.call(paramsMap, paramName)) {
    throw planInvalid(`Missing value for parameter ${paramName}`);
  }

  const value = paramsMap[paramName];
  const index = values.push(value);

  const meta = (where.left.columnMeta ?? {}) as { type?: string; nullable?: boolean };

  descriptors.push({
    name: paramName,
    source: 'dsl',
    refs: { table: where.left.table, column: where.left.column },
    ...(typeof meta.type === 'string' ? { type: meta.type } : {}),
    ...(typeof meta.nullable === 'boolean' ? { nullable: meta.nullable } : {}),
  });

  return {
    kind: 'bin',
    op: 'eq',
    left: {
      kind: 'col',
      table: where.left.table,
      column: where.left.column,
    },
    right: {
      kind: 'param',
      index,
      name: paramName,
    },
  };
}

interface MetaBuildArgs {
  readonly contract: SqlContract;
  readonly table: TableRef;
  readonly projection: ProjectionState;
  readonly where?: BinaryBuilder;
  readonly orderBy?: ReturnType<ColumnBuilder['asc']>;
  readonly paramDescriptors: ParamDescriptor[];
}

function buildMeta(args: MetaBuildArgs): DslPlanMeta {
  const refsColumns = new Map<string, { table: string; column: string }>();

  args.projection.columns.forEach((column) => {
    refsColumns.set(`${column.table}.${column.column}`, {
      table: column.table,
      column: column.column,
    });
  });

  if (args.where) {
    refsColumns.set(`${args.where.left.table}.${args.where.left.column}`, {
      table: args.where.left.table,
      column: args.where.left.column,
    });
  }

  if (args.orderBy) {
    refsColumns.set(`${args.orderBy.expr.table}.${args.orderBy.expr.column}`, {
      table: args.orderBy.expr.table,
      column: args.orderBy.expr.column,
    });
  }

  const projectionMap = Object.fromEntries(
    args.projection.aliases.map((alias, index) => {
      const column = args.projection.columns[index];
      if (!column) {
        throw planInvalid(`Missing column for alias ${alias} at index ${index}`);
      }
      return [alias, `${column.table}.${column.column}`];
    }),
  );

  // Build projectionTypes mapping: alias → contract scalar type
  const projectionTypes: Record<string, string> = {};
  for (let i = 0; i < args.projection.aliases.length; i++) {
    const alias = args.projection.aliases[i];
    const column = args.projection.columns[i];
    if (!column || !alias) {
      continue;
    }
    const columnMeta = column.columnMeta;
    if (columnMeta?.type) {
      projectionTypes[alias] = columnMeta.type;
    }
  }

  return Object.freeze({
    target: args.contract.target,
    ...(args.contract.targetFamily ? { targetFamily: args.contract.targetFamily } : {}),
    coreHash: args.contract.coreHash,
    lane: 'dsl' as const,
    refs: {
      tables: [args.table.name],
      columns: Array.from(refsColumns.values()),
    },
    projection: projectionMap,
    ...(Object.keys(projectionTypes).length > 0 ? { projectionTypes } : {}),
    paramDescriptors: args.paramDescriptors,
    ...(args.contract.profileHash !== undefined ? { profileHash: args.contract.profileHash } : {}),
  } satisfies DslPlanMeta);
}

type SelectBuilder = SelectBuilderImpl<unknown> & { readonly raw: RawFactory };

export function sql(options: SqlBuilderOptions): SelectBuilder {
  const builder = new SelectBuilderImpl(options) as SelectBuilder;
  const rawFactory = createRawFactory(options.contract);

  Object.defineProperty(builder, 'raw', {
    value: rawFactory,
    enumerable: true,
    configurable: false,
  });

  return builder;
}
