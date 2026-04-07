import { describe, expect, it } from 'vitest';
import { createQueryOperationRegistry } from '../src/query-operation-registry';

describe('createQueryOperationRegistry', () => {
  const descriptor = {
    method: 'cosineDistance',
    args: [
      { codecId: 'pg/vector@1', nullable: false },
      { codecId: 'pg/vector@1', nullable: false },
    ],
    returns: { codecId: 'pg/float8@1', nullable: false },
    lowering: {
      targetFamily: 'sql' as const,
      strategy: 'function' as const,
      template: '{{self}} <=> {{arg0}}',
    },
  };

  it('registers and retrieves operations', () => {
    const registry = createQueryOperationRegistry();
    registry.register(descriptor);
    const entries = registry.entries();
    expect(entries['cosineDistance']).toEqual({
      args: descriptor.args,
      returns: descriptor.returns,
      lowering: descriptor.lowering,
    });
  });

  it('throws on duplicate method registration', () => {
    const registry = createQueryOperationRegistry();
    registry.register(descriptor);
    expect(() => registry.register(descriptor)).toThrow(
      /Query operation "cosineDistance" is already registered/,
    );
  });

  it('returns frozen entries', () => {
    const registry = createQueryOperationRegistry();
    registry.register(descriptor);
    const entries = registry.entries();
    expect(Object.isFrozen(entries)).toBe(true);
  });
});
