import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { ParamRef, RawSqlExpr } from '../src/exports/ast';
import { planFromAst } from '../src/plan';

const contract: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: profileHash('sha256:plan-from-ast-test'),
  roots: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  storage: {
    storageHash: coreHash('sha256:plan-from-ast-test-storage'),
    tables: {},
  } as unknown as SqlStorage,
  models: {},
};

describe('planFromAst', () => {
  it('meta.storageHash matches contract.storage.storageHash', () => {
    const ast = RawSqlExpr.of(['SELECT 1'], []);
    const plan = planFromAst(ast, contract);
    expect(plan.meta.storageHash).toBe(contract.storage.storageHash);
  });

  it('forwards target and targetFamily from the contract onto plan.meta', () => {
    const ast = RawSqlExpr.of(['SELECT 1'], []);
    const plan = planFromAst(ast, contract);
    expect(plan.meta.target).toBe(contract.target);
    expect(plan.meta.targetFamily).toBe(contract.targetFamily);
  });

  it("meta.lane defaults to 'raw' and is overridable via the third arg", () => {
    const ast = RawSqlExpr.of(['SELECT 1'], []);
    const defaultPlan = planFromAst(ast, contract);
    expect(defaultPlan.meta.lane).toBe('raw');

    const overridden = planFromAst(ast, contract, 'sql-raw');
    expect(overridden.meta.lane).toBe('sql-raw');
  });

  it('returns a plan whose ast is the supplied AST and whose params are empty (resolved at lowering)', () => {
    const ast = RawSqlExpr.of(
      ['SELECT eql_v2.eq(', ', ', ')'],
      [
        ParamRef.of('email', { codecId: 'pg/text@1' }),
        ParamRef.of('alice', { codecId: 'pg/text@1' }),
      ],
    );
    const plan = planFromAst(ast, contract);
    expect(plan.ast).toBe(ast);
    expect(plan.params).toEqual([]);
  });
});
