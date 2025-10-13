// Main ORM exports
export { orm } from '../relations/factory';
export type { OrmFactory } from '../relations/factory';
export type { OrmBuilder, OrmQueryBuilder, IncludeOptions } from '../relations/builder';
export type { RelationHandle } from '../relations/handles';
export type { OrmQueryAST, IncludeNode } from '../ast/types';

// Lowering exports
export { lowerRelations } from '../lowering/lower-relations';
export { lowererRegistry } from '../lowering/registry';
export type { RelationsLowerer, LowerContext } from '../lowering/types';
