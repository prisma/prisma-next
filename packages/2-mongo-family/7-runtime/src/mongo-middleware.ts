import type {
  AfterExecuteResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import type { MongoExecutionPlan } from './mongo-execution-plan';

export interface MongoMiddlewareContext extends RuntimeMiddlewareContext {}

/**
 * Mongo-domain middleware. Extends the framework `RuntimeMiddleware`
 * parameterized over `MongoExecutionPlan` because `runWithMiddleware`
 * (driven by `RuntimeCore`) invokes the lifecycle hooks with the
 * post-lowering plan.
 *
 * `familyId` is optional so generic cross-family middleware (e.g.
 * telemetry) — which carry no `familyId` — remain assignable. When
 * present, it must be `'mongo'`; the runtime rejects mismatches at
 * construction time via `checkMiddlewareCompatibility`.
 */
export interface MongoMiddleware extends RuntimeMiddleware<MongoExecutionPlan> {
  readonly familyId?: 'mongo';
  beforeExecute?(plan: MongoExecutionPlan, ctx: MongoMiddlewareContext): Promise<void>;
  onRow?(
    row: Record<string, unknown>,
    plan: MongoExecutionPlan,
    ctx: MongoMiddlewareContext,
  ): Promise<void>;
  afterExecute?(
    plan: MongoExecutionPlan,
    result: AfterExecuteResult,
    ctx: MongoMiddlewareContext,
  ): Promise<void>;
}
