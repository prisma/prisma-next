import { describe, expect, it } from 'vitest';
import { createSqlOperationRegistry, type SqlOperationDescriptor } from '../src/index';

describe('SqlOperationRegistry', () => {
  const descriptor = (
    method: string,
    overrides?: Partial<SqlOperationDescriptor>,
  ): SqlOperationDescriptor => ({
    method,
    args: [{ codecId: 'pg/vector@1', nullable: false }],
    returns: { codecId: 'core/float8', nullable: false },
    lowering: {
      targetFamily: 'sql',
      strategy: 'infix',
      template: '{{self}} <=> {{arg0}}',
    },
    ...overrides,
  });

  it('registers and retrieves with lowering spec', () => {
    const registry = createSqlOperationRegistry();
    registry.register(descriptor('cosineDistance'));

    const entry = registry.entries()['cosineDistance'];
    expect(entry?.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'infix',
      template: '{{self}} <=> {{arg0}}',
    });
  });

  it('supports function strategy', () => {
    const registry = createSqlOperationRegistry();
    registry.register(
      descriptor('normalize', {
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          template: 'normalize({{self}})',
        },
      }),
    );

    const entry = registry.entries()['normalize'];
    expect(entry?.lowering.strategy).toBe('function');
  });

  it('throws on duplicate method', () => {
    const registry = createSqlOperationRegistry();
    registry.register(descriptor('cosineDistance'));

    expect(() => registry.register(descriptor('cosineDistance'))).toThrow(
      'Operation "cosineDistance" is already registered',
    );
  });
});
