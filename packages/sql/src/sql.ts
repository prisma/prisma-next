import { planInvalid } from './errors';
import { createRawFactory } from './raw';
import type { SqlContract, SqlStorage, StorageColumn } from './contract-types';
import type {
  BinaryBuilder,
  BuildOptions,
  ColumnBuilder,
  ColumnRef,
  Direction,
  InferProjectionRow,
  LoweredStatement,
  ParamDescriptor,
  Plan,
  PlanMeta,
  RawFactory,
  SelectAst,
  SqlBuilderOptions,
  TableRef,
} from './types';

interface BuilderState {
  from?: TableRef;
  projection?: ProjectionState;
  where?: BinaryBuilder;
  orderBy?: ReturnType<ColumnBuilder<string, StorageColumn>['asc']>;
  limit?: number;
}

interface ProjectionState {
  readonly aliases: string[];
  readonly columns: ColumnBuilder[];
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

  constructor(
    options: SqlBuilderOptions<TContract, CodecTypes>,
    state?: BuilderState,
  ) {
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

  select<P extends Record<string, ColumnBuilder>>(
    projection: P,
  ): SelectBuilderImpl<TContract, InferProjectionRow<P>, CodecTypes> {
    const table = this.ensureFrom();
    const projectionState = buildProjectionState(table, projection);

    return new SelectBuilderImpl<TContract, InferProjectionRow<P>, CodecTypes>(
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

    const codecId = extractTypeIdFromExtensions(
      this.contract.extensions,
      where.left.table,
      where.left.column,
    );

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

/**
 * Extracts typeId from extension decorations for a given table/column.
 * Searches through all extensions for a decoration matching the table/column.
 */
function extractTypeIdFromExtensions(
  extensions: Record<string, unknown> | undefined,
  table: string,
  column: string,
): string | undefined {
  if (!extensions) {
    return undefined;
  }

  for (const [_namespace, extension] of Object.entries(extensions)) {
    if (typeof extension !== 'object' || extension === null) {
      continue;
    }

    const ext = extension as {
      decorations?: {
        columns?: Array<{
          ref?: { kind?: string; table?: string; column?: string };
          payload?: { typeId?: string };
        }>;
      };
    };

    if (ext.decorations?.columns) {
      for (const decoration of ext.decorations.columns) {
        if (
          decoration.ref?.kind === 'column' &&
          decoration.ref.table === table &&
          decoration.ref.column === column &&
          decoration.payload?.typeId
        ) {
          return decoration.payload.typeId;
        }
      }
    }
  }

  return undefined;
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

interface MetaBuildArgs {
  readonly contract: SqlContract<SqlStorage>;
  readonly table: TableRef;
  readonly projection: ProjectionState;
  readonly where?: BinaryBuilder;
  readonly orderBy?: ReturnType<ColumnBuilder['asc']>;
  readonly paramDescriptors: ParamDescriptor[];
  readonly paramCodecs?: Record<string, string>;
}

function buildMeta(args: MetaBuildArgs): PlanMeta {
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

  // Build codec assignments from extension decorations
  const projectionCodecs: Record<string, string> = {};
  for (let i = 0; i < args.projection.aliases.length; i++) {
    const alias = args.projection.aliases[i];
    const column = args.projection.columns[i];
    if (!column || !alias) {
      continue;
    }
    // Extract typeId from extension decorations
    const typeId = extractTypeIdFromExtensions(
      args.contract.extensions,
      column.table,
      column.column,
    );
    if (typeId) {
      projectionCodecs[alias] = typeId;
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
      tables: [args.table.name],
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

type SelectBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> = SelectBuilderImpl<TContract, unknown, CodecTypes> & {
  readonly raw: RawFactory;
};

export function sql<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(options: SqlBuilderOptions<TContract, CodecTypes>): SelectBuilder<TContract, CodecTypes> {
  const builder = new SelectBuilderImpl<TContract, unknown, CodecTypes>(
    options,
  ) as SelectBuilder<TContract, CodecTypes>;
  const rawFactory = createRawFactory(options.contract);

  Object.defineProperty(builder, 'raw', {
    value: rawFactory,
    enumerable: true,
    configurable: false,
  });

  return builder;
}
