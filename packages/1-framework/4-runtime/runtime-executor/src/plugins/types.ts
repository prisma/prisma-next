import type { ExecutionPlan } from '@prisma-next/contract/types';
import type {
  AfterExecuteResult,
  RuntimeLog,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';

export type Severity = 'error' | 'warn' | 'info';

export type { AfterExecuteResult, RuntimeLog as Log };

export interface MiddlewareContext<TContract = unknown, TAdapter = unknown, TDriver = unknown>
  extends RuntimeMiddlewareContext {
  readonly contract: TContract;
  readonly adapter: TAdapter;
  readonly driver: TDriver;
}

export interface Middleware<TContract = unknown, TAdapter = unknown, TDriver = unknown> {
  readonly name: string;
  readonly familyId?: string;
  readonly targetId?: string;
  beforeExecute?(
    plan: ExecutionPlan,
    ctx: MiddlewareContext<TContract, TAdapter, TDriver>,
  ): Promise<void>;
  onRow?(
    row: Record<string, unknown>,
    plan: ExecutionPlan,
    ctx: MiddlewareContext<TContract, TAdapter, TDriver>,
  ): Promise<void>;
  afterExecute?(
    plan: ExecutionPlan,
    result: AfterExecuteResult,
    ctx: MiddlewareContext<TContract, TAdapter, TDriver>,
  ): Promise<void>;
}
