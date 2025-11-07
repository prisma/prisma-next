import type { Plan } from '@prisma-next/contract/types';
import { evaluateRawGuardrails } from '../guardrails/raw';
import type { Plugin, PluginContext } from './types';

export interface LintsOptions {
  readonly severities?: {
    readonly selectStar?: 'warn' | 'error';
    readonly noLimit?: 'warn' | 'error';
    readonly readOnlyMutation?: 'warn' | 'error';
    readonly unindexedPredicate?: 'warn' | 'error';
  };
}

function lintError(code: string, message: string, details?: Record<string, unknown>) {
  const error = new Error(message) as Error & {
    code: string;
    category: 'LINT';
    severity: 'error';
    details?: Record<string, unknown>;
  };
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });
  return Object.assign(error, {
    code,
    category: 'LINT' as const,
    severity: 'error' as const,
    details,
  });
}

export function lints(options?: LintsOptions): Plugin {
  return Object.freeze({
    name: 'lints',

    async beforeExecute(plan: Plan, ctx: PluginContext) {
      // Only evaluate guardrails for plans without AST (raw plans)
      if (plan.ast) {
        return;
      }

      const evaluation = evaluateRawGuardrails(plan);

      for (const lint of evaluation.lints) {
        const configuredSeverity = getConfiguredSeverity(lint.code, options);
        const effectiveSeverity = configuredSeverity ?? lint.severity;

        if (effectiveSeverity === 'error') {
          throw lintError(lint.code, lint.message, lint.details);
        }
        if (effectiveSeverity === 'warn') {
          ctx.log.warn({
            code: lint.code,
            message: lint.message,
            details: lint.details,
          });
        }
      }
    },
  });
}

function getConfiguredSeverity(code: string, options?: LintsOptions): 'warn' | 'error' | undefined {
  const severities = options?.severities;
  if (!severities) {
    return undefined;
  }

  if (code === 'LINT.SELECT_STAR') {
    return severities.selectStar;
  }
  if (code === 'LINT.NO_LIMIT') {
    return severities.noLimit;
  }
  if (code === 'LINT.READ_ONLY_MUTATION') {
    return severities.readOnlyMutation;
  }
  if (code === 'LINT.UNINDEXED_PREDICATE') {
    return severities.unindexedPredicate;
  }

  return undefined;
}
