import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { PostgresPlanTargetDetails } from '@prisma-next/target-postgres/planner-target-details';

/**
 * Postgres-flavoured migration `Op` shape: a `SqlMigrationPlanOperation`
 * specialised to `PostgresPlanTargetDetails`. The public migration
 * surface (`@prisma-next/target-postgres/migration`) re-exports
 * factories that produce values of this type but does not re-export
 * the type alias itself, so we redeclare it locally rather than
 * deep-import. (R-FM-7 — public surface only.)
 */
export type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/**
 * RLS migration operation factories — STUB for T1.4 (tests-first).
 *
 * Real implementation lands in T1.5 (`projects/supabase-poc/plan.md`
 * § Milestone 1) and is what makes `test/migrations/rls-ops.test.ts`
 * pass. Until then every export throws so the spec fails loudly,
 * making the tests-first ordering observable in the commit history
 * (R-NF-4).
 */

const NOT_IMPLEMENTED = 'rls-ops: not implemented yet (lands in T1.5)';

export function enableRowLevelSecurity(_schema: string, _table: string): Op {
  throw new Error(NOT_IMPLEMENTED);
}

export interface CreateRlsPolicySpec {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly command?: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  readonly permissive?: 'PERMISSIVE' | 'RESTRICTIVE';
  readonly to?: ReadonlyArray<string>;
  readonly using?: string;
  readonly withCheck?: string;
}

export function createRlsPolicy(_spec: CreateRlsPolicySpec): Op {
  throw new Error(NOT_IMPLEMENTED);
}

export function dropRlsPolicy(_schema: string, _table: string, _name: string): Op {
  throw new Error(NOT_IMPLEMENTED);
}
