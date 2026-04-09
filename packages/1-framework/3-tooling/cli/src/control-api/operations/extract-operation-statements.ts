import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { extractMongoStatements } from './extract-mongo-statements';
import { extractSqlDdl } from './extract-sql-ddl';

export function extractOperationStatements(
  familyId: string,
  operations: readonly MigrationPlanOperation[],
): string[] | undefined {
  switch (familyId) {
    case 'sql':
      return extractSqlDdl(operations);
    case 'mongo':
      return extractMongoStatements(operations);
    default:
      return undefined;
  }
}
