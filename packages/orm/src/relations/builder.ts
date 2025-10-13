import { Schema, RelationGraph } from '@prisma/relational-ir';
import { Table, Column, FieldExpression, Plan, ContractMismatchMode, TABLE_NAME } from '@prisma/sql';
import { OrmQueryAST, IncludeNode, RelationHandle } from '../ast/types';
import { lowerRelations } from '../lowering/lower-relations';
import { compileToSQL } from '@prisma/sql';

export interface IncludeOptions {
  asArray?: boolean; // true = nested mode (json_agg), false = flat mode
  alias?: string;
  required?: boolean;
}

export class OrmBuilder<Parent> {
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

  include<Child>(
    relation: RelationHandle,
    buildChild: (qb: OrmQueryBuilder<Child>) => OrmQueryBuilder<Child>,
    opts?: IncludeOptions,
  ): this {
    const childBuilder = new OrmQueryBuilder(relation.child, this.ir);
    const childBuilt = buildChild(childBuilder);

    const mode =
      (opts?.asArray ?? (relation.cardinality === '1:N' ? true : false)) ? 'nested' : 'flat';

    this.ast.includes = this.ast.includes ?? [];
    this.ast.includes.push({
      kind: 'Include',
      relation,
      alias: opts?.alias ?? relation.name,
      mode,
      child: childBuilt.getAst(),
    });

    return this;
  }

  select<TSelect extends Record<string, Column<any>>>(
    fields: TSelect,
  ): OrmBuilder<Parent> & {
    build(): Plan;
  } {
    this.ast.select = {
      type: 'select',
      fields,
    };
    this.ast.projectStar = false;
    return this as any;
  }

  where(condition: FieldExpression): OrmBuilder<Parent> {
    this.ast.where = { type: 'where', condition };
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): OrmBuilder<Parent> {
    this.ast.orderBy = this.ast.orderBy ?? [];
    this.ast.orderBy.push({ type: 'orderBy', field, direction });
    return this;
  }

  limit(count: number): OrmBuilder<Parent> {
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

export class OrmQueryBuilder<Child> {
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

  select<TSelect extends Record<string, Column<any>>>(fields: TSelect): OrmQueryBuilder<Child> {
    this.ast.select = {
      type: 'select',
      fields,
    };
    this.ast.projectStar = false;
    return this;
  }

  where(condition: FieldExpression): OrmQueryBuilder<Child> {
    this.ast.where = { type: 'where', condition };
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): OrmQueryBuilder<Child> {
    this.ast.orderBy = this.ast.orderBy ?? [];
    this.ast.orderBy.push({ type: 'orderBy', field, direction });
    return this;
  }

  limit(count: number): OrmQueryBuilder<Child> {
    this.ast.limit = { type: 'limit', count };
    return this;
  }

  getAst(): OrmQueryAST {
    return this.ast;
  }
}
