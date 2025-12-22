import { describe, expect, it } from 'vitest';
import { createOperationRegistry, hasAllCapabilities, type OperationSignature } from '../src/index';

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
    };
    const signature2: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'l2Distance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
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
    };
    const signature2: OperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
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
    };
    const signature2: OperationSignature = {
      forTypeId: 'pg/point@1',
      method: 'distance',
      args: [{ kind: 'typeId', type: 'pg/point@1' }],
      returns: { kind: 'builtin', type: 'number' },
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
      capabilities: ['pgvector.index.ivfflat'],
    };

    registry.register(signature);
    const operations = registry.byType('pg/vector@1');
    expect(operations[0]?.capabilities).toEqual(['pgvector.index.ivfflat']);
  });
});

describe('hasAllCapabilities', () => {
  it('returns false when contractCapabilities is undefined', () => {
    expect(hasAllCapabilities(['pgvector.index.ivfflat'], undefined)).toBe(false);
  });

  it('returns true when all capabilities are present', () => {
    const contractCapabilities = {
      pgvector: {
        'index.ivfflat': true,
      },
    };
    expect(hasAllCapabilities(['pgvector.index.ivfflat'], contractCapabilities)).toBe(true);
  });

  it('returns false when capability is missing', () => {
    const contractCapabilities = {
      pgvector: {
        'index.ivfflat': true,
      },
    };
    expect(hasAllCapabilities(['pgvector.index.hnsw'], contractCapabilities)).toBe(false);
  });

  it('returns false when namespace is missing', () => {
    const contractCapabilities = {
      pgvector: {
        'index.ivfflat': true,
      },
    };
    expect(hasAllCapabilities(['other.index.ivfflat'], contractCapabilities)).toBe(false);
  });

  it('returns false when capability value is false', () => {
    const contractCapabilities = {
      pgvector: {
        'index.ivfflat': false,
      },
    };
    expect(hasAllCapabilities(['pgvector.index.ivfflat'], contractCapabilities)).toBe(false);
  });

  it('returns false when capability value is undefined', () => {
    const contractCapabilities = {
      pgvector: {},
    };
    expect(hasAllCapabilities(['pgvector.index.ivfflat'], contractCapabilities)).toBe(false);
  });

  it('returns true when all multiple capabilities are present', () => {
    const contractCapabilities = {
      pgvector: {
        'index.ivfflat': true,
        'index.hnsw': true,
      },
    };
    expect(
      hasAllCapabilities(['pgvector.index.ivfflat', 'pgvector.index.hnsw'], contractCapabilities),
    ).toBe(true);
  });

  it('returns false when one of multiple capabilities is missing', () => {
    const contractCapabilities = {
      pgvector: {
        'index.ivfflat': true,
      },
    };
    expect(
      hasAllCapabilities(['pgvector.index.ivfflat', 'pgvector.index.hnsw'], contractCapabilities),
    ).toBe(false);
  });

  it('handles capabilities with multiple dots in key', () => {
    const contractCapabilities = {
      pgvector: {
        'index.ivfflat': true,
      },
    };
    expect(hasAllCapabilities(['pgvector.index.ivfflat'], contractCapabilities)).toBe(true);
  });

  it('handles empty capabilities array', () => {
    const contractCapabilities = {
      pgvector: {
        'index.ivfflat': true,
      },
    };
    expect(hasAllCapabilities([], contractCapabilities)).toBe(true);
  });

  it('handles capabilities from different namespaces', () => {
    const contractCapabilities = {
      pgvector: {
        'index.ivfflat': true,
      },
      postgres: {
        returning: true,
      },
    };
    expect(
      hasAllCapabilities(['pgvector.index.ivfflat', 'postgres.returning'], contractCapabilities),
    ).toBe(true);
  });

  it('returns false when one namespace capability is missing', () => {
    const contractCapabilities = {
      pgvector: {
        'index.ivfflat': true,
      },
      postgres: {
        returning: true,
      },
    };
    expect(
      hasAllCapabilities(
        ['pgvector.index.ivfflat', 'postgres.returning', 'other.feature'],
        contractCapabilities,
      ),
    ).toBe(false);
  });
});
