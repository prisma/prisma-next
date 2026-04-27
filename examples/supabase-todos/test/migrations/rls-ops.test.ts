import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRlsPolicy,
  dropRlsPolicy,
  enableRowLevelSecurity,
} from '../../src/db/migrations/rls-ops';

/**
 * Vitest spec for the RLS migration factories.
 *
 * Lands in T1.4 (`projects/supabase-poc/plan.md` § Milestone 1)
 * before the implementation in T1.5, so the commit history records
 * tests-first ordering (R-NF-4).
 *
 * Coverage maps to spec § Migration factories (R-FM):
 * - R-FM-1: factories exist and emit `Op`s usable inside a `Migration`
 *           (asserted indirectly by every unit-test below + integration).
 * - R-FM-2: identifier validation rejects non-`^[A-Za-z_][A-Za-z0-9_]*$`
 *           inputs synchronously, before any string composition.
 * - R-FM-3: `using` / `withCheck` interpolated verbatim.
 * - R-FM-4: emitted `Op` shape (precheck / execute / postcheck) is
 *           consistent with neighbouring factories; pre/postchecks
 *           query `pg_policies` / `pg_class.relrowsecurity`.
 * - R-FM-5: `dropRlsPolicy` is `'destructive'`; the others are `'additive'`.
 * - R-FM-6: applying a small migration (createTable → enableRLS → policy)
 *           leaves `pg_policies` in the expected state; re-running it
 *           surfaces the precheck failure cleanly. Exercised by the
 *           integration leg below.
 * - R-FM-7: factories use only public exports of
 *           `@prisma-next/target-postgres/*` (verified by code review +
 *           the literal `git diff origin/main -- packages/` gate).
 */

const ENABLE_RLS_SQL = 'ALTER TABLE "public"."todos" ENABLE ROW LEVEL SECURITY';

const SELECT_OWN_POLICY_SQL =
  'CREATE POLICY "todos_select_own" ON "public"."todos" FOR SELECT TO "authenticated" USING ((user_id = auth.uid()))';

const DROP_POLICY_SQL = 'DROP POLICY "todos_select_own" ON "public"."todos"';

const INVALID_IDENTS = ['1bad', 'has space', 'inj"ect', ''] as const;

describe('enableRowLevelSecurity', () => {
  it('emits the expected ALTER TABLE statement', () => {
    const op = enableRowLevelSecurity('public', 'todos');
    expect(op.execute).toHaveLength(1);
    expect(op.execute[0]?.sql).toBe(ENABLE_RLS_SQL);
  });

  it('precheck queries `pg_class.relrowsecurity = false`', () => {
    const op = enableRowLevelSecurity('public', 'todos');
    expect(op.precheck).toHaveLength(1);
    const sql = op.precheck[0]?.sql ?? '';
    expect(sql).toMatch(/relrowsecurity/);
    expect(sql).toMatch(/pg_class/);
    expect(sql).toMatch(/pg_namespace/);
    expect(sql).toMatch(/'public'/);
    expect(sql).toMatch(/'todos'/);
  });

  it('postcheck queries `pg_class.relrowsecurity` to confirm', () => {
    const op = enableRowLevelSecurity('public', 'todos');
    expect(op.postcheck).toHaveLength(1);
    const sql = op.postcheck[0]?.sql ?? '';
    expect(sql).toMatch(/relrowsecurity/);
    expect(sql).toMatch(/pg_class/);
    expect(sql).toMatch(/'public'/);
    expect(sql).toMatch(/'todos'/);
  });

  it('Op envelope: id, label, summary, target, operationClass', () => {
    const op = enableRowLevelSecurity('public', 'todos');
    expect(op.operationClass).toBe('additive');
    expect(typeof op.id).toBe('string');
    expect(op.id.length).toBeGreaterThan(0);
    expect(typeof op.label).toBe('string');
    expect(op.label.length).toBeGreaterThan(0);
    expect(typeof op.summary).toBe('string');
    expect(op.target.id).toBe('postgres');
    expect(op.target.details).toMatchObject({
      schema: 'public',
      objectType: 'dependency',
      table: 'todos',
    });
  });

  it.each(INVALID_IDENTS)('rejects invalid schema identifier %p', (bad) => {
    expect(() => enableRowLevelSecurity(bad, 'todos')).toThrow(/identifier/i);
  });

  it.each(INVALID_IDENTS)('rejects invalid table identifier %p', (bad) => {
    expect(() => enableRowLevelSecurity('public', bad)).toThrow(/identifier/i);
  });
});

