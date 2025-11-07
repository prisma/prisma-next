import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-target';
import { planInvalid } from './errors';
import { createRawFactory } from './raw';
import type {
  BinaryBuilder,
  BuildOptions,
  ColumnBuilder,
  ColumnRef,
  Direction,
  InferNestedProjectionRow,
  JoinOnBuilder,
  JoinOnPredicate,
  LoweredStatement,
  ParamDescriptor,
  Plan,
  PlanMeta,
  RawFactory,
  SelectAst,
  SqlBuilderOptions,
  TableRef,
} from './types';

interface JoinState {
  readonly joinType: 'inner' | 'left' | 'right' | 'full';
  readonly table: TableRef;
  readonly on: JoinOnPredicate;
}

interface BuilderState {
  from?: TableRef;
  joins?: ReadonlyArray<JoinState>;
  projection?: ProjectionState;
  where?: BinaryBuilder;
  orderBy?: ReturnType<ColumnBuilder<string, StorageColumn>['asc']>;
  limit?: number;
}

interface ProjectionState {
  readonly aliases: string[];
  readonly columns: ColumnBuilder[];
}

function generateAlias(path: string[]): string {
  if (path.length === 0) {
    throw planInvalid('Alias path cannot be empty');
  }
  return path.join('_');
}

class AliasTracker {
  private readonly aliases = new Set<string>();
  private readonly aliasToPath = new Map<string, string[]>();

  register(path: string[]): string {
    const alias = generateAlias(path);
    if (this.aliases.has(alias)) {
      const existingPath = this.aliasToPath.get(alias);
      throw planInvalid(
        `Alias collision: path ${path.join('.')} would generate alias "${alias}" which conflicts with path ${existingPath?.join('.') ?? 'unknown'}`,
      );
    }
    this.aliases.add(alias);
    this.aliasToPath.set(alias, path);
    return alias;
  }

  getPath(alias: string): string[] | undefined {
    return this.aliasToPath.get(alias);
  }

  has(alias: string): boolean {
    return this.aliases.has(alias);
  }
}

class JoinOnBuilderImpl implements JoinOnBuilder {
  eqCol(
    left: ColumnBuilder<string, StorageColumn, unknown>,
    right: ColumnBuilder<string, StorageColumn, unknown>,
  ): JoinOnPredicate {
    if (!left || left.kind !== 'column') {
      throw planInvalid('Join ON left operand must be a column');
    }

    if (!right || right.kind !== 'column') {
      throw planInvalid('Join ON right operand must be a column');
    }

    if (left.table === right.table) {
      throw planInvalid('Self-joins are not supported in MVP');
    }

    return {
      kind: 'join-on',
      left,
      right,
    };
  }
}

export function createJoinOnBuilder(): JoinOnBuilder {
  return new JoinOnBuilderImpl();
}

class SelectBuilderImpl<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  Row = unknown,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> {
  private readonly contract: TContract;
  private readonly adapter: SqlBuilderOptions<TContract, CodecTypes>['adapter'];
  private readonly codecTypes: CodecTypes;
  private state: BuilderState = {};

  constructor(options: SqlBuilderOptions<TContract, CodecTypes>, state?: BuilderState) {
    this.contract = options.contract;
    this.adapter = options.adapter;
    this.codecTypes = options.codecTypes ?? ({} as CodecTypes);
    if (state) {
      this.state = state;
    }
  }

  from(table: TableRef): SelectBuilderImpl<TContract, unknown, CodecTypes> {
    return new SelectBuilderImpl<TContract, unknown, CodecTypes>(
      {
        contract: this.contract,
        adapter: this.adapter,
        codecTypes: this.codecTypes,
      },
      { ...this.state, from: table },
    );
  }

