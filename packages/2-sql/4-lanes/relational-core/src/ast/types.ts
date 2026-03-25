import type { ParamDescriptor, PlanRefs } from '@prisma-next/contract/types';
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
  toExpr(): Expression;
}

export interface ExpressionRewriter {
  columnRef?(expr: ColumnRef): Expression;
  paramRef?(expr: ParamRef): ParamRef | LiteralExpr;
  literal?(expr: LiteralExpr): LiteralExpr;
  listLiteral?(expr: ListLiteralExpr): ListLiteralExpr | LiteralExpr;
  select?(ast: SelectAst): SelectAst;
}

export interface AstRewriter extends ExpressionRewriter {
  tableSource?(source: TableSource): TableSource;
  eqColJoinOn?(on: EqColJoinOn): EqColJoinOn | WhereExpr;
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

export type ProjectionExpr = Expression | LiteralExpr;
export type SqlComparable = Expression | ParamRef | LiteralExpr | ListLiteralExpr;
export type InsertValue = ColumnRef | ParamRef | DefaultValueExpr;
export type JoinOnExpr = EqColJoinOn | WhereExpr;
export type WhereArg = WhereExpr | ToWhereExpr;
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

function rewriteComparable(value: SqlComparable, rewriter: ExpressionRewriter): SqlComparable {
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
    default:
      return value.rewrite(rewriter);
  }
}

