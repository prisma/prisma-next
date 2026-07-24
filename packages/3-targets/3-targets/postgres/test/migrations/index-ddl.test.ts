import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { describe, expect, it } from 'vitest';
import { createIndex, renameIndex } from '../../src/core/migrations/operations/indexes';

function stubLowerer(): ExecuteRequestLowerer {
  return {
    lower: () => Object.freeze({ sql: 'STUB', params: Object.freeze([]) }),
    lowerToExecuteRequest: async () =>
      Object.freeze({ sql: 'SELECT true', params: Object.freeze([]) }),
  };
}

async function executeSql(op: ReturnType<typeof createIndex>): Promise<string> {
  const resolved = await op;
  const stmt = resolved.execute[0];
  if (!stmt) throw new Error('createIndex op has no execute step');
  return stmt.sql;
}

describe('createIndex DDL emission', () => {
  it('emits a plain CREATE INDEX when no extras are supplied', async () => {
    const op = createIndex(
      'public',
      'user',
      'user_email_idx',
      { columns: ['email'] },
      stubLowerer(),
    );
    expect(await executeSql(op)).toBe('CREATE INDEX "user_email_idx" ON "public"."user" ("email")');
  });

  it('emits USING <method> when type is supplied', async () => {
    const op = createIndex('public', 'doc', 'doc_body_idx', { columns: ['body'] }, stubLowerer(), {
      type: 'gin',
    });
    expect(await executeSql(op)).toBe(
      'CREATE INDEX "doc_body_idx" ON "public"."doc" USING "gin" ("body")',
    );
  });

  it('emits WITH (...) when options are supplied', async () => {
    const op = createIndex('public', 'doc', 'doc_body_idx', { columns: ['body'] }, stubLowerer(), {
      type: 'gin',
      options: { fastupdate: false },
    });
    expect(await executeSql(op)).toBe(
      'CREATE INDEX "doc_body_idx" ON "public"."doc" USING "gin" ("body") WITH ("fastupdate" = false)',
    );
  });

  it('omits WITH when options is an empty object', async () => {
    const op = createIndex('public', 'doc', 'doc_body_idx', { columns: ['body'] }, stubLowerer(), {
      type: 'gin',
      options: {},
    });
    expect(await executeSql(op)).toBe(
      'CREATE INDEX "doc_body_idx" ON "public"."doc" USING "gin" ("body")',
    );
  });

  it('renders number, boolean, and string option leaves correctly', async () => {
    const op = createIndex('public', 'doc', 'doc_body_idx', { columns: ['body'] }, stubLowerer(), {
      type: 'demo',
      options: { fillfactor: 70, fastupdate: false, pdb_locale: 'en-US' },
    });
    expect(await executeSql(op)).toBe(
      `CREATE INDEX "doc_body_idx" ON "public"."doc" USING "demo" ("body") WITH ("fillfactor" = 70, "fastupdate" = false, "pdb_locale" = 'en-US')`,
    );
  });

  it('escapes single quotes in string option values', async () => {
    const op = createIndex('public', 'doc', 'doc_body_idx', { columns: ['body'] }, stubLowerer(), {
      type: 'demo',
      options: { needle: "with'quote" },
    });
    expect(await executeSql(op)).toContain(`"needle" = 'with''quote'`);
  });

  it('rejects null option values as CONTRACT.INDEX_INVALID', async () => {
    await expect(
      createIndex('public', 'doc', 'doc_body_idx', { columns: ['body'] }, stubLowerer(), {
        type: 'demo',
        options: { weird: null },
      }),
    ).rejects.toMatchObject({
      code: 'CONTRACT.INDEX_INVALID',
      message: 'Index option "weird" must be a string, finite number, or boolean; got object',
      meta: { key: 'weird', valueType: 'object' },
    });
  });

  it('rejects non-finite numeric option values', async () => {
    await expect(
      createIndex('public', 'doc', 'doc_body_idx', { columns: ['body'] }, stubLowerer(), {
        type: 'demo',
        options: { weird: Number.NaN },
      }),
    ).rejects.toThrow(/Index option/);
  });

  it('emits CREATE UNIQUE INDEX when unique is set', async () => {
    const op = createIndex(
      'public',
      'user',
      'user_email_key',
      { columns: ['email'] },
      stubLowerer(),
      {
        unique: true,
      },
    );
    expect(await executeSql(op)).toBe(
      'CREATE UNIQUE INDEX "user_email_key" ON "public"."user" ("email")',
    );
  });

  it('emits the WHERE predicate verbatim in parens, never quoted or escaped', async () => {
    const op = createIndex(
      'public',
      'doc',
      'doc_active_idx',
      { columns: ['email'] },
      stubLowerer(),
      {
        where: "deleted_at IS NULL AND status = 'active'",
      },
    );
    expect(await executeSql(op)).toBe(
      `CREATE INDEX "doc_active_idx" ON "public"."doc" ("email") WHERE (deleted_at IS NULL AND status = 'active')`,
    );
  });

  it('emits the expression element list verbatim, never quoted or escaped', async () => {
    const op = createIndex(
      'public',
      'doc',
      'doc_email_eq',
      { expression: 'eql_v3.eq_term(email)' },
      stubLowerer(),
    );
    expect(await executeSql(op)).toBe(
      'CREATE INDEX "doc_email_eq" ON "public"."doc" (eql_v3.eq_term(email))',
    );
  });

  it('combines unique, USING, expression, WITH, and WHERE in clause order', async () => {
    const op = createIndex(
      'public',
      'doc',
      'doc_email_eq',
      { expression: 'lower(email), id' },
      stubLowerer(),
      {
        unique: true,
        type: 'btree',
        options: { fillfactor: 70 },
        where: 'deleted_at IS NULL',
      },
    );
    expect(await executeSql(op)).toBe(
      'CREATE UNIQUE INDEX "doc_email_eq" ON "public"."doc" USING "btree" (lower(email), id) WITH ("fillfactor" = 70) WHERE (deleted_at IS NULL)',
    );
  });
});

describe('renameIndex DDL emission', () => {
  it('emits ALTER INDEX … RENAME TO with quoted identifiers', async () => {
    const op = await renameIndex(
      'public',
      'user',
      'old_email_idx',
      'user_email_idx_46df9cad',
      stubLowerer(),
    );
    const stmt = op.execute[0];
    expect(stmt?.sql).toBe(
      'ALTER INDEX "public"."old_email_idx" RENAME TO "user_email_idx_46df9cad"',
    );
    expect(op.operationClass).toBe('widening');
    expect(op.id).toBe('index.public.user.old_email_idx.rename');
    expect(op.precheck).toHaveLength(2);
    expect(op.postcheck).toHaveLength(1);
  });
});
