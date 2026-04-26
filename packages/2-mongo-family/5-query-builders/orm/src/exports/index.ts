// Re-exported so facade packages (e.g. `@prisma-next/mongo`) can plumb the
// executor signature without a direct dep on `@prisma-next/mongo-query-ast`.
export type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
export type { SimplifyDeep } from '@prisma-next/utils/simplify-deep';
export type { MongoCollection } from '../collection';
export { createMongoCollection } from '../collection';
export { compileMongoQuery } from '../compile';
export type { MongoQueryExecutor } from '../executor';
export type {
  DotPath,
  FieldAccessor,
  FieldExpression,
  FieldOperation,
  ResolveDotPathType,
  UpdateOperator,
} from '../field-accessor';
export { createFieldAccessor } from '../field-accessor';
export type { MongoOrmClient, MongoOrmOptions } from '../mongo-orm';
export { mongoOrm } from '../mongo-orm';
export type { MongoRawClient } from '../mongo-raw';
export { mongoRaw } from '../mongo-raw';
export type { RawMongoCollection } from '../raw-collection';
export type {
  CreateInput,
  DefaultModelRow,
  IncludedRow,
  IncludeResultFields,
  InferFullRow,
  InferRootRow,
  MongoIncludeSpec,
  MongoWhereFilter,
  NoIncludes,
  ResolvedCreateInput,
  VariantCreateInput,
  VariantModelRow,
  VariantNames,
} from '../types';
