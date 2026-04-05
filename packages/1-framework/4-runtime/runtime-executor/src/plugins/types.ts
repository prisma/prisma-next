import type { ExecutionPlan } from '@prisma-next/contract/types';

export type Severity = 'error' | 'warn' | 'info';

export interface Log {
  info(event: unknown): void;
  warn(event: unknown): void;
  error(event: unknown): void;
}

export interface PluginContext<TContract = unknown, TAdapter = unknown, TDriver = unknown> {
  readonly contract: TContract;
  readonly adapter: TAdapter;
  readonly driver: TDriver;
  readonly mode: 'strict' | 'permissive';
  readonly now: () => number;
  readonly log: Log;
}

export interface AfterExecuteResult {
  readonly rowCount: number;
  readonly latencyMs: number;
  readonly completed: boolean;
}

export interface Plugin<TContract = unknown, TAdapter = unknown, TDriver = unknown> {
  readonly name: string;
  beforeExecute?(
    plan: ExecutionPlan,
    ctx: PluginContext<TContract, TAdapter, TDriver>,
  ): Promise<void>;
  onRow?(
    row: Record<string, unknown>,
    plan: ExecutionPlan,
    ctx: PluginContext<TContract, TAdapter, TDriver>,
  ): Promise<void>;
  afterExecute?(
    plan: ExecutionPlan,
    result: AfterExecuteResult,
    ctx: PluginContext<TContract, TAdapter, TDriver>,
  ): Promise<void>;
}
