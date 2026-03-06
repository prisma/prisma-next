import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';

/**
 * Shape of an SQL execute step on SqlMigrationPlanOperation.
 * Used for runtime type narrowing without importing the concrete SQL type.
 */
interface SqlExecuteStep {
  readonly sql: string;
}

function isDdlStatement(sqlStatement: string): boolean {
  const trimmed = sqlStatement.trim().toLowerCase();
  return (
    trimmed.startsWith('create ') || trimmed.startsWith('alter ') || trimmed.startsWith('drop ')
  );
}

function hasExecuteSteps(
  operation: MigrationPlanOperation,
): operation is MigrationPlanOperation & { readonly execute: readonly SqlExecuteStep[] } {
  const candidate = operation as unknown as Record<string, unknown>;
  if (!('execute' in candidate) || !Array.isArray(candidate['execute'])) {
    return false;
  }
  return candidate['execute'].every(
    (step: unknown) => typeof step === 'object' && step !== null && 'sql' in step,
  );
}

/**
 * Extracts a best-effort SQL DDL preview for CLI plan output.
 * This helper is presentation-only and is never used to decide migration correctness.
 */
export function extractSqlDdl(operations: readonly MigrationPlanOperation[]): string[] {
  const statements: string[] = [];
  for (const operation of operations) {
    if (!hasExecuteSteps(operation)) {
      continue;
    }
    for (const step of operation.execute) {
      if (typeof step.sql === 'string' && isDdlStatement(step.sql)) {
        statements.push(step.sql.trim());
      }
    }
  }
  return statements;
}
