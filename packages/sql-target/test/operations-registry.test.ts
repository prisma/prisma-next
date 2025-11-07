import { describe, expect, it } from 'vitest';
import {
  createOperationRegistry,
  type ArgSpec,
  type LoweringSpec,
  type OperationSignature,
  type ReturnSpec,
} from '../src/operations-registry';

describe('OperationRegistry', () => {
  it('creates empty registry', () => {
    const registry = createOperationRegistry();
    expect(registry.byType('pg/vector@1')).toEqual([]);
  });

  it('registers operation with valid signature', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <=> ${arg0}',
      },
    };

    registry.register(signature);
    const operations = registry.byType('pg/vector@1');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toEqual(signature);
  });

  it('returns operations for matching typeId', () => {
    const registry = createOperationRegistry();
    const signature1: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <=> ${arg0}',
      },
    };
    const signature2: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'l2Distance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <-> ${arg0}',
      },
    };

    registry.register(signature1);
    registry.register(signature2);

    const operations = registry.byType('pg/vector@1');
    expect(operations).toHaveLength(2);
    expect(operations.map((op) => op.method)).toEqual(['cosineDistance', 'l2Distance']);
  });

  it('returns empty array for non-matching typeId', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <=> ${arg0}',
      },
    };

    registry.register(signature);
    expect(registry.byType('pg/text@1')).toEqual([]);
  });

  it('throws error for duplicate method name on same typeId', () => {
    const registry = createOperationRegistry();
    const signature1: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <=> ${arg0}',
      },
    };
    const signature2: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template: 'cosine_similarity(${self}, ${arg0})',
      },
    };

    registry.register(signature1);
    expect(() => {
      registry.register(signature2);
    }).toThrow('Operation method "cosineDistance" already registered for typeId "pg/vector@1"');
  });

  it('allows same method name for different typeIds', () => {
    const registry = createOperationRegistry();
    const signature1: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'distance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <=> ${arg0}',
      },
    };
    const signature2: OperationSignature = {
      forTypeId: 'pg/point@1',
      method: 'distance',
      args: [{ kind: 'typeId', type: 'pg/point@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template: 'distance(${self}, ${arg0})',
      },
    };

    registry.register(signature1);
    registry.register(signature2);

    expect(registry.byType('pg/vector@1')).toHaveLength(1);
    expect(registry.byType('pg/point@1')).toHaveLength(1);
  });

  it('supports operation with param argument', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <=> ${arg0}',
      },
    };

    registry.register(signature);
    const operations = registry.byType('pg/vector@1');
    expect(operations[0]?.args[0]).toEqual({ kind: 'param' });
  });

  it('supports operation with literal argument', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'literal' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <=> ${arg0}',
      },
    };

    registry.register(signature);
    const operations = registry.byType('pg/vector@1');
    expect(operations[0]?.args[0]).toEqual({ kind: 'literal' });
  });

  it('supports operation with typeId return type', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'normalize',
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template: 'normalize(${self})',
      },
    };

    registry.register(signature);
    const operations = registry.byType('pg/vector@1');
    expect(operations[0]?.returns).toEqual({ kind: 'typeId', type: 'pg/vector@1' });
  });

  it('supports operation with multiple arguments', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineSimilarity',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }, { kind: 'param' }, { kind: 'literal' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template: 'cosine_similarity(${self}, ${arg0}, ${arg1}, ${arg2})',
      },
    };

    registry.register(signature);
    const operations = registry.byType('pg/vector@1');
    expect(operations[0]?.args).toHaveLength(3);
  });

  it('supports operation with capabilities', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <=> ${arg0}',
      },
      capabilities: ['pgvector.index.ivfflat'],
    };

    registry.register(signature);
    const operations = registry.byType('pg/vector@1');
    expect(operations[0]?.capabilities).toEqual(['pgvector.index.ivfflat']);
  });
});
