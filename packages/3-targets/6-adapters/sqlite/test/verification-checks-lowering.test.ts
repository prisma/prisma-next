import { columnExistsAst } from '@prisma-next/target-sqlite/contract-free';
import { describe, expect, it } from 'vitest';
import { createSqliteBuiltinCodecLookup } from '../src/core/codec-lookup';
import { SqliteControlAdapter } from '../src/core/control-adapter';
import type { SqliteContract } from '../src/core/types';

const adapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());
const ctx = { contract: {} as SqliteContract };

describe('columnExistsAst lowering — pragma_table_info verification checks', () => {
  it('lowers columnAbsent to COUNT(*) = 0 over pragma_table_info', async () => {
    const ast = columnExistsAst('users', 'email').columnAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'SELECT COUNT(*) = 0 AS "result" FROM pragma_table_info(?) WHERE "name" = ?',
    );
    expect(result.params).toEqual(['users', 'email']);
  });

  it('lowers columnPresent to COUNT(*) > 0 over pragma_table_info', async () => {
    const ast = columnExistsAst('users', 'email').columnPresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'SELECT COUNT(*) > 0 AS "result" FROM pragma_table_info(?) WHERE "name" = ?',
    );
    expect(result.params).toEqual(['users', 'email']);
  });
});
