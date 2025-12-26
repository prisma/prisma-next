import type { TableRef } from '@prisma-next/sql-relational-core/ast';
import type {
  AnyBinaryBuilder,
  AnyColumnBuilder,
  AnyOrderBuilder,
  NestedProjection,
} from '@prisma-next/sql-relational-core/types';

export interface RelationFilter {
  relationName: string;
  childModelName: string;
  filterType: 'some' | 'none' | 'every';
  childWhere: AnyBinaryBuilder | undefined;
  relation: {
    to: string;
    cardinality: string;
    on: {
      parentCols: readonly string[];
      childCols: readonly string[];
    };
  };
}

export interface OrmIncludeState {
  relationName: string;
  childModelName: string;
  childTable: TableRef;
  childWhere: AnyBinaryBuilder | undefined;
  childOrderBy: AnyOrderBuilder | undefined;
  childLimit: number | undefined;
  childProjection: Record<string, AnyColumnBuilder | boolean | NestedProjection> | undefined;
  alias: string;
  relation: {
    to: string;
    cardinality: string;
    on: {
      parentCols: readonly string[];
      childCols: readonly string[];
    };
  };
}

export interface OrmBuilderState {
  table: TableRef;
  wherePredicate: AnyBinaryBuilder | undefined;
  relationFilters: RelationFilter[];
  includes: OrmIncludeState[];
  orderByExpr: AnyOrderBuilder | undefined;
  limitValue: number | undefined;
  offsetValue: number | undefined;
  projection: Record<string, AnyColumnBuilder | boolean | NestedProjection> | undefined;
}
