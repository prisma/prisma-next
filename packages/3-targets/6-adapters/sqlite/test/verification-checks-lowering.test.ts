import {
  columnExistsAst,
  indexExistsAst,
  tableExistsAst,
} from '@prisma-next/target-sqlite/contract-free';
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

describe('tableExistsAst lowering — sqlite_master table verification checks', () => {
  it('lowers tableAbsent to COUNT(*) = 0 over sqlite_master WHERE type=table AND name=?', async () => {
    const ast = tableExistsAst('users').tableAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT COUNT(*) = 0 AS "result" FROM "sqlite_master" WHERE ("type" = ? AND "name" = ?)`,
    );
    expect(result.params).toEqual(['table', 'users']);
  });

  it('lowers tablePresent to COUNT(*) > 0', async () => {
    const ast = tableExistsAst('users').tablePresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT COUNT(*) > 0 AS "result" FROM "sqlite_master" WHERE ("type" = ? AND "name" = ?)`,
    );
    expect(result.params).toEqual(['table', 'users']);
  });
});

describe('indexExistsAst lowering — sqlite_master index verification checks', () => {
  it('lowers indexAbsent to COUNT(*) = 0 over sqlite_master WHERE type=index AND name=?', async () => {
    const ast = indexExistsAst('idx_users_email').indexAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT COUNT(*) = 0 AS "result" FROM "sqlite_master" WHERE ("type" = ? AND "name" = ?)`,
    );
    expect(result.params).toEqual(['index', 'idx_users_email']);
  });

  it('lowers indexPresent to COUNT(*) > 0', async () => {
    const ast = indexExistsAst('idx_users_email').indexPresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT COUNT(*) > 0 AS "result" FROM "sqlite_master" WHERE ("type" = ? AND "name" = ?)`,
    );
    expect(result.params).toEqual(['index', 'idx_users_email']);
  });
});
