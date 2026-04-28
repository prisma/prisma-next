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

/**
 * Build the `target` envelope every migration op carries
 * (`{ id: 'postgres', details: PostgresPlanTargetDetails }`).
 *
 * Why this is a helper rather than a tidy `targets.policy(...)` call:
 * `PostgresPlanTargetDetails` is the framework's opaque tri-shape
 * `{ schema, objectType, name, table? }`, in which `name` overloads as
 * either the *table* name (for table-level ops like `ENABLE ROW LEVEL
 * SECURITY`, `table = undefined`) or the *policy/index/constraint* name
 * (for relation-bound ops, with `table` set to the parent table). The
 * `objectType` discriminant lacks a `'policy'` value (FL-04), so RLS
 * policy ops fall back to `'dependency'`. Both decisions are the
 * framework's; the helper is the in-example bridge until FL-04 / FL-07
 * land. See `framework-limitations.md` § Migration authoring.
 */
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
 * `OperationClass` union has no `'policy'` slot; FL-04 documents the
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
 * - `condition` is a shorthand: pass it instead of `using` / `withCheck`
 *   when the same expression should serve as both. Mapping by command:
 *     - `SELECT` / `DELETE` → `using` only (those commands reject `WITH CHECK`).
 *     - `INSERT` → `withCheck` only (`USING` is rejected by Postgres).
 *     - `UPDATE` / `ALL` (or omitted) → both `using` and `withCheck`.
 *   Mixing `condition` with `using` or `withCheck` in the same call
 *   throws synchronously — pick one shape.
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
  readonly condition?: string;
}

/**
 * Resolve a `{ using?, withCheck?, condition? }` triple to the concrete
 * `using` / `withCheck` clauses the policy should emit. Encapsulates the
 * mutual-exclusion + command-aware fan-out so `createRlsPolicy` and
 * `alterRlsPolicy` share one source of truth.
 *
 * `command === undefined` is treated as the `ALL` case (both clauses set).
 * `alterRlsPolicy` passes `'ALL'` explicitly because Postgres' `ALTER POLICY`
 * grammar has no `command` slot — once the policy exists, its command is
 * frozen.
 */
function resolveClauses(
  spec: { using?: string; withCheck?: string; condition?: string },
  command: CreateRlsPolicySpec['command'],
): { using?: string; withCheck?: string } {
  const { using, withCheck, condition } = spec;
  if (condition !== undefined) {
    if (using !== undefined || withCheck !== undefined) {
      throw new Error(
        'Cannot pass both `condition` and `using`/`withCheck`. ' +
          "Use `condition: '<predicate>'` for the common case (same predicate gates read and write); " +
          "use `using: '<read>'` and/or `withCheck: '<write>'` only when UPDATE needs divergent " +
          'read vs write predicates.',
      );
    }
    if (command === 'SELECT' || command === 'DELETE') {
      return { using: condition };
    }
    if (command === 'INSERT') {
      return { withCheck: condition };
    }
    return { using: condition, withCheck: condition };
  }
  const out: { using?: string; withCheck?: string } = {};
  if (using !== undefined) out.using = using;
  if (withCheck !== undefined) out.withCheck = withCheck;
  return out;
}

