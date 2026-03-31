import type { StorageTable } from '@prisma-next/sql-contract/types';
import { type AnyFromSource, TableSource } from '@prisma-next/sql-relational-core/ast';
import type {
  AggregateFunctions,
  Expression,
  ExpressionBuilder,
  ExtractScopeFields,
  FieldProxy,
  WithField,
  WithFields,
} from '../expression';
import type {
  EmptyRow,
  Expand,
  JoinOuterScope,
  JoinSource,
  MergeScopes,
  NullableScope,
  QueryContext,
  RebindScope,
  Scope,
  ScopeField,
  ScopeTable,
  StorageTableToScopeTable,
  Subquery,
} from '../scope';
import type { TableProxyContract } from '../types/db';
import type { JoinedTables } from '../types/joined-tables';
import type { DeleteQuery, InsertQuery, UpdateQuery } from '../types/mutation-query';
import type { SelectQuery } from '../types/select-query';
import type { LateralBuilder } from '../types/shared';
import type { TableProxy } from '../types/table-proxy';
import { BuilderBase, type BuilderContext, emptyState, tableToScope } from './builder-base';
import { JoinedTablesImpl } from './joined-tables-impl';
import { DeleteQueryImpl, InsertQueryImpl, UpdateQueryImpl } from './mutation-impl';
import { SelectQueryImpl } from './query-impl';

export class TableProxyImpl<
    C extends TableProxyContract,
    Name extends string & keyof C['storage']['tables'],
    Alias extends string,
    AvailableScope extends Scope,
    QC extends QueryContext,
  >
  extends BuilderBase<C['capabilities']>
  implements TableProxy<C, Name, Alias, AvailableScope, QC>
{
  declare readonly [JoinOuterScope]: JoinSource<
    StorageTableToScopeTable<C['storage']['tables'][Name]>,
    Alias
  >[typeof JoinOuterScope];

  readonly #tableName: string;
  readonly #table: StorageTable;
  readonly #fromSource: TableSource;
  readonly #scope: Scope;

  constructor(tableName: string, table: StorageTable, alias: string, ctx: BuilderContext) {
    super(ctx);
    this.#tableName = tableName;
    this.#table = table;
    this.#scope = tableToScope(alias, table);
    this.#fromSource = TableSource.named(tableName, alias !== tableName ? alias : undefined);
  }

  lateralJoin = this._gate(
    { sql: { lateral: true } },
    'lateralJoin',
    <LAlias extends string, LateralRow extends Record<string, ScopeField>>(
      alias: LAlias,
      builder: (lateral: LateralBuilder<QC, AvailableScope>) => Subquery<LateralRow>,
    ): JoinedTables<
      QC,
      MergeScopes<AvailableScope, { topLevel: LateralRow; namespaces: Record<LAlias, LateralRow> }>
    > => {
      return this.#toJoined().lateralJoin(alias, builder);
    },
  ) as TableProxy<C, Name, Alias, AvailableScope, QC>['lateralJoin'];

  outerLateralJoin = this._gate(
    { sql: { lateral: true } },
    'outerLateralJoin',
    <LAlias extends string, LateralRow extends Record<string, ScopeField>>(
      alias: LAlias,
      builder: (lateral: LateralBuilder<QC, AvailableScope>) => Subquery<LateralRow>,
    ): JoinedTables<
      QC,
      MergeScopes<
        AvailableScope,
        NullableScope<{ topLevel: LateralRow; namespaces: Record<LAlias, LateralRow> }>
      >
    > => {
      return this.#toJoined().outerLateralJoin(alias, builder);
    },
  ) as TableProxy<C, Name, Alias, AvailableScope, QC>['outerLateralJoin'];

  getJoinOuterScope(): Scope {
    return this.#scope;
  }

  buildAst(): AnyFromSource {
    return this.#fromSource;
  }

  as<NewAlias extends string>(
    newAlias: NewAlias,
  ): TableProxy<C, Name, NewAlias, RebindScope<AvailableScope, Alias, NewAlias>> {
    return new TableProxyImpl(this.#tableName, this.#table, newAlias, this.ctx);
  }

  select<Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
    ...columns: Columns
  ): SelectQuery<QC, AvailableScope, WithFields<EmptyRow, AvailableScope['topLevel'], Columns>>;
  select<LAlias extends string, Field extends ScopeField>(
    alias: LAlias,
    expr: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Expression<Field>,
  ): SelectQuery<QC, AvailableScope, WithField<EmptyRow, Field, LAlias>>;
  select<Result extends Record<string, Expression<ScopeField>>>(
    callback: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Result,
  ): SelectQuery<QC, AvailableScope, Expand<ExtractScopeFields<Result>>>;
  select(...args: unknown[]): unknown {
    return new SelectQueryImpl(emptyState(this.#fromSource, this.#scope), this.ctx).select(
      ...(args as string[]),
    );
  }

  innerJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>> {
    return this.#toJoined().innerJoin(other, on);
  }

  outerLeftJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<AvailableScope, NullableScope<Other[typeof JoinOuterScope]>>> {
    return this.#toJoined().outerLeftJoin(other, on);
  }

  outerRightJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<NullableScope<AvailableScope>, Other[typeof JoinOuterScope]>> {
    return this.#toJoined().outerRightJoin(other, on);
  }

  outerFullJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<
    QC,
    MergeScopes<NullableScope<AvailableScope>, NullableScope<Other[typeof JoinOuterScope]>>
  > {
    return this.#toJoined().outerFullJoin(other, on);
  }

  insert(values: Record<string, unknown>): InsertQuery<QC, AvailableScope, EmptyRow> {
    return new InsertQueryImpl(this.#tableName, this.#scope, values, this.ctx);
  }

  update(set: Record<string, unknown>): UpdateQuery<QC, AvailableScope, EmptyRow> {
    return new UpdateQueryImpl(this.#tableName, this.#scope, set, this.ctx);
  }

  delete(): DeleteQuery<QC, AvailableScope, EmptyRow> {
    return new DeleteQueryImpl(this.#tableName, this.#scope, this.ctx);
  }

  #toJoined(): JoinedTables<QC, AvailableScope> {
    return new JoinedTablesImpl(emptyState(this.#fromSource, this.#scope), this.ctx);
  }
}
