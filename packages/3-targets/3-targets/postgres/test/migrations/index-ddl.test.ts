import { describe, expect, it } from 'vitest';
import { createIndex } from '../../src/core/migrations/operations/indexes';

function executeSql(op: ReturnType<typeof createIndex>): string {
  const stmt = op.execute[0];
  if (!stmt) throw new Error('createIndex op has no execute step');
  return stmt.sql;
}

describe('createIndex DDL emission', () => {
  it('emits a plain CREATE INDEX when no extras are supplied', () => {
    const op = createIndex('public', 'user', 'user_email_idx', ['email']);
    expect(executeSql(op)).toBe('CREATE INDEX "user_email_idx" ON "public"."user" ("email")');
  });

  it('emits USING <method> when type is supplied', () => {
    const op = createIndex('public', 'doc', 'doc_body_idx', ['body'], { type: 'gin' });
    expect(executeSql(op)).toBe(
      'CREATE INDEX "doc_body_idx" ON "public"."doc" USING "gin" ("body")',
    );
  });

  it('emits WITH (...) when options are supplied', () => {
    const op = createIndex('public', 'doc', 'doc_body_idx', ['body'], {
      type: 'gin',
      options: { fastupdate: false },
    });
    expect(executeSql(op)).toBe(
      'CREATE INDEX "doc_body_idx" ON "public"."doc" USING "gin" ("body") WITH ("fastupdate" = false)',
    );
  });

  it('omits WITH when options is an empty object', () => {
    const op = createIndex('public', 'doc', 'doc_body_idx', ['body'], {
      type: 'gin',
      options: {},
    });
    expect(executeSql(op)).toBe(
      'CREATE INDEX "doc_body_idx" ON "public"."doc" USING "gin" ("body")',
    );
  });

  it('renders number, boolean, and string option leaves correctly', () => {
    const op = createIndex('public', 'doc', 'doc_body_idx', ['body'], {
      type: 'demo',
      options: { fillfactor: 70, fastupdate: false, pdb_locale: 'en-US' },
    });
    expect(executeSql(op)).toBe(
      `CREATE INDEX "doc_body_idx" ON "public"."doc" USING "demo" ("body") WITH ("fillfactor" = 70, "fastupdate" = false, "pdb_locale" = 'en-US')`,
    );
  });

  it('escapes single quotes in string option values', () => {
    const op = createIndex('public', 'doc', 'doc_body_idx', ['body'], {
      type: 'demo',
      options: { needle: "with'quote" },
    });
    expect(executeSql(op)).toContain(`"needle" = 'with''quote'`);
  });

  it('rejects null option values', () => {
    expect(() =>
      createIndex('public', 'doc', 'doc_body_idx', ['body'], {
        type: 'demo',
        options: { weird: null },
      }),
    ).toThrow(/Index option/);
  });

  it('rejects non-finite numeric option values', () => {
    expect(() =>
      createIndex('public', 'doc', 'doc_body_idx', ['body'], {
        type: 'demo',
        options: { weird: Number.NaN },
      }),
    ).toThrow(/Index option/);
  });
});
