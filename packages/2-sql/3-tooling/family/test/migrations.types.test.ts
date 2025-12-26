import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
} from '../src/core/migrations/plan-helpers';
import { INIT_ADDITIVE_POLICY } from '../src/core/migrations/policies';
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
      policy: INIT_ADDITIVE_POLICY,
      contract: { coreHash: 'core', profileHash: 'profile' },
      operations: sourceOperations as readonly MigrationPlanOperation<TestTargetDetails>[],
      meta: { marker: 'none' },
    });

    expect(plan).toMatchObject({
      targetId: 'postgres',
      contract: { coreHash: 'core', profileHash: 'profile' },
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
});

describe('planner helpers', () => {
  it('produce immutable envelopes that clone conflict metadata', () => {
    const plan: MigrationPlan<TestTargetDetails> = createMigrationPlan({
      targetId: 'postgres',
      policy: INIT_ADDITIVE_POLICY,
      contract: { coreHash: 'abc', profileHash: 'def' },
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
