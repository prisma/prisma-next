// Main ORM exports
export { orm } from '../relations/factory';
export type { OrmFactory } from '../relations/factory';
export type { OrmBuilder, OrmQueryBuilder, IncludeOptions } from '../relations/builder';
export type { OrmQueryAST, IncludeNode } from '../ast/types';

// Type-safe exports
export type { TypedOrmFactory, TypedOrmBuilder, TypedChildQB } from '../typed-builder';

// Import Column from SQL package
export type { Column } from '@prisma/sql';

// New type-safe types
export type {
  TableHandle,
  RelationHandle,
  RelationHandles,
  RowOfProjection,
  Merge,
  NonEmpty,
  IncludeResult,
  GateCardinality,
  BaseQB,
  ChildQB,
  OrmQB,
  OrmHandles,
} from '../types';

// Lowering exports
export { lowerRelations } from '../lowering/lower-relations';
export { lowererRegistry } from '../lowering/registry';
export type { RelationsLowerer, LowerContext } from '../lowering/types';
