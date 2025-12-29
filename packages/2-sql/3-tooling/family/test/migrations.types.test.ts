import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
} from '../src/core/migrations/plan-helpers';
import type {
  MigrationPlan,
  MigrationPlanOperation,
  PlannerConflict,
} from '../src/core/migrations/types';

type TestTargetDetails = { readonly schema: string };

describe('createMigrationPlan', () => {
  it('returns a deep-frozen plan and does not retain mutable references', () => {
    const sourceOperations = [
      {
        id: 'operation.table.user',
        label: 'Create table "user"',
        operationClass: 'additive',
        target: { id: 'postgres', details: { schema: 'public' } },
        precheck: [{ description: 'ensure table missing', sql: 'select 1' }],
        execute: [
          { description: 'create table', sql: 'create table "user" ("id" serial primary key)' },
        ],
        postcheck: [{ description: 'verify table exists', sql: 'select to_regclass(\'"user"\')' }],
      },
    ];

    const plan = createMigrationPlan<TestTargetDetails>({
      targetId: 'postgres',
      origin: { coreHash: 'originCore', profileHash: 'originProfile' },
      destination: { coreHash: 'core', profileHash: 'profile' },
      operations: sourceOperations as readonly MigrationPlanOperation<TestTargetDetails>[],
      meta: { marker: 'none' },
    });

    expect(plan).toMatchObject({
      targetId: 'postgres',
      origin: { coreHash: 'originCore', profileHash: 'originProfile' },
      destination: { coreHash: 'core', profileHash: 'profile' },
      operations: [
        {
          id: 'operation.table.user',
          operationClass: 'additive',
          target: { id: 'postgres', details: { schema: 'public' } },
        },
      ],
      meta: { marker: 'none' },
    });

    expect(Object.isFrozen(plan.operations)).toBe(true);
    expect(Object.isFrozen(plan.operations[0]!)).toBe(true);
    expect(Object.isFrozen(plan.operations[0]!.precheck)).toBe(true);

    const firstOperation = plan.operations[0]!;
    expectTypeOf(firstOperation.target.details).toEqualTypeOf<TestTargetDetails | undefined>();
  });

  it('freezes and clones target.details to prevent mutation', () => {
    const mutableDetails = { schema: 'public', objectType: 'table' as const, name: 'user' };
    const plan = createMigrationPlan({
      targetId: 'postgres',
      destination: { coreHash: 'abc' },
      operations: [
        {
          id: 'op1',
          label: 'Test',
          operationClass: 'additive',
          target: { id: 'postgres', details: mutableDetails },
          precheck: [],
          execute: [],
          postcheck: [],
        },
      ],
    });

    // Mutate original
    mutableDetails.schema = 'mutated';

    // Assert plan's details unchanged
    expect(plan.operations[0]!.target.details).toMatchObject({
      schema: 'public',
      objectType: 'table',
      name: 'user',
    });

    // Assert frozen
    expect(Object.isFrozen(plan.operations[0]!.target)).toBe(true);
    expect(Object.isFrozen(plan.operations[0]!.target.details)).toBe(true);
  });

  it('preserves primitive details without cloning', () => {
    const plan = createMigrationPlan({
      targetId: 'postgres',
      destination: { coreHash: 'abc' },
      operations: [
        {
          id: 'op1',
          label: 'Test',
          operationClass: 'additive',
          target: { id: 'postgres', details: 'primitive-string' as unknown as TestTargetDetails },
          precheck: [],
          execute: [],
          postcheck: [],
        },
      ],
    });

    // Primitive should remain as-is (no cloning needed)
    expect(plan.operations[0]!.target.details).toBe('primitive-string');
    expect(Object.isFrozen(plan.operations[0]!.target)).toBe(true);
  });

  it('freezes and clones array details', () => {
    const mutableArray = ['item1', 'item2'];
    const plan = createMigrationPlan({
      targetId: 'postgres',
      destination: { coreHash: 'abc' },
      operations: [
        {
          id: 'op1',
          label: 'Test',
          operationClass: 'additive',
          target: { id: 'postgres', details: mutableArray as unknown as TestTargetDetails },
          precheck: [],
          execute: [],
          postcheck: [],
        },
      ],
    });

    // Mutate original array
    mutableArray.push('item3');

    // Assert plan's array unchanged
    expect(plan.operations[0]!.target.details).toEqual(['item1', 'item2']);
    expect(Object.isFrozen(plan.operations[0]!.target)).toBe(true);
    expect(Object.isFrozen(plan.operations[0]!.target.details)).toBe(true);
  });
});

describe('planner helpers', () => {
  it('produce immutable envelopes that clone conflict metadata', () => {
    const plan: MigrationPlan<TestTargetDetails> = createMigrationPlan({
      targetId: 'postgres',
      destination: { coreHash: 'abc', profileHash: 'def' },
      operations: [],
    });
    const success = plannerSuccess(plan);
    expect(success).toEqual({ kind: 'success', plan });
    expect(Object.isFrozen(success)).toBe(true);

    const conflict = {
      kind: 'typeMismatch',
      summary: 'Column "user"."email" has mismatched type',
      location: { table: 'user', column: 'email' },
      meta: { hint: 'only additive operations allowed' },
    } satisfies PlannerConflict;
    const failure = plannerFailure([conflict]);
    conflict.location!.table = 'mutated';

    expect(failure).toMatchObject({
      kind: 'failure',
      conflicts: [
        {
          kind: 'typeMismatch',
          location: { table: 'user', column: 'email' },
          meta: { hint: 'only additive operations allowed' },
        },
      ],
    });
    expect(Object.isFrozen(failure.conflicts)).toBe(true);
    expect(Object.isFrozen(failure.conflicts[0]!)).toBe(true);
    expect(failure.conflicts[0]?.location?.table).toBe('user');
  });
});
