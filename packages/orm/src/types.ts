import { Column, Table, Plan } from '@prisma/sql';
import { Contract } from '@prisma/relational-ir';

export type TableHandle<TName extends string, TCols extends Record<string, any>> = {
  name: TName;
} & {
  [K in keyof TCols & string]: Column<TName, K, any>;
};

// ============================================================================
// Relation Handle Types from Contract.Relations
// ============================================================================

type Cardinality = '1:N' | 'N:1';

export type RelationHandle<
  TContract extends Contract,
  P extends keyof TContract['Relations'] & string,
  K extends keyof TContract['Relations'][P] & string,
  C extends
    TContract['Relations'][P][K]['cardinality'] = TContract['Relations'][P][K]['cardinality'],
  To extends TContract['Relations'][P][K]['to'] = TContract['Relations'][P][K]['to'],
> = {
  parent: P; // e.g., 'user'
  child: To; // e.g., 'post'
  cardinality: C; // '1:N' | 'N:1'
  alias: K; // relation property name, e.g., 'post' or 'user'
  on: TContract['Relations'][P][K]['on']; // join keys
};

// Helper to shape the whole r object from Relations
export type RelationHandles<TContract extends Contract> = {
  [P in keyof TContract['Relations'] & string]: {
    [K in keyof TContract['Relations'][P] & string]: RelationHandle<TContract, P, K>;
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
export type GateCardinality<C extends Cardinality, QB> = C extends 'N:1'
  ? Omit<QB, 'limit' | 'orderBy'>
  : QB;

// ============================================================================
// Query Builder Types
// ============================================================================

export class BaseQB<
  TContract extends Contract,
  TFrom extends keyof TContract['Tables'] & string,
  TRow extends Record<string, any> = {},
> {
  constructor(readonly from: TFrom) {}

  select<P extends Projection<Record<string, Column<TFrom, any, any>>>>(
    p: P,
  ): BaseQB<TContract, TFrom, Merge<TRow, RowOfProjection<P>>> {
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
  TContract extends Contract,
  TChild extends keyof TContract['Tables'] & string,
  TChildRow extends Record<string, any> = {},
> {
  constructor(readonly child: TChild) {}

  select<P extends Projection<Record<string, Column<TChild, any, any>>>>(
    p: P,
  ): ChildQB<TContract, TChild, Merge<TChildRow, RowOfProjection<P>>> {
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
  TContract extends Contract,
  TFrom extends keyof TContract['Tables'] & string,
  TRow extends Record<string, any> = {},
> extends BaseQB<TContract, TFrom, TRow> {
  include<
    K extends keyof TContract['Relations'][TFrom] & string,
    C extends TContract['Relations'][TFrom][K]['cardinality'],
    To extends TContract['Relations'][TFrom][K]['to'],
    Handle extends RelationHandle<TContract, TFrom, K, C, To>,
    CQ extends ChildQB<TContract, To, any>,
  >(
    handle: Handle,
    build: (qb: GateCardinality<C, ChildQB<TContract, To, {}>>) => CQ,
  ): OrmQB<
    TContract,
    TFrom,
    Merge<TRow, IncludeResult<C, Handle['alias'], ReturnType<CQ['_row']>>>
  > {
    // capture IncludeNode + child AST…
    return this as any;
  }
}

// ============================================================================
// Factory Types
// ============================================================================

export type OrmHandles<TContract extends Contract> = RelationHandles<TContract>;

export function orm<TContract extends Contract>(
  irJson: unknown,
): OrmHandles<TContract> & {
  from<T extends keyof TContract['Tables'] & string>(
    table: TableHandle<T, TContract['Tables'][T]>,
  ): OrmQB<TContract, T, {}>;
} {
  // runtime: build handles from JSON IR (FKs → handles with alias/cardinality)
  // return object satisfying the OrmHandles mapping + .from()
  return {} as any;
}
