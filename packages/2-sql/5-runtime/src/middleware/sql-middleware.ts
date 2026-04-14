import type { Contract, ExecutionPlan } from '@prisma-next/contract/types';
import type {
  AfterExecuteResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';

export interface SqlMiddlewareContext extends RuntimeMiddlewareContext {
  readonly contract: Contract<SqlStorage>;
}

export interface SqlMiddleware extends RuntimeMiddleware {
  readonly familyId: 'sql';
  beforeExecute?(plan: ExecutionPlan, ctx: SqlMiddlewareContext): Promise<void>;
  onRow?(
    row: Record<string, unknown>,
    plan: ExecutionPlan,
    ctx: SqlMiddlewareContext,
  ): Promise<void>;
  afterExecute?(
    plan: ExecutionPlan,
    result: AfterExecuteResult,
    ctx: SqlMiddlewareContext,
  ): Promise<void>;
}
