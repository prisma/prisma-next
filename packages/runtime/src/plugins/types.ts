import type { SqlContract, SqlStorage } from '@prisma-next/sql/contract-types';
import type { Plan, Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql/types';
import type { SqlDriver } from '@prisma-next/sql-target';

export type Severity = 'error' | 'warn' | 'info';

export interface Log {
  info(event: unknown): void;
  warn(event: unknown): void;
  error(event: unknown): void;
}

export interface PluginContext {
  readonly contract: SqlContract<SqlStorage>;
  readonly adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>;
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
  onRow?(row: Record<string, unknown>, plan: Plan, ctx: PluginContext): Promise<void>;
  afterExecute?(plan: Plan, result: AfterExecuteResult, ctx: PluginContext): Promise<void>;
}
