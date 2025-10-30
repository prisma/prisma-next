export type Severity = 'error' | 'warn' | 'info';

export interface Log {
  info(event: unknown): void;
  warn(event: unknown): void;
  error(event: unknown): void;
}

export interface PluginContext {
  readonly contract: unknown;
  readonly adapter: unknown;
  readonly driver: unknown;
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
  beforeExecute?(plan: unknown, ctx: PluginContext): Promise<void>;
  onRow?(row: unknown, plan: unknown, ctx: PluginContext): Promise<void>;
  afterExecute?(plan: unknown, result: AfterExecuteResult, ctx: PluginContext): Promise<void>;
}