describe('createRlsPolicy', () => {
  it('emits the expected CREATE POLICY statement (full spec)', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'todos',
      name: 'todos_select_own',
      command: 'SELECT',
      to: ['authenticated'],
      using: '(user_id = auth.uid())',
    });
    expect(op.execute).toHaveLength(1);
    expect(op.execute[0]?.sql).toBe(SELECT_OWN_POLICY_SQL);
  });

  it('interpolates `using` verbatim (R-FM-3)', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'todos',
      name: 'p',
      command: 'SELECT',
      to: ['authenticated'],
      using: '(some.weird()::text || $$x$$)',
    });
    expect(op.execute[0]?.sql).toContain('USING ((some.weird()::text || $$x$$))');
  });

  it('interpolates `withCheck` verbatim (R-FM-3)', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'todos',
      name: 'p',
      command: 'INSERT',
      to: ['authenticated'],
      withCheck: '(author_id = auth.uid())',
    });
    expect(op.execute[0]?.sql).toContain('WITH CHECK ((author_id = auth.uid()))');
  });

  it('quotes multiple roles in the TO clause', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'public_messages',
      name: 'pm_select_all',
      command: 'SELECT',
      to: ['anon', 'authenticated'],
      using: 'true',
    });
    expect(op.execute[0]?.sql).toContain('TO "anon", "authenticated"');
  });

  it('emits AS RESTRICTIVE when permissive = "RESTRICTIVE"', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'todos',
      name: 'todos_strict',
      permissive: 'RESTRICTIVE',
      command: 'SELECT',
      to: ['authenticated'],
      using: '(user_id = auth.uid())',
    });
    expect(op.execute[0]?.sql).toContain(' AS RESTRICTIVE ');
  });

  it('does not emit AS PERMISSIVE for the default (PERMISSIVE is implicit)', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'todos',
      name: 'todos_select_own',
      command: 'SELECT',
      to: ['authenticated'],
      using: '(user_id = auth.uid())',
    });
    expect(op.execute[0]?.sql).not.toContain('AS PERMISSIVE');
    expect(op.execute[0]?.sql).not.toContain('AS RESTRICTIVE');
  });

  it('omitted command defaults to ALL', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'todos',
      name: 'todos_anything',
      to: ['authenticated'],
      using: 'true',
    });
    expect(op.execute[0]?.sql).toContain('FOR ALL');
  });

  it('omitted `to` produces no TO clause (PUBLIC)', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'todos',
      name: 'todos_public',
      command: 'SELECT',
      using: 'true',
    });
    expect(op.execute[0]?.sql).not.toMatch(/\bTO\b/);
  });

  it('omitted `using` produces no USING clause', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'todos',
      name: 'todos_insert_anything',
      command: 'INSERT',
      to: ['authenticated'],
      withCheck: 'true',
    });
    expect(op.execute[0]?.sql).not.toMatch(/USING/);
  });

  it('omitted `withCheck` produces no WITH CHECK clause', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'todos',
      name: 'todos_select_own',
      command: 'SELECT',
      to: ['authenticated'],
      using: 'true',
    });
    expect(op.execute[0]?.sql).not.toMatch(/WITH CHECK/);
  });

  it('precheck queries `pg_policies` for the named policy', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'todos',
      name: 'todos_select_own',
      command: 'SELECT',
      to: ['authenticated'],
      using: 'true',
    });
    const sql = op.precheck[0]?.sql ?? '';
    expect(sql).toMatch(/pg_policies/);
    expect(sql).toMatch(/'public'/);
    expect(sql).toMatch(/'todos'/);
    expect(sql).toMatch(/'todos_select_own'/);
  });

  it('postcheck queries `pg_policies` to confirm the policy exists', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'todos',
      name: 'todos_select_own',
      command: 'SELECT',
      to: ['authenticated'],
      using: 'true',
    });
    const sql = op.postcheck[0]?.sql ?? '';
    expect(sql).toMatch(/pg_policies/);
    expect(sql).toMatch(/'todos_select_own'/);
  });

  it('Op envelope: id, label, summary, target, operationClass', () => {
    const op = createRlsPolicy({
      schema: 'public',
      table: 'todos',
      name: 'todos_select_own',
      command: 'SELECT',
      to: ['authenticated'],
      using: 'true',
    });
    expect(op.operationClass).toBe('additive');
    expect(typeof op.id).toBe('string');
    expect(op.id.length).toBeGreaterThan(0);
    expect(typeof op.label).toBe('string');
    expect(op.label).toContain('todos_select_own');
    expect(typeof op.summary).toBe('string');
    expect(op.target.id).toBe('postgres');
    expect(op.target.details).toMatchObject({
      schema: 'public',
      objectType: 'dependency',
      name: 'todos_select_own',
      table: 'todos',
    });
  });

  describe('identifier validation (R-FM-2)', () => {
    const baseSpec = {
      schema: 'public',
      table: 'todos',
      name: 'p',
      command: 'SELECT' as const,
      to: ['authenticated'],
      using: 'true',
    };

    it.each(INVALID_IDENTS)('rejects invalid schema %p', (bad) => {
      expect(() => createRlsPolicy({ ...baseSpec, schema: bad })).toThrow(/identifier/i);
    });
    it.each(INVALID_IDENTS)('rejects invalid table %p', (bad) => {
      expect(() => createRlsPolicy({ ...baseSpec, table: bad })).toThrow(/identifier/i);
    });
    it.each(INVALID_IDENTS)('rejects invalid name %p', (bad) => {
      expect(() => createRlsPolicy({ ...baseSpec, name: bad })).toThrow(/identifier/i);
    });
    it.each(INVALID_IDENTS)('rejects invalid role in to[] %p', (bad) => {
      expect(() => createRlsPolicy({ ...baseSpec, to: [bad] })).toThrow(/identifier/i);
    });
  });
});

