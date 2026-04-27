import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import { rawSql } from '@prisma-next/target-postgres/migration';
import type { PostgresPlanTargetDetails } from '@prisma-next/target-postgres/planner-target-details';
import { escapeLiteral, quoteIdentifier } from '@prisma-next/target-postgres/sql-utils';

/**
 * Postgres-flavoured migration `Op` shape: a `SqlMigrationPlanOperation`
 * specialised to `PostgresPlanTargetDetails`. The public migration
 * surface (`@prisma-next/target-postgres/migration`) re-exports
 * factories that produce values of this type but does not re-export
 * the type alias itself, so we redeclare it locally rather than
 * deep-import. (R-FM-7 — public surface only.)
 */
export type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

const IDENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate a Postgres identifier against `^[A-Za-z_][A-Za-z0-9_]*$` and
 * throw synchronously on rejection (R-FM-2). The error message mentions
 * "identifier" so call-sites and tests can pattern-match without coupling
 * to the exact wording.
 *
 * Rationale for this stricter check on top of the underlying
 * `quoteIdentifier`: the postgres `quoteIdentifier` only rejects empty
 * strings and null bytes — it accepts e.g. `'has space'` or `'inj"ect'`
 * by escaping them. RLS authoring is the wrong place for that
 * permissiveness: a stray `"` in a policy name almost always indicates
 * a programming error, and we want it to surface before any SQL is
 * composed rather than as a Postgres syntax error at apply time.
 */
function validateIdent(value: string, slot: string): void {
  if (!IDENT_PATTERN.test(value)) {
    throw new Error(
      `Invalid identifier for ${slot}: ${JSON.stringify(value)} ` +
        `(must match ${IDENT_PATTERN.source})`,
    );
  }
}

function buildTargetDetails(
  schema: string,
  name: string,
  table?: string,
): { readonly id: 'postgres'; readonly details: PostgresPlanTargetDetails } {
  const details: PostgresPlanTargetDetails =
    table === undefined
      ? { schema, objectType: 'dependency', name }
      : { schema, objectType: 'dependency', name, table };
  return { id: 'postgres', details };
}

function step(
  description: string,
  sql: string,
): { readonly description: string; readonly sql: string } {
  return { description, sql };
}

/**
 * Build a `WHERE schemaname = '…' AND tablename = '…' AND policyname = '…'`
 * predicate for `pg_policies`. Schema/table/name are already
 * `validateIdent`-checked at this point; `escapeLiteral` is belt-and-braces
 * so the inlined literals also survive any future identifier-rule loosening.
 *
 * The predicates are inlined as literals (not bound parameters) because the
 * runner executes `step.sql` without out-of-band parameters — see existing
 * factories in `packages/3-targets/.../planner-sql-checks` for the same
 * pattern.
 */
function policyPredicate(schema: string, table: string, name: string): string {
  return (
    `schemaname = '${escapeLiteral(schema)}' ` +
    `AND tablename = '${escapeLiteral(table)}' ` +
    `AND policyname = '${escapeLiteral(name)}'`
  );
}

function rlsPredicate(schema: string, table: string): string {
  return `n.nspname = '${escapeLiteral(schema)}' AND c.relname = '${escapeLiteral(table)}'`;
}

/**
 * `enableRowLevelSecurity('public', 'todos')` →
 * `ALTER TABLE "public"."todos" ENABLE ROW LEVEL SECURITY`.
 *
 * - Precheck:  `pg_class.relrowsecurity = false` (RLS is currently OFF).
 * - Postcheck: `pg_class.relrowsecurity = true`  (RLS is now ON).
 *
 * `target.details.objectType` is `'dependency'` because the
 * `OperationClass` union has no `'policy'` slot; FL-01 documents the
 * limitation.
 */
export function enableRowLevelSecurity(schema: string, table: string): Op {
  validateIdent(schema, 'schema');
  validateIdent(table, 'table');

  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const where = rlsPredicate(schema, table);

  return rawSql({
    id: `enableRowLevelSecurity.${schema}.${table}`,
    label: `Enable RLS on "${table}"`,
    summary: `Enables row-level security on "${schema}"."${table}"`,
    operationClass: 'additive',
    target: buildTargetDetails(schema, table, table),
    precheck: [
      step(
        `ensure RLS is not yet enabled on "${table}"`,
        'SELECT relrowsecurity = false FROM pg_class c ' +
          `JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${where}`,
      ),
    ],
    execute: [
      step(`enable RLS on "${table}"`, `ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY`),
    ],
    postcheck: [
      step(
        `verify RLS is enabled on "${table}"`,
        'SELECT relrowsecurity = true FROM pg_class c ' +
          `JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${where}`,
      ),
    ],
  });
}

