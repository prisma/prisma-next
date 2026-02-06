import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { DeleteAst, InsertAst, UpdateAst } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';

import { createSqliteAdapter } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract = Object.freeze(
  validateContract<SqliteContract>({
    target: 'sqlite',
    targetFamily: 'sql' as const,
    coreHash: 'sha256:test-core',
    profileHash: 'sha256:test-profile',
    storage: {
      tables: {
        user: {
          columns: {
            id: { codecId: 'sqlite/int@1', nativeType: 'integer', nullable: false },
            email: { codecId: 'sqlite/text@1', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  }),
);

describe('SQLite DML lowering', () => {
  it('lowers INSERT ... RETURNING', () => {
    const adapter = createSqliteAdapter();

    const ast: InsertAst = {
      kind: 'insert',
      table: { kind: 'table', name: 'user' },
      values: {
        email: { kind: 'param', index: 1, name: 'email' },
      },
      returning: [
        { kind: 'col', table: 'user', column: 'id' },
        { kind: 'col', table: 'user', column: 'email' },
      ],
    };

    const lowered = adapter.lower(ast, { contract, params: ['a@b.com'] });
    expect(lowered.body.sql).toBe(
      'INSERT INTO "user" ("email") VALUES (?1) RETURNING "user"."id", "user"."email"',
    );
    expect(lowered.body.params).toEqual(['a@b.com']);
  });

  it('lowers UPDATE ... RETURNING', () => {
    const adapter = createSqliteAdapter();

    const ast: UpdateAst = {
      kind: 'update',
      table: { kind: 'table', name: 'user' },
      set: {
        email: { kind: 'param', index: 1, name: 'email' },
      },
      where: {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: 'user', column: 'id' },
        right: { kind: 'param', index: 2, name: 'userId' },
      },
      returning: [
        { kind: 'col', table: 'user', column: 'id' },
        { kind: 'col', table: 'user', column: 'email' },
      ],
    };

    const lowered = adapter.lower(ast, { contract, params: ['new@b.com', 1] });
    expect(lowered.body.sql).toBe(
      'UPDATE "user" SET "email" = ?1 WHERE "user"."id" = ?2 RETURNING "user"."id", "user"."email"',
    );
    expect(lowered.body.params).toEqual(['new@b.com', 1]);
  });

  it('lowers DELETE ... RETURNING', () => {
    const adapter = createSqliteAdapter();

    const ast: DeleteAst = {
      kind: 'delete',
      table: { kind: 'table', name: 'user' },
      where: {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: 'user', column: 'id' },
        right: { kind: 'param', index: 1, name: 'userId' },
      },
      returning: [
        { kind: 'col', table: 'user', column: 'id' },
        { kind: 'col', table: 'user', column: 'email' },
      ],
    };

    const lowered = adapter.lower(ast, { contract, params: [1] });
    expect(lowered.body.sql).toBe(
      'DELETE FROM "user" WHERE "user"."id" = ?1 RETURNING "user"."id", "user"."email"',
    );
    expect(lowered.body.params).toEqual([1]);
  });
});
