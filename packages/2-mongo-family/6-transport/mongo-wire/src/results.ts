/**
 * Re-export canonical command result types from the query layer.
 *
 * The result shape definitions live in `@prisma-next/mongo-query-ast`
 * because they are part of the primitive language — the transport layer
 * satisfies those interfaces, it does not define them.
 */
export type {
  DeleteManyResult,
  DeleteOneResult,
  InsertManyResult,
  InsertOneResult,
  UpdateManyResult,
  UpdateOneResult,
} from '@prisma-next/mongo-query-ast/execution';