/**
 * Spec for `createRlsPolicy`. Mirrors Postgres' `CREATE POLICY` grammar:
 *
 * - `command` defaults to `'ALL'` (R-FM-3); omitting it emits `FOR ALL`.
 * - `to` is a list of role identifiers; omitting it (or passing an empty
 *   array) emits no `TO` clause and the policy applies to PUBLIC.
 * - `permissive` defaults to `'PERMISSIVE'`. The default is left implicit
 *   (matches Postgres' own default), so no `AS PERMISSIVE` is emitted;
 *   `'RESTRICTIVE'` emits `AS RESTRICTIVE`.
 * - `using` and `withCheck` are interpolated **verbatim**, wrapped in
 *   double parens (`USING ((<expr>))`). Authors are responsible for the
 *   safety of expressions they pass in (R-FM-3).
 */
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

export function createRlsPolicy(spec: CreateRlsPolicySpec): Op {
  const { schema, table, name, command, permissive, to, using, withCheck } = spec;

  validateIdent(schema, 'schema');
  validateIdent(table, 'table');
  validateIdent(name, 'policy name');
  if (to) {
    for (const role of to) {
      validateIdent(role, 'role in to[]');
    }
  }

  const parts: string[] = [
    'CREATE POLICY',
    quoteIdentifier(name),
    'ON',
    `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
  ];
  if (permissive === 'RESTRICTIVE') {
    parts.push('AS', 'RESTRICTIVE');
  }
  parts.push('FOR', command ?? 'ALL');
  if (to && to.length > 0) {
    parts.push('TO', to.map(quoteIdentifier).join(', '));
  }
  if (using !== undefined) {
    parts.push('USING', `(${using})`);
  }
  if (withCheck !== undefined) {
    parts.push('WITH CHECK', `(${withCheck})`);
  }
  const createSql = parts.join(' ');
  const where = policyPredicate(schema, table, name);

  return rawSql({
    id: `createRlsPolicy.${schema}.${table}.${name}`,
    label: `Create policy "${name}" on "${table}"`,
    summary: `Creates RLS policy "${name}" on "${schema}"."${table}"`,
    operationClass: 'additive',
    target: buildTargetDetails(schema, name, table),
    precheck: [
      step(
        `ensure policy "${name}" does not yet exist`,
        `SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE ${where})`,
      ),
    ],
    execute: [step(`create policy "${name}"`, createSql)],
    postcheck: [
      step(
        `verify policy "${name}" exists`,
        `SELECT EXISTS (SELECT 1 FROM pg_policies WHERE ${where})`,
      ),
    ],
  });
}

/**
 * `dropRlsPolicy('public', 'todos', 'todos_select_own')` →
 * `DROP POLICY "todos_select_own" ON "public"."todos"`.
 *
 * Classified as `'destructive'` to match `dropTable` / `dropColumn` and
 * surface through the migration policy (R-FM-5).
 */
export function dropRlsPolicy(schema: string, table: string, name: string): Op {
  validateIdent(schema, 'schema');
  validateIdent(table, 'table');
  validateIdent(name, 'policy name');

  const where = policyPredicate(schema, table, name);

  return rawSql({
    id: `dropRlsPolicy.${schema}.${table}.${name}`,
    label: `Drop policy "${name}" on "${table}"`,
    summary: `Drops RLS policy "${name}" on "${schema}"."${table}"`,
    operationClass: 'destructive',
    target: buildTargetDetails(schema, name, table),
    precheck: [
      step(
        `ensure policy "${name}" exists`,
        `SELECT EXISTS (SELECT 1 FROM pg_policies WHERE ${where})`,
      ),
    ],
    execute: [
      step(
        `drop policy "${name}"`,
        `DROP POLICY ${quoteIdentifier(name)} ON ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
      ),
    ],
    postcheck: [
      step(
        `verify policy "${name}" is gone`,
        `SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE ${where})`,
      ),
    ],
  });
}
