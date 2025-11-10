import { describe, expect, it } from 'vitest';
import {
  type ArgSpec,
  assembleOperationRegistry,
  createOperationRegistry,
  type LoweringSpec,
  type OperationRegistry,
  type OperationSignature,
  type ReturnSpec,
} from '../src/operations-registry';

describe('operations-registry re-exports', () => {
  it('re-exports createOperationRegistry from @prisma-next/operations', () => {
    const registry = createOperationRegistry();
    expect(registry).toBeDefined();
    expect(typeof registry.register).toBe('function');
    expect(typeof registry.byType).toBe('function');
  });

  it('re-exports OperationRegistry type from @prisma-next/operations', () => {
    const registry: OperationRegistry = createOperationRegistry();
    expect(registry).toBeDefined();
  });

  it('re-exports ArgSpec type from @prisma-next/operations', () => {
    const argSpec: ArgSpec = { kind: 'param' };
    expect(argSpec.kind).toBe('param');
  });

  it('re-exports ReturnSpec type from @prisma-next/operations', () => {
    const returnSpec: ReturnSpec = { kind: 'builtin', type: 'string' };
    expect(returnSpec.kind).toBe('builtin');
    expect(returnSpec.type).toBe('string');
  });

  it('re-exports LoweringSpec type from @prisma-next/sql-operations', () => {
    const loweringSpec: LoweringSpec = {
      targetFamily: 'sql',
      strategy: 'function',
      template: 'test(${self})',
    };
    expect(loweringSpec.targetFamily).toBe('sql');
    expect(loweringSpec.strategy).toBe('function');
  });

  it('re-exports OperationSignature type from @prisma-next/sql-operations', () => {
    const signature: OperationSignature = {
      forTypeId: 'pg/text@1',
      method: 'test',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'string' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template: 'test(${self})',
      },
    };
    expect(signature.forTypeId).toBe('pg/text@1');
    expect(signature.method).toBe('test');
  });

  it('re-exports assembleOperationRegistry from @prisma-next/sql-operations', () => {
    const registry = assembleOperationRegistry([]);
    expect(registry).toBeDefined();
    expect(typeof registry.register).toBe('function');
    expect(typeof registry.byType).toBe('function');
  });
});
