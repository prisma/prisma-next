import type { PlanRefs } from '@prisma-next/contract/types';
import type { ReturnSpec } from '@prisma-next/operations';
import type { SqlLoweringSpec } from '@prisma-next/sql-operations';

export type Direction = 'asc' | 'desc';

export type BinaryOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'in'
  | 'notIn';

export type AggregateCountFn = 'count';
export type AggregateOpFn = 'sum' | 'avg' | 'min' | 'max';
export type AggregateFn = AggregateCountFn | AggregateOpFn;

export interface ExpressionSource {
  toExpr(): AnyExpression;
}

export interface ExpressionRewriter {
  columnRef?(expr: ColumnRef): AnyExpression;
  paramRef?(expr: ParamRef): ParamRef | LiteralExpr;
  literal?(expr: LiteralExpr): LiteralExpr;
  listLiteral?(expr: ListLiteralExpr): ListLiteralExpr | LiteralExpr;
  select?(ast: SelectAst): SelectAst;
}

export interface AstRewriter extends ExpressionRewriter {
  tableSource?(source: TableSource): TableSource;
  eqColJoinOn?(on: EqColJoinOn): EqColJoinOn | AnyWhereExpr;
}

export interface WhereExprVisitor<R> {
  binary(expr: BinaryExpr): R;
  and(expr: AndExpr): R;
  or(expr: OrExpr): R;
  exists(expr: ExistsExpr): R;
  nullCheck(expr: NullCheckExpr): R;
}

export interface ExpressionFolder<T> {
  empty: T;
  combine(a: T, b: T): T;
  isAbsorbing?(value: T): boolean;
  columnRef?(expr: ColumnRef): T;
  paramRef?(expr: ParamRef): T;
  literal?(expr: LiteralExpr): T;
  listLiteral?(expr: ListLiteralExpr): T;
  select?(ast: SelectAst): T;
}

export type ProjectionExpr = AnyExpression | LiteralExpr;
export type InsertValue = ColumnRef | ParamRef | DefaultValueExpr;
export type JoinOnExpr = EqColJoinOn | AnyWhereExpr;
export type WhereArg = AnyWhereExpr | ToWhereExpr;
export type JsonObjectEntry = {
  readonly key: string;
  readonly value: ProjectionExpr;
};

function frozenArrayCopy<T>(values: readonly T[]): ReadonlyArray<T> {
  return Object.freeze([...values]);
}

function frozenOptionalRecordCopy<T extends Record<string, unknown>>(
  value: T | undefined,
): Readonly<T> | undefined {
  return value === undefined ? undefined : Object.freeze({ ...value });
}

function frozenRecordCopy<T>(record: Readonly<Record<string, T>>): Readonly<Record<string, T>> {
  return Object.freeze({ ...record });
}

