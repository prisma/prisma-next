import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { ParamRef, RawSqlExpr } from '@prisma-next/sql-relational-core/ast';
import { planFromAst } from '@prisma-next/sql-relational-core/plan';
import { dataTransform } from '@prisma-next/target-postgres/data-transform';
import { describe, expect, it, vi } from 'vitest';

function makeContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:profile'),
    roots: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    storage: {
      storageHash: coreHash('sha256:plan-from-ast-e2e'),
      tables: {},
    } as unknown as SqlStorage,
    models: {},
  };
}

function makeAdapter(impl: (sql: string, params: readonly unknown[]) => void = () => {}) {
  const lower = vi.fn((_ast: unknown, _ctx: unknown) => {
    const result = { sql: 'SELECT 1', params: [] as readonly unknown[] };
    impl(result.sql, result.params);
    return result;
  });
  return { lower } as unknown as SqlControlAdapter<'postgres'>;
}

describe('planFromAst integrated with dataTransform (AC-PLAN3)', () => {
  it("AC-PLAN3: a plan returned by planFromAst satisfies dataTransform's assertContractMatches", () => {
    const ast = RawSqlExpr.of(
      ['SELECT eql_v2.add_search_config(', ', ', ')'],
      [
        ParamRef.of('user', { codecId: 'pg/text@1' }),
        ParamRef.of('email', { codecId: 'pg/text@1' }),
      ],
    );

    const contract = makeContract();
    const plan = planFromAst(ast, contract);
    const adapter = makeAdapter();

    expect(() =>
      dataTransform(contract, 'add-search-config', { run: () => plan }, adapter),
    ).not.toThrow();
  });
});
