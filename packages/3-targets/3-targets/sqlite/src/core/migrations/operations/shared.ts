import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { SqlitePlanTargetDetails } from '../planner-target-details';

export type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

export function step(description: string, sql: string): { description: string; sql: string } {
  return { description, sql };
}

export function esc(value: string): string {
  return value.replace(/'/g, "''");
}