function freezeRows(
  rows: ReadonlyArray<Record<string, InsertValue>>,
): ReadonlyArray<Readonly<Record<string, InsertValue>>> {
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

function combineAll<T>(folder: ExpressionFolder<T>, thunks: Array<() => T>): T {
  let result = folder.empty;
  for (const thunk of thunks) {
    if (folder.isAbsorbing?.(result)) {
      return result;
    }
    result = folder.combine(result, thunk());
  }
  return result;
}

function rewriteComparable(
  value: AnySqlComparable,
  rewriter: ExpressionRewriter,
): AnySqlComparable {
  switch (value.kind) {
    case 'param-ref':
      return rewriter.paramRef ? rewriter.paramRef(value) : value;
    case 'literal':
      return rewriter.literal ? rewriter.literal(value) : value;
    case 'list-literal':
      if (rewriter.listLiteral) {
        return rewriter.listLiteral(value);
      }
      return value.rewrite(rewriter);
    case 'column-ref':
    case 'subquery':
    case 'operation':
    case 'aggregate':
    case 'json-object':
    case 'json-array-agg':
      return value.rewrite(rewriter);
    // v8 ignore next 4
    default:
      throw new Error(
        `Unsupported comparable kind: ${(value satisfies never as { kind: string }).kind}`,
      );
  }
}

function foldComparable<T>(value: AnySqlComparable, folder: ExpressionFolder<T>): T {
  switch (value.kind) {
    case 'param-ref':
      return folder.paramRef ? folder.paramRef(value) : folder.empty;
    case 'literal':
      return folder.literal ? folder.literal(value) : folder.empty;
    case 'list-literal':
    case 'column-ref':
    case 'subquery':
    case 'operation':
    case 'aggregate':
    case 'json-object':
    case 'json-array-agg':
      return value.fold(folder);
    // v8 ignore next 4
    default:
      throw new Error(
        `Unsupported comparable kind: ${(value satisfies never as { kind: string }).kind}`,
      );
  }
}

function collectColumnRefsWith<TNode extends Expression | WhereExpr>(node: TNode): ColumnRef[] {
  return node.fold<ColumnRef[]>({
    empty: [],
    combine: (a, b) => [...a, ...b],
    columnRef: (columnRef) => [columnRef],
    select: (ast) => ast.collectColumnRefs(),
  });
}

function collectParamRefsWith<TNode extends Expression | WhereExpr>(node: TNode): ParamRef[] {
  return node.fold<ParamRef[]>({
    empty: [],
    combine: (a, b) => [...a, ...b],
    paramRef: (paramRef) => [paramRef],
    select: (ast) => ast.collectParamRefs(),
  });
}

function sortRefs(
  tables: ReadonlySet<string>,
  columns: ReadonlyMap<string, { table: string; column: string }>,
): PlanRefs {
  const sortedTables = [...tables].sort((a, b) => a.localeCompare(b));
  const sortedColumns = [...columns.values()].sort((a, b) => {
    const tableCompare = a.table.localeCompare(b.table);
    if (tableCompare !== 0) {
      return tableCompare;
    }
    return a.column.localeCompare(b.column);
  });

  return {
    tables: sortedTables,
    columns: sortedColumns,
  };
}

function addColumnRefToRefSets(
  columnRef: ColumnRef,
  tables: Set<string>,
  columns: Map<string, { table: string; column: string }>,
): void {
  if (columnRef.table === 'excluded') {
    return;
  }
  tables.add(columnRef.table);
  const key = `${columnRef.table}.${columnRef.column}`;
  if (!columns.has(key)) {
    columns.set(key, {
      table: columnRef.table,
      column: columnRef.column,
    });
  }
}

function mergeRefsInto(
  refs: PlanRefs,
  tables: Set<string>,
  columns: Map<string, { table: string; column: string }>,
): void {
  for (const table of refs.tables ?? []) {
    tables.add(table);
  }
  for (const column of refs.columns ?? []) {
    addColumnRefToRefSets(new ColumnRef(column.table, column.column), tables, columns);
  }
}

abstract class AstNode {
  abstract readonly kind: string;

  protected freeze(): void {
    Object.freeze(this);
  }
}

abstract class QueryAst extends AstNode {
  abstract collectRefs(): PlanRefs;
  abstract collectParamRefs(): ParamRef[];

  collectColumnRefs(): ColumnRef[] {
    const refs = this.collectRefs().columns ?? [];
    return refs.map((ref) => new ColumnRef(ref.table, ref.column));
  }

  abstract toQueryAst(): AnyQueryAst;
}

abstract class FromSource extends AstNode {
  abstract collectRefs(): PlanRefs;
  abstract rewrite(rewriter: AstRewriter): AnyFromSource;
  abstract toFromSource(): AnyFromSource;
}

abstract class Expression extends AstNode implements ExpressionSource {
  abstract rewrite(rewriter: ExpressionRewriter): AnyExpression;
  abstract fold<T>(folder: ExpressionFolder<T>): T;
  abstract toExpr(): AnyExpression;

  collectColumnRefs(): ColumnRef[] {
    return collectColumnRefsWith(this);
  }

  collectParamRefs(): ParamRef[] {
    return collectParamRefsWith(this);
  }

  baseColumnRef(): ColumnRef {
    throw new Error(`${this.constructor.name} does not expose a base column reference`);
  }
}

abstract class WhereExpr extends AstNode {
  abstract accept<R>(visitor: WhereExprVisitor<R>): R;
  abstract rewrite(rewriter: ExpressionRewriter): AnyWhereExpr;
  abstract fold<T>(folder: ExpressionFolder<T>): T;
  abstract not(): AnyWhereExpr;
  abstract toUnboundWhereExpr(): AnyWhereExpr;

  collectColumnRefs(): ColumnRef[] {
    return collectColumnRefsWith(this);
  }

  collectParamRefs(): ParamRef[] {
    return collectParamRefsWith(this);
  }
}

export class TableSource extends FromSource {
  readonly kind = 'table-source' as const;
  readonly name: string;
  readonly alias: string | undefined;

  constructor(name: string, alias?: string) {
    super();
    this.name = name;
    this.alias = alias;
    this.freeze();
  }

  override toFromSource(): AnyFromSource {
    return this;
  }

  static named(name: string, alias?: string): TableSource {
    return new TableSource(name, alias);
  }

  override rewrite(rewriter: AstRewriter): AnyFromSource {
    return rewriter.tableSource ? rewriter.tableSource(this) : this;
  }

  override collectRefs(): PlanRefs {
    return {
      tables: [this.name],
      columns: [],
    };
  }
}

export interface TableRef {
  readonly name: string;
  readonly alias?: string;
}

export class DerivedTableSource extends FromSource {
  readonly kind = 'derived-table-source' as const;
  readonly alias: string;
  readonly query: SelectAst;

  constructor(alias: string, query: SelectAst) {
    super();
    this.alias = alias;
    this.query = query;
    this.freeze();
  }

  static as(alias: string, query: SelectAst): DerivedTableSource {
    return new DerivedTableSource(alias, query);
  }

  // Intentionally does not call rewriter.tableSource — derived tables are rewritten
  // via their inner query, not intercepted at the FromSource level. A future
  // fromSource?(source: AnyFromSource) callback would be needed for that.
  override rewrite(rewriter: AstRewriter): AnyFromSource {
    return new DerivedTableSource(this.alias, this.query.rewrite(rewriter));
  }

  override collectRefs(): PlanRefs {
    return this.query.collectRefs();
  }

  override toFromSource(): AnyFromSource {
    return this;
  }
}

export class ColumnRef extends Expression {
  readonly kind = 'column-ref' as const;
  readonly table: string;
  readonly column: string;

  constructor(table: string, column: string) {
    super();
    this.table = table;
    this.column = column;
    this.freeze();
  }

  static of(table: string, column: string): ColumnRef {
    return new ColumnRef(table, column);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return rewriter.columnRef ? rewriter.columnRef(this) : this;
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.columnRef ? folder.columnRef(this) : folder.empty;
  }

  override baseColumnRef(): ColumnRef {
    return this;
  }

  override toExpr(): AnyExpression {
    return this;
  }
}

export class ParamRef extends AstNode {
  readonly kind = 'param-ref' as const;
  readonly value: unknown;
  readonly name: string | undefined;
  readonly codecId: string;

  constructor(
    value: unknown,
    options: {
      name?: string;
      codecId: string;
    },
  ) {
    super();
    this.value = value;
    this.name = options.name;
    this.codecId = options.codecId;
    this.freeze();
  }

  static of(
    value: unknown,
    options: {
      name?: string;
      codecId: string;
    },
  ): ParamRef {
    return new ParamRef(value, options);
  }
}

export class DefaultValueExpr extends AstNode {
  readonly kind = 'default-value' as const;

  constructor() {
    super();
    this.freeze();
  }
}

export class LiteralExpr extends AstNode {
  readonly kind = 'literal' as const;
  readonly value: unknown;

  constructor(value: unknown) {
    super();
    this.value = value;
    this.freeze();
  }

  static of(value: unknown): LiteralExpr {
    return new LiteralExpr(value);
  }
}

export class SubqueryExpr extends Expression {
  readonly kind = 'subquery' as const;
  readonly query: SelectAst;

  constructor(query: SelectAst) {
    super();
    this.query = query;
    this.freeze();
  }

  static of(query: SelectAst): SubqueryExpr {
    return new SubqueryExpr(query);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    const query = this.query.rewrite(rewriter);
    return new SubqueryExpr(query);
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.select ? folder.select(this.query) : folder.empty;
  }

  override toExpr(): AnyExpression {
    return this;
  }
}

export class OperationExpr extends Expression {
  readonly kind = 'operation' as const;
  readonly method: string;
  readonly forTypeId: string;
  readonly self: AnyExpression;
  readonly args: ReadonlyArray<AnyOperationArg>;
  readonly returns: ReturnSpec;
  readonly lowering: SqlLoweringSpec;

  constructor(options: {
    readonly method: string;
    readonly forTypeId: string;
    readonly self: AnyExpression;
    readonly args: ReadonlyArray<AnyOperationArg> | undefined;
    readonly returns: ReturnSpec;
    readonly lowering: SqlLoweringSpec;
  }) {
    super();
    this.method = options.method;
    this.forTypeId = options.forTypeId;
    this.self = options.self;
    this.args = frozenArrayCopy(options.args ?? []);
    this.returns = options.returns;
    this.lowering = options.lowering;
    this.freeze();
  }

  static function(options: {
    readonly method: string;
    readonly forTypeId: string;
    readonly self: AnyExpression;
    readonly args: ReadonlyArray<AnyOperationArg> | undefined;
    readonly returns: ReturnSpec;
    readonly template: string;
  }): OperationExpr {
    return new OperationExpr({
      method: options.method,
      forTypeId: options.forTypeId,
      self: options.self,
      args: options.args,
      returns: options.returns,
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template: options.template,
      },
    });
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new OperationExpr({
      method: this.method,
      forTypeId: this.forTypeId,
      self: this.self.rewrite(rewriter),
      args: this.args.map((arg) =>
        rewriteComparable(arg, rewriter),
      ) as ReadonlyArray<AnyOperationArg>,
      returns: this.returns,
      lowering: this.lowering,
    });
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(folder, [
      () => this.self.fold(folder),
      ...this.args.map((arg) => () => foldComparable(arg, folder)),
    ]);
  }

  override baseColumnRef(): ColumnRef {
    return this.self.baseColumnRef();
  }

  override toExpr(): AnyExpression {
    return this;
  }
}

