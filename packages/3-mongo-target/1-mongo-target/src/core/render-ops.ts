import type { MongoMigrationPlanOperation } from '@prisma-next/mongo-query-ast/control';
import type { OpFactoryCall } from './op-factory-call';

export function renderOps(calls: ReadonlyArray<OpFactoryCall>): MongoMigrationPlanOperation[] {
  return calls.map((call) => call.toOp());
}
