import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { Plugin, PluginContext } from '@prisma-next/runtime-executor';
import { evaluateRawGuardrails } from '@prisma-next/runtime-executor';
import {
  type AnyFromSource,
  type AnyQueryAst,
  isQueryAst,
} from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';

export interface LintsOptions {
  readonly severities?: {
    readonly selectStar?: 'warn' | 'error';
    readonly noLimit?: 'warn' | 'error';
    readonly deleteWithoutWhere?: 'warn' | 'error';
    readonly updateWithoutWhere?: 'warn' | 'error';
    readonly readOnlyMutation?: 'warn' | 'error';
    readonly unindexedPredicate?: 'warn' | 'error';
  };
  readonly fallbackWhenAstMissing?: 'raw' | 'skip';
}

export interface LintFinding {
  readonly code: `LINT.${string}`;
  readonly severity: 'error' | 'warn';
  readonly message: string;
  readonly details?: Record<string, unknown>;
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

function getFromSourceTableDetail(source: AnyFromSource): string | undefined {
  switch (source.kind) {
    case 'table-source':
      return source.name;
    case 'derived-table-source':
      return source.alias;
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unsupported source kind: ${(_exhaustive as { kind: string }).kind}`);
    }
  }
}

function evaluateAstLints(ast: AnyQueryAst): LintFinding[] {
  const findings: LintFinding[] = [];

  switch (ast.kind) {
    case 'delete':
      if (ast.where === undefined) {
        findings.push({
          code: 'LINT.DELETE_WITHOUT_WHERE',
          severity: 'error',
          message:
            'DELETE without WHERE clause blocks execution to prevent accidental full-table deletion',
          details: { table: ast.table.name },
        });
      }
      break;

    case 'update':
      if (ast.where === undefined) {
        findings.push({
          code: 'LINT.UPDATE_WITHOUT_WHERE',
          severity: 'error',
          message:
            'UPDATE without WHERE clause blocks execution to prevent accidental full-table update',
          details: { table: ast.table.name },
        });
      }
      break;

    case 'select':
      if (ast.limit === undefined) {
        const table = getFromSourceTableDetail(ast.from);
        findings.push({
          code: 'LINT.NO_LIMIT',
          severity: 'warn',
          message: 'Unbounded SELECT may return large result sets',
          ...ifDefined('details', table !== undefined ? { table } : undefined),
        });
      }
      if (ast.selectAllIntent !== undefined) {
        const table = ast.selectAllIntent.table;
        findings.push({
          code: 'LINT.SELECT_STAR',
          severity: 'warn',
          message: 'Query selects all columns via selectAll intent',
          ...ifDefined('details', table !== undefined ? { table } : undefined),
        });
      }
      break;

    case 'insert':
      break;

    default: {
      const _exhaustive: never = ast;
      throw new Error(`Unsupported AST kind: ${(_exhaustive as { kind: string }).kind}`);
    }
  }

  return findings;
}

function getConfiguredSeverity(code: string, options?: LintsOptions): 'warn' | 'error' | undefined {
  const severities = options?.severities;
  if (!severities) return undefined;

  switch (code) {
    case 'LINT.SELECT_STAR':
      return severities.selectStar;
    case 'LINT.NO_LIMIT':
      return severities.noLimit;
    case 'LINT.DELETE_WITHOUT_WHERE':
      return severities.deleteWithoutWhere;
    case 'LINT.UPDATE_WITHOUT_WHERE':
      return severities.updateWithoutWhere;
    case 'LINT.READ_ONLY_MUTATION':
      return severities.readOnlyMutation;
    case 'LINT.UNINDEXED_PREDICATE':
      return severities.unindexedPredicate;
    default:
      return undefined;
  }
}

/**
 * AST-first lint plugin for SQL plans. When `plan.ast` is a SQL QueryAst, inspects
 * the AST structurally. When `plan.ast` is missing, falls back to raw heuristic
 * guardrails or skips linting depending on `fallbackWhenAstMissing`.
 *
 * Rules (AST-based):
 * - DELETE without WHERE: blocks execution (configurable severity, default error)
 * - UPDATE without WHERE: blocks execution (configurable severity, default error)
 * - Unbounded SELECT: warn/error (severity from noLimit)
 * - SELECT * intent: warn/error (severity from selectStar)
 *
 * Fallback: When ast is missing, `fallbackWhenAstMissing: 'raw'` uses heuristic
 * SQL parsing; `'skip'` skips all lints. Default is `'raw'`.
 */
export function lints<TContract = unknown, TAdapter = unknown, TDriver = unknown>(
  options?: LintsOptions,
): Plugin<TContract, TAdapter, TDriver> {
  const fallback = options?.fallbackWhenAstMissing ?? 'raw';

  return Object.freeze({
    name: 'lints',

    async beforeExecute(plan: ExecutionPlan, ctx: PluginContext<TContract, TAdapter, TDriver>) {
      if (isQueryAst(plan.ast)) {
        const findings = evaluateAstLints(plan.ast);

        for (const lint of findings) {
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
        return;
      }

      if (fallback === 'skip') {
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