export class AggregateExpr extends Expression {
  readonly kind = 'aggregate' as const;
  readonly fn: AggregateFn;
  readonly expr: AnyExpression | undefined;

  constructor(fn: AggregateFn, expr?: AnyExpression) {
    super();
    if (fn !== 'count' && expr === undefined) {
      throw new Error(`Aggregate function "${fn}" requires an expression`);
    }
    this.fn = fn;
    this.expr = expr;
    this.freeze();
  }

  static count(expr?: AnyExpression): AggregateExpr {
    return new AggregateExpr('count', expr);
  }

  static sum(expr: AnyExpression): AggregateExpr {
    return new AggregateExpr('sum', expr);
  }

  static avg(expr: AnyExpression): AggregateExpr {
    return new AggregateExpr('avg', expr);
  }

  static min(expr: AnyExpression): AggregateExpr {
    return new AggregateExpr('min', expr);
  }

  static max(expr: AnyExpression): AggregateExpr {
    return new AggregateExpr('max', expr);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return this.expr === undefined ? this : new AggregateExpr(this.fn, this.expr.rewrite(rewriter));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return this.expr ? this.expr.fold(folder) : folder.empty;
  }

  override toExpr(): AnyExpression {
    return this;
  }
}

export class JsonObjectExpr extends Expression {
  readonly kind = 'json-object' as const;
  readonly entries: ReadonlyArray<JsonObjectEntry>;

  constructor(entries: ReadonlyArray<JsonObjectEntry>) {
    super();
    this.entries = frozenArrayCopy(entries.map((entry) => Object.freeze({ ...entry })));
    this.freeze();
  }

  override toExpr(): AnyExpression {
    return this;
  }

  static entry(key: string, value: ProjectionExpr): JsonObjectEntry {
    return {
      key,
      value,
    };
  }

  static fromEntries(entries: ReadonlyArray<JsonObjectEntry>): JsonObjectExpr {
    return new JsonObjectExpr(entries);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new JsonObjectExpr(
      this.entries.map((entry) => ({
        key: entry.key,
        value:
          entry.value.kind === 'literal'
            ? rewriter.literal
              ? rewriter.literal(entry.value)
              : entry.value
            : entry.value.rewrite(rewriter),
      })),
    );
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(
      folder,
      this.entries.map(
        (entry) => () =>
          entry.value.kind === 'literal'
            ? folder.literal
              ? folder.literal(entry.value)
              : folder.empty
            : entry.value.fold(folder),
      ),
    );
  }
}

export class OrderByItem extends AstNode {
  readonly kind = 'order-by-item' as const;
  readonly expr: AnyExpression;
  readonly dir: Direction;

  constructor(expr: AnyExpression, dir: Direction) {
    super();
    this.expr = expr;
    this.dir = dir;
    this.freeze();
  }

  static asc(expr: AnyExpression): OrderByItem {
    return new OrderByItem(expr, 'asc');
  }

  static desc(expr: AnyExpression): OrderByItem {
    return new OrderByItem(expr, 'desc');
  }

  rewrite(rewriter: ExpressionRewriter): OrderByItem {
    return new OrderByItem(this.expr.rewrite(rewriter), this.dir);
  }
}

export class JsonArrayAggExpr extends Expression {
  readonly kind = 'json-array-agg' as const;
  readonly expr: AnyExpression;
  readonly onEmpty: 'null' | 'emptyArray';
  readonly orderBy: ReadonlyArray<OrderByItem> | undefined;

  constructor(
    expr: AnyExpression,
    onEmpty: 'null' | 'emptyArray' = 'null',
    orderBy?: ReadonlyArray<OrderByItem>,
  ) {
    super();
    this.expr = expr;
    this.onEmpty = onEmpty;
    this.orderBy = orderBy && orderBy.length > 0 ? frozenArrayCopy(orderBy) : undefined;
    this.freeze();
  }

  static of(
    expr: AnyExpression,
    onEmpty: 'null' | 'emptyArray' = 'null',
    orderBy?: ReadonlyArray<OrderByItem>,
  ): JsonArrayAggExpr {
    return new JsonArrayAggExpr(expr, onEmpty, orderBy);
  }

  override toExpr(): AnyExpression {
    return this;
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new JsonArrayAggExpr(
      this.expr.rewrite(rewriter),
      this.onEmpty,
      this.orderBy?.map((orderItem) => orderItem.rewrite(rewriter)),
    );
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(folder, [
      () => this.expr.fold(folder),
      ...(this.orderBy ?? []).map((orderItem) => () => orderItem.expr.fold(folder)),
    ]);
  }
}