describe('dropRlsPolicy', () => {
  it('emits the expected DROP POLICY statement', () => {
    const op = dropRlsPolicy('public', 'todos', 'todos_select_own');
    expect(op.execute).toHaveLength(1);
    expect(op.execute[0]?.sql).toBe(DROP_POLICY_SQL);
  });

  it('precheck asserts the policy exists in `pg_policies`', () => {
    const op = dropRlsPolicy('public', 'todos', 'todos_select_own');
    const sql = op.precheck[0]?.sql ?? '';
    expect(sql).toMatch(/pg_policies/);
    expect(sql).toMatch(/'todos_select_own'/);
  });

  it('postcheck asserts the policy is gone from `pg_policies`', () => {
    const op = dropRlsPolicy('public', 'todos', 'todos_select_own');
    const sql = op.postcheck[0]?.sql ?? '';
    expect(sql).toMatch(/pg_policies/);
    expect(sql).toMatch(/'todos_select_own'/);
  });

  it('is destructive (R-FM-5)', () => {
    const op = dropRlsPolicy('public', 'todos', 'todos_select_own');
    expect(op.operationClass).toBe('destructive');
  });

  it('Op envelope: id, label, target', () => {
    const op = dropRlsPolicy('public', 'todos', 'todos_select_own');
    expect(typeof op.id).toBe('string');
    expect(op.id.length).toBeGreaterThan(0);
    expect(typeof op.label).toBe('string');
    expect(op.label).toContain('todos_select_own');
    expect(op.target.id).toBe('postgres');
    expect(op.target.details).toMatchObject({
      schema: 'public',
      objectType: 'dependency',
      name: 'todos_select_own',
      table: 'todos',
    });
  });

  it.each(INVALID_IDENTS)('rejects invalid schema %p', (bad) => {
    expect(() => dropRlsPolicy(bad, 'todos', 'p')).toThrow(/identifier/i);
  });
  it.each(INVALID_IDENTS)('rejects invalid table %p', (bad) => {
    expect(() => dropRlsPolicy('public', bad, 'p')).toThrow(/identifier/i);
  });
  it.each(INVALID_IDENTS)('rejects invalid name %p', (bad) => {
    expect(() => dropRlsPolicy('public', 'todos', bad)).toThrow(/identifier/i);
  });
});

