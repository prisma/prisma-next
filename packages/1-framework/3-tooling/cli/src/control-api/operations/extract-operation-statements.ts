import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { extractSqlDdl } from './extract-sql-ddl';

export function extractOperationStatements(
  familyId: string,
  operations: readonly MigrationPlanOperation[],
): string[] | undefined {
  switch (familyId) {
    case 'sql':
      return extractSqlDdl(operations);
    default:
      return undefined;
  }
}
