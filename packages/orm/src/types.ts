import { Column, Table } from '@prisma/sql';

// Base table shape types
export type TableShape<T extends string> = T extends keyof Contract.Tables ? Contract.Tables[T] : never;

// Relation metadata types
export type RelationMeta<T extends string, K extends string> = 
  T extends keyof Contract.Relations 
    ? K extends keyof Contract.Relations[T]
      ? Contract.Relations[T][K]
      : never
    : never;

// Result type inference helpers
export type InferSelect<T> = T extends Record<string, Column<infer U>> ? U : never;

export type InferInclude<T, R extends RelationMeta<any, any>> = 
  R['cardinality'] extends '1:N' 
    ? InferSelect<T>[]
    : InferSelect<T>;

// Include options with proper typing
export interface IncludeOptions<T, R extends RelationMeta<any, any>> {
  asArray?: R['cardinality'] extends '1:N' ? boolean : never;
  alias?: string;
  required?: boolean;
}

// Result type for queries with includes
export type QueryResult<
  TSelect extends Record<string, Column<any>>,
  TIncludes extends Record<string, any> = {}
> = InferSelect<TSelect> & TIncludes;

// Relation builder type - this should be the same as the main builder but scoped to the child table
export type RelationBuilder<TChild extends string> = {
  select<TSelect extends Record<string, Column<any>>>(
    fields: TSelect
  ): RelationBuilder<TChild> & { getAst(): any };
  where(condition: any): RelationBuilder<TChild>;
  orderBy(field: string, direction?: 'ASC' | 'DESC'): RelationBuilder<TChild>;
  limit(count: number): RelationBuilder<TChild>;
  getAst(): any;
};

// Main ORM builder with proper typing
export type OrmBuilderTyped<TParent extends string> = {
  select<TSelect extends Record<string, Column<any>>>(
    fields: TSelect
  ): OrmBuilderTyped<TParent> & {
    build(): { ast: any; sql: string; params: any[]; meta: any };
  };
  where(condition: any): OrmBuilderTyped<TParent>;
  orderBy(field: string, direction?: 'ASC' | 'DESC'): OrmBuilderTyped<TParent>;
  limit(count: number): OrmBuilderTyped<TParent>;
  include<
    TRelation extends string,
    TChild extends RelationMeta<TParent, TRelation>['to'],
    TChildSelect extends Record<string, Column<any>>
  >(
    relation: RelationHandle<TParent, TRelation>,
    buildChild: (qb: RelationBuilder<TChild>) => RelationBuilder<TChild> & { getAst(): any },
    opts?: IncludeOptions<TChildSelect, RelationMeta<TParent, TRelation>>
  ): OrmBuilderTyped<TParent> & {
    build(): { 
      ast: any; 
      sql: string; 
      params: any[]; 
      meta: any;
      // This would ideally include the result type, but TypeScript limitations make this complex
    };
  };
  build(): { ast: any; sql: string; params: any[]; meta: any };
};

// Relation handle with proper typing
export interface RelationHandle<TParent extends string, TRelation extends string> {
  parent: TParent;
  child: RelationMeta<TParent, TRelation>['to'];
  cardinality: RelationMeta<TParent, TRelation>['cardinality'];
  on: RelationMeta<TParent, TRelation>['on'];
  name: TRelation;
}

// ORM factory with proper typing
export type OrmFactoryTyped = {
  from<T extends keyof Contract.Tables>(table: Table<Contract.Tables[T]>): OrmBuilderTyped<T>;
  [K in keyof Contract.Relations]: {
    [R in keyof Contract.Relations[K]]: RelationHandle<K, R>;
  };
};

// Import the generated contract types
declare global {
  namespace Contract {
    interface Tables {
      user: {
        id: number;
        email: string;
        active: boolean;
        createdAt: Date;
      };
      post: {
        id: number;
        title: string;
        published: boolean;
        createdAt: Date;
        user_id: number;
      };
    }

    interface Relations {
      user: {
        post: {
          to: 'post';
          cardinality: '1:N';
          on: { parentCols: ['id']; childCols: ['user_id'] };
        };
      };
      post: {
        user: {
          to: 'user';
          cardinality: 'N:1';
          on: { parentCols: ['user_id']; childCols: ['id'] };
        };
      };
    }

    interface Uniques {
      user: ['id'] | ['email'];
      post: ['id'];
    }
  }
}