export class ListLiteralExpr extends AstNode {
  readonly kind = 'list-literal' as const;
  readonly values: ReadonlyArray<ParamRef | LiteralExpr>;

  constructor(values: ReadonlyArray<ParamRef | LiteralExpr>) {
    super();
    this.values = frozenArrayCopy(values);
    this.freeze();
  }

  static of(values: ReadonlyArray<ParamRef | LiteralExpr>): ListLiteralExpr {
    return new ListLiteralExpr(values);
  }

  static fromValues(values: ReadonlyArray<unknown>): ListLiteralExpr {
    return new ListLiteralExpr(values.map((value) => new LiteralExpr(value)));
  }

  rewrite(rewriter: ExpressionRewriter): ListLiteralExpr | LiteralExpr {
    if (rewriter.listLiteral) {
      return rewriter.listLiteral(this);
    }

    return new ListLiteralExpr(
      this.values.map((value) => {
        if (value.kind === 'param-ref') {
          return rewriter.paramRef ? rewriter.paramRef(value) : value;
        }
        return rewriter.literal ? rewriter.literal(value) : value;
      }) as ReadonlyArray<ParamRef | LiteralExpr>,
    );
  }

  fold<T>(folder: ExpressionFolder<T>): T {
    if (folder.listLiteral) {
      return folder.listLiteral(this);
    }
    return combineAll(
      folder,
      this.values.map(
        (value) => () =>
          value.kind === 'param-ref'
            ? folder.paramRef
              ? folder.paramRef(value)
              : folder.empty
            : folder.literal
              ? folder.literal(value)
              : folder.empty,
      ),
    );
  }
}

export class BinaryExpr extends WhereExpr {
  readonly kind = 'binary' as const;
  readonly op: BinaryOp;
  readonly left: AnyExpression;
  readonly right: AnySqlComparable;

  constructor(op: BinaryOp, left: AnyExpression, right: AnySqlComparable) {
    super();
    this.op = op;
    this.left = left;
    this.right = right;
    this.freeze();
  }

  static eq(left: AnyExpression, right: AnySqlComparable): BinaryExpr {
    return new BinaryExpr('eq', left, right);
  }

  static neq(left: AnyExpression, right: AnySqlComparable): BinaryExpr {
    return new BinaryExpr('neq', left, right);
  }

  static gt(left: AnyExpression, right: AnySqlComparable): BinaryExpr {
    return new BinaryExpr('gt', left, right);
  }

  static lt(left: AnyExpression, right: AnySqlComparable): BinaryExpr {
    return new BinaryExpr('lt', left, right);
  }

  static gte(left: AnyExpression, right: AnySqlComparable): BinaryExpr {
    return new BinaryExpr('gte', left, right);
  }

  static lte(left: AnyExpression, right: AnySqlComparable): BinaryExpr {
    return new BinaryExpr('lte', left, right);
  }

  static like(left: AnyExpression, right: AnySqlComparable): BinaryExpr {
    return new BinaryExpr('like', left, right);
  }

  static ilike(left: AnyExpression, right: AnySqlComparable): BinaryExpr {
    return new BinaryExpr('ilike', left, right);
  }

  static in(left: AnyExpression, right: AnySqlComparable): BinaryExpr {
    return new BinaryExpr('in', left, right);
  }

  static notIn(left: AnyExpression, right: AnySqlComparable): BinaryExpr {
    return new BinaryExpr('notIn', left, right);
  }

