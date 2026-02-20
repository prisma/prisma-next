import type { ContractBase, ExecutionPlan } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import {
  createExecutionPlanFromCompiledQuery,
  executeCompiledQuery,
} from '../src/execution-plan';
import { createAsyncResult, createCompiledQuery, createTestContract } from './helpers';

describe('execution-plan helpers', () => {
  it('createExecutionPlanFromCompiledQuery passes through sql and params', () => {
    const contract = createTestContract();
    const compiledQuery = createCompiledQuery('select * from "users" where "id" = $1', [123]);

    const plan = createExecutionPlanFromCompiledQuery(contract, compiledQuery);

    expect(plan.sql).toBe(compiledQuery.sql);
    expect(plan.params).toEqual(compiledQuery.parameters);
    expect(plan.meta.target).toBe(contract.target);
    expect(plan.meta.targetFamily).toBe(contract.targetFamily);
    expect(plan.meta.storageHash).toBe(contract.storageHash);
    expect(plan.meta.paramDescriptors).toEqual([]);
  });

  it('createExecutionPlanFromCompiledQuery defaults lane to raw', () => {
    const contract = createTestContract();
    const compiledQuery = createCompiledQuery('select 1');

    const plan = createExecutionPlanFromCompiledQuery(contract, compiledQuery);

    expect(plan.meta.lane).toBe('raw');
  });

  it('createExecutionPlanFromCompiledQuery supports lane override', () => {
    const contract = createTestContract();
    const compiledQuery = createCompiledQuery('select 1');

    const plan = createExecutionPlanFromCompiledQuery(contract, compiledQuery, { lane: 'orm-client' });

    expect(plan.meta.lane).toBe('orm-client');
  });

  it('createExecutionPlanFromCompiledQuery includes profileHash when present', () => {
    const contract = createTestContract({
      profileHash: 'sha256:profile' as ContractBase['profileHash'],
    });
    const compiledQuery = createCompiledQuery('select 1');

    const plan = createExecutionPlanFromCompiledQuery(contract, compiledQuery);

    expect(plan.meta.profileHash).toBe('sha256:profile');
  });

  it('executeCompiledQuery delegates execution with converted plan', async () => {
    const contract = createTestContract();
    const compiledQuery = createCompiledQuery<{ id: number }>(
      'select "id" from "users" where "id" = $1',
      [7],
    );
    const capturedPlans: ExecutionPlan[] = [];
    const executor = {
      execute<Row>(plan: ExecutionPlan<Row>) {
        capturedPlans.push(plan as ExecutionPlan);
        return createAsyncResult([{ id: 7 } as Row]);
      },
    };

    const rows = await executeCompiledQuery(executor, contract, compiledQuery, {
      lane: 'orm-client',
    }).toArray();

    expect(rows).toEqual([{ id: 7 }]);
    expect(capturedPlans).toHaveLength(1);
    expect(capturedPlans[0]?.sql).toBe(compiledQuery.sql);
    expect(capturedPlans[0]?.params).toEqual(compiledQuery.parameters);
    expect(capturedPlans[0]?.meta.lane).toBe('orm-client');
  });
});
