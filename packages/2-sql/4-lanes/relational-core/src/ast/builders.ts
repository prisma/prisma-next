import { ifDefined } from '@prisma-next/utils/defined';
import { createProjectionItem } from './common';
import { createDeleteAst } from './delete';
import { createInsertAst } from './insert';
import { createSelectAst } from './select';
import type {
  ColumnRef,
  DeleteAst,
  Expression,
  FromSource,
  InsertAst,
  InsertOnConflictAst,
  InsertValue,
  JoinAst,
  LiteralExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
  UpdateAst,
  WhereExpr,
} from './types';
import { createUpdateAst } from './update';

export class SelectAstBuilder {
  private fromSource: FromSource;
  private joinsValue: ReadonlyArray<JoinAst> | undefined;
  private projectValue: ProjectionItem[];
  private whereValue: WhereExpr | undefined;
  private orderByValue: ReadonlyArray<OrderByItem> | undefined;
  private distinctValue: true | undefined;
  private distinctOnValue: ReadonlyArray<Expression> | undefined;
  private groupByValue: ReadonlyArray<Expression> | undefined;
  private havingValue: WhereExpr | undefined;
  private limitValue: number | undefined;
  private offsetValue: number | undefined;
  private selectAllIntentValue: { table?: string } | undefined;

  constructor(from: FromSource) {
    this.fromSource = from;
    this.projectValue = [];
  }

  from(from: FromSource): this {
    this.fromSource = from;
    return this;
  }

  joins(joins: ReadonlyArray<JoinAst>): this {
    this.joinsValue = joins.length > 0 ? [...joins] : undefined;
    return this;
  }

  project(project: ReadonlyArray<ProjectionItem>): this {
    this.projectValue = [...project];
    return this;
  }

  addProject(alias: string, expr: Expression | LiteralExpr): this {
    this.projectValue.push(createProjectionItem(alias, expr));
    return this;
  }

  where(where: WhereExpr | undefined): this {
    this.whereValue = where;
    return this;
  }

  orderBy(orderBy: ReadonlyArray<OrderByItem>): this {
    this.orderByValue = orderBy.length > 0 ? [...orderBy] : undefined;
    return this;
  }

  distinct(enabled = true): this {
    this.distinctValue = enabled ? true : undefined;
    return this;
  }

  distinctOn(distinctOn: ReadonlyArray<Expression>): this {
    this.distinctOnValue = distinctOn.length > 0 ? [...distinctOn] : undefined;
    return this;
  }

  groupBy(groupBy: ReadonlyArray<Expression>): this {
    this.groupByValue = groupBy.length > 0 ? [...groupBy] : undefined;
    return this;
  }

  having(having: WhereExpr | undefined): this {
    this.havingValue = having;
    return this;
  }

  limit(limit: number | undefined): this {
    this.limitValue = limit;
    return this;
  }

  offset(offset: number | undefined): this {
    this.offsetValue = offset;
    return this;
  }

  selectAllIntent(selectAllIntent: { table?: string } | undefined): this {
    this.selectAllIntentValue = selectAllIntent;
    return this;
  }

  build(): SelectAst {
    return createSelectAst({
      from: this.fromSource,
      project: this.projectValue,
      ...ifDefined('joins', this.joinsValue),
      ...ifDefined('where', this.whereValue),
      ...ifDefined('orderBy', this.orderByValue),
      ...ifDefined('distinct', this.distinctValue),
      ...ifDefined('distinctOn', this.distinctOnValue),
      ...ifDefined('groupBy', this.groupByValue),
      ...ifDefined('having', this.havingValue),
      ...ifDefined('limit', this.limitValue),
      ...ifDefined('offset', this.offsetValue),
      ...ifDefined('selectAllIntent', this.selectAllIntentValue),
    });
  }
}

export function doNothing(): InsertOnConflictAst['action'] {
  return {
    kind: 'doNothing',
  };
}

export function doUpdateSet(
  setValues: Record<string, ColumnRef | ParamRef>,
): InsertOnConflictAst['action'] {
  return {
    kind: 'doUpdateSet',
    set: { ...setValues },
  };
}

export class InsertOnConflictAstBuilder {
  private readonly columns: ReadonlyArray<ColumnRef>;
  private actionValue: InsertOnConflictAst['action'];

