import { tableExistsAst } from '@prisma-next/target-postgres/contract-free';
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
