import { describe, expect, it } from 'vitest';
import {
  createOperationRegistry,
  type OperationDescriptor,
  type OperationEntry,
} from '../src/index';

describe('OperationRegistry', () => {
  const descriptor = (
    method: string,
    overrides?: Partial<OperationEntry>,
  ): OperationDescriptor => ({
    method,

    args: [
      { codecId: 'pg/vector@1', nullable: false },
      { codecId: 'pg/vector@1', nullable: false },
    ],
    returns: { codecId: 'core/float8', nullable: false },
    ...overrides,
  });

  it('creates empty registry', () => {
    const registry = createOperationRegistry();
    expect(registry.entries()).toEqual({});
  });

  it('registers and retrieves an operation', () => {
    const registry = createOperationRegistry();
    registry.register(descriptor('cosineDistance'));

    const entries = registry.entries();
    expect(entries['cosineDistance']).toEqual({
      args: [
        { codecId: 'pg/vector@1', nullable: false },
        { codecId: 'pg/vector@1', nullable: false },
      ],
      returns: { codecId: 'core/float8', nullable: false },
    });
  });

  it('registers multiple operations', () => {
    const registry = createOperationRegistry();
    registry.register(descriptor('cosineDistance'));
    registry.register(descriptor('l2Distance'));

    const entries = registry.entries();
    expect(Object.keys(entries)).toEqual(['cosineDistance', 'l2Distance']);
  });

  it('throws on duplicate method name', () => {
    const registry = createOperationRegistry();
    registry.register(descriptor('cosineDistance'));

    expect(() => registry.register(descriptor('cosineDistance'))).toThrow(
      'Operation "cosineDistance" is already registered',
    );
  });

  it('strips method from stored entry', () => {
    const registry = createOperationRegistry();
    registry.register(descriptor('cosineDistance'));

    const entry = registry.entries()['cosineDistance'];
    expect(entry).not.toHaveProperty('method');
  });

  it('returns frozen entries', () => {
    const registry = createOperationRegistry();
    registry.register(descriptor('cosineDistance'));

    const entries = registry.entries();
    expect(Object.isFrozen(entries)).toBe(true);
  });

  it('works with custom entry types', () => {
    interface CustomEntry extends OperationEntry {
      readonly extra: string;
    }

    const registry = createOperationRegistry<CustomEntry>();
    registry.register({
      method: 'custom',
      args: [],
      returns: { codecId: 'core/int4', nullable: false },
      extra: 'metadata',
    });

    const entry = registry.entries()['custom'];
    expect(entry?.extra).toBe('metadata');
  });
});
