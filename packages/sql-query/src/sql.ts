import { planInvalid } from './errors';
import { createRawFactory } from './raw';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-target';
import type {
  BinaryBuilder,
  BinaryExpr,
  BuildOptions,
  ColumnBuilder,
  ColumnRef,
  Direction,
  InferNestedProjectionRow,
  IncludeRef,
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

interface IncludeState {
  readonly alias: string;
  readonly table: TableRef;
  readonly on: JoinOnPredicate;
  readonly childProjection: ProjectionState;
  readonly childWhere?: BinaryBuilder;
  readonly childOrderBy?: ReturnType<ColumnBuilder<string, StorageColumn>['asc']>;
  readonly childLimit?: number;
}

interface BuilderState {
  from?: TableRef;
  joins?: ReadonlyArray<JoinState>;
  includes?: ReadonlyArray<IncludeState>;
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

class IncludeChildBuilderImpl<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  ChildRow = unknown,
> {
  private readonly contract: TContract;
  private readonly codecTypes: CodecTypes;
  private readonly table: TableRef;
  private childProjection?: ProjectionState;
  private childWhere?: BinaryBuilder;
  private childOrderBy?: ReturnType<ColumnBuilder<string, StorageColumn>['asc']>;
  private childLimit?: number;

  constructor(
    contract: TContract,
    codecTypes: CodecTypes,
    table: TableRef,
  ) {
    this.contract = contract;
    this.codecTypes = codecTypes;
    this.table = table;
  }

  select<
    P extends Record<
      string,
      ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>>>
    >,
  >(
    projection: P,
  ): IncludeChildBuilderImpl<TContract, CodecTypes, InferNestedProjectionRow<P, CodecTypes>> {
    const projectionState = buildProjectionState(this.table, projection);
    const builder = new IncludeChildBuilderImpl<TContract, CodecTypes, InferNestedProjectionRow<P, CodecTypes>>(
      this.contract,
      this.codecTypes,
      this.table,
    );
    builder.childProjection = projectionState;
    if (this.childWhere !== undefined) {
      builder.childWhere = this.childWhere;
    }
    if (this.childOrderBy !== undefined) {
      builder.childOrderBy = this.childOrderBy;
    }
    if (this.childLimit !== undefined) {
      builder.childLimit = this.childLimit;
    }
    return builder;
  }

  where(expr: BinaryBuilder): IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow> {
    const builder = new IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow>(
      this.contract,
      this.codecTypes,
      this.table,
    );
    if (this.childProjection !== undefined) {
      builder.childProjection = this.childProjection;
    }
    builder.childWhere = expr;
    if (this.childOrderBy !== undefined) {
      builder.childOrderBy = this.childOrderBy;
    }
    if (this.childLimit !== undefined) {
      builder.childLimit = this.childLimit;
    }
    return builder;
  }

  orderBy(order: ReturnType<ColumnBuilder['asc']>): IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow> {
    const builder = new IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow>(
      this.contract,
      this.codecTypes,
      this.table,
    );
    if (this.childProjection !== undefined) {
      builder.childProjection = this.childProjection;
    }
    if (this.childWhere !== undefined) {
      builder.childWhere = this.childWhere;
    }
    builder.childOrderBy = order;
    if (this.childLimit !== undefined) {
      builder.childLimit = this.childLimit;
    }
    return builder;
  }

  limit(count: number): IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow> {
    if (!Number.isInteger(count) || count < 0) {
      throw planInvalid('Limit must be a non-negative integer');
    }

    const builder = new IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow>(
      this.contract,
      this.codecTypes,
      this.table,
    );
    if (this.childProjection !== undefined) {
      builder.childProjection = this.childProjection;
    }
    if (this.childWhere !== undefined) {
      builder.childWhere = this.childWhere;
    }
    if (this.childOrderBy !== undefined) {
      builder.childOrderBy = this.childOrderBy;
    }
    builder.childLimit = count;
    return builder;
  }

  getState(): {
    childProjection: ProjectionState;
    childWhere?: BinaryBuilder<string, StorageColumn, unknown>;
    childOrderBy?: ReturnType<ColumnBuilder<string, StorageColumn>['asc']>;
    childLimit?: number;
  } {
    if (!this.childProjection) {
      throw planInvalid('Child projection must be specified');
    }
    const state: {
      childProjection: ProjectionState;
      childWhere?: BinaryBuilder<string, StorageColumn, unknown>;
      childOrderBy?: ReturnType<ColumnBuilder<string, StorageColumn>['asc']>;
      childLimit?: number;
    } = {
      childProjection: this.childProjection,
    };
    if (this.childWhere !== undefined) {
      state.childWhere = this.childWhere;
    }
    if (this.childOrderBy !== undefined) {
      state.childOrderBy = this.childOrderBy;
    }
    if (this.childLimit !== undefined) {
      state.childLimit = this.childLimit;
    }
    return state;
  }
}

export interface IncludeChildBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  ChildRow = unknown,
> {
  select<
    P extends Record<
      string,
      ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>>>
    >,
  >(
    projection: P,
  ): IncludeChildBuilder<TContract, CodecTypes, InferNestedProjectionRow<P, CodecTypes>>;
  where(expr: BinaryBuilder): IncludeChildBuilder<TContract, CodecTypes, ChildRow>;
  orderBy(order: ReturnType<ColumnBuilder['asc']>): IncludeChildBuilder<TContract, CodecTypes, ChildRow>;
  limit(count: number): IncludeChildBuilder<TContract, CodecTypes, ChildRow>;
}

class SelectBuilderImpl<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  Row = unknown,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  Includes extends Record<string, any> = Record<string, never>,
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

  from(table: TableRef): SelectBuilderImpl<TContract, unknown, CodecTypes, Record<string, never>> {
    return new SelectBuilderImpl<TContract, unknown, CodecTypes, Record<string, never>>(
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
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    return this._addJoin('inner', table, on);
  }

  leftJoin(
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    return this._addJoin('left', table, on);
  }

  rightJoin(
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    return this._addJoin('right', table, on);
  }

  fullJoin(
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    return this._addJoin('full', table, on);
  }

  includeMany<
    ChildProjection extends Record<
      string,
      ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>>>
    >,
    ChildRow = InferNestedProjectionRow<ChildProjection, CodecTypes>,
    AliasName extends string = string,
  >(
    childTable: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
    childBuilder: (child: IncludeChildBuilder<TContract, CodecTypes, unknown>) => IncludeChildBuilder<TContract, CodecTypes, ChildRow>,
    options?: { alias?: AliasName },
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes & { [K in AliasName]: ChildRow }> {
    // Runtime capability check
    const target = this.contract.target;
    const capabilities = this.contract.capabilities;
    if (!capabilities || !capabilities[target]) {
      throw planInvalid('includeMany requires lateral and jsonAgg capabilities');
    }
    const targetCapabilities = capabilities[target];
    if (targetCapabilities['lateral'] !== true || targetCapabilities['jsonAgg'] !== true) {
      throw planInvalid('includeMany requires lateral and jsonAgg capabilities to be true');
    }

    if (!this.contract.storage.tables[childTable.name]) {
      throw planInvalid(`Unknown table ${childTable.name}`);
    }

    const joinOnBuilder = createJoinOnBuilder();
    const onPredicate = on(joinOnBuilder);

    // Validate ON uses column equality
    if (onPredicate.left.table === onPredicate.right.table) {
      throw planInvalid('Self-joins are not supported in MVP');
    }

    // Build child builder
    const childBuilderImpl = new IncludeChildBuilderImpl<TContract, CodecTypes, unknown>(
      this.contract,
      this.codecTypes,
      childTable,
    );
    const builtChild = childBuilder(childBuilderImpl as IncludeChildBuilder<TContract, CodecTypes, unknown>);
    const childState = (builtChild as IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow>).getState();

    // Validate child projection is non-empty
    if (childState.childProjection.aliases.length === 0) {
      throw planInvalid('Child projection must not be empty');
    }

    // Determine alias
    const alias = options?.alias ?? childTable.name;

    // Check for alias collisions with existing projection
    if (this.state.projection) {
      if (this.state.projection.aliases.includes(alias)) {
        throw planInvalid(`Alias collision: include alias "${alias}" conflicts with existing projection alias`);
      }
    }

    // Check for alias collisions with existing includes
    const existingIncludes = this.state.includes ?? [];
    if (existingIncludes.some((inc) => inc.alias === alias)) {
      throw planInvalid(`Alias collision: include alias "${alias}" conflicts with existing include alias`);
    }

    const includeState: IncludeState = {
      alias,
      table: childTable,
      on: onPredicate,
      childProjection: childState.childProjection,
      ...(childState.childWhere !== undefined ? { childWhere: childState.childWhere } : {}),
      ...(childState.childOrderBy !== undefined ? { childOrderBy: childState.childOrderBy } : {}),
      ...(childState.childLimit !== undefined ? { childLimit: childState.childLimit } : {}),
    };

    const newIncludes = [...existingIncludes, includeState];

    // Type-level: Update Includes map with new include
    // Use the AliasName generic parameter which TypeScript will infer from the options.alias value
    type NewIncludes = Includes & { [K in AliasName]: ChildRow };

    return new SelectBuilderImpl<TContract, Row, CodecTypes, NewIncludes>(
      {
        contract: this.contract,
        adapter: this.adapter,
        codecTypes: this.codecTypes,
      },
      { ...this.state, includes: newIncludes },
    );
  }

  private _addJoin(
    joinType: 'inner' | 'left' | 'right' | 'full',
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
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

    return new SelectBuilderImpl<TContract, Row, CodecTypes, Includes>(
      {
        contract: this.contract,
        adapter: this.adapter,
        codecTypes: this.codecTypes,
      },
      { ...this.state, joins: newJoins },
    );
  }

  where(expr: BinaryBuilder): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    return new SelectBuilderImpl<TContract, Row, CodecTypes, Includes>(
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
      ColumnBuilder | boolean | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>>>
    >,
  >(
    projection: P,
  ): SelectBuilderImpl<TContract, InferNestedProjectionRow<P, CodecTypes, Includes>, CodecTypes, Includes> {
    const table = this.ensureFrom();
    const projectionState = buildProjectionState(table, projection, this.state.includes);

    return new SelectBuilderImpl<TContract, InferNestedProjectionRow<P, CodecTypes, Includes>, CodecTypes, Includes>(
      {
        contract: this.contract,
        adapter: this.adapter,
        codecTypes: this.codecTypes,
      },
      { ...this.state, projection: projectionState },
    );
  }

  orderBy(order: ReturnType<ColumnBuilder['asc']>): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    return new SelectBuilderImpl<TContract, Row, CodecTypes, Includes>(
      {
        contract: this.contract,
        adapter: this.adapter,
        codecTypes: this.codecTypes,
      },
      { ...this.state, orderBy: order },
    );
  }

  limit(count: number): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    if (!Number.isInteger(count) || count < 0) {
      throw planInvalid('Limit must be a non-negative integer');
    }

    return new SelectBuilderImpl<TContract, Row, CodecTypes, Includes>(
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

    const includes = this.state.includes?.map((include) => {
      const childOrderBy = include.childOrderBy
        ? ([
            {
              expr: {
                kind: 'col' as const,
                table: include.childOrderBy.expr.table,
                column: include.childOrderBy.expr.column,
              },
              dir: include.childOrderBy.dir,
            },
          ] as ReadonlyArray<{ expr: ColumnRef; dir: Direction }>)
        : undefined;

      let childWhere: BinaryExpr | undefined;
      if (include.childWhere) {
        const whereResult = this._buildWhereExpr(include.childWhere, paramsMap, paramDescriptors, paramValues);
        childWhere = whereResult?.expr;
      }

      return {
        kind: 'includeMany' as const,
        alias: include.alias,
        child: {
          table: { kind: 'table' as const, name: include.table.name },
          on: {
            kind: 'eqCol' as const,
            left: {
              kind: 'col' as const,
              table: include.on.left.table,
              column: include.on.left.column,
            },
            right: {
              kind: 'col' as const,
              table: include.on.right.table,
              column: include.on.right.column,
            },
          },
          ...(childWhere ? { where: childWhere } : {}),
          ...(childOrderBy ? { orderBy: childOrderBy } : {}),
          ...(typeof include.childLimit === 'number' ? { limit: include.childLimit } : {}),
          project: include.childProjection.aliases.map((alias, idx) => {
            const column = include.childProjection.columns[idx];
            if (!column || !alias) {
              throw planInvalid(`Missing column for alias ${alias ?? 'unknown'} at index ${idx}`);
            }
            return {
              alias,
              expr: {
                kind: 'col' as const,
                table: column.table,
                column: column.column,
              },
            };
          }),
        },
      };
    });

    // Build projection with support for includeRef
    const projectEntries: Array<{ alias: string; expr: ColumnRef | IncludeRef }> = [];
    for (let i = 0; i < projection.aliases.length; i++) {
      const alias = projection.aliases[i];
      if (!alias) {
        throw planInvalid(`Missing alias at index ${i}`);
      }
      const column = projection.columns[i];
      if (!column) {
        throw planInvalid(`Missing column for alias ${alias} at index ${i}`);
      }

      // Check if this alias matches an include alias
      const matchingInclude = this.state.includes?.find((inc) => inc.alias === alias);
      if (matchingInclude) {
        // This is an include reference
        projectEntries.push({
          alias,
          expr: { kind: 'includeRef', alias },
        });
      } else {
        // This is a regular column
        const tableName = column.table;
        const columnName = column.column;
        if (!tableName || !columnName) {
          throw planInvalid(`Invalid column for alias ${alias} at index ${i}`);
        }
        projectEntries.push({
          alias,
          expr: {
            kind: 'col',
            table: tableName,
            column: columnName,
          },
        });
      }
    }

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: table.name },
      ...(joins && joins.length > 0 ? { joins } : {}),
      ...(includes && includes.length > 0 ? { includes } : {}),
      project: projectEntries,
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
      ...(this.state.includes ? { includes: this.state.includes } : {}),
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
    ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>>>
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
          ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>>>
        >,
        tracker,
        path,
      );
      aliases.push(...nested.aliases);
      columns.push(...nested.columns);
    } else {
      throw planInvalid(`Invalid projection value at path ${path.join('.')}: expected ColumnBuilder or nested object`);
    }
  }

  return { aliases, columns };
}

