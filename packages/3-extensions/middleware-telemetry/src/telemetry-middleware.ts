import type { PlanMeta } from '@prisma-next/contract/types';
import type {
  AfterExecuteResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';

export interface TelemetryEvent {
  readonly phase: 'beforeExecute' | 'afterExecute';
  readonly lane: string;
  readonly target: string;
  readonly storageHash: string;
  readonly rowCount?: number;
  readonly latencyMs?: number;
  readonly completed?: boolean;
  /**
   * Where the rows came from. Only set on `afterExecute` events; `'driver'`
   * means the underlying driver served the query, `'middleware'` means a
   * `RuntimeMiddleware.intercept` hook short-circuited execution and
   * supplied the rows directly. Mirrors `AfterExecuteResult.source`.
   */
  readonly source?: 'driver' | 'middleware';
}

export interface TelemetryMiddlewareOptions {
  readonly onEvent?: (event: TelemetryEvent) => void;
}

export function createTelemetryMiddleware(
  options?: TelemetryMiddlewareOptions,
): RuntimeMiddleware & { readonly familyId?: undefined; readonly targetId?: undefined } {
  const emit = (event: TelemetryEvent, ctx: RuntimeMiddlewareContext) => {
    try {
      if (options?.onEvent) {
        options.onEvent(event);
      } else {
        ctx.log.info(event);
      }
    } catch (error) {
      ctx.log.warn({ message: 'telemetry sink error', error, event });
    }
  };

  return {
    name: 'telemetry',
    async beforeExecute(plan: { readonly meta: PlanMeta }, ctx: RuntimeMiddlewareContext) {
      emit(
        {
          phase: 'beforeExecute',
          lane: plan.meta.lane,
          target: plan.meta.target,
          storageHash: plan.meta.storageHash,
        },
        ctx,
      );
    },
    async afterExecute(
      plan: { readonly meta: PlanMeta },
      result: AfterExecuteResult,
      ctx: RuntimeMiddlewareContext,
    ) {
      emit(
        {
          phase: 'afterExecute',
          lane: plan.meta.lane,
          target: plan.meta.target,
          storageHash: plan.meta.storageHash,
          rowCount: result.rowCount,
          latencyMs: result.latencyMs,
          completed: result.completed,
          source: result.source,
        },
        ctx,
      );
    },
  };
}