function foldComparable<T>(value: SqlComparable, folder: ExpressionFolder<T>): T {
  switch (value.kind) {
    case 'param-ref':
      return folder.paramRef ? folder.paramRef(value) : folder.empty;
    case 'literal':
      return folder.literal ? folder.literal(value) : folder.empty;
    case 'list-literal':
      return value.fold(folder);
    default:
      return value.fold(folder);
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

export abstract class AstNode {
  abstract readonly kind: string;

  protected freeze(): void {
    Object.freeze(this);
  }
}

export abstract class QueryAst extends AstNode {
  abstract readonly kind: 'select' | 'insert' | 'update' | 'delete';
  abstract collectRefs(): PlanRefs;

  collectColumnRefs(): ColumnRef[] {
    const refs = this.collectRefs().columns ?? [];
    return refs.map((ref) => new ColumnRef(ref.table, ref.column));
  }
}

export abstract class FromSource extends AstNode {
  abstract readonly kind: 'table-source' | 'derived-table-source';
  abstract collectRefs(): PlanRefs;
  abstract rewrite(rewriter: AstRewriter): FromSource;
}

export abstract class Expression extends AstNode implements ExpressionSource {
  abstract readonly kind:
    | 'column-ref'
    | 'subquery'
    | 'operation'
    | 'aggregate'
    | 'json-object'
    | 'json-array-agg';
  abstract rewrite(rewriter: ExpressionRewriter): Expression;
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

  toExpr(): Expression {
    return this;
  }
}

export abstract class WhereExpr extends AstNode {
  abstract readonly kind: 'binary' | 'and' | 'or' | 'exists' | 'null-check';
  abstract accept<R>(visitor: WhereExprVisitor<R>): R;
  abstract rewrite(rewriter: ExpressionRewriter): WhereExpr;
  abstract fold<T>(folder: ExpressionFolder<T>): T;
  abstract not(): WhereExpr;

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

  static named(name: string, alias?: string): TableSource {
    return new TableSource(name, alias);
  }

  override rewrite(rewriter: AstRewriter): FromSource {
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
  // fromSource?(source: FromSource) callback would be needed for that.
  override rewrite(rewriter: AstRewriter): FromSource {
    return new DerivedTableSource(this.alias, this.query.rewrite(rewriter));
  }

  override collectRefs(): PlanRefs {
    return this.query.collectRefs();
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

  override rewrite(rewriter: ExpressionRewriter): Expression {
    return rewriter.columnRef ? rewriter.columnRef(this) : this;
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.columnRef ? folder.columnRef(this) : folder.empty;
  }

  override baseColumnRef(): ColumnRef {
    return this;
  }
}

export class ParamRef extends AstNode {
  readonly kind = 'param-ref' as const;
  // 1-based index matching PostgreSQL's $1, $2, ... convention.
  // The corresponding value lives at params[index - 1] in the bound params array.
  readonly index: number;
  readonly name: string | undefined;

  constructor(index: number, name?: string) {
    super();
    this.index = index;
    this.name = name;
    this.freeze();
  }

  static of(index: number, name?: string): ParamRef {
    return new ParamRef(index, name);
  }

  withIndex(index: number): ParamRef {
    return new ParamRef(index, this.name);
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

  override rewrite(rewriter: ExpressionRewriter): Expression {
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
  readonly forTypeId: string;
  readonly self: Expression;
  readonly args: ReadonlyArray<Expression | ParamRef | LiteralExpr>;
  readonly returns: ReturnSpec;
  readonly lowering: SqlLoweringSpec;

  constructor(options: {
    readonly method: string;
    readonly forTypeId: string;
    readonly self: Expression;
    readonly args: ReadonlyArray<Expression | ParamRef | LiteralExpr> | undefined;
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
    readonly self: Expression;
    readonly args: ReadonlyArray<Expression | ParamRef | LiteralExpr> | undefined;
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

  override rewrite(rewriter: ExpressionRewriter): Expression {
    return new OperationExpr({
      method: this.method,
      forTypeId: this.forTypeId,
      self: this.self.rewrite(rewriter),
      args: this.args.map((arg) => rewriteComparable(arg, rewriter)) as ReadonlyArray<
        Expression | ParamRef | LiteralExpr
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
  readonly expr: Expression | undefined;

  constructor(fn: AggregateFn, expr?: Expression) {
    super();
    if (fn !== 'count' && expr === undefined) {
      throw new Error(`Aggregate function "${fn}" requires an expression`);
    }
    this.fn = fn;
    this.expr = expr;
    this.freeze();
  }

  static count(expr?: Expression): AggregateExpr {
    return new AggregateExpr('count', expr);
  }

  static sum(expr: Expression): AggregateExpr {
    return new AggregateExpr('sum', expr);
  }

  static avg(expr: Expression): AggregateExpr {
    return new AggregateExpr('avg', expr);
  }

  static min(expr: Expression): AggregateExpr {
    return new AggregateExpr('min', expr);
  }

  static max(expr: Expression): AggregateExpr {
    return new AggregateExpr('max', expr);
  }

  override rewrite(rewriter: ExpressionRewriter): Expression {
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

  override rewrite(rewriter: ExpressionRewriter): Expression {
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
  readonly expr: Expression;
  readonly dir: Direction;

  constructor(expr: Expression, dir: Direction) {
    super();
    this.expr = expr;
    this.dir = dir;
    this.freeze();
  }

  static asc(expr: Expression): OrderByItem {
    return new OrderByItem(expr, 'asc');
  }

  static desc(expr: Expression): OrderByItem {
    return new OrderByItem(expr, 'desc');
  }

  rewrite(rewriter: ExpressionRewriter): OrderByItem {
    return new OrderByItem(this.expr.rewrite(rewriter), this.dir);
  }
}

export class JsonArrayAggExpr extends Expression {
  readonly kind = 'json-array-agg' as const;
  readonly expr: Expression;
  readonly onEmpty: 'null' | 'emptyArray';
  readonly orderBy: ReadonlyArray<OrderByItem> | undefined;

  constructor(
    expr: Expression,
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
    expr: Expression,
    onEmpty: 'null' | 'emptyArray' = 'null',
    orderBy?: ReadonlyArray<OrderByItem>,
  ): JsonArrayAggExpr {
    return new JsonArrayAggExpr(expr, onEmpty, orderBy);
  }

  override rewrite(rewriter: ExpressionRewriter): Expression {
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
  readonly left: Expression;
  readonly right: SqlComparable;

  constructor(op: BinaryOp, left: Expression, right: SqlComparable) {
    super();
    this.op = op;
    this.left = left;
    this.right = right;
    this.freeze();
  }

  static eq(left: Expression, right: SqlComparable): BinaryExpr {
    return new BinaryExpr('eq', left, right);
  }

  static neq(left: Expression, right: SqlComparable): BinaryExpr {
    return new BinaryExpr('neq', left, right);
  }

  static gt(left: Expression, right: SqlComparable): BinaryExpr {
    return new BinaryExpr('gt', left, right);
  }

  static lt(left: Expression, right: SqlComparable): BinaryExpr {
    return new BinaryExpr('lt', left, right);
  }

  static gte(left: Expression, right: SqlComparable): BinaryExpr {
    return new BinaryExpr('gte', left, right);
  }

  static lte(left: Expression, right: SqlComparable): BinaryExpr {
    return new BinaryExpr('lte', left, right);
  }

  static like(left: Expression, right: SqlComparable): BinaryExpr {
    return new BinaryExpr('like', left, right);
  }

  static ilike(left: Expression, right: SqlComparable): BinaryExpr {
    return new BinaryExpr('ilike', left, right);
  }

  static in(left: Expression, right: SqlComparable): BinaryExpr {
    return new BinaryExpr('in', left, right);
  }

  static notIn(left: Expression, right: SqlComparable): BinaryExpr {
    return new BinaryExpr('notIn', left, right);
  }

  override accept<R>(visitor: WhereExprVisitor<R>): R {
    return visitor.binary(this);
  }

  override rewrite(rewriter: ExpressionRewriter): WhereExpr {
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

  override not(): WhereExpr {
    return new BinaryExpr(negateBinaryOp(this.op), this.left, this.right);
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
  readonly exprs: ReadonlyArray<WhereExpr>;

  constructor(exprs: ReadonlyArray<WhereExpr>) {
    super();
    this.exprs = frozenArrayCopy(exprs);
    this.freeze();
  }

  static of(exprs: ReadonlyArray<WhereExpr>): AndExpr {
    return new AndExpr(exprs);
  }

  static true(): AndExpr {
    return new AndExpr([]);
  }

  override accept<R>(visitor: WhereExprVisitor<R>): R {
    return visitor.and(this);
  }

  override rewrite(rewriter: ExpressionRewriter): WhereExpr {
    return new AndExpr(this.exprs.map((expr) => expr.rewrite(rewriter)));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(
      folder,
      this.exprs.map((expr) => () => expr.fold(folder)),
    );
  }

  override not(): WhereExpr {
    return new OrExpr(this.exprs.map((expr) => expr.not()));
  }
}

export class OrExpr extends WhereExpr {
  readonly kind = 'or' as const;
  readonly exprs: ReadonlyArray<WhereExpr>;

  constructor(exprs: ReadonlyArray<WhereExpr>) {
    super();
    this.exprs = frozenArrayCopy(exprs);
    this.freeze();
  }

  static of(exprs: ReadonlyArray<WhereExpr>): OrExpr {
    return new OrExpr(exprs);
  }

  static false(): OrExpr {
    return new OrExpr([]);
  }

  override accept<R>(visitor: WhereExprVisitor<R>): R {
    return visitor.or(this);
  }

  override rewrite(rewriter: ExpressionRewriter): WhereExpr {
    return new OrExpr(this.exprs.map((expr) => expr.rewrite(rewriter)));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(
      folder,
      this.exprs.map((expr) => () => expr.fold(folder)),
    );
  }

  override not(): WhereExpr {
    return new AndExpr(this.exprs.map((expr) => expr.not()));
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

  override rewrite(rewriter: ExpressionRewriter): WhereExpr {
    return new ExistsExpr(this.subquery.rewrite(rewriter), this.notExists);
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.select ? folder.select(this.subquery) : folder.empty;
  }

  override not(): WhereExpr {
    return new ExistsExpr(this.subquery, !this.notExists);
  }
}

export class NullCheckExpr extends WhereExpr {
  readonly kind = 'null-check' as const;
  readonly expr: Expression;
  readonly isNull: boolean;

  constructor(expr: Expression, isNull: boolean) {
    super();
    this.expr = expr;
    this.isNull = isNull;
    this.freeze();
  }

  static isNull(expr: Expression): NullCheckExpr {
    return new NullCheckExpr(expr, true);
  }

  static isNotNull(expr: Expression): NullCheckExpr {
    return new NullCheckExpr(expr, false);
  }

  override accept<R>(visitor: WhereExprVisitor<R>): R {
    return visitor.nullCheck(this);
  }

  override rewrite(rewriter: ExpressionRewriter): WhereExpr {
    return new NullCheckExpr(this.expr.rewrite(rewriter), this.isNull);
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return this.expr.fold(folder);
  }

  override not(): WhereExpr {
    return new NullCheckExpr(this.expr, !this.isNull);
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

  rewrite(rewriter: AstRewriter): EqColJoinOn | WhereExpr {
    return rewriter.eqColJoinOn ? rewriter.eqColJoinOn(this) : this;
  }
}

export class JoinAst extends AstNode {
  readonly kind = 'join' as const;
  readonly joinType: 'inner' | 'left' | 'right' | 'full';
  readonly source: FromSource;
  readonly lateral: boolean;
  readonly on: JoinOnExpr;

  constructor(
    joinType: 'inner' | 'left' | 'right' | 'full',
    source: FromSource,
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

  static inner(source: FromSource, on: JoinOnExpr, lateral = false): JoinAst {
    return new JoinAst('inner', source, on, lateral);
  }

  static left(source: FromSource, on: JoinOnExpr, lateral = false): JoinAst {
    return new JoinAst('left', source, on, lateral);
  }

  static right(source: FromSource, on: JoinOnExpr, lateral = false): JoinAst {
    return new JoinAst('right', source, on, lateral);
  }

  static full(source: FromSource, on: JoinOnExpr, lateral = false): JoinAst {
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
  readonly from: FromSource;
  readonly joins: ReadonlyArray<JoinAst> | undefined;
  readonly projection: ReadonlyArray<ProjectionItem>;
  readonly where: WhereExpr | undefined;
  readonly orderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly distinct: true | undefined;
  readonly distinctOn: ReadonlyArray<Expression> | undefined;
  readonly groupBy: ReadonlyArray<Expression> | undefined;
  readonly having: WhereExpr | undefined;
  readonly limit: number | undefined;
  readonly offset: number | undefined;
  readonly selectAllIntent: { readonly table?: string } | undefined;
}

export class SelectAst extends QueryAst {
  readonly kind = 'select' as const;
  readonly from: FromSource;
  readonly joins: ReadonlyArray<JoinAst> | undefined;
  readonly projection: ReadonlyArray<ProjectionItem>;
  readonly where: WhereExpr | undefined;
  readonly orderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly distinct: true | undefined;
  readonly distinctOn: ReadonlyArray<Expression> | undefined;
  readonly groupBy: ReadonlyArray<Expression> | undefined;
  readonly having: WhereExpr | undefined;
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

  static from(from: FromSource): SelectAst {
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

  withFrom(from: FromSource): SelectAst {
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

  withWhere(where: WhereExpr | undefined): SelectAst {
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

  withDistinctOn(distinctOn: ReadonlyArray<Expression>): SelectAst {
    return new SelectAst({
      ...this,
      distinctOn: distinctOn.length > 0 ? distinctOn : undefined,
    });
  }

  withGroupBy(groupBy: ReadonlyArray<Expression>): SelectAst {
    return new SelectAst({
      ...this,
      groupBy: groupBy.length > 0 ? groupBy : undefined,
    });
  }

  withHaving(having: WhereExpr | undefined): SelectAst {
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

    const addSource = (source: FromSource) => {
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
}

export abstract class InsertOnConflictAction extends AstNode {
  abstract readonly kind: 'do-nothing' | 'do-update-set';
}

export class DoNothingConflictAction extends InsertOnConflictAction {
  readonly kind = 'do-nothing' as const;

  constructor() {
    super();
    this.freeze();
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
}

export class InsertOnConflict extends AstNode {
  readonly kind = 'insert-on-conflict' as const;
  readonly columns: ReadonlyArray<ColumnRef>;
  readonly action: InsertOnConflictAction;

  constructor(columns: ReadonlyArray<ColumnRef>, action: InsertOnConflictAction) {
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
        for (const value of Object.values(this.onConflict.action.set)) {
          if (value.kind === 'column-ref') {
            addColumn(value);
          }
        }
      }
    }

    return sortRefs(tables, columns);
  }
}

export class UpdateAst extends QueryAst {
  readonly kind = 'update' as const;
  readonly table: TableSource;
  readonly set: Readonly<Record<string, ColumnRef | ParamRef>>;
  readonly where: WhereExpr | undefined;
  readonly returning: ReadonlyArray<ColumnRef> | undefined;

  constructor(
    table: TableSource,
    set: Readonly<Record<string, ColumnRef | ParamRef>> = {},
    where?: WhereExpr,
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

  withWhere(where: WhereExpr | undefined): UpdateAst {
    return new UpdateAst(this.table, this.set, where, this.returning);
  }

  withReturning(returning: ReadonlyArray<ColumnRef> | undefined): UpdateAst {
    return new UpdateAst(this.table, this.set, this.where, returning);
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
}

export class DeleteAst extends QueryAst {
  readonly kind = 'delete' as const;
  readonly table: TableSource;
  readonly where: WhereExpr | undefined;
  readonly returning: ReadonlyArray<ColumnRef> | undefined;

  constructor(table: TableSource, where?: WhereExpr, returning?: ReadonlyArray<ColumnRef>) {
    super();
    this.table = table;
    this.where = where;
    this.returning = returning && returning.length > 0 ? frozenArrayCopy(returning) : undefined;
    this.freeze();
  }

  static from(table: TableSource): DeleteAst {
    return new DeleteAst(table);
  }

  withWhere(where: WhereExpr | undefined): DeleteAst {
    return new DeleteAst(this.table, where, this.returning);
  }

  withReturning(returning: ReadonlyArray<ColumnRef> | undefined): DeleteAst {
    return new DeleteAst(this.table, this.where, returning);
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

export interface BoundWhereExpr {
  readonly expr: WhereExpr;
  readonly params: readonly unknown[];
  readonly paramDescriptors: ReadonlyArray<ParamDescriptor>;
}

export interface ToWhereExpr {
  toWhereExpr(): BoundWhereExpr;
}

export interface LoweredStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly annotations?: Record<string, unknown>;
}