function buildProjectionState(
  _table: TableRef,
  projection: Record<
    string,
    ColumnBuilder | boolean | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>>>
  >,
  includes?: ReadonlyArray<IncludeState>,
): ProjectionState {
  const tracker = new AliasTracker();
  const aliases: string[] = [];
  const columns: ColumnBuilder[] = [];

  for (const [key, value] of Object.entries(projection)) {
    if (value === true) {
      // Boolean true means this is an include reference
      const matchingInclude = includes?.find((inc) => inc.alias === key);
      if (!matchingInclude) {
        throw planInvalid(`Include alias "${key}" not found. Did you call includeMany() with alias "${key}"?`);
      }
      // For include references, we track the alias but use a placeholder column
      // The actual handling happens in AST building where we create includeRef
      aliases.push(key);
      // Use a placeholder column - this won't be used for includes, but we need
      // to maintain the same array length for aliases and columns
      columns.push({
        kind: 'column',
        table: matchingInclude.table.name,
        column: '',
        columnMeta: { type: 'core/json@1', nullable: true },
      } as ColumnBuilder);
    } else if (isColumnBuilder(value)) {
      const alias = tracker.register([key]);
      aliases.push(alias);
      columns.push(value);
    } else if (typeof value === 'object' && value !== null) {
      const nested = flattenProjection(
        value as Record<
          string,
          ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>>>
        >,
        tracker,
        [key],
      );
      aliases.push(...nested.aliases);
      columns.push(...nested.columns);
    } else {
      throw planInvalid(`Invalid projection value at key "${key}": expected ColumnBuilder, boolean true (for includes), or nested object`);
    }
  }

  if (aliases.length === 0) {
    throw planInvalid('select() requires at least one column or include');
  }

  return { aliases, columns };
}

