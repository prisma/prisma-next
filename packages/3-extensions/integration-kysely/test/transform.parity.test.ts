import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { Kysely, PostgresDialect } from 'kysely';
import { describe, expect, it } from 'vitest';
import { transformKyselyToPnAst } from '../src/transform/transform';
import { contract, normalizeSql, postgresContract, type TestDb } from './transform.fixtures';

const adapter = createPostgresAdapter();

describe('transformKyselyToPnAst — lowering parity', () => {
  it('matches Kysely compiled SQL for simple insert', async () => {
    const db = new Kysely<TestDb>({
      dialect: new PostgresDialect({ pool: {} as unknown as import('pg').Pool }),
    });

    try {
      const compiled = db
        .insertInto('user')
        .values({ id: 'u_1', email: 'u_1@example.com', createdAt: '2024-01-01' })
        .compile();
      const transformed = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
      const lowered = adapter.lower(transformed.ast, {
        contract: postgresContract,
        params: compiled.parameters,
      });

      expect(normalizeSql(lowered.body.sql)).toBe(normalizeSql(compiled.sql));
      expect(lowered.body.params).toEqual(compiled.parameters);
    } finally {
      await db.destroy();
    }
  });

  it('keeps select semantics aligned with Kysely compiled output', async () => {
    const db = new Kysely<TestDb>({
      dialect: new PostgresDialect({ pool: {} as unknown as import('pg').Pool }),
    });

    try {
      const compiled = db
        .selectFrom('user')
        .select(['id', 'email'])
        .where('id', '=', 'u_1')
        .orderBy('email', 'asc')
        .compile();
      const transformed = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
      const lowered = adapter.lower(transformed.ast, {
        contract: postgresContract,
        params: compiled.parameters,
      });

      const loweredSql = normalizeSql(lowered.body.sql);
      const compiledSql = normalizeSql(compiled.sql);

      expect(loweredSql).toContain('from "user"');
      expect(compiledSql).toContain('from "user"');
      expect(loweredSql).toContain('where "user"."id" = $1');
      expect(compiledSql).toContain('where "id" = $1');
      expect(loweredSql).toContain('order by');
      expect(compiledSql).toContain('order by');
      expect(lowered.body.params).toEqual(compiled.parameters);
    } finally {
      await db.destroy();
    }
  });

  it('stamps projectionTypes from compiled select columns', async () => {
    const db = new Kysely<TestDb>({
      dialect: new PostgresDialect({ pool: {} as unknown as import('pg').Pool }),
    });

    try {
      const compiled = db
        .selectFrom('user')
        .select(['id', 'email'])
        .where('id', '=', 'u_1')
        .compile();
      const transformed = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
      const projectionTypes = transformed.metaAdditions.projectionTypes;

      expect(projectionTypes).toBeDefined();
      expect(projectionTypes).toMatchObject({
        id: expect.any(String),
        email: expect.any(String),
      });
      expect(Object.values(projectionTypes ?? {})).not.toContain('unknown');
    } finally {
      await db.destroy();
    }
  });
});
