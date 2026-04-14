import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { RuntimeExecutor } from '@prisma-next/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import type { RuntimeCore } from '../src/runtime-core';

test('RuntimeCore nominally extends RuntimeExecutor<ExecutionPlan>', () => {
  expectTypeOf<RuntimeCore>().toMatchTypeOf<RuntimeExecutor<ExecutionPlan>>();
});

test('RuntimeCore.execute is assignable to RuntimeExecutor.execute', () => {
  type CoreExecute = RuntimeCore['execute'];
  type ExecutorExecute = RuntimeExecutor<ExecutionPlan>['execute'];
  expectTypeOf<CoreExecute>().toMatchTypeOf<ExecutorExecute>();
});

test('RuntimeCore.close is assignable to RuntimeExecutor.close', () => {
  expectTypeOf<RuntimeCore['close']>().toMatchTypeOf<RuntimeExecutor<ExecutionPlan>['close']>();
});
