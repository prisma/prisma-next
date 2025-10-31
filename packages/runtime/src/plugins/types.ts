import type { DataContract, Plan } from '@prisma-next/sql/types';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql/types';
import type { SqlDriver } from '@prisma-next/sql-target';

export type Severity = 'error' | 'warn' | 'info';

export interface Log {
  info(event: unknown): void;
  warn(event: unknown): void;
  error(event: unknown): void;
}

export interface PluginContext {
  readonly contract: DataContract;
  readonly adapter: Adapter<SelectAst, DataContract, LoweredStatement>;
  readonly driver: SqlDriver;
  readonly mode: 'strict' | 'permissive';
  readonly now: () => number;
  readonly log: Log;
}

export interface AfterExecuteResult {
  readonly rowCount: number;
  readonly latencyMs: number;
  readonly completed: boolean;
}

export interface Plugin {
  readonly name: string;
  beforeExecute?(plan: Plan, ctx: PluginContext): Promise<void>;
  onRow?(row: Record<string, any>, plan: Plan, ctx: PluginContext): Promise<void>;
  afterExecute?(plan: Plan, result: AfterExecuteResult, ctx: PluginContext): Promise<void>;
}
