import {
  PostgresAlterPolicyRename,
  PostgresCreatePolicy,
  PostgresDisableRowLevelSecurity,
  PostgresDropPolicy,
} from '@prisma-next/target-postgres/ddl';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-lookup';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
const ctx = { contract: {} as PostgresContract };

describe('PostgresControlAdapter.lowerToExecuteRequest — RLS DDL', () => {
  it('renders CREATE POLICY with quoted identifiers and verbatim predicate', async () => {
    const ast = new PostgresCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_read_ab12cd34',
      permissive: true,
      operation: 'select',
      roles: ['app_user'],
      using: '(auth.uid() = user_id)',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'CREATE POLICY "p_read_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR SELECT TO app_user USING ((auth.uid() = user_id))',
      params: [],
    });
  });

  it('renders DROP POLICY with quoted identifiers', async () => {
    const ast = new PostgresDropPolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_read_ab12cd34',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'DROP POLICY "p_read_ab12cd34" ON "public"."profiles"',
      params: [],
    });
  });

  it('renders ALTER TABLE … DISABLE ROW LEVEL SECURITY', async () => {
    const ast = new PostgresDisableRowLevelSecurity({ schema: 'public', table: 'profiles' });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'ALTER TABLE "public"."profiles" DISABLE ROW LEVEL SECURITY',
      params: [],
    });
  });

  it('renders ALTER POLICY … RENAME TO with all identifiers quoted', async () => {
    const ast = new PostgresAlterPolicyRename({
      schema: 'public',
      table: 'profiles',
      name: 'read_own_profiles_ab12cd34',
      newName: 'owner_read_profiles_ab12cd34',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'ALTER POLICY "read_own_profiles_ab12cd34" ON "public"."profiles" RENAME TO "owner_read_profiles_ab12cd34"',
      params: [],
    });
  });
});
