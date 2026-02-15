import { expectTypeOf, test } from 'vitest';
import { createExecutionStack, instantiateExecutionStack } from '../src/stack';
import type {
  RuntimeAdapterDescriptor,
  RuntimeDriverDescriptor,
  RuntimeTargetDescriptor,
} from '../src/types';

type MockDriverInstance = { familyId: 'sql'; targetId: 'postgres' };

test('ExecutionStackInstance.driver type includes driver instance when stack has driver descriptor', () => {
  const target: RuntimeTargetDescriptor<'sql', 'postgres'> = {
    kind: 'target',
    id: 'postgres',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  };

  const adapter: RuntimeAdapterDescriptor<'sql', 'postgres'> = {
    kind: 'adapter',
    id: 'postgres-adapter',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  };

  const driverDescriptor: RuntimeDriverDescriptor<'sql', 'postgres', void, MockDriverInstance> = {
    kind: 'driver',
    id: 'pg-driver',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  };

  const stackWithDriver = createExecutionStack({ target, adapter, driver: driverDescriptor });
  const instanceWithDriver = instantiateExecutionStack(stackWithDriver);

  expectTypeOf(instanceWithDriver).toHaveProperty('driver');
  expectTypeOf(instanceWithDriver.driver).toMatchTypeOf<MockDriverInstance | undefined>();

  const instanceDriver = instanceWithDriver.driver;
  if (instanceDriver === undefined) {
    throw new Error('driver should exist when stack has driver descriptor');
  }
  expectTypeOf(instanceDriver).toMatchTypeOf<MockDriverInstance>();
});

test('ExecutionStackInstance has driver property when stack has no driver descriptor', () => {
  const target: RuntimeTargetDescriptor<'sql', 'postgres'> = {
    kind: 'target',
    id: 'postgres',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  };

  const adapter: RuntimeAdapterDescriptor<'sql', 'postgres'> = {
    kind: 'adapter',
    id: 'postgres-adapter',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  };

  const stackWithoutDriver = createExecutionStack({ target, adapter });
  const instanceWithoutDriver = instantiateExecutionStack(stackWithoutDriver);

  expectTypeOf(instanceWithoutDriver).toHaveProperty('driver');
});
