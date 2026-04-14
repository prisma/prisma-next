import type { PlanMeta } from '@prisma-next/contract/types';
import type { AsyncIterableResult } from './async-iterable-result';

export interface RuntimeLog {
  info(event: unknown): void;
  warn(event: unknown): void;
  error(event: unknown): void;
}

export interface RuntimeMiddlewareContext {
  readonly contract: unknown;
  readonly mode: 'strict' | 'permissive';
  readonly now: () => number;
  readonly log: RuntimeLog;
}

export interface AfterExecuteResult {
  readonly rowCount: number;
  readonly latencyMs: number;
  readonly completed: boolean;
}

export interface RuntimeMiddleware {
  readonly name: string;
  readonly familyId?: string;
  readonly targetId?: string;
  beforeExecute?(plan: { readonly meta: PlanMeta }, ctx: RuntimeMiddlewareContext): Promise<void>;
  onRow?(
    row: Record<string, unknown>,
    plan: { readonly meta: PlanMeta },
    ctx: RuntimeMiddlewareContext,
  ): Promise<void>;
  afterExecute?(
    plan: { readonly meta: PlanMeta },
    result: AfterExecuteResult,
    ctx: RuntimeMiddlewareContext,
  ): Promise<void>;
}

/**
 * Cross-family SPI for any runtime that can execute plans and be shut down.
 * Each family runtime (SQL, Mongo) satisfies this interface — SQL nominally,
 * Mongo structurally (due to its phantom Row parameter using a unique symbol).
 *
 * The `_row` intersection on `execute` connects the `Row` type parameter to the
 * plan, mirroring how `ExecutionPlan<Row>` carries a phantom `_row?: Row`.
 */
export interface RuntimeExecutor<TPlan extends { readonly meta: PlanMeta }> {
  execute<Row>(plan: TPlan & { readonly _row?: Row }): AsyncIterableResult<Row>;
  close(): Promise<void>;
}

export function checkMiddlewareCompatibility(
  middleware: RuntimeMiddleware,
  runtimeFamilyId: string,
  runtimeTargetId?: string,
): void {
  if (middleware.targetId !== undefined && middleware.familyId === undefined) {
    throw new Error(
      `Middleware '${middleware.name}' specifies targetId '${middleware.targetId}' without familyId`,
    );
  }

  if (middleware.familyId !== undefined && middleware.familyId !== runtimeFamilyId) {
    throw new Error(
      `Middleware '${middleware.name}' requires family '${middleware.familyId}' but the runtime is configured for family '${runtimeFamilyId}'`,
    );
  }

  if (
    middleware.targetId !== undefined &&
    runtimeTargetId !== undefined &&
    middleware.targetId !== runtimeTargetId
  ) {
    throw new Error(
      `Middleware '${middleware.name}' requires target '${middleware.targetId}' but the runtime is configured for target '${runtimeTargetId}'`,
    );
  }
}
