import { Column, Table, Plan } from '@prisma/sql';

export type TableHandle<TName extends string, TCols extends Record<string, any>> = {
  name: TName;
} & {
  [K in keyof TCols & string]: Column<TName, K, any>;
};

// ============================================================================
// Relation Handle Types from Contract.Relations
// ============================================================================

type Cardinality = '1:N' | 'N:1';

// Forward declare the Contract types - these will be populated by the global namespace
type Tables = any;
type Relations = any;

export type RelationHandle<
  P extends keyof Relations & string,
  K extends keyof Relations[P] & string,
  C extends Relations[P][K]['cardinality'] = Relations[P][K]['cardinality'],
  To extends Relations[P][K]['to'] = Relations[P][K]['to'],
> = {
  parent: P; // e.g., 'user'
  child: To; // e.g., 'post'
  cardinality: C; // '1:N' | 'N:1'
  alias: K; // relation property name, e.g., 'post' or 'user'
  on: Relations[P][K]['on']; // join keys
};

// Helper to shape the whole r object from Relations
export type RelationHandles<R extends Relations> = {
  [P in keyof R & string]: {
    [K in keyof R[P] & string]: RelationHandle<P, K>;
  };
};

// ============================================================================
// Projection Typing (select columns → row type)
// ============================================================================

type Projection<TCols extends Record<string, Column<any, any, any>>> = TCols;

export type RowOfProjection<P extends Projection<any>> = {
  [K in keyof P & string]: P[K] extends Column<any, any, infer T> ? T : never;
};

// Merge helper
export type Merge<A, B> = Omit<A, keyof B> & B;
export type NonEmpty<T> = keyof T extends never ? never : T;

// ============================================================================
// Include Result Types
// ============================================================================

export type IncludeResult<C extends Cardinality, Alias extends string, ChildRow> = C extends '1:N'
  ? { [A in Alias]: ChildRow[] }
  : { [A in Alias]: ChildRow | null };

// For N:1, hide limit/orderBy at type level
export type GateCardinality<C extends Cardinality, QB extends ChildQB<any, any>> = C extends 'N:1'
  ? Omit<QB, 'limit' | 'orderBy'>
  : QB;

// ============================================================================
// Query Builder Types
// ============================================================================

export class BaseQB<TFrom extends keyof Tables & string, TRow extends Record<string, any> = {}> {
  constructor(readonly from: TFrom) {}

  select<P extends Projection<Record<string, Column<TFrom, any, any>>>>(
    p: P,
  ): BaseQB<TFrom, Merge<TRow, RowOfProjection<P>>> {
    // record select for AST...
    return this as any;
  }

  where(_pred: any): this {
    return this;
  } // can tighten later
  orderBy(_spec: any): this {
    return this;
  }
  limit(_n: number): this {
    return this;
  }

  build(): Plan<NonEmpty<TRow>> {
    /* ... */ return {} as any;
  }
}

export class ChildQB<
  TChild extends keyof Tables & string,
  TChildRow extends Record<string, any> = {},
> {
  constructor(readonly child: TChild) {}

  select<P extends Projection<Record<string, Column<TChild, any, any>>>>(
    p: P,
  ): ChildQB<TChild, Merge<TChildRow, RowOfProjection<P>>> {
    return this as any;
  }

  where(_pred: any): this {
    return this;
  }
  orderBy(_spec: any): this {
    return this;
  }
  limit(_n: number): this {
    return this;
  }

  // type witness (no runtime)
  _row(): TChildRow {
    return {} as any;
  }
}

export class OrmQB<
  TFrom extends keyof Tables & string,
  TRow extends Record<string, any> = {},
> extends BaseQB<TFrom, TRow> {
  include(handle: any, build: (qb: any) => any): OrmQB<TFrom, any> {
    // capture IncludeNode + child AST…
    return this as any;
  }
}

// ============================================================================
// Factory Types
// ============================================================================

export type OrmHandles = RelationHandles<Relations>;

export function orm(irJson: unknown): OrmHandles & {
  from<T extends keyof Tables & string>(table: TableHandle<T, Tables[T]>): OrmQB<T, {}>;
} {
  // runtime: build handles from JSON IR (FKs → handles with alias/cardinality)
  // return object satisfying the OrmHandles mapping + .from()
  return {} as any;
}

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
