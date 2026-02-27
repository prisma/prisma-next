import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';

function isDdlStatement(sqlStatement: string): boolean {
  const trimmed = sqlStatement.trim().toLowerCase();
  return (
    trimmed.startsWith('create ') || trimmed.startsWith('alter ') || trimmed.startsWith('drop ')
  );
}

export function extractSqlDdl(operations: readonly MigrationPlanOperation[]): string[] {
  const statements: string[] = [];
  for (const operation of operations) {
    const record = operation as unknown as Record<string, unknown>;
    const execute = record['execute'];
    if (!Array.isArray(execute)) {
      continue;
    }
    for (const step of execute) {
      if (typeof step !== 'object' || step === null) {
        continue;
      }
      const sql = (step as Record<string, unknown>)['sql'];
      if (typeof sql !== 'string') {
        continue;
      }
      if (isDdlStatement(sql)) {
        statements.push(sql.trim());
      }
    }
  }
  return statements;
}
