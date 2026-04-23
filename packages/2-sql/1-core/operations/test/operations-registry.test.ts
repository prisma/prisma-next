import { describe, expect, it } from 'vitest';
import { createSqlOperationRegistry, type SqlOperationDescriptor } from '../src/index';

describe('SqlOperationRegistry', () => {
  const noopImpl = () => ({ returnType: { codecId: 'pg/bool@1', nullable: false } });

  const descriptor = (
    method: string,
    overrides?: Partial<SqlOperationDescriptor>,
  ): SqlOperationDescriptor => ({
    method,
    self: { codecId: 'pg/vector@1' },
    impl: noopImpl,
    ...overrides,
  });

  it('registers and retrieves an operation', () => {
    const registry = createSqlOperationRegistry();
    registry.register(descriptor('cosineDistance'));

    const entry = registry.entries()['cosineDistance'];
    expect(entry).toEqual({
      self: { codecId: 'pg/vector@1' },
      impl: noopImpl,
    });
  });

  it('registers multiple operations', () => {
    const registry = createSqlOperationRegistry();
    registry.register(descriptor('cosineDistance'));
    registry.register(descriptor('l2Distance', { self: { traits: ['order'] } }));

    const entries = registry.entries();
    expect(Object.keys(entries)).toEqual(['cosineDistance', 'l2Distance']);
  });

  it('throws on duplicate method', () => {
    const registry = createSqlOperationRegistry();
    registry.register(descriptor('cosineDistance'));

    expect(() => registry.register(descriptor('cosineDistance'))).toThrow(
      'Operation "cosineDistance" is already registered',
    );
  });
});
