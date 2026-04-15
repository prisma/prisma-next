import type { PlanMeta } from '@prisma-next/contract/types';
import type {
  AfterExecuteResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from './runtime-middleware';

export interface TelemetryEvent {
  readonly phase: 'beforeExecute' | 'afterExecute';
  readonly lane: string;
  readonly target: string;
  readonly storageHash: string;
  readonly rowCount?: number;
  readonly latencyMs?: number;
  readonly completed?: boolean;
}

export interface TelemetryMiddlewareOptions {
  readonly onEvent?: (event: TelemetryEvent) => void;
}

export function createTelemetryMiddleware(options?: TelemetryMiddlewareOptions): RuntimeMiddleware {
  const emit = (event: TelemetryEvent, ctx: RuntimeMiddlewareContext) => {
    if (options?.onEvent) {
      options.onEvent(event);
    } else {
      ctx.log.info(event);
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
        },
        ctx,
      );
    },
  };
}
