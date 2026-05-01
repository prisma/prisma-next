import { coreHash } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { ParamRef, RawSqlExpr } from '../../src/ast/types';
import { createSqlParamRefMutator } from '../../src/middleware/param-ref-mutator';
import type { SqlExecutionPlan } from '../../src/sql-execution-plan';

const TEST_HASH = coreHash('sha256:param-ref-mutator-test');

function buildPlan(): {
  plan: SqlExecutionPlan;
  refs: readonly ParamRef[];
} {
  const a = ParamRef.of('alice@example.com', { codecId: 'pg/text@1', name: 'email' });
  const b = ParamRef.of(42, { codecId: 'pg/int4@1', name: 'age' });
  const c = ParamRef.of('legacy', { name: 'plain' });
  const ast = RawSqlExpr.of(
    ['SELECT a, b, c FROM t WHERE a = ', ' AND b = ', ' AND c = ', ''],
    [a, b, c],
  );
  const plan: SqlExecutionPlan = {
    sql: 'SELECT a, b, c FROM t WHERE a = $1 AND b = $2 AND c = $3',
    params: [a.value, b.value, c.value],
    ast,
    meta: {
      target: 'postgres',
      storageHash: TEST_HASH,
      lane: 'raw',
    },
  };
  return { plan, refs: [a, b, c] };
}

describe('createSqlParamRefMutator', () => {
  it('AC-MUT2: entries() enumerates every ParamRef with { ref, value, codecId }', () => {
    const { plan, refs } = buildPlan();
    const mutator = createSqlParamRefMutator(plan);
    const entries = [...mutator.entries()];

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      value: 'alice@example.com',
      codecId: 'pg/text@1',
    });
    expect(entries[1]).toMatchObject({
      value: 42,
      codecId: 'pg/int4@1',
    });
    expect(entries[2]).toMatchObject({
      value: 'legacy',
      codecId: undefined,
    });
    // ref tokens are the underlying ParamRefs; the public type erases this
    // via the unforgeable brand, but identity is verifiable here.
    expect(entries[0]?.ref).toBe(refs[0] as unknown);
    expect(entries[1]?.ref).toBe(refs[1] as unknown);
    expect(entries[2]?.ref).toBe(refs[2] as unknown);
  });

  it('AC-MUT5: currentParams() returns plan.params by reference identity when no middleware mutates', () => {
    const { plan } = buildPlan();
    const mutator = createSqlParamRefMutator(plan);

    // entries() walk does NOT trip allocation
    for (const _ of mutator.entries()) {
      // intentionally empty
    }

    expect(mutator.currentParams()).toBe(plan.params);
  });

  it('replaceValue updates currentParams() with a fresh frozen array carrying the mutation', () => {
    const { plan } = buildPlan();
    const mutator = createSqlParamRefMutator(plan);

    const firstEntry = mutator.entries().next().value!;
    mutator.replaceValue(firstEntry.ref, 'mutated@example.com');

    const finalParams = mutator.currentParams();
    expect(finalParams).not.toBe(plan.params);
    expect([...finalParams]).toEqual(['mutated@example.com', 42, 'legacy']);
    expect(Object.isFrozen(finalParams)).toBe(true);
    // Original plan.params is untouched
    expect([...plan.params]).toEqual(['alice@example.com', 42, 'legacy']);
  });

  it('replaceValues applies bulk updates in iteration order (chain-order writeback)', () => {
    const { plan } = buildPlan();
    const mutator = createSqlParamRefMutator(plan);
    const entries = [...mutator.entries()];

    mutator.replaceValues([
      { ref: entries[0]!.ref, newValue: 'wire-a' },
      { ref: entries[1]!.ref, newValue: 999 },
    ]);

    expect([...mutator.currentParams()]).toEqual(['wire-a', 999, 'legacy']);
  });

  it('subsequent entries() reflects prior mutations (chain-composition semantics)', () => {
    const { plan } = buildPlan();
    const mutator = createSqlParamRefMutator(plan);
    const firstEntry = mutator.entries().next().value!;
    mutator.replaceValue(firstEntry.ref, 'mutated');

    const re = [...mutator.entries()];
    expect(re[0]?.value).toBe('mutated');
    expect(re[1]?.value).toBe(42);
  });

  it('handles plans with no ParamRefs (empty entries(), currentParams identity preserved)', () => {
    const ast = RawSqlExpr.of(['SELECT 1'], []);
    const plan: SqlExecutionPlan = {
      sql: 'SELECT 1',
      params: [],
      ast,
      meta: {
        target: 'postgres',
        storageHash: TEST_HASH,
        lane: 'raw',
      },
    };
    const mutator = createSqlParamRefMutator(plan);
    expect([...mutator.entries()]).toEqual([]);
    expect(mutator.currentParams()).toBe(plan.params);
  });
});
