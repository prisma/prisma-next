import { constraintExistsAst, tableExistsAst } from '@prisma-next/target-postgres/contract-free';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-lookup';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
const ctx = { contract: {} as PostgresContract };

describe('tableExistsAst lowering — to_regclass verification checks', () => {
  it('lowers tableAbsent to SELECT to_regclass($1) IS NULL', async () => {
    const ast = tableExistsAst('public', 'users').tableAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe('SELECT (to_regclass($1)) IS NULL AS "result"');
    expect(result.params).toEqual(['"public"."users"']);
  });

  it('lowers tablePresent to SELECT to_regclass($1) IS NOT NULL', async () => {
    const ast = tableExistsAst('public', 'users').tablePresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe('SELECT (to_regclass($1)) IS NOT NULL AS "result"');
    expect(result.params).toEqual(['"public"."users"']);
  });

  it('binds the unqualified name for the unbound namespace', async () => {
    const ast = tableExistsAst('__unbound__', 'users').tableAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe('SELECT (to_regclass($1)) IS NULL AS "result"');
    expect(result.params).toEqual(['"users"']);
  });
});

describe('constraintExistsAst lowering — pg_constraint EXISTS checks', () => {
  const innerBody =
    'SELECT 1 AS "one" FROM "pg_constraint" AS "c" ' +
    'INNER JOIN "pg_namespace" AS "n" ON "n"."oid" = "c"."connamespace"';

  it('lowers constraintPresent with table scope to EXISTS with three bound params', async () => {
    const ast = constraintExistsAst({
      constraintName: 'user_pkey',
      schema: 'public',
      table: 'user',
    }).constraintPresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT EXISTS (${innerBody} WHERE ` +
        '("c"."conname" = $1 AND "n"."nspname" = $2 AND "c"."conrelid" = to_regclass($3))' +
        ') AS "result"',
    );
    expect(result.params).toEqual(['user_pkey', 'public', '"public"."user"']);
  });

  it('lowers constraintAbsent to NOT EXISTS over the same body', async () => {
    const ast = constraintExistsAst({
      constraintName: 'user_pkey',
      schema: 'public',
    }).constraintAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT NOT EXISTS (${innerBody} WHERE ` +
        '("c"."conname" = $1 AND "n"."nspname" = $2)' +
        ') AS "result"',
    );
    expect(result.params).toEqual(['user_pkey', 'public']);
  });

  it('uses current_schema() for the unbound namespace', async () => {
    const ast = constraintExistsAst({
      constraintName: 'user_pkey',
      schema: '__unbound__',
    }).constraintPresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT EXISTS (${innerBody} WHERE ` +
        '("c"."conname" = $1 AND "n"."nspname" = current_schema())' +
        ') AS "result"',
    );
    expect(result.params).toEqual(['user_pkey']);
  });
});
