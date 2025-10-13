import { Schema } from '@prisma/relational-ir';
import { Plan } from '@prisma/sql';

export interface QueryResult {
  rows: any[];
  rowCount: number;
}

export interface QueryMetrics {
  durationMs: number;
  rowCount: number;
}

export interface RuntimeConfig {
  verify?: 'onFirstUse' | 'never';
  [key: string]: any;
}

export interface BeforeExecuteContext {
  plan: Plan;
  ir: Schema;
  config: RuntimeConfig;
}

export interface AfterExecuteContext {
  plan: Plan;
  result: QueryResult;
  metrics: QueryMetrics;
  ir: Schema;
}

export interface ErrorContext {
  plan?: Plan;
  error: unknown;
  ir: Schema;
}

export interface RuntimePlugin {
  beforeExecute?(ctx: BeforeExecuteContext): void | Promise<void>;
  afterExecute?(ctx: AfterExecuteContext): void | Promise<void>;
  onError?(ctx: ErrorContext): void | Promise<void>;
}
