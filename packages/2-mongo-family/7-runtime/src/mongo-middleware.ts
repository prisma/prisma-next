import type {
  AfterExecuteResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';

export interface MongoMiddlewareContext extends RuntimeMiddlewareContext {}

export interface MongoMiddleware extends RuntimeMiddleware {
  readonly familyId: 'mongo';
  beforeExecute?(plan: MongoQueryPlan, ctx: MongoMiddlewareContext): Promise<void>;
  onRow?(
    row: Record<string, unknown>,
    plan: MongoQueryPlan,
    ctx: MongoMiddlewareContext,
  ): Promise<void>;
  afterExecute?(
    plan: MongoQueryPlan,
    result: AfterExecuteResult,
    ctx: MongoMiddlewareContext,
  ): Promise<void>;
}
