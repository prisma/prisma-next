import type {
  AfterExecuteResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import type { MongoExecutionPlan } from './mongo-execution-plan';
import type { MongoParamRefMutator } from './mongo-param-ref-mutator';

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
 *
 * `beforeExecute` accepts an additive third {@link MongoParamRefMutator}
 * argument matching the SQL family's seam (AC-FAM1). Existing 2-arg
 * middleware bodies remain valid — TypeScript permits assigning a
 * function with fewer parameters to a function-typed slot that declares
 * more.
 */
export interface MongoMiddleware<
  TCodecMap extends Record<string, unknown> = Record<string, unknown>,
> extends RuntimeMiddleware<MongoExecutionPlan, MongoParamRefMutator<TCodecMap>> {
  readonly familyId?: 'mongo';
  beforeExecute?(
    plan: MongoExecutionPlan,
    ctx: MongoMiddlewareContext,
    params?: MongoParamRefMutator<TCodecMap>,
  ): void | Promise<void>;
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