  innerJoin(
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes> {
    return this._addJoin('inner', table, on);
  }

  leftJoin(
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes> {
    return this._addJoin('left', table, on);
  }

  rightJoin(
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes> {
    return this._addJoin('right', table, on);
  }

  fullJoin(
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes> {
    return this._addJoin('full', table, on);
  }

  private _addJoin(
    joinType: 'inner' | 'left' | 'right' | 'full',
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes> {
    const fromTable = this.ensureFrom();

    if (!this.contract.storage.tables[table.name]) {
      throw planInvalid(`Unknown table ${table.name}`);
    }

    if (table.name === fromTable.name) {
      throw planInvalid('Self-joins are not supported in MVP');
    }

    const joinOnBuilder = createJoinOnBuilder();
    const onPredicate = on(joinOnBuilder);

    const joinState: JoinState = {
      joinType,
      table,
      on: onPredicate,
    };

    const existingJoins = this.state.joins ?? [];
    const newJoins = [...existingJoins, joinState];

    return new SelectBuilderImpl<TContract, Row, CodecTypes>(
      {
        contract: this.contract,
        adapter: this.adapter,
        codecTypes: this.codecTypes,
      },
      { ...this.state, joins: newJoins },
    );
  }

  where(expr: BinaryBuilder): SelectBuilderImpl<TContract, Row, CodecTypes> {
    return new SelectBuilderImpl<TContract, Row, CodecTypes>(
      {
        contract: this.contract,
        adapter: this.adapter,
        codecTypes: this.codecTypes,
      },
      { ...this.state, where: expr },
    );
  }

  select<
    P extends Record<
      string,
      | ColumnBuilder
      | Record<
          string,
          | ColumnBuilder
          | Record<
              string,
              ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
            >
        >
    >,
  >(
    projection: P,
  ): SelectBuilderImpl<TContract, InferNestedProjectionRow<P, CodecTypes>, CodecTypes> {
    const table = this.ensureFrom();
    const projectionState = buildProjectionState(table, projection);

    return new SelectBuilderImpl<TContract, InferNestedProjectionRow<P, CodecTypes>, CodecTypes>(
      {
        contract: this.contract,
        adapter: this.adapter,
        codecTypes: this.codecTypes,
      },
      { ...this.state, projection: projectionState },
    );
  }

  orderBy(order: ReturnType<ColumnBuilder['asc']>): SelectBuilderImpl<TContract, Row, CodecTypes> {
    return new SelectBuilderImpl<TContract, Row, CodecTypes>(
      {
        contract: this.contract,
        adapter: this.adapter,
        codecTypes: this.codecTypes,
      },
      { ...this.state, orderBy: order },
    );
  }

  limit(count: number): SelectBuilderImpl<TContract, Row, CodecTypes> {
    if (!Number.isInteger(count) || count < 0) {
      throw planInvalid('Limit must be a non-negative integer');
    }

    return new SelectBuilderImpl<TContract, Row, CodecTypes>(
      {
        contract: this.contract,
        adapter: this.adapter,
        codecTypes: this.codecTypes,
      },
      { ...this.state, limit: count },
    );
  }

  build(options?: BuildOptions): Plan<Row> {
    const table = this.ensureFrom();
    const projection = this.ensureProjection();

    const paramsMap = (options?.params ?? {}) as Record<string, unknown>;
    const contractTable = this.contract.storage.tables[table.name];

    if (!contractTable) {
      throw planInvalid(`Unknown table ${table.name}`);
    }

    const paramDescriptors: ParamDescriptor[] = [];
    const paramValues: unknown[] = [];
    const paramCodecs: Record<string, string> = {};

    const whereResult = this.state.where
      ? this._buildWhereExpr(this.state.where, paramsMap, paramDescriptors, paramValues)
      : undefined;
    const whereExpr = whereResult?.expr;

    if (whereResult?.codecId && whereResult.paramName) {
      paramCodecs[whereResult.paramName] = whereResult.codecId;
    }

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

    const joins = this.state.joins?.map((join) => ({
      kind: 'join' as const,
      joinType: join.joinType,
      table: { kind: 'table' as const, name: join.table.name },
      on: {
        kind: 'eqCol' as const,
        left: {
          kind: 'col' as const,
          table: join.on.left.table,
          column: join.on.left.column,
        },
        right: {
          kind: 'col' as const,
          table: join.on.right.table,
          column: join.on.right.column,
        },
      },
    }));

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: table.name },
      ...(joins && joins.length > 0 ? { joins } : {}),
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
      ...(this.state.joins ? { joins: this.state.joins } : {}),
      paramDescriptors,
      ...(Object.keys(paramCodecs).length > 0 ? { paramCodecs } : {}),
      ...(this.state.where ? { where: this.state.where } : {}),
      ...(this.state.orderBy ? { orderBy: this.state.orderBy } : {}),
    });

    const plan: Plan<Row> = Object.freeze({
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

  private _buildWhereExpr(
    where: BinaryBuilder,
    paramsMap: Record<string, unknown>,
    descriptors: ParamDescriptor[],
    values: unknown[],
  ): {
    expr: {
      readonly kind: 'bin';
      readonly op: 'eq';
      readonly left: { kind: 'col'; table: string; column: string };
      readonly right: { kind: 'param'; index: number; name?: string };
    };
    codecId?: string;
    paramName: string;
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

    // Get codec ID from column metadata type (already canonicalized)
    const contractTable = this.contract.storage.tables[where.left.table];
    const columnMeta = contractTable?.columns[where.left.column];
    const codecId = columnMeta?.type;

    return {
      expr: {
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
      },
      ...(codecId ? { codecId } : {}),
      paramName,
    };
  }
}

function isColumnBuilder(value: unknown): value is ColumnBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'column'
  );
}

function flattenProjection(
  projection: Record<
    string,
    | ColumnBuilder
    | Record<
        string,
        | ColumnBuilder
        | Record<
            string,
            ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
          >
      >
  >,
  tracker: AliasTracker,
  currentPath: string[] = [],
): { aliases: string[]; columns: ColumnBuilder[] } {
  const aliases: string[] = [];
  const columns: ColumnBuilder[] = [];

  for (const [key, value] of Object.entries(projection)) {
    const path = [...currentPath, key];

    if (isColumnBuilder(value)) {
      const alias = tracker.register(path);
      aliases.push(alias);
      columns.push(value);
    } else if (typeof value === 'object' && value !== null) {
      const nested = flattenProjection(
        value as Record<
          string,
          | ColumnBuilder
          | Record<
              string,
              | ColumnBuilder
              | Record<
                  string,
                  ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
                >
            >
        >,
        tracker,
        path,
      );
      aliases.push(...nested.aliases);
      columns.push(...nested.columns);
    } else {
      throw planInvalid(
        `Invalid projection value at path ${path.join('.')}: expected ColumnBuilder or nested object`,
      );
    }
  }

  return { aliases, columns };
}

function buildProjectionState(
  _table: TableRef,
  projection: Record<
    string,
    | ColumnBuilder
    | Record<
        string,
        | ColumnBuilder
        | Record<
            string,
            ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
          >
      >
  >,
): ProjectionState {
  const tracker = new AliasTracker();
  const { aliases, columns } = flattenProjection(projection, tracker);

  if (aliases.length === 0) {
    throw planInvalid('select() requires at least one column');
  }

  return { aliases, columns };
}

interface MetaBuildArgs {
  readonly contract: SqlContract<SqlStorage>;
  readonly table: TableRef;
  readonly projection: ProjectionState;
  readonly joins?: ReadonlyArray<JoinState>;
  readonly where?: BinaryBuilder;
  readonly orderBy?: ReturnType<ColumnBuilder['asc']>;
  readonly paramDescriptors: ParamDescriptor[];
  readonly paramCodecs?: Record<string, string>;
}

function buildMeta(args: MetaBuildArgs): PlanMeta {
  const refsColumns = new Map<string, { table: string; column: string }>();
  const refsTables = new Set<string>([args.table.name]);

  for (const column of args.projection.columns) {
    refsColumns.set(`${column.table}.${column.column}`, {
      table: column.table,
      column: column.column,
    });
  }

  if (args.joins) {
    for (const join of args.joins) {
      refsTables.add(join.table.name);
      refsColumns.set(`${join.on.left.table}.${join.on.left.column}`, {
        table: join.on.left.table,
        column: join.on.left.column,
      });
      refsColumns.set(`${join.on.right.table}.${join.on.right.column}`, {
        table: join.on.right.table,
        column: join.on.right.column,
      });
    }
  }

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

  // Build projectionTypes mapping: alias → column type ID
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

  // Build codec assignments from column types
  const projectionCodecs: Record<string, string> = {};
  for (let i = 0; i < args.projection.aliases.length; i++) {
    const alias = args.projection.aliases[i];
    const column = args.projection.columns[i];
    if (!column || !alias) {
      continue;
    }
    // Use columnMeta.type directly as typeId (already canonicalized)
    const columnMeta = column.columnMeta;
    if (columnMeta?.type) {
      projectionCodecs[alias] = columnMeta.type;
    }
  }

  // Merge projection and parameter codecs
  const allCodecs: Record<string, string> = {
    ...projectionCodecs,
    ...(args.paramCodecs ? args.paramCodecs : {}),
  };

  return Object.freeze({
    target: args.contract.target,
    ...(args.contract.targetFamily ? { targetFamily: args.contract.targetFamily } : {}),
    coreHash: args.contract.coreHash,
    lane: 'dsl',
    refs: {
      tables: Array.from(refsTables),
      columns: Array.from(refsColumns.values()),
    },
    projection: projectionMap,
    ...(Object.keys(projectionTypes).length > 0 ? { projectionTypes } : {}),
    ...(Object.keys(allCodecs).length > 0
      ? { annotations: Object.freeze({ codecs: Object.freeze(allCodecs) }) }
      : {}),
    paramDescriptors: args.paramDescriptors,
    ...(args.contract.profileHash !== undefined ? { profileHash: args.contract.profileHash } : {}),
  } satisfies PlanMeta);
}

export type SelectBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  Row = unknown,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> = SelectBuilderImpl<TContract, Row, CodecTypes> & {
  readonly raw: RawFactory;
};

export function sql<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(
  options: SqlBuilderOptions<TContract, CodecTypes>,
): SelectBuilder<TContract, unknown, CodecTypes> {
  const builder = new SelectBuilderImpl<TContract, unknown, CodecTypes>(options) as SelectBuilder<
    TContract,
    unknown,
    CodecTypes
  >;
  const rawFactory = createRawFactory(options.contract);

  Object.defineProperty(builder, 'raw', {
    value: rawFactory,
    enumerable: true,
    configurable: false,
  });

  return builder;
}
