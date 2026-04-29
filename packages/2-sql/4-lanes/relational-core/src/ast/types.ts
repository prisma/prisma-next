import type { ParamSpec } from '@prisma-next/operations';
import type { SqlLoweringSpec } from '@prisma-next/sql-operations';

export type Direction = 'asc' | 'desc';

export type BinaryOp = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'like' | 'in' | 'notIn';

export type AggregateCountFn = 'count';
export type AggregateOpFn = 'sum' | 'avg' | 'min' | 'max';
export type AggregateFn = AggregateCountFn | AggregateOpFn;

export interface ExpressionSource {
  toExpr(): AnyExpression;
}

export interface ExpressionRewriter {
  columnRef?(expr: ColumnRef): AnyExpression;
  identifierRef?(expr: IdentifierRef): AnyExpression;
  paramRef?(expr: ParamRef): ParamRef | LiteralExpr;
  literal?(expr: LiteralExpr): LiteralExpr;
  list?(expr: ListExpression): ListExpression | LiteralExpr;
  select?(ast: SelectAst): SelectAst;
}

export interface AstRewriter extends ExpressionRewriter {
  tableSource?(source: TableSource): TableSource;
  eqColJoinOn?(on: EqColJoinOn): EqColJoinOn | AnyExpression;
}

export interface ExprVisitor<R> {
  columnRef(expr: ColumnRef): R;
  identifierRef(expr: IdentifierRef): R;
  subquery(expr: SubqueryExpr): R;
  operation(expr: OperationExpr): R;
  aggregate(expr: AggregateExpr): R;
  jsonObject(expr: JsonObjectExpr): R;
  jsonArrayAgg(expr: JsonArrayAggExpr): R;
  binary(expr: BinaryExpr): R;
  and(expr: AndExpr): R;
  or(expr: OrExpr): R;
  exists(expr: ExistsExpr): R;
  nullCheck(expr: NullCheckExpr): R;
  not(expr: NotExpr): R;
  literal(expr: LiteralExpr): R;
  param(expr: ParamRef): R;
  list(expr: ListExpression): R;
}

export interface ExpressionFolder<T> {
  empty: T;
  combine(a: T, b: T): T;
  isAbsorbing?(value: T): boolean;
  columnRef?(expr: ColumnRef): T;
  identifierRef?(expr: IdentifierRef): T;
  paramRef?(expr: ParamRef): T;
  literal?(expr: LiteralExpr): T;
  list?(expr: ListExpression): T;
  select?(ast: SelectAst): T;
}

export type ProjectionExpr = AnyExpression;
export type InsertValue = ColumnRef | ParamRef | DefaultValueExpr;
export type JoinOnExpr = EqColJoinOn | AnyExpression;
export type WhereArg = AnyExpression | ToWhereExpr;
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

function rewriteComparable(value: AnyExpression, rewriter: ExpressionRewriter): AnyExpression {
  switch (value.kind) {
    case 'param-ref':
      return rewriter.paramRef ? rewriter.paramRef(value) : value;
    case 'literal':
      return rewriter.literal ? rewriter.literal(value) : value;
    case 'list':
      if (rewriter.list) {
        return rewriter.list(value);
      }
      return value.rewrite(rewriter);
    default:
      return value.rewrite(rewriter);
  }
}

function foldComparable<T>(value: AnyExpression, folder: ExpressionFolder<T>): T {
  switch (value.kind) {
    case 'param-ref':
      return folder.paramRef ? folder.paramRef(value) : folder.empty;
    case 'literal':
      return folder.literal ? folder.literal(value) : folder.empty;
    case 'list':
      return value.fold(folder);
    default:
      return value.fold(folder);
  }
}

function collectColumnRefsWith<TNode extends Expression>(node: TNode): ColumnRef[] {
  return node.fold<ColumnRef[]>({
    empty: [],
    combine: (a, b) => [...a, ...b],
    columnRef: (columnRef) => [columnRef],
    select: (ast) => ast.collectColumnRefs(),
  });
}

function collectParamRefsWith<TNode extends Expression>(node: TNode): ParamRef[] {
  return node.fold<ParamRef[]>({
    empty: [],
    combine: (a, b) => [...a, ...b],
    paramRef: (paramRef) => [paramRef],
    select: (ast) => ast.collectParamRefs(),
  });
}

