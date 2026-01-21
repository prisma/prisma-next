import { describe, expect, it, vi } from 'vitest';
import { createExecutionStack, instantiateExecutionStack } from '../src/stack';
import type {
  RuntimeAdapterDescriptor,
  RuntimeDriverDescriptor,
  RuntimeExtensionDescriptor,
  RuntimeTargetDescriptor,
} from '../src/types';

describe('createExecutionStack', () => {
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

  const driver: RuntimeDriverDescriptor<'sql', 'postgres'> = {
    kind: 'driver',
    id: 'pg-driver',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  };

  const extension: RuntimeExtensionDescriptor<'sql', 'postgres'> = {
    kind: 'extension',
    id: 'pgvector',
    familyId: 'sql',
    targetId: 'postgres',
    version: '1.0.0',
    create: () => ({ familyId: 'sql', targetId: 'postgres', id: 'pgvector' }),
  };

  it('creates stack with required fields', () => {
    const stack = createExecutionStack({
      target,
      adapter,
    });

    expect(stack).toMatchObject({
      target,
      adapter,
      driver: undefined,
      extensionPacks: [],
    });
  });

  it('creates stack with optional driver', () => {
    const stack = createExecutionStack({
      target,
      adapter,
      driver,
    });

    expect(stack.driver).toBe(driver);
  });

  it('creates stack with extension packs', () => {
    const stack = createExecutionStack({
      target,
      adapter,
      extensionPacks: [extension],
    });

    expect(stack.extensionPacks).toEqual([extension]);
  });
});

describe('instantiateExecutionStack', () => {
  it('calls create() on target, adapter, and extensions', () => {
    const targetInstance = { familyId: 'sql' as const, targetId: 'postgres' as const };
    const adapterInstance = { familyId: 'sql' as const, targetId: 'postgres' as const };
    const extensionInstance = {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      id: 'pgvector',
    };

    const targetCreate = vi.fn(() => targetInstance);
    const adapterCreate = vi.fn(() => adapterInstance);
    const extensionCreate = vi.fn(() => extensionInstance);

    const target: RuntimeTargetDescriptor<'sql', 'postgres'> = {
      kind: 'target',
      id: 'postgres',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      create: targetCreate,
    };

    const adapter: RuntimeAdapterDescriptor<'sql', 'postgres'> = {
      kind: 'adapter',
      id: 'postgres-adapter',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      create: adapterCreate,
    };

    const extension: RuntimeExtensionDescriptor<'sql', 'postgres'> = {
      kind: 'extension',
      id: 'pgvector',
      familyId: 'sql',
      targetId: 'postgres',
      version: '1.0.0',
      create: extensionCreate,
    };

    const stack = createExecutionStack({
      target,
      adapter,
      extensionPacks: [extension],
    });

    const instance = instantiateExecutionStack(stack);

    expect(targetCreate).toHaveBeenCalledOnce();
    expect(adapterCreate).toHaveBeenCalledOnce();
    expect(extensionCreate).toHaveBeenCalledOnce();

    expect(instance).toMatchObject({
      stack,
      target: targetInstance,
      adapter: adapterInstance,
      extensionPacks: [extensionInstance],
    });
  });

  it('handles empty extension packs', () => {
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

    const stack = createExecutionStack({ target, adapter });
    const instance = instantiateExecutionStack(stack);

    expect(instance.extensionPacks).toEqual([]);
  });
});