  constructor(columns: ReadonlyArray<ColumnRef>) {
    this.columns = [...columns];
    this.actionValue = doNothing();
  }

  doNothing(): this {
    this.actionValue = doNothing();
    return this;
  }

  doUpdateSet(setValues: Record<string, ColumnRef | ParamRef>): this {
    this.actionValue = doUpdateSet(setValues);
    return this;
  }

  set(setValues: Record<string, ColumnRef | ParamRef>): this {
    return this.doUpdateSet(setValues);
  }

  build(): InsertOnConflictAst {
    return {
      columns: this.columns,
      action: this.actionValue,
    };
  }
}

export class InsertAstBuilder {
  private readonly table: TableSource;
  private rowValues: ReadonlyArray<Record<string, InsertValue>> = [{}];
  private returningColumns: ReadonlyArray<ColumnRef> | undefined;
  private conflict: InsertOnConflictAst | undefined;

  constructor(table: TableSource) {
    this.table = table;
  }

  values(values: Record<string, InsertValue>): this {
    this.rowValues = [{ ...values }];
    return this;
  }

  rows(rows: ReadonlyArray<Record<string, InsertValue>>): this {
    this.rowValues = rows.map((row) => ({ ...row }));
    return this;
  }

  returning(returning: ReadonlyArray<ColumnRef> | undefined): this {
    this.returningColumns = returning && returning.length > 0 ? [...returning] : undefined;
    return this;
  }

  onConflict(onConflict: InsertOnConflictAst | undefined): this {
    this.conflict = onConflict;
    return this;
  }

  build(): InsertAst {
    return createInsertAst({
      table: this.table,
      rows: this.rowValues,
      ...ifDefined('onConflict', this.conflict),
      ...ifDefined('returning', this.returningColumns),
    });
  }
}

export class UpdateAstBuilder {
  private readonly table: TableSource;
  private setValues: Record<string, ColumnRef | ParamRef> = {};
  private whereExpr: WhereExpr | undefined;
  private returningColumns: ReadonlyArray<ColumnRef> | undefined;

  constructor(table: TableSource) {
    this.table = table;
  }

  set(setValues: Record<string, ColumnRef | ParamRef>): this {
    this.setValues = { ...setValues };
    return this;
  }

  where(where: WhereExpr | undefined): this {
    this.whereExpr = where;
    return this;
  }

  returning(returning: ReadonlyArray<ColumnRef> | undefined): this {
    this.returningColumns = returning && returning.length > 0 ? [...returning] : undefined;
    return this;
  }

  build(): UpdateAst {
    return createUpdateAst({
      table: this.table,
      set: this.setValues,
      ...ifDefined('where', this.whereExpr),
      ...ifDefined('returning', this.returningColumns),
    });
  }
}

export class DeleteAstBuilder {
  private readonly table: TableSource;
  private whereExpr: WhereExpr | undefined;
  private returningColumns: ReadonlyArray<ColumnRef> | undefined;

  constructor(table: TableSource) {
    this.table = table;
  }

  where(where: WhereExpr | undefined): this {
    this.whereExpr = where;
    return this;
  }

  returning(returning: ReadonlyArray<ColumnRef> | undefined): this {
    this.returningColumns = returning && returning.length > 0 ? [...returning] : undefined;
    return this;
  }

  build(): DeleteAst {
    return createDeleteAst({
      table: this.table,
      ...ifDefined('where', this.whereExpr),
      ...ifDefined('returning', this.returningColumns),
    });
  }
}

export function createSelectAstBuilder(from: FromSource): SelectAstBuilder {
  return new SelectAstBuilder(from);
}

export function createInsertOnConflictAstBuilder(
  columns: ReadonlyArray<ColumnRef>,
): InsertOnConflictAstBuilder {
  return new InsertOnConflictAstBuilder(columns);
}

export function createInsertAstBuilder(table: TableSource): InsertAstBuilder {
  return new InsertAstBuilder(table);
}

export function createUpdateAstBuilder(table: TableSource): UpdateAstBuilder {
  return new UpdateAstBuilder(table);
}

export function createDeleteAstBuilder(table: TableSource): DeleteAstBuilder {
  return new DeleteAstBuilder(table);
}
