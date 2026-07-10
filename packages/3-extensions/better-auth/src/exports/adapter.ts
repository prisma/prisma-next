export type {
  AdapterAggregateBuilder,
  AdapterCollection,
  AdapterFieldComparators,
  AdapterModelAccessor,
  AdapterRow,
  BetterAuthDb,
  BetterAuthDbCollections,
} from '../adapter/db-surface';
export { PrismaNextAdapterError, type PrismaNextAdapterErrorCode } from '../adapter/errors';
export { prismaNextAdapter } from '../adapter/index';
export {
  BETTER_AUTH_MODEL_BY_SPACE_MODEL,
  type BetterAuthModelName,
  type SpaceModelName,
  type SpaceModelRelation,
} from '../adapter/model-map';
