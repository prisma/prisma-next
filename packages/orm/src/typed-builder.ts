import { Schema, RelationGraph, Contract } from '@prisma/relational-ir';
import { Table, Column, FieldExpression, Plan, TABLE_NAME, InferSelectResult } from '@prisma/sql';
import { OrmQueryAST, IncludeNode, RelationHandle } from './ast/types';
import { lowerRelations } from './lowering/lower-relations';
import { compileToSQL } from '@prisma/sql';
import {
  RelationHandle as TypedRelationHandle,
  RelationHandles,
  ChildQB,
  OrmQB,
  GateCardinality,
  IncludeResult,
  Merge,
  RowOfProjection,
  NonEmpty,
} from './types';

// ============================================================================
// Type-safe Child Query Builder
// ============================================================================

export class TypedChildQB<
  TChild extends keyof Contract['Tables'] & string,
  TChildRow extends Record<string, any> = {},
> {
  private ast: OrmQueryAST;
  private ir: Schema;

  constructor(tableName: TChild, ir: Schema) {
    this.ir = ir;
    this.ast = {
      type: 'select',
      from: tableName,
      projectStar: true,
    };
  }

  select<TSelect extends Record<string, Column<any, any, any>>>(
    fields: TSelect,
  ): TypedChildQB<TChild, Merge<TChildRow, InferSelectResult<TSelect>>> {
    this.ast.select = {
      type: 'select',
      fields,
    };
    this.ast.projectStar = false;
    return this as any;
  }

  where(condition: FieldExpression): TypedChildQB<TChild, TChildRow> {
    this.ast.where = { type: 'where', condition };
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): TypedChildQB<TChild, TChildRow> {
    this.ast.orderBy = this.ast.orderBy ?? [];
    this.ast.orderBy.push({ type: 'orderBy', field, direction });
    return this;
  }

  limit(count: number): TypedChildQB<TChild, TChildRow> {
    this.ast.limit = { type: 'limit', count };
    return this;
  }

  getAst(): OrmQueryAST {
    return this.ast;
  }

  // Type witness for extracting accumulated row type
  _row(): TChildRow {
    return {} as any;
  }
}

// ============================================================================
// Type-safe ORM Builder
// ============================================================================

export class TypedOrmBuilder<
  TContract extends Contract,
  TParent extends keyof TContract['Tables'] & string,
  TRow extends Record<string, any> = {},
> {
  private ast: OrmQueryAST;
  private ir: Schema;
  private graph: RelationGraph;

  constructor(table: Table<any>, ir: Schema, graph: RelationGraph) {
    this.ir = ir;
    this.graph = graph;
    this.ast = {
      type: 'select',
      from: table[TABLE_NAME],
      contractHash: table.__contractHash,
      projectStar: true,
    };
  }

  select<TSelect extends Record<string, Column<any, any, any>>>(
    fields: TSelect,
  ): TypedOrmBuilder<TContract, TParent, Merge<TRow, InferSelectResult<TSelect>>> & {
    build(): Plan<Merge<TRow, InferSelectResult<TSelect>>>;
  } {
    this.ast.select = {
      type: 'select',
      fields,
    };
    this.ast.projectStar = false;
    return this as any;
  }

  where(condition: FieldExpression): TypedOrmBuilder<TContract, TParent, TRow> {
    this.ast.where = { type: 'where', condition };
    return this;
  }

  orderBy(
    field: string,
    direction: 'ASC' | 'DESC' = 'ASC',
  ): TypedOrmBuilder<TContract, TParent, TRow> {
    this.ast.orderBy = this.ast.orderBy ?? [];
    this.ast.orderBy.push({ type: 'orderBy', field, direction });
    return this;
  }

  limit(count: number): TypedOrmBuilder<TContract, TParent, TRow> {
    this.ast.limit = { type: 'limit', count };
    return this;
  }

  include(
    handle: any,
    build: (qb: any) => any,
    opts?: { asArray?: boolean; alias?: string; required?: boolean },
  ): TypedOrmBuilder<TContract, TParent, any> {
    const childBuilder = new TypedChildQB(handle.child, this.ir);
    const childBuilt = build(childBuilder as any);

    const mode =
      (opts?.asArray ?? (handle.cardinality === '1:N' ? true : false)) ? 'nested' : 'flat';

    this.ast.includes = this.ast.includes ?? [];
    this.ast.includes.push({
      kind: 'Include',
      relation: handle as any,
      alias: opts?.alias ?? String(handle.alias),
      mode,
      child: childBuilt.getAst(),
    });

    return this as any;
  }

  build(): Plan<NonEmpty<TRow>> {
    // 1. ORM AST complete
    // 2. Lower to base QueryAST
    const baseAst = lowerRelations(this.ast, this.ir);
    // 3. Compile to SQL
    const { sql, params } = compileToSQL(baseAst);
    // 4. Build Plan
    return {
      ast: baseAst,
      sql,
      params,
      meta: {
        contractHash: this.ast.contractHash || '',
        target: 'postgres',
        refs: {
          tables: [this.ast.from],
          columns: [],
        },
      },
    } as Plan<NonEmpty<TRow>>;
  }
}

// ============================================================================
// Type-safe ORM Factory
// ============================================================================

export type TypedOrmFactory<TContract extends Contract> = {
  from<TParent extends keyof TContract['Tables'] & string>(
    table: Table<any>,
  ): TypedOrmBuilder<TContract, TParent>;
} & RelationHandles<TContract['Relations']>;
