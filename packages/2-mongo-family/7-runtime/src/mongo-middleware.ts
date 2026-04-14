import type {
  AfterExecuteResult,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import type { MongoAdapter, MongoDriver } from '@prisma-next/mongo-lowering';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';

export interface MongoMiddlewareContext extends RuntimeMiddlewareContext {
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
}

export interface MongoMiddleware {
  readonly name: string;
  readonly familyId: 'mongo';
  readonly targetId?: string;
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
