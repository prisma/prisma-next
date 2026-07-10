export type {
  AdapterAggregateBuilder,
  AdapterCollection,
  AdapterFieldComparators,
  AdapterModelAccessor,
  AdapterRow,
  BetterAuthDb,
} from '../adapter/db-surface';
export { PrismaNextAdapterError, type PrismaNextAdapterErrorCode } from '../adapter/errors';
export { prismaNextAdapter } from '../adapter/index';
export {
  BETTER_AUTH_MODEL_BY_SPACE_MODEL,
  type BetterAuthModelName,
  type SpaceModelName,
} from '../adapter/model-map';