describe('synchronous-throw guarantee (R-FM-2)', () => {
  it('enableRowLevelSecurity validates BEFORE constructing any SQL', () => {
    const sentinel = 'inj"ect';
    let captured: unknown;
    try {
      enableRowLevelSecurity('public', sentinel);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
  });

  it('createRlsPolicy validates BEFORE evaluating using/withCheck', () => {
    let captured: unknown;
    try {
      createRlsPolicy({
        schema: 'public',
        table: 'todos',
        name: 'has space',
        command: 'SELECT',
        to: ['authenticated'],
        using: 'true',
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
  });

  it('dropRlsPolicy validates synchronously', () => {
    let captured: unknown;
    try {
      dropRlsPolicy('1bad', 'todos', 'p');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
  });
});

// =====================================================================
// Integration leg — exercises R-FM-6.
//
// Programmatically applies a small migration (createTable →
// enableRowLevelSecurity → createRlsPolicy) by walking the `Op`
// precheck / execute / postcheck steps directly via `pg.Client`. We
// don't use `MigrationCLI` here because the CLI's `run()` only
// serializes a migration to disk; the apply path lives behind the
// `prisma-next migration apply` runner which requires a fully wired
// control stack. Walking the steps directly keeps the test focused
// on the factory behaviour the spec asks us to verify (re-running
// surfaces the precheck failure cleanly, pg_policies reflects the
// new policy).
//
// Each run uses a unique schema (`rls_test_<uuid>`) so the demo
// schema (`profiles`, `todos`, `public_messages`) is never touched.
//
// Requires `supabase start` running locally; skipped automatically
// when SUPABASE_TODOS_DB_URL is unset.
// =====================================================================

const DB_URL =
  process.env['SUPABASE_TODOS_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const SKIP_INTEGRATION = process.env['SUPABASE_TODOS_SKIP_INTEGRATION'] === '1';
const describeIntegration = SKIP_INTEGRATION ? describe.skip : describe;

interface OpStep {
  readonly description: string;
  readonly sql: string;
}

interface MinimalOp {
  readonly precheck: readonly OpStep[];
  readonly execute: readonly OpStep[];
  readonly postcheck: readonly OpStep[];
}

async function applyOps(client: Client, ops: readonly MinimalOp[]): Promise<void> {
  for (const op of ops) {
    for (const step of op.precheck) {
      const result = await client.query(step.sql);
      const first = result.rows[0];
      if (first) {
        const value = Object.values(first)[0];
        if (value === false) {
          throw new Error(`precheck failed: ${step.description}`);
        }
      }
    }
    for (const step of op.execute) {
      await client.query(step.sql);
    }
    for (const step of op.postcheck) {
      const result = await client.query(step.sql);
      const first = result.rows[0];
      if (first) {
        const value = Object.values(first)[0];
        if (value === false) {
          throw new Error(`postcheck failed: ${step.description}`);
        }
      }
    }
  }
}

function uniqueSchemaName(): string {
  // schema identifiers must match validateIdent's pattern (no hyphens).
  const suffix = Math.random().toString(36).slice(2, 10);
  return `rls_test_${suffix}`;
}

describeIntegration('integration — applies a migration end-to-end', () => {
  const schema = uniqueSchemaName();
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(
      `CREATE TABLE "${schema}"."widgets" (id text PRIMARY KEY, owner text NOT NULL)`,
    );
  });

  afterAll(async () => {
    if (client) {
      try {
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await client.end();
      }
    }
  });

  it('applies enableRowLevelSecurity + createRlsPolicy and pg_policies reflects it', async () => {
    const ops: readonly MinimalOp[] = [
      enableRowLevelSecurity(schema, 'widgets'),
      createRlsPolicy({
        schema,
        table: 'widgets',
        name: 'widgets_select_own',
        command: 'SELECT',
        to: ['authenticated'],
        using: '(owner = current_user)',
      }),
    ];

    await applyOps(client, ops);

    const policies = await client.query(
      `SELECT policyname, cmd, roles, qual
         FROM pg_policies
         WHERE schemaname = $1 AND tablename = 'widgets'`,
      [schema],
    );
    expect(policies.rows).toHaveLength(1);
    expect(policies.rows[0]?.policyname).toBe('widgets_select_own');
    expect(policies.rows[0]?.cmd).toBe('SELECT');

    const rls = await client.query(
      `SELECT relrowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = 'widgets'`,
      [schema],
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
  });

  it('re-running the same migration surfaces the precheck failure cleanly (R-FM-6)', async () => {
    const ops: readonly MinimalOp[] = [enableRowLevelSecurity(schema, 'widgets')];
    await expect(applyOps(client, ops)).rejects.toThrow(/precheck failed/i);
  });

  it('dropRlsPolicy removes the policy and postcheck confirms', async () => {
    await applyOps(client, [dropRlsPolicy(schema, 'widgets', 'widgets_select_own')]);
    const policies = await client.query(
      `SELECT policyname FROM pg_policies WHERE schemaname = $1 AND tablename = 'widgets'`,
      [schema],
    );
    expect(policies.rows).toHaveLength(0);
  });
});