function rewriteTableSource(table: TableSource, rewriter: AstRewriter): TableSource {
  return rewriter.tableSource ? rewriter.tableSource(table) : table;
}

function rewriteProjectionItem(item: ProjectionItem, rewriter: AstRewriter): ProjectionItem {
  const rewrittenExpr =
    item.expr.kind === 'literal'
      ? rewriter.literal
        ? rewriter.literal(item.expr)
        : item.expr
      : item.expr.rewrite(rewriter);
  return new ProjectionItem(item.alias, rewrittenExpr, item.codecId);
}

function rewriteInsertValue(value: InsertValue, rewriter: AstRewriter): InsertValue {
  switch (value.kind) {
    case 'param-ref':
      return rewriter.paramRef ? rewriteParamRefForInsert(value, rewriter) : value;
    case 'column-ref':
      return rewriter.columnRef ? rewriteColumnRefForInsert(value, rewriter) : value;
    case 'default-value':
      return value;
  }
}

function rewriteParamRefForInsert(value: ParamRef, rewriter: AstRewriter): InsertValue {
  const rewritten = rewriter.paramRef ? rewriter.paramRef(value) : value;
  return rewritten.kind === 'param-ref' ? rewritten : value;
}

function rewriteColumnRefForInsert(value: ColumnRef, rewriter: AstRewriter): InsertValue {
  const rewritten = rewriter.columnRef ? rewriter.columnRef(value) : value;
  return rewritten.kind === 'column-ref' ? rewritten : value;
}

function rewriteInsertRow(
  row: Readonly<Record<string, InsertValue>>,
  rewriter: AstRewriter,
): Record<string, InsertValue> {
  const result: Record<string, InsertValue> = {};
  for (const [key, value] of Object.entries(row)) {
    result[key] = rewriteInsertValue(value, rewriter);
  }
  return result;
}

function rewriteUpdateSetValue(
  value: ColumnRef | ParamRef,
  rewriter: AstRewriter,
): ColumnRef | ParamRef {
  if (value.kind === 'column-ref') {
    const rewritten = rewriter.columnRef ? rewriter.columnRef(value) : value;
    return rewritten.kind === 'column-ref' ? rewritten : value;
  }
  const rewritten = rewriter.paramRef ? rewriter.paramRef(value) : value;
  return rewritten.kind === 'param-ref' ? rewritten : value;
}

function rewriteUpdateSet(
  set: Readonly<Record<string, ColumnRef | ParamRef>>,
  rewriter: AstRewriter,
): Record<string, ColumnRef | ParamRef> {
  const result: Record<string, ColumnRef | ParamRef> = {};
  for (const [key, value] of Object.entries(set)) {
    result[key] = rewriteUpdateSetValue(value, rewriter);
  }
  return result;
}

function rewriteOnConflict(onConflict: InsertOnConflict, rewriter: AstRewriter): InsertOnConflict {
  const columns = onConflict.columns.map((columnRef) => {
    const rewritten = rewriter.columnRef ? rewriter.columnRef(columnRef) : columnRef;
    return rewritten.kind === 'column-ref' ? rewritten : columnRef;
  });

  if (onConflict.action.kind === 'do-nothing') {
    return new InsertOnConflict(columns, new DoNothingConflictAction());
  }

  return new InsertOnConflict(
    columns,
    new DoUpdateSetConflictAction(rewriteUpdateSet(onConflict.action.set, rewriter)),
  );
}

abstract class AstNode {
  abstract readonly kind: string;

  protected freeze(): void {
    Object.freeze(this);
  }
}

abstract class QueryAst extends AstNode {
  abstract collectParamRefs(): ParamRef[];
  abstract toQueryAst(): AnyQueryAst;
}

abstract class FromSource extends AstNode {
  abstract rewrite(rewriter: AstRewriter): AnyFromSource;
  abstract toFromSource(): AnyFromSource;
}

abstract class Expression extends AstNode implements ExpressionSource {
  abstract accept<R>(visitor: ExprVisitor<R>): R;
  abstract rewrite(rewriter: ExpressionRewriter): AnyExpression;
  abstract fold<T>(folder: ExpressionFolder<T>): T;

  collectColumnRefs(): ColumnRef[] {
    return collectColumnRefsWith(this);
  }

  collectParamRefs(): ParamRef[] {
    return collectParamRefsWith(this);
  }

  baseColumnRef(): ColumnRef {
    throw new Error(`${this.constructor.name} does not expose a base column reference`);
  }