  override accept<R>(visitor: WhereExprVisitor<R>): R {
    return visitor.binary(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyWhereExpr {
    return new BinaryExpr(
      this.op,
      this.left.rewrite(rewriter),
      rewriteComparable(this.right, rewriter),
    );
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(folder, [
      () => this.left.fold(folder),
      () => foldComparable(this.right, folder),
    ]);
  }

  override not(): AnyWhereExpr {
    return new BinaryExpr(negateBinaryOp(this.op), this.left, this.right);
  }

  override toUnboundWhereExpr(): AnyWhereExpr {
    return this;
  }
}

function negateBinaryOp(op: BinaryOp): BinaryOp {
  switch (op) {
    case 'eq':
      return 'neq';
    case 'neq':
      return 'eq';
    case 'gt':
      return 'lte';
    case 'lt':
      return 'gte';
    case 'gte':
      return 'lt';
    case 'lte':
      return 'gt';
    case 'in':
      return 'notIn';
    case 'notIn':
      return 'in';
    case 'like':
    case 'ilike':
      throw new Error(`Operator "${op}" is not negatable without explicit NOT support in the AST`);
    default: {
      const exhaustiveCheck: never = op;
      throw new Error(`Unknown binary operator: ${String(exhaustiveCheck)}`);
    }
  }
}

export class AndExpr extends WhereExpr {
  readonly kind = 'and' as const;
  readonly exprs: ReadonlyArray<AnyWhereExpr>;

  constructor(exprs: ReadonlyArray<AnyWhereExpr>) {
    super();
    this.exprs = frozenArrayCopy(exprs);
    this.freeze();
  }

  static of(exprs: ReadonlyArray<AnyWhereExpr>): AndExpr {
    return new AndExpr(exprs);
  }

  static true(): AndExpr {
    return new AndExpr([]);
  }

  override accept<R>(visitor: WhereExprVisitor<R>): R {
    return visitor.and(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyWhereExpr {
    return new AndExpr(this.exprs.map((expr) => expr.rewrite(rewriter)));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(
      folder,
      this.exprs.map((expr) => () => expr.fold(folder)),
    );
  }

  override not(): AnyWhereExpr {
    return new OrExpr(this.exprs.map((expr) => expr.not()));
  }

  override toUnboundWhereExpr(): AnyWhereExpr {
    return this;
  }
}

export class OrExpr extends WhereExpr {
  readonly kind = 'or' as const;
  readonly exprs: ReadonlyArray<AnyWhereExpr>;

  constructor(exprs: ReadonlyArray<AnyWhereExpr>) {
    super();
    this.exprs = frozenArrayCopy(exprs);
    this.freeze();
  }

  static of(exprs: ReadonlyArray<AnyWhereExpr>): OrExpr {
    return new OrExpr(exprs);
  }

  static false(): OrExpr {
    return new OrExpr([]);
  }

  override accept<R>(visitor: WhereExprVisitor<R>): R {
    return visitor.or(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyWhereExpr {
    return new OrExpr(this.exprs.map((expr) => expr.rewrite(rewriter)));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(
      folder,
      this.exprs.map((expr) => () => expr.fold(folder)),
    );
  }

  override not(): AnyWhereExpr {
    return new AndExpr(this.exprs.map((expr) => expr.not()));
  }

  override toUnboundWhereExpr(): AnyWhereExpr {
    return this;
  }
}

export class ExistsExpr extends WhereExpr {
  readonly kind = 'exists' as const;
  readonly notExists: boolean;
  readonly subquery: SelectAst;

  constructor(subquery: SelectAst, notExists = false) {
    super();
    this.notExists = notExists;
    this.subquery = subquery;
    this.freeze();
  }

  static exists(subquery: SelectAst): ExistsExpr {
    return new ExistsExpr(subquery, false);
  }

  static notExists(subquery: SelectAst): ExistsExpr {
    return new ExistsExpr(subquery, true);
  }

  override accept<R>(visitor: WhereExprVisitor<R>): R {
    return visitor.exists(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyWhereExpr {
    return new ExistsExpr(this.subquery.rewrite(rewriter), this.notExists);
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.select ? folder.select(this.subquery) : folder.empty;
  }

  override not(): AnyWhereExpr {
    return new ExistsExpr(this.subquery, !this.notExists);
  }

  override toUnboundWhereExpr(): AnyWhereExpr {
    return this;
  }
}

export class NullCheckExpr extends WhereExpr {
  readonly kind = 'null-check' as const;
  readonly expr: AnyExpression;
  readonly isNull: boolean;

  constructor(expr: AnyExpression, isNull: boolean) {
    super();
    this.expr = expr;
    this.isNull = isNull;
    this.freeze();
  }

  static isNull(expr: AnyExpression): NullCheckExpr {
    return new NullCheckExpr(expr, true);
  }

  static isNotNull(expr: AnyExpression): NullCheckExpr {
    return new NullCheckExpr(expr, false);
  }

  override accept<R>(visitor: WhereExprVisitor<R>): R {
    return visitor.nullCheck(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyWhereExpr {
    return new NullCheckExpr(this.expr.rewrite(rewriter), this.isNull);
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return this.expr.fold(folder);
  }

  override not(): AnyWhereExpr {
    return new NullCheckExpr(this.expr, !this.isNull);
  }

  override toUnboundWhereExpr(): AnyWhereExpr {
    return this;
  }
}

export class EqColJoinOn extends AstNode {
  readonly kind = 'eq-col-join-on' as const;
  readonly left: ColumnRef;
  readonly right: ColumnRef;

  constructor(left: ColumnRef, right: ColumnRef) {
    super();
    this.left = left;
    this.right = right;
    this.freeze();
  }

  static of(left: ColumnRef, right: ColumnRef): EqColJoinOn {
    return new EqColJoinOn(left, right);
  }

  rewrite(rewriter: AstRewriter): EqColJoinOn | AnyWhereExpr {
    return rewriter.eqColJoinOn ? rewriter.eqColJoinOn(this) : this;
  }
}

export class JoinAst extends AstNode {
  readonly kind = 'join' as const;
  readonly joinType: 'inner' | 'left' | 'right' | 'full';
  readonly source: AnyFromSource;
  readonly lateral: boolean;
  readonly on: JoinOnExpr;

  constructor(
    joinType: 'inner' | 'left' | 'right' | 'full',
    source: AnyFromSource,
    on: JoinOnExpr,
    lateral = false,
  ) {
    super();
    this.joinType = joinType;
    this.source = source;
    this.lateral = lateral;
    this.on = on;
    this.freeze();
  }

  static inner(source: AnyFromSource, on: JoinOnExpr, lateral = false): JoinAst {
    return new JoinAst('inner', source, on, lateral);
  }

  static left(source: AnyFromSource, on: JoinOnExpr, lateral = false): JoinAst {
    return new JoinAst('left', source, on, lateral);
  }

  static right(source: AnyFromSource, on: JoinOnExpr, lateral = false): JoinAst {
    return new JoinAst('right', source, on, lateral);
  }

  static full(source: AnyFromSource, on: JoinOnExpr, lateral = false): JoinAst {
    return new JoinAst('full', source, on, lateral);
  }

  rewrite(rewriter: AstRewriter): JoinAst {
    return new JoinAst(
      this.joinType,
      this.source.rewrite(rewriter),
      this.on.rewrite(rewriter),
      this.lateral,
    );
  }
}

export class ProjectionItem extends AstNode {
  readonly kind = 'projection-item' as const;
  readonly alias: string;
  readonly expr: ProjectionExpr;

  constructor(alias: string, expr: ProjectionExpr) {
    super();
    this.alias = alias;
    this.expr = expr;
    this.freeze();
  }

  static of(alias: string, expr: ProjectionExpr): ProjectionItem {
    return new ProjectionItem(alias, expr);
  }
}

export interface SelectAstOptions {
  readonly from: AnyFromSource;
  readonly joins: ReadonlyArray<JoinAst> | undefined;
  readonly projection: ReadonlyArray<ProjectionItem>;
  readonly where: AnyWhereExpr | undefined;
  readonly orderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly distinct: true | undefined;
  readonly distinctOn: ReadonlyArray<AnyExpression> | undefined;
  readonly groupBy: ReadonlyArray<AnyExpression> | undefined;
  readonly having: AnyWhereExpr | undefined;
  readonly limit: number | undefined;
  readonly offset: number | undefined;
  readonly selectAllIntent: { readonly table?: string } | undefined;
}

export class SelectAst extends QueryAst {
  readonly kind = 'select' as const;
  readonly from: AnyFromSource;
  readonly joins: ReadonlyArray<JoinAst> | undefined;
  readonly projection: ReadonlyArray<ProjectionItem>;
  readonly where: AnyWhereExpr | undefined;
  readonly orderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly distinct: true | undefined;
  readonly distinctOn: ReadonlyArray<AnyExpression> | undefined;
  readonly groupBy: ReadonlyArray<AnyExpression> | undefined;
  readonly having: AnyWhereExpr | undefined;
  readonly limit: number | undefined;
  readonly offset: number | undefined;
  readonly selectAllIntent: { readonly table?: string } | undefined;

  constructor(options: SelectAstOptions) {
    super();
    this.from = options.from;
    this.joins =
      options.joins && options.joins.length > 0 ? frozenArrayCopy(options.joins) : undefined;
    this.projection = frozenArrayCopy(options.projection);
    this.where = options.where;
    this.orderBy =
      options.orderBy && options.orderBy.length > 0 ? frozenArrayCopy(options.orderBy) : undefined;
    this.distinct = options.distinct;
    this.distinctOn =
      options.distinctOn && options.distinctOn.length > 0
        ? frozenArrayCopy(options.distinctOn)
        : undefined;
    this.groupBy =
      options.groupBy && options.groupBy.length > 0 ? frozenArrayCopy(options.groupBy) : undefined;
    this.having = options.having;
    this.limit = options.limit;
    this.offset = options.offset;
    this.selectAllIntent = frozenOptionalRecordCopy(options.selectAllIntent);
    this.freeze();
  }

  static from(from: AnyFromSource): SelectAst {
    return new SelectAst({
      from,
      joins: undefined,
      projection: [],
      where: undefined,
      orderBy: undefined,
      distinct: undefined,
      distinctOn: undefined,
      groupBy: undefined,
      having: undefined,
      limit: undefined,
      offset: undefined,
      selectAllIntent: undefined,
    });
  }

  withFrom(from: AnyFromSource): SelectAst {
    return new SelectAst({ ...this, from });
  }

  withJoins(joins: ReadonlyArray<JoinAst>): SelectAst {
    return new SelectAst({
      ...this,
      joins: joins.length > 0 ? joins : undefined,
    });
  }

  withProjection(projection: ReadonlyArray<ProjectionItem>): SelectAst {
    return new SelectAst({ ...this, projection });
  }

  addProjection(alias: string, expr: ProjectionExpr): SelectAst {
    return new SelectAst({
      ...this,
      projection: [...this.projection, new ProjectionItem(alias, expr)],
    });
  }

  withWhere(where: AnyWhereExpr | undefined): SelectAst {
    return new SelectAst({ ...this, where });
  }

  withOrderBy(orderBy: ReadonlyArray<OrderByItem>): SelectAst {
    return new SelectAst({
      ...this,
      orderBy: orderBy.length > 0 ? orderBy : undefined,
    });
  }

  withDistinct(enabled = true): SelectAst {
    return new SelectAst({
      ...this,
      distinct: enabled ? true : undefined,
    });
  }

  withDistinctOn(distinctOn: ReadonlyArray<AnyExpression>): SelectAst {
    return new SelectAst({
      ...this,
      distinctOn: distinctOn.length > 0 ? distinctOn : undefined,
    });
  }

  withGroupBy(groupBy: ReadonlyArray<AnyExpression>): SelectAst {
    return new SelectAst({
      ...this,
      groupBy: groupBy.length > 0 ? groupBy : undefined,
    });
  }

  withHaving(having: AnyWhereExpr | undefined): SelectAst {
    return new SelectAst({ ...this, having });
  }

  withLimit(limit: number | undefined): SelectAst {
    return new SelectAst({ ...this, limit });
  }

  withOffset(offset: number | undefined): SelectAst {
    return new SelectAst({ ...this, offset });
  }

  withSelectAllIntent(selectAllIntent: { readonly table?: string } | undefined): SelectAst {
    return new SelectAst({ ...this, selectAllIntent });
  }

  rewrite(rewriter: AstRewriter): SelectAst {
    const rewritten = new SelectAst({
      from: this.from.rewrite(rewriter),
      joins: this.joins?.map((join) => join.rewrite(rewriter)),
      projection: this.projection.map(
        (projection) =>
          new ProjectionItem(
            projection.alias,
            projection.expr.kind === 'literal'
              ? rewriter.literal
                ? rewriter.literal(projection.expr)
                : projection.expr
              : projection.expr.rewrite(rewriter),
          ),
      ),
      where: this.where?.rewrite(rewriter),
      orderBy: this.orderBy?.map((orderItem) => orderItem.rewrite(rewriter)),
      distinct: this.distinct,
      distinctOn: this.distinctOn?.map((expr) => expr.rewrite(rewriter)),
      groupBy: this.groupBy?.map((expr) => expr.rewrite(rewriter)),
      having: this.having?.rewrite(rewriter),
      limit: this.limit,
      offset: this.offset,
      selectAllIntent: this.selectAllIntent,
    });

    return rewriter.select ? rewriter.select(rewritten) : rewritten;
  }

  override collectColumnRefs(): ColumnRef[] {
    const refs: ColumnRef[] = [];
    const pushRefs = (columns: ReadonlyArray<ColumnRef>) => {
      refs.push(...columns);
    };

    if (this.from.kind === 'derived-table-source') {
      pushRefs(this.from.query.collectColumnRefs());
    }

    for (const projection of this.projection) {
      if (projection.expr.kind !== 'literal') {
        pushRefs(projection.expr.collectColumnRefs());
      }
    }

    if (this.where) {
      pushRefs(this.where.collectColumnRefs());
    }
    if (this.having) {
      pushRefs(this.having.collectColumnRefs());
    }
    for (const orderItem of this.orderBy ?? []) {
      pushRefs(orderItem.expr.collectColumnRefs());
    }
    for (const expr of this.distinctOn ?? []) {
      pushRefs(expr.collectColumnRefs());
    }
    for (const expr of this.groupBy ?? []) {
      pushRefs(expr.collectColumnRefs());
    }
    for (const join of this.joins ?? []) {
      if (join.source.kind === 'derived-table-source') {
        pushRefs(join.source.query.collectColumnRefs());
      }
      if (join.on.kind === 'eq-col-join-on') {
        refs.push(join.on.left, join.on.right);
      } else {
        pushRefs(join.on.collectColumnRefs());
      }
    }

    return refs;
  }

  collectParamRefs(): ParamRef[] {
    const refs: ParamRef[] = [];
    const pushRefs = (params: ReadonlyArray<ParamRef>) => {
      refs.push(...params);
    };

    if (this.from.kind === 'derived-table-source') {
      pushRefs(this.from.query.collectParamRefs());
    }

    for (const projection of this.projection) {
      if (projection.expr.kind !== 'literal') {
        pushRefs(projection.expr.collectParamRefs());
      }
    }

    if (this.where) {
      pushRefs(this.where.collectParamRefs());
    }
    if (this.having) {
      pushRefs(this.having.collectParamRefs());
    }
    for (const orderItem of this.orderBy ?? []) {
      pushRefs(orderItem.expr.collectParamRefs());
    }
    for (const expr of this.distinctOn ?? []) {
      pushRefs(expr.collectParamRefs());
    }
    for (const expr of this.groupBy ?? []) {
      pushRefs(expr.collectParamRefs());
    }
    for (const join of this.joins ?? []) {
      if (join.source.kind === 'derived-table-source') {
        pushRefs(join.source.query.collectParamRefs());
      }
      if (join.on.kind !== 'eq-col-join-on') {
        pushRefs(join.on.collectParamRefs());
      }
    }

    return refs;
  }

  override collectRefs(): PlanRefs {
    const tables = new Set<string>();
    const columns = new Map<string, { table: string; column: string }>();

    const addSource = (source: AnyFromSource) => {
      mergeRefsInto(source.collectRefs(), tables, columns);
    };

    addSource(this.from);

    for (const join of this.joins ?? []) {
      addSource(join.source);
      if (join.on.kind === 'eq-col-join-on') {
        addColumnRefToRefSets(join.on.left, tables, columns);
        addColumnRefToRefSets(join.on.right, tables, columns);
      } else {
        for (const columnRef of join.on.collectColumnRefs()) {
          addColumnRefToRefSets(columnRef, tables, columns);
        }
      }
    }

    for (const columnRef of this.collectColumnRefs()) {
      addColumnRefToRefSets(columnRef, tables, columns);
    }

    return sortRefs(tables, columns);
  }

  override toQueryAst(): AnyQueryAst {
    return this;
  }
}

abstract class InsertOnConflictAction extends AstNode {
  abstract toInsertOnConflictAction(): AnyInsertOnConflictAction;
}

export class DoNothingConflictAction extends InsertOnConflictAction {
  readonly kind = 'do-nothing' as const;

  constructor() {
    super();
    this.freeze();
  }

  override toInsertOnConflictAction(): AnyInsertOnConflictAction {
    return this;
  }
}

export class DoUpdateSetConflictAction extends InsertOnConflictAction {
  readonly kind = 'do-update-set' as const;
  readonly set: Readonly<Record<string, ColumnRef | ParamRef>>;

  constructor(set: Readonly<Record<string, ColumnRef | ParamRef>>) {
    super();
    this.set = frozenRecordCopy(set);
    this.freeze();
  }

  override toInsertOnConflictAction(): AnyInsertOnConflictAction {
    return this;
  }
}

export class InsertOnConflict extends AstNode {
  readonly kind = 'insert-on-conflict' as const;
  readonly columns: ReadonlyArray<ColumnRef>;
  readonly action: AnyInsertOnConflictAction;

  constructor(columns: ReadonlyArray<ColumnRef>, action: AnyInsertOnConflictAction) {
    super();
    this.columns = frozenArrayCopy(columns);
    this.action = action;
    this.freeze();
  }

  static on(columns: ReadonlyArray<ColumnRef>): InsertOnConflict {
    return new InsertOnConflict(columns, new DoNothingConflictAction());
  }

  doNothing(): InsertOnConflict {
    return new InsertOnConflict(this.columns, new DoNothingConflictAction());
  }

  doUpdateSet(set: Readonly<Record<string, ColumnRef | ParamRef>>): InsertOnConflict {
    return new InsertOnConflict(this.columns, new DoUpdateSetConflictAction(set));
  }
}

export class InsertAst extends QueryAst {
  readonly kind = 'insert' as const;
  readonly table: TableSource;
  readonly rows: ReadonlyArray<Readonly<Record<string, InsertValue>>>;
  readonly onConflict: InsertOnConflict | undefined;
  readonly returning: ReadonlyArray<ColumnRef> | undefined;

  constructor(
    table: TableSource,
    rows: ReadonlyArray<Record<string, InsertValue>> = [{}],
    onConflict?: InsertOnConflict,
    returning?: ReadonlyArray<ColumnRef>,
  ) {
    super();
    this.table = table;
    this.rows = freezeRows(rows);
    this.onConflict = onConflict;
    this.returning = returning && returning.length > 0 ? frozenArrayCopy(returning) : undefined;
    this.freeze();
  }

  static into(table: TableSource): InsertAst {
    return new InsertAst(table);
  }

  withValues(values: Record<string, InsertValue>): InsertAst {
    return new InsertAst(this.table, [{ ...values }], this.onConflict, this.returning);
  }

  withRows(rows: ReadonlyArray<Record<string, InsertValue>>): InsertAst {
    return new InsertAst(
      this.table,
      rows.map((row) => ({ ...row })),
      this.onConflict,
      this.returning,
    );
  }

  withReturning(returning: ReadonlyArray<ColumnRef> | undefined): InsertAst {
    return new InsertAst(
      this.table,
      this.rows.map((row) => ({ ...row })),
      this.onConflict,
      returning,
    );
  }

  withOnConflict(onConflict: InsertOnConflict | undefined): InsertAst {
    return new InsertAst(
      this.table,
      this.rows.map((row) => ({ ...row })),
      onConflict,
      this.returning,
    );
  }

  override collectParamRefs(): ParamRef[] {
    const refs: ParamRef[] = [];
    for (const row of this.rows) {
      for (const value of Object.values(row)) {
        if (value instanceof ParamRef) refs.push(value);
      }
    }
    if (this.onConflict?.action instanceof DoUpdateSetConflictAction) {
      for (const value of Object.values(this.onConflict.action.set)) {
        if (value instanceof ParamRef) refs.push(value);
      }
    }
    return refs;
  }

  override collectRefs(): PlanRefs {
    const tables = new Set<string>([this.table.name]);
    const columns = new Map<string, { table: string; column: string }>();

    const addColumn = (columnRef: ColumnRef) => addColumnRefToRefSets(columnRef, tables, columns);
    const addValue = (value: InsertValue) => {
      if (value.kind === 'column-ref') {
        addColumn(value);
      }
    };

    for (const row of this.rows) {
      for (const value of Object.values(row)) {
        addValue(value);
      }
    }

    for (const columnRef of this.returning ?? []) {
      addColumn(columnRef);
    }

    if (this.onConflict) {
      for (const columnRef of this.onConflict.columns) {
        addColumn(columnRef);
      }
      if (this.onConflict.action.kind === 'do-update-set') {
        const action = this.onConflict.action as DoUpdateSetConflictAction;
        for (const value of Object.values(action.set)) {
          if (value.kind === 'column-ref') {
            addColumn(value);
          }
        }
      }
    }

    return sortRefs(tables, columns);
  }

  override toQueryAst(): AnyQueryAst {
    return this;
  }
}

export class UpdateAst extends QueryAst {
  readonly kind = 'update' as const;
  readonly table: TableSource;
  readonly set: Readonly<Record<string, ColumnRef | ParamRef>>;
  readonly where: AnyWhereExpr | undefined;
  readonly returning: ReadonlyArray<ColumnRef> | undefined;

  constructor(
    table: TableSource,
    set: Readonly<Record<string, ColumnRef | ParamRef>> = {},
    where?: AnyWhereExpr,
    returning?: ReadonlyArray<ColumnRef>,
  ) {
    super();
    this.table = table;
    this.set = frozenRecordCopy(set);
    this.where = where;
    this.returning = returning && returning.length > 0 ? frozenArrayCopy(returning) : undefined;
    this.freeze();
  }

  static table(table: TableSource): UpdateAst {
    return new UpdateAst(table);
  }

  withSet(set: Readonly<Record<string, ColumnRef | ParamRef>>): UpdateAst {
    return new UpdateAst(this.table, set, this.where, this.returning);
  }

  withWhere(where: AnyWhereExpr | undefined): UpdateAst {
    return new UpdateAst(this.table, this.set, where, this.returning);
  }

  withReturning(returning: ReadonlyArray<ColumnRef> | undefined): UpdateAst {
    return new UpdateAst(this.table, this.set, this.where, returning);
  }

  override collectParamRefs(): ParamRef[] {
    const refs: ParamRef[] = [];
    for (const value of Object.values(this.set)) {
      if (value instanceof ParamRef) refs.push(value);
    }
    if (this.where) {
      refs.push(...this.where.collectParamRefs());
    }
    return refs;
  }

  override collectRefs(): PlanRefs {
    const tables = new Set<string>([this.table.name]);
    const columns = new Map<string, { table: string; column: string }>();

    for (const value of Object.values(this.set)) {
      if (value.kind === 'column-ref') {
        addColumnRefToRefSets(value, tables, columns);
      }
    }

    for (const columnRef of this.where?.collectColumnRefs() ?? []) {
      addColumnRefToRefSets(columnRef, tables, columns);
    }

    for (const columnRef of this.returning ?? []) {
      addColumnRefToRefSets(columnRef, tables, columns);
    }

    return sortRefs(tables, columns);
  }

  override toQueryAst(): AnyQueryAst {
    return this;
  }
}

export class DeleteAst extends QueryAst {
  readonly kind = 'delete' as const;
  readonly table: TableSource;
  readonly where: AnyWhereExpr | undefined;
  readonly returning: ReadonlyArray<ColumnRef> | undefined;

  constructor(table: TableSource, where?: AnyWhereExpr, returning?: ReadonlyArray<ColumnRef>) {
    super();
    this.table = table;
    this.where = where;
    this.returning = returning && returning.length > 0 ? frozenArrayCopy(returning) : undefined;
    this.freeze();
  }

  static from(table: TableSource): DeleteAst {
    return new DeleteAst(table);
  }

  withWhere(where: AnyWhereExpr | undefined): DeleteAst {
    return new DeleteAst(this.table, where, this.returning);
  }

  withReturning(returning: ReadonlyArray<ColumnRef> | undefined): DeleteAst {
    return new DeleteAst(this.table, this.where, returning);
  }

  override collectParamRefs(): ParamRef[] {
    return this.where ? this.where.collectParamRefs() : [];
  }

  override collectRefs(): PlanRefs {
    const tables = new Set<string>([this.table.name]);
    const columns = new Map<string, { table: string; column: string }>();

    for (const columnRef of this.where?.collectColumnRefs() ?? []) {
      addColumnRefToRefSets(columnRef, tables, columns);
    }

    for (const columnRef of this.returning ?? []) {
      addColumnRefToRefSets(columnRef, tables, columns);
    }

    return sortRefs(tables, columns);
  }

  override toQueryAst(): AnyQueryAst {
    return this;
  }
}

export type AnyQueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst;
export type AnyFromSource = TableSource | DerivedTableSource;
export type AnyExpression =
  | ColumnRef
  | SubqueryExpr
  | OperationExpr
  | AggregateExpr
  | JsonObjectExpr
  | JsonArrayAggExpr;
export type AnyWhereExpr = BinaryExpr | AndExpr | OrExpr | ExistsExpr | NullCheckExpr;
export type AnyInsertOnConflictAction = DoNothingConflictAction | DoUpdateSetConflictAction;
export type AnySqlComparable = AnyExpression | ParamRef | LiteralExpr | ListLiteralExpr;
export type AnyInsertValue = ColumnRef | ParamRef | DefaultValueExpr;
export type AnyOperationArg = AnyExpression | ParamRef | LiteralExpr;

export const queryAstKinds: ReadonlySet<string> = new Set<AnyQueryAst['kind']>([
  'select',
  'insert',
  'update',
  'delete',
]);
export const whereExprKinds: ReadonlySet<string> = new Set<AnyWhereExpr['kind']>([
  'binary',
  'and',
  'or',
  'exists',
  'null-check',
]);

export function isQueryAst(value: unknown): value is AnyQueryAst {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    queryAstKinds.has((value as { kind: string }).kind)
  );
}

export function isWhereExpr(value: unknown): value is AnyWhereExpr {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    whereExprKinds.has((value as { kind: string }).kind)
  );
}

export interface BoundWhereExpr {
  readonly expr: AnyWhereExpr;
}

export interface ToWhereExpr {
  toWhereExpr(): BoundWhereExpr;
}

export interface LoweredStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly annotations?: Record<string, unknown>;
}
