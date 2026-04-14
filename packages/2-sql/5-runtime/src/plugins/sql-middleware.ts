import type { ExecutionPlan } from '@prisma-next/contract/types';
import type {
  AfterExecuteResult,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  Adapter,
  Contract,
  LoweredStatement,
  SelectAst,
  SqlDriver,
} from '@prisma-next/sql-relational-core/ast';

export interface SqlMiddlewareContext extends RuntimeMiddlewareContext {
  readonly contract: Contract<SqlStorage>;
  readonly adapter: Adapter<SelectAst, Contract<SqlStorage>, LoweredStatement>;
  readonly driver: SqlDriver<unknown>;
}

export interface SqlMiddleware {
  readonly name: string;
  readonly familyId: 'sql';
  readonly targetId?: string;
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
