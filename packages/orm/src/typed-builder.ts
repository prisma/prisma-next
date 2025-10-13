import { Schema, RelationGraph, Contract } from '@prisma/relational-ir';
import { Table, Column, FieldExpression, Plan, TABLE_NAME } from '@prisma/sql';
import { OrmQueryAST, IncludeNode, RelationHandle } from './ast/types';
import { lowerRelations } from './lowering/lower-relations';
import { compileToSQL } from '@prisma/sql';

// Type-safe relation handle
export interface TypedRelationHandle<
  TContract extends Contract,
  TParent extends keyof TContract['Tables'],
  TRelation extends keyof TContract['Relations'][TParent],
> {
  parent: TParent;
  child: TContract['Relations'][TParent][TRelation]['to'];
  cardinality: TContract['Relations'][TParent][TRelation]['cardinality'];
  on: TContract['Relations'][TParent][TRelation]['on'];
  name: TRelation;
}

// Type-safe include options
export interface TypedIncludeOptions {
  asArray?: boolean;
  alias?: string;
  required?: boolean;
}

// Type-safe relation builder
export class TypedRelationBuilder<TChild extends string> {
  private ast: OrmQueryAST;
  private ir: Schema;

  constructor(tableName: string, ir: Schema) {
    this.ir = ir;
    this.ast = {
      type: 'select',
      from: tableName,
      projectStar: true,
    };
  }

  select<TSelect extends Record<string, Column<any>>>(
    fields: TSelect,
  ): TypedRelationBuilder<TChild> {
    this.ast.select = {
      type: 'select',
      fields,
    };
    this.ast.projectStar = false;
    return this;
  }

  where(condition: FieldExpression): TypedRelationBuilder<TChild> {
    this.ast.where = { type: 'where', condition };
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): TypedRelationBuilder<TChild> {
    this.ast.orderBy = this.ast.orderBy ?? [];
    this.ast.orderBy.push({ type: 'orderBy', field, direction });
    return this;
  }

  limit(count: number): TypedRelationBuilder<TChild> {
    this.ast.limit = { type: 'limit', count };
    return this;
  }

  getAst(): OrmQueryAST {
    return this.ast;
  }
}

// Type-safe ORM builder
export class TypedOrmBuilder<
  TContract extends Contract,
  TParent extends keyof TContract['Tables'],
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

  include(
    relation: TypedRelationHandle<TContract, TParent, any>,
    buildChild: (qb: TypedRelationBuilder<any>) => TypedRelationBuilder<any>,
    opts?: TypedIncludeOptions,
  ): TypedOrmBuilder<TContract, TParent> {
    const childBuilder = new TypedRelationBuilder(relation.child, this.ir);
    const childBuilt = buildChild(childBuilder);

    const mode =
      (opts?.asArray ?? (relation.cardinality === '1:N' ? true : false)) ? 'nested' : 'flat';

    this.ast.includes = this.ast.includes ?? [];
    this.ast.includes.push({
      kind: 'Include',
      relation: relation as RelationHandle,
      alias: opts?.alias ?? String(relation.name),
      mode,
      child: childBuilt.getAst(),
    });

    return this;
  }

  select<TSelect extends Record<string, Column<any>>>(
    fields: TSelect,
  ): TypedOrmBuilder<TContract, TParent> & {
    build(): Plan;
  } {
    this.ast.select = {
      type: 'select',
      fields,
    };
    this.ast.projectStar = false;
    return this as any;
  }

  where(condition: FieldExpression): TypedOrmBuilder<TContract, TParent> {
    this.ast.where = { type: 'where', condition };
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): TypedOrmBuilder<TContract, TParent> {
    this.ast.orderBy = this.ast.orderBy ?? [];
    this.ast.orderBy.push({ type: 'orderBy', field, direction });
    return this;
  }

  limit(count: number): TypedOrmBuilder<TContract, TParent> {
    this.ast.limit = { type: 'limit', count };
    return this;
  }

  build(): Plan {
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
    };
  }
}

// Type-safe ORM factory
export type TypedOrmFactory<TContract extends Contract> = {
  from<TParent extends keyof TContract['Tables']>(
    table: Table<any>,
  ): TypedOrmBuilder<TContract, TParent>;
} & {
  [K in keyof TContract['Relations']]: {
    [R in keyof TContract['Relations'][K]]: TypedRelationHandle<TContract, K, R>;
  };
};
