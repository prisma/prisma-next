import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { describe, expect, it } from 'vitest';
import { createIndex } from '../../src/core/migrations/operations/indexes';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';

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

const publicNs = postgresCreateNamespace({ id: 'public', entries: { table: {} } });

describe('createIndex DDL emission', () => {
  it('emits a plain CREATE INDEX when no extras are supplied', async () => {
    const op = createIndex(publicNs.tableRef('user'), 'user_email_idx', ['email'], stubLowerer());
    expect(await executeSql(op)).toBe('CREATE INDEX "user_email_idx" ON "public"."user" ("email")');
  });

  it('emits USING <method> when type is supplied', async () => {
    const op = createIndex(publicNs.tableRef('doc'), 'doc_body_idx', ['body'], stubLowerer(), {
      type: 'gin',
    });
    expect(await executeSql(op)).toBe(
      'CREATE INDEX "doc_body_idx" ON "public"."doc" USING "gin" ("body")',
    );
  });

  it('emits WITH (...) when options are supplied', async () => {
    const op = createIndex(publicNs.tableRef('doc'), 'doc_body_idx', ['body'], stubLowerer(), {
      type: 'gin',
      options: { fastupdate: false },
    });
    expect(await executeSql(op)).toBe(
      'CREATE INDEX "doc_body_idx" ON "public"."doc" USING "gin" ("body") WITH ("fastupdate" = false)',
    );
  });

  it('omits WITH when options is an empty object', async () => {
    const op = createIndex(publicNs.tableRef('doc'), 'doc_body_idx', ['body'], stubLowerer(), {
      type: 'gin',
      options: {},
    });
    expect(await executeSql(op)).toBe(
      'CREATE INDEX "doc_body_idx" ON "public"."doc" USING "gin" ("body")',
    );
  });

  it('renders number, boolean, and string option leaves correctly', async () => {
    const op = createIndex(publicNs.tableRef('doc'), 'doc_body_idx', ['body'], stubLowerer(), {
      type: 'demo',
      options: { fillfactor: 70, fastupdate: false, pdb_locale: 'en-US' },
    });
    expect(await executeSql(op)).toBe(
      `CREATE INDEX "doc_body_idx" ON "public"."doc" USING "demo" ("body") WITH ("fillfactor" = 70, "fastupdate" = false, "pdb_locale" = 'en-US')`,
    );
  });

  it('escapes single quotes in string option values', async () => {
    const op = createIndex(publicNs.tableRef('doc'), 'doc_body_idx', ['body'], stubLowerer(), {
      type: 'demo',
      options: { needle: "with'quote" },
    });
    expect(await executeSql(op)).toContain(`"needle" = 'with''quote'`);
  });

  it('rejects null option values', async () => {
    await expect(
      createIndex(publicNs.tableRef('doc'), 'doc_body_idx', ['body'], stubLowerer(), {
        type: 'demo',
        options: { weird: null },
      }),
    ).rejects.toThrow(/Index option/);
  });

  it('rejects non-finite numeric option values', async () => {
    await expect(
      createIndex(publicNs.tableRef('doc'), 'doc_body_idx', ['body'], stubLowerer(), {
        type: 'demo',
        options: { weird: Number.NaN },
      }),
    ).rejects.toThrow(/Index option/);
  });
});
