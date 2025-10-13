import { Schema } from '@prisma/relational-ir';
import { Plan } from '@prisma/sql';
import { DatabaseConnection } from './connection';

export interface QueryResult {
  rows: any[];
  rowCount: number;
}

export interface QueryMetrics {
  durationMs: number;
  rowCount: number;
}

export interface RuntimeConfig {
  [key: string]: any;
}

export interface BeforeExecuteContext {
  plan: Plan;
  ir: Schema;
  config: RuntimeConfig;
  driver: DatabaseConnection;
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