interface MetaBuildArgs {
  readonly contract: SqlContract<SqlStorage>;
  readonly table: TableRef;
  readonly projection: ProjectionState;
  readonly joins?: ReadonlyArray<JoinState>;
  readonly includes?: ReadonlyArray<IncludeState>;
  readonly where?: BinaryBuilder;
  readonly orderBy?: ReturnType<ColumnBuilder['asc']>;
  readonly paramDescriptors: ParamDescriptor[];
  readonly paramCodecs?: Record<string, string>;
}

function buildMeta(args: MetaBuildArgs): PlanMeta {
  const refsColumns = new Map<string, { table: string; column: string }>();
  const refsTables = new Set<string>([args.table.name]);

  args.projection.columns.forEach((column) => {
    refsColumns.set(`${column.table}.${column.column}`, {
      table: column.table,
      column: column.column,
    });
  });

  if (args.joins) {
    args.joins.forEach((join) => {
      refsTables.add(join.table.name);
      refsColumns.set(`${join.on.left.table}.${join.on.left.column}`, {
        table: join.on.left.table,
        column: join.on.left.column,
      });
      refsColumns.set(`${join.on.right.table}.${join.on.right.column}`, {
        table: join.on.right.table,
        column: join.on.right.column,
      });
    });
  }

  if (args.includes) {
    args.includes.forEach((include) => {
      refsTables.add(include.table.name);
      // Add ON condition columns
      refsColumns.set(`${include.on.left.table}.${include.on.left.column}`, {
        table: include.on.left.table,
        column: include.on.left.column,
      });
      refsColumns.set(`${include.on.right.table}.${include.on.right.column}`, {
        table: include.on.right.table,
        column: include.on.right.column,
      });
      // Add child projection columns
      include.childProjection.columns.forEach((column) => {
        if (column.table && column.column) {
          refsColumns.set(`${column.table}.${column.column}`, {
            table: column.table,
            column: column.column,
          });
        }
      });
      // Add child WHERE columns if present
      if (include.childWhere) {
        refsColumns.set(`${include.childWhere.left.table}.${include.childWhere.left.column}`, {
          table: include.childWhere.left.table,
          column: include.childWhere.left.column,
        });
      }
      // Add child ORDER BY columns if present
      if (include.childOrderBy) {
        refsColumns.set(`${include.childOrderBy.expr.table}.${include.childOrderBy.expr.column}`, {
          table: include.childOrderBy.expr.table,
          column: include.childOrderBy.expr.column,
        });
      }
    });
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

  // Build projection map - mark include aliases with special marker
  const includeAliases = new Set(args.includes?.map((inc) => inc.alias) ?? []);
  const projectionMap = Object.fromEntries(
    args.projection.aliases.map((alias, index) => {
      if (includeAliases.has(alias)) {
        // Mark include alias with special marker
        return [alias, `include:${alias}`];
      }
      const column = args.projection.columns[index];
      if (!column) {
        throw planInvalid(`Missing column for alias ${alias} at index ${index}`);
      }
      if (!column.table || !column.column) {
        // This is a placeholder column for an include - skip it
        return [alias, `include:${alias}`];
      }
      return [alias, `${column.table}.${column.column}`];
    }),
  );

  // Build projectionTypes mapping: alias → column type ID
  // Skip include aliases - they don't have column types
  const projectionTypes: Record<string, string> = {};
  for (let i = 0; i < args.projection.aliases.length; i++) {
    const alias = args.projection.aliases[i];
    if (!alias || includeAliases.has(alias)) {
      continue;
    }
    const column = args.projection.columns[i];
    if (!column) {
      continue;
    }
    const columnMeta = column.columnMeta;
    if (columnMeta?.type) {
      projectionTypes[alias] = columnMeta.type;
    }
  }

  // Build codec assignments from column types
  // Skip include aliases - they don't need codec entries
  const projectionCodecs: Record<string, string> = {};
  for (let i = 0; i < args.projection.aliases.length; i++) {
    const alias = args.projection.aliases[i];
    if (!alias || includeAliases.has(alias)) {
      continue;
    }
    const column = args.projection.columns[i];
    if (!column) {
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
  Includes extends Record<string, any> = Record<string, never>,
> = SelectBuilderImpl<TContract, Row, CodecTypes, Includes> & {
  readonly raw: RawFactory;
};

export function sql<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(
  options: SqlBuilderOptions<TContract, CodecTypes>,
): SelectBuilder<TContract, unknown, CodecTypes, Record<string, never>> {
  const builder = new SelectBuilderImpl<TContract, unknown, CodecTypes, Record<string, never>>(options) as SelectBuilder<
    TContract,
    unknown,
    CodecTypes,
    Record<string, never>
  >;
  const rawFactory = createRawFactory(options.contract);

  Object.defineProperty(builder, 'raw', {
    value: rawFactory,
    enumerable: true,
    configurable: false,
  });

  return builder;
}