export function createRlsPolicy(spec: CreateRlsPolicySpec): Op {
  const { schema, table, name, command, permissive, to } = spec;

  validateIdent(schema, 'schema');
  validateIdent(table, 'table');
  validateIdent(name, 'policy name');
  if (to !== undefined && to.length === 0) {
    throw new Error(
      `createRlsPolicy on "${name}": \`to\` cannot be an empty array — ` +
        "pass roles like `to: ['authenticated']`, or omit `to` entirely if you " +
        'really want the policy to apply to PUBLIC (almost never the right answer; ' +
        'see SKILL.md § 4).',
    );
  }
  if (to) {
    for (const role of to) {
      validateIdent(role, 'role in to[]');
    }
  }

  const { using, withCheck } = resolveClauses(spec, command);

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
 * Spec for `alterRlsPolicy`. Mirrors Postgres' second `ALTER POLICY`
 * form (the one that mutates the policy body, not the rename form):
 *
 *     ALTER POLICY <name> ON <schema>.<table>
 *       [ TO <roles> ]
 *       [ USING (<expr>) ]
 *       [ WITH CHECK (<expr>) ]
 *
 * At least one of `to` / `using` / `withCheck` / `condition` must be
 * given — Postgres rejects an `ALTER POLICY` that names no clauses.
 *
 * `condition` shorthand: same mutual-exclusion rule as `createRlsPolicy`.
 * Because `ALTER POLICY` has no `command` slot, `condition` always sets
 * **both** `USING` and `WITH CHECK` (Postgres validates per-policy that
 * the clauses match the underlying command).
 */
export interface AlterRlsPolicySpec {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly to?: ReadonlyArray<string>;
  readonly using?: string;
  readonly withCheck?: string;
  readonly condition?: string;
}

export function alterRlsPolicy(spec: AlterRlsPolicySpec): Op {
  const { schema, table, name, to } = spec;

  validateIdent(schema, 'schema');
  validateIdent(table, 'table');
  validateIdent(name, 'policy name');
  if (to) {
    for (const role of to) {
      validateIdent(role, 'role in to[]');
    }
  }

  // `'ALL'` so `condition` lifts to both clauses; Postgres' grammar has
  // no command slot for `ALTER POLICY`, the underlying policy keeps its
  // command from `CREATE POLICY`.
  const { using, withCheck } = resolveClauses(spec, 'ALL');

  if ((to === undefined || to.length === 0) && using === undefined && withCheck === undefined) {
    throw new Error(
      `alterRlsPolicy on "${name}": at least one of \`to\`, \`using\`, \`withCheck\`, or \`condition\` must be given`,
    );
  }

  const head = `ALTER POLICY ${quoteIdentifier(name)} ON ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const tail: string[] = [];
  if (to && to.length > 0) {
    tail.push(`TO ${to.map(quoteIdentifier).join(', ')}`);
  }
  if (using !== undefined) {
    tail.push(`USING (${using})`);
  }
  if (withCheck !== undefined) {
    tail.push(`WITH CHECK (${withCheck})`);
  }
  const alterSql = `${head} ${tail.join(' ')}`;
  const where = policyPredicate(schema, table, name);

  return rawSql({
    id: `alterRlsPolicy.${schema}.${table}.${name}`,
    label: `Alter policy "${name}" on "${table}"`,
    summary: `Alters RLS policy "${name}" on "${schema}"."${table}"`,
    // `'widening'` mirrors `dropNotNull` / `setDefault` (widening case)
    // — modifying an existing security predicate is conceptually a
    // policy-relaxation step, not a `'destructive'` data change. If a
    // future caller needs the stricter classification, expose it as an
    // option then; defaults match neighbouring `alter*` ops today.
    //
    // Assumption (R-FM-7 marker, reviewer N2 of phase-1c-cli round 3):
    // the planner does not currently gate behavior on `operationClass`
    // for the apply path this PoC exercises, so a single default is
    // acceptable even though `ALTER POLICY` can also *tighten* a
    // predicate (which would conceptually be `'destructive'` rather
    // than `'widening'`). If the planner ever starts gating on it
    // (e.g. requiring `--allow-destructive` for tightening migrations),
    // promote this to a per-call option and require the caller to pick.
    operationClass: 'widening',
    target: buildTargetDetails(schema, name, table),
    precheck: [
      step(
        `ensure policy "${name}" exists before alter`,
        `SELECT EXISTS (SELECT 1 FROM pg_policies WHERE ${where})`,
      ),
    ],
    execute: [step(`alter policy "${name}"`, alterSql)],
    // Postcheck only confirms the policy still exists; we don't try to
    // re-verify the precise `qual` / `with_check` text because Postgres
    // normalises predicates aggressively in `pg_policies` (parens,
    // implicit casts, etc.) and the round-trip would be brittle.
    postcheck: [
      step(
        `verify policy "${name}" still exists after alter`,
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