  toExpr(): AnyExpression {
    return this as unknown as AnyExpression;
  }

  not(): NotExpr {
    return new NotExpr(this as unknown as AnyExpression);
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

  static named(name: string, alias?: string): TableSource {
    return new TableSource(name, alias);
  }

  override rewrite(rewriter: AstRewriter): AnyFromSource {
    return rewriter.tableSource ? rewriter.tableSource(this) : this;
  }

  override toFromSource(): AnyFromSource {
    return this;
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

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.columnRef(this);
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
}

export class IdentifierRef extends Expression {
  readonly kind = 'identifier-ref' as const;
  readonly name: string;

  constructor(name: string) {
    super();
    this.name = name;
    this.freeze();
  }

  static of(name: string): IdentifierRef {
    return new IdentifierRef(name);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.identifierRef(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return rewriter.identifierRef ? rewriter.identifierRef(this) : this;
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.identifierRef ? folder.identifierRef(this) : folder.empty;
  }
}

export class ParamRef extends Expression {
  readonly kind = 'param-ref' as const;
  readonly value: unknown;
  readonly name: string | undefined;
  readonly codecId: string | undefined;

  constructor(
    value: unknown,
    options?: {
      name?: string;
      codecId?: string;
    },
  ) {
    super();
    this.value = value;
    this.name = options?.name;
    this.codecId = options?.codecId;
    this.freeze();
  }

  static of(
    value: unknown,
    options?: {
      name?: string;
      codecId?: string;
    },
  ): ParamRef {
    return new ParamRef(value, options);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.param(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return rewriter.paramRef ? rewriter.paramRef(this) : this;
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.paramRef ? folder.paramRef(this) : folder.empty;
  }
}

export class DefaultValueExpr extends AstNode {
  readonly kind = 'default-value' as const;

  constructor() {
    super();
    this.freeze();
  }
}

export class LiteralExpr extends Expression {
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

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.literal(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return rewriter.literal ? rewriter.literal(this) : this;
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.literal ? folder.literal(this) : folder.empty;
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

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.subquery(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    const query = this.query.rewrite(rewriter);
    return new SubqueryExpr(query);
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.select ? folder.select(this.query) : folder.empty;
  }
}

export class OperationExpr extends Expression {
  readonly kind = 'operation' as const;
  readonly method: string;
  readonly self: AnyExpression;
  readonly args: ReadonlyArray<AnyExpression | ParamRef | LiteralExpr>;
  readonly returns: ParamSpec;
  readonly lowering: SqlLoweringSpec;

  constructor(options: {
    readonly method: string;
    readonly self: AnyExpression;
    readonly args: ReadonlyArray<AnyExpression | ParamRef | LiteralExpr> | undefined;
    readonly returns: ParamSpec;
    readonly lowering: SqlLoweringSpec;
  }) {
    super();
    this.method = options.method;
    this.self = options.self;
    this.args = frozenArrayCopy(options.args ?? []);
    this.returns = options.returns;
    this.lowering = options.lowering;
    this.freeze();
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.operation(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new OperationExpr({
      method: this.method,
      self: this.self.rewrite(rewriter),
      args: this.args.map((arg) => rewriteComparable(arg, rewriter)) as ReadonlyArray<
        AnyExpression | ParamRef | LiteralExpr
      >,
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

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.aggregate(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return this.expr === undefined ? this : new AggregateExpr(this.fn, this.expr.rewrite(rewriter));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return this.expr ? this.expr.fold(folder) : folder.empty;
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

  static entry(key: string, value: ProjectionExpr): JsonObjectEntry {
    return {
      key,
      value,
    };
  }

  static fromEntries(entries: ReadonlyArray<JsonObjectEntry>): JsonObjectExpr {
    return new JsonObjectExpr(entries);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.jsonObject(this);
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

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.jsonArrayAgg(this);
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

export class ListExpression extends Expression {
  readonly kind = 'list' as const;
  readonly values: ReadonlyArray<AnyExpression>;

  constructor(values: ReadonlyArray<AnyExpression>) {
    super();
    this.values = frozenArrayCopy(values);
    this.freeze();
  }

  static of(values: ReadonlyArray<AnyExpression>): ListExpression {
    return new ListExpression(values);
  }

  static fromValues(values: ReadonlyArray<unknown>): ListExpression {
    return new ListExpression(values.map((value) => new LiteralExpr(value)));
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.list(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    if (rewriter.list) {
      return rewriter.list(this);
    }

    return new ListExpression(this.values.map((value) => value.rewrite(rewriter)));
  }

  fold<T>(folder: ExpressionFolder<T>): T {
    if (folder.list) {
      return folder.list(this);
    }
    return combineAll(
      folder,
      this.values.map((value) => () => value.fold(folder)),
    );
  }
}

export class BinaryExpr extends Expression {
  readonly kind = 'binary' as const;
  readonly op: BinaryOp;
  readonly left: AnyExpression;
  readonly right: AnyExpression;

  constructor(op: BinaryOp, left: AnyExpression, right: AnyExpression) {
    super();
    this.op = op;
    this.left = left;
    this.right = right;
    this.freeze();
  }

  static eq(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('eq', left, right);
  }

  static neq(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('neq', left, right);
  }

  static gt(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('gt', left, right);
  }

  static lt(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('lt', left, right);
  }

  static gte(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('gte', left, right);
  }

  static lte(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('lte', left, right);
  }

  static like(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('like', left, right);
  }

  static in(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('in', left, right);
  }

  static notIn(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('notIn', left, right);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.binary(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new BinaryExpr(
      this.op,
      rewriteComparable(this.left, rewriter),
      rewriteComparable(this.right, rewriter),
    );
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(folder, [
      () => foldComparable(this.left, folder),
      () => foldComparable(this.right, folder),
    ]);
  }
}

export class AndExpr extends Expression {
  readonly kind = 'and' as const;
  readonly exprs: ReadonlyArray<AnyExpression>;

  constructor(exprs: ReadonlyArray<AnyExpression>) {
    super();
    this.exprs = frozenArrayCopy(exprs);
    this.freeze();
  }

  static of(exprs: ReadonlyArray<AnyExpression>): AndExpr {
    return new AndExpr(exprs);
  }

  static true(): AndExpr {
    return new AndExpr([]);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.and(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new AndExpr(this.exprs.map((expr) => expr.rewrite(rewriter)));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(
      folder,
      this.exprs.map((expr) => () => expr.fold(folder)),
    );
  }
}

export class OrExpr extends Expression {
  readonly kind = 'or' as const;
  readonly exprs: ReadonlyArray<AnyExpression>;

  constructor(exprs: ReadonlyArray<AnyExpression>) {
    super();
    this.exprs = frozenArrayCopy(exprs);
    this.freeze();
  }

  static of(exprs: ReadonlyArray<AnyExpression>): OrExpr {
    return new OrExpr(exprs);
  }

  static false(): OrExpr {
    return new OrExpr([]);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.or(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new OrExpr(this.exprs.map((expr) => expr.rewrite(rewriter)));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(
      folder,
      this.exprs.map((expr) => () => expr.fold(folder)),
    );
  }
}

export class ExistsExpr extends Expression {
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

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.exists(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new ExistsExpr(this.subquery.rewrite(rewriter), this.notExists);
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.select ? folder.select(this.subquery) : folder.empty;
  }
}

export class NullCheckExpr extends Expression {
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

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.nullCheck(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new NullCheckExpr(this.expr.rewrite(rewriter), this.isNull);
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return this.expr.fold(folder);
  }
}

export class NotExpr extends Expression {
  readonly kind = 'not' as const;
  readonly expr: AnyExpression;

  constructor(expr: AnyExpression) {
    super();
    this.expr = expr;
    this.freeze();
  }

  toWhereExpr(): AnyExpression {
    return this;
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.not(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new NotExpr(this.expr.rewrite(rewriter));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return this.expr.fold(folder);
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

  rewrite(rewriter: AstRewriter): EqColJoinOn | AnyExpression {
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
      this.on.kind === 'eq-col-join-on' ? this.on.rewrite(rewriter) : this.on.rewrite(rewriter),
      this.lateral,
    );
  }
}

export class ProjectionItem extends AstNode {
  readonly kind = 'projection-item' as const;
  readonly alias: string;
  readonly expr: ProjectionExpr;
  readonly codecId: string | undefined;

  constructor(alias: string, expr: ProjectionExpr, codecId?: string) {
    super();
    this.alias = alias;
    this.expr = expr;
    this.codecId = codecId;
    this.freeze();
  }

  static of(alias: string, expr: ProjectionExpr, codecId?: string): ProjectionItem {
    return new ProjectionItem(alias, expr, codecId);
  }

  withCodecId(codecId: string | undefined): ProjectionItem {
    return new ProjectionItem(this.alias, this.expr, codecId);
  }
}

export interface SelectAstOptions {
  readonly from: AnyFromSource;
  readonly joins: ReadonlyArray<JoinAst> | undefined;
  readonly projection: ReadonlyArray<ProjectionItem>;
  readonly where: AnyExpression | undefined;
  readonly orderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly distinct: true | undefined;
  readonly distinctOn: ReadonlyArray<AnyExpression> | undefined;
  readonly groupBy: ReadonlyArray<AnyExpression> | undefined;
  readonly having: AnyExpression | undefined;
  readonly limit: number | undefined;
  readonly offset: number | undefined;
  readonly selectAllIntent: { readonly table?: string } | undefined;
}

export class SelectAst extends QueryAst {
  readonly kind = 'select' as const;
  readonly from: AnyFromSource;
  readonly joins: ReadonlyArray<JoinAst> | undefined;
  readonly projection: ReadonlyArray<ProjectionItem>;
  readonly where: AnyExpression | undefined;
  readonly orderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly distinct: true | undefined;
  readonly distinctOn: ReadonlyArray<AnyExpression> | undefined;
  readonly groupBy: ReadonlyArray<AnyExpression> | undefined;
  readonly having: AnyExpression | undefined;
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

  withWhere(where: AnyExpression | undefined): SelectAst {
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

  withHaving(having: AnyExpression | undefined): SelectAst {
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
            projection.codecId,
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

  collectColumnRefs(): ColumnRef[] {
    const refs: ColumnRef[] = [];
    const pushRefs = (columns: ReadonlyArray<ColumnRef>) => {
      refs.push(...columns);
    };

    if (this.from.kind === 'derived-table-source') {
      pushRefs(this.from.query.collectColumnRefs());
    }

    for (const projection of this.projection) {
      if (!(projection.expr.kind === 'literal')) {
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
      if (!(projection.expr.kind === 'literal')) {
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
      if (!(join.on.kind === 'eq-col-join-on')) {
        pushRefs(join.on.collectParamRefs());
      }
    }

    return refs;
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
  readonly returning: ReadonlyArray<ProjectionItem> | undefined;

  constructor(
    table: TableSource,
    rows: ReadonlyArray<Record<string, InsertValue>> = [{}],
    onConflict?: InsertOnConflict,
    returning?: ReadonlyArray<ProjectionItem>,
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

  withReturning(returning: ReadonlyArray<ProjectionItem> | undefined): InsertAst {
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

  rewrite(rewriter: AstRewriter): InsertAst {
    return new InsertAst(
      rewriteTableSource(this.table, rewriter),
      this.rows.map((row) => rewriteInsertRow(row, rewriter)),
      this.onConflict ? rewriteOnConflict(this.onConflict, rewriter) : undefined,
      this.returning?.map((item) => rewriteProjectionItem(item, rewriter)),
    );
  }

  override collectParamRefs(): ParamRef[] {
    const refs: ParamRef[] = [];
    for (const row of this.rows) {
      for (const value of Object.values(row)) {
        if (value.kind === 'param-ref') {
          refs.push(value);
        }
      }
    }
    if (this.onConflict?.action.kind === 'do-update-set') {
      for (const value of Object.values(this.onConflict.action.set)) {
        if (value.kind === 'param-ref') {
          refs.push(value);
        }
      }
    }
    for (const item of this.returning ?? []) {
      if (item.expr.kind !== 'literal') {
        refs.push(...item.expr.collectParamRefs());
      }
    }
    return refs;
  }

  override toQueryAst(): AnyQueryAst {
    return this;
  }
}

export class UpdateAst extends QueryAst {
  readonly kind = 'update' as const;
  readonly table: TableSource;
  readonly set: Readonly<Record<string, ColumnRef | ParamRef>>;
  readonly where: AnyExpression | undefined;
  readonly returning: ReadonlyArray<ProjectionItem> | undefined;

  constructor(
    table: TableSource,
    set: Readonly<Record<string, ColumnRef | ParamRef>> = {},
    where?: AnyExpression,
    returning?: ReadonlyArray<ProjectionItem>,
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

  withWhere(where: AnyExpression | undefined): UpdateAst {
    return new UpdateAst(this.table, this.set, where, this.returning);
  }

  withReturning(returning: ReadonlyArray<ProjectionItem> | undefined): UpdateAst {
    return new UpdateAst(this.table, this.set, this.where, returning);
  }

  rewrite(rewriter: AstRewriter): UpdateAst {
    return new UpdateAst(
      rewriteTableSource(this.table, rewriter),
      rewriteUpdateSet(this.set, rewriter),
      this.where?.rewrite(rewriter),
      this.returning?.map((item) => rewriteProjectionItem(item, rewriter)),
    );
  }

  override collectParamRefs(): ParamRef[] {
    const refs: ParamRef[] = [];
    for (const value of Object.values(this.set)) {
      if (value.kind === 'param-ref') {
        refs.push(value);
      }
    }
    if (this.where) {
      refs.push(...this.where.collectParamRefs());
    }
    for (const item of this.returning ?? []) {
      if (item.expr.kind !== 'literal') {
        refs.push(...item.expr.collectParamRefs());
      }
    }
    return refs;
  }

  override toQueryAst(): AnyQueryAst {
    return this;
  }
}

export class DeleteAst extends QueryAst {
  readonly kind = 'delete' as const;
  readonly table: TableSource;
  readonly where: AnyExpression | undefined;
  readonly returning: ReadonlyArray<ProjectionItem> | undefined;

  constructor(
    table: TableSource,
    where?: AnyExpression,
    returning?: ReadonlyArray<ProjectionItem>,
  ) {
    super();
    this.table = table;
    this.where = where;
    this.returning = returning && returning.length > 0 ? frozenArrayCopy(returning) : undefined;
    this.freeze();
  }

  static from(table: TableSource): DeleteAst {
    return new DeleteAst(table);
  }

  withWhere(where: AnyExpression | undefined): DeleteAst {
    return new DeleteAst(this.table, where, this.returning);
  }

  withReturning(returning: ReadonlyArray<ProjectionItem> | undefined): DeleteAst {
    return new DeleteAst(this.table, this.where, returning);
  }

  rewrite(rewriter: AstRewriter): DeleteAst {
    return new DeleteAst(
      rewriteTableSource(this.table, rewriter),
      this.where?.rewrite(rewriter),
      this.returning?.map((item) => rewriteProjectionItem(item, rewriter)),
    );
  }

  override collectParamRefs(): ParamRef[] {
    const refs: ParamRef[] = [];
    if (this.where) {
      refs.push(...this.where.collectParamRefs());
    }
    for (const item of this.returning ?? []) {
      if (item.expr.kind !== 'literal') {
        refs.push(...item.expr.collectParamRefs());
      }
    }
    return refs;
  }

  override toQueryAst(): AnyQueryAst {
    return this;
  }
}

export type AnyQueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst;
export type AnyFromSource = TableSource | DerivedTableSource;
export type AnyExpression =
  | ColumnRef
  | IdentifierRef
  | ParamRef
  | LiteralExpr
  | SubqueryExpr
  | OperationExpr
  | AggregateExpr
  | JsonObjectExpr
  | JsonArrayAggExpr
  | ListExpression
  | BinaryExpr
  | AndExpr
  | OrExpr
  | ExistsExpr
  | NullCheckExpr
  | NotExpr;
export type AnyInsertOnConflictAction = DoNothingConflictAction | DoUpdateSetConflictAction;
export type AnyInsertValue = ColumnRef | ParamRef | DefaultValueExpr;
export type AnyOperationArg = AnyExpression | ParamRef | LiteralExpr;

export const queryAstKinds: ReadonlySet<string> = new Set<AnyQueryAst['kind']>([
  'select',
  'insert',
  'update',
  'delete',
]);
export const whereExprKinds: ReadonlySet<string> = new Set<AnyExpression['kind']>([
  'binary',
  'and',
  'or',
  'exists',
  'null-check',
  'not',
]);

export function isQueryAst(value: unknown): value is AnyQueryAst {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    queryAstKinds.has((value as { kind: string }).kind)
  );
}

export function isWhereExpr(value: unknown): value is AnyExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    whereExprKinds.has((value as { kind: string }).kind)
  );
}

export interface ToWhereExpr {
  toWhereExpr(): AnyExpression;
}

export interface LoweredStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly annotations?: Record<string, unknown>;
}
