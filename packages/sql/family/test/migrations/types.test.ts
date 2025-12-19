import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createMigrationPlan,
  INIT_ADDITIVE_POLICY,
  plannerFailure,
  plannerSuccess,
} from '../../src/core/migrations/plan-helpers';
import type {
  CreateMigrationPlanOptions,
  MigrationPlan,
  MigrationPlanOperation,
  PlannerConflict,
  PlannerResult,
} from '../../src/core/migrations/types';

type TestTargetDetails = { readonly schema: string };

describe('migration vocabulary', () => {
  it('freezes the default init policy', () => {
    expect(INIT_ADDITIVE_POLICY).toMatchObject({
      allowedOperationClasses: ['additive'],
    });
    expect(Object.isFrozen(INIT_ADDITIVE_POLICY)).toBe(true);
    expect(Object.isFrozen(INIT_ADDITIVE_POLICY.allowedOperationClasses)).toBe(true);
  });

  it('creates immutable migration plans', () => {
    const operations: readonly MigrationPlanOperation<TestTargetDetails>[] = [
      {
        id: 'operation.table.user',
        label: 'Create table "user"',
        summary: 'create table user',
        operationClass: 'additive',
        target: { id: 'postgres', details: { schema: 'public' } },
        precheck: [
          {
            description: 'ensure table missing',
            sql: 'select 1',
          },
        ],
        execute: [
          {
            description: 'create table',
            sql: 'create table "user" ("id" serial primary key)',
          },
        ],
        postcheck: [
          {
            description: 'verify table exists',
            sql: 'select to_regclass(\'"user"\')',
          },
        ],
      },
      {
        id: 'operation.index.user_email',
        label: 'Create index user_email',
        operationClass: 'additive',
        target: { id: 'postgres', details: { schema: 'public' } },
        precheck: [],
        execute: [
          {
            description: 'create index',
            sql: 'create index "user_email_idx" on "user"("email")',
          },
        ],
        postcheck: [],
      },
    ];

    const plan = createMigrationPlan<TestTargetDetails>({
      targetId: 'postgres',
      policy: INIT_ADDITIVE_POLICY,
      contract: { coreHash: 'core', profileHash: 'profile' },
      operations,
      meta: { marker: 'none' },
    });

    expect(plan).toMatchObject({
      targetId: 'postgres',
      contract: { coreHash: 'core', profileHash: 'profile' },
      operations: [
        {
          id: 'operation.table.user',
          precheck: [{ description: 'ensure table missing' }],
        },
        {
          id: 'operation.index.user_email',
          execute: [{ description: 'create index' }],
        },
      ],
      meta: { marker: 'none' },
    });

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.operations)).toBe(true);
    const firstOperation = plan.operations[0]!;
    expect(Object.isFrozen(firstOperation)).toBe(true);
    expect(Object.isFrozen(firstOperation.precheck)).toBe(true);

    expectTypeOf(firstOperation.target.details).toEqualTypeOf<TestTargetDetails | undefined>();
  });

  it('wraps planner results with discriminated unions', () => {
    const options: CreateMigrationPlanOptions<TestTargetDetails> = {
      targetId: 'postgres',
      policy: INIT_ADDITIVE_POLICY,
      contract: { coreHash: 'abc', profileHash: 'def' },
      operations: [],
    };
    const plan: MigrationPlan<TestTargetDetails> = createMigrationPlan(options);
    const success = plannerSuccess(plan);

    expect(success).toMatchObject({ kind: 'success', plan });
    expect(Object.isFrozen(success)).toBe(true);

    const conflicts: readonly PlannerConflict[] = [
      {
        kind: 'typeMismatch',
        summary: 'Column "user"."email" has mismatched type',
        why: 'Expected text, found integer',
        location: { table: 'user', column: 'email' },
      },
    ];
    const failure = plannerFailure(conflicts);

    expect(failure).toMatchObject({
      kind: 'failure',
      conflicts: [
        {
          kind: 'typeMismatch',
          location: { table: 'user', column: 'email' },
        },
      ],
    });

    expect(Object.isFrozen(failure.conflicts)).toBe(true);

    const results: readonly PlannerResult<TestTargetDetails>[] = [success, failure];
    results.forEach((result) => {
      if (result.kind === 'success') {
        expect(result.plan).toBe(plan);
      } else {
        expect(result.conflicts.length).toBeGreaterThan(0);
      }
    });
  });
});
