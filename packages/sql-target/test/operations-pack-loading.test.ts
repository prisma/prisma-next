import { describe, expect, it } from 'vitest';
import { assembleOperationRegistry, createOperationRegistry } from '../src/operations-registry';
import type { ExtensionPack } from '@prisma-next/emitter';

describe('assembleOperationRegistry', () => {
  it('assembles registry from extension pack manifests', () => {
    const pack1: ExtensionPack = {
      manifest: {
        id: 'pgvector',
        version: '1.2.0',
        operations: [
          {
            for: 'pgvector/vector@1',
            method: 'cosineDistance',
            args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
            returns: { kind: 'builtin', type: 'number' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'infix',
              template: '${self} <=> ${arg0}',
            },
          },
        ],
      },
      path: '/path/to/pack1',
    };

    const registry = assembleOperationRegistry([pack1]);
    const operations = registry.byType('pgvector/vector@1');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.method).toBe('cosineDistance');
  });

  it('assembles registry from multiple packs', () => {
    const pack1: ExtensionPack = {
      manifest: {
        id: 'pgvector',
        version: '1.2.0',
        operations: [
          {
            for: 'pgvector/vector@1',
            method: 'cosineDistance',
            args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
            returns: { kind: 'builtin', type: 'number' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'infix',
              template: '${self} <=> ${arg0}',
            },
          },
        ],
      },
      path: '/path/to/pack1',
    };

    const pack2: ExtensionPack = {
      manifest: {
        id: 'pgvector',
        version: '1.2.0',
        operations: [
          {
            for: 'pgvector/vector@1',
            method: 'l2Distance',
            args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
            returns: { kind: 'builtin', type: 'number' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'infix',
              template: '${self} <-> ${arg0}',
            },
          },
        ],
      },
      path: '/path/to/pack2',
    };

    const registry = assembleOperationRegistry([pack1, pack2]);
    const operations = registry.byType('pgvector/vector@1');
    expect(operations).toHaveLength(2);
    expect(operations.map((op) => op.method)).toEqual(['cosineDistance', 'l2Distance']);
  });

  it('handles packs without operations', () => {
    const pack: ExtensionPack = {
      manifest: {
        id: 'postgres',
        version: '15.0.0',
      },
      path: '/path/to/pack',
    };

    const registry = assembleOperationRegistry([pack]);
    expect(registry.byType('pgvector/vector@1')).toEqual([]);
  });

  it('throws error for duplicate method name on same typeId across packs', () => {
    const pack1: ExtensionPack = {
      manifest: {
        id: 'pgvector',
        version: '1.2.0',
        operations: [
          {
            for: 'pgvector/vector@1',
            method: 'cosineDistance',
            args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
            returns: { kind: 'builtin', type: 'number' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'infix',
              template: '${self} <=> ${arg0}',
            },
          },
        ],
      },
      path: '/path/to/pack1',
    };

    const pack2: ExtensionPack = {
      manifest: {
        id: 'pgvector',
        version: '1.2.0',
        operations: [
          {
            for: 'pgvector/vector@1',
            method: 'cosineDistance',
            args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
            returns: { kind: 'builtin', type: 'number' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'function',
              template: 'cosine_similarity(${self}, ${arg0})',
            },
          },
        ],
      },
      path: '/path/to/pack2',
    };

    expect(() => {
      assembleOperationRegistry([pack1, pack2]);
    }).toThrow(
      'Operation method "cosineDistance" already registered for typeId "pgvector/vector@1"',
    );
  });

  it('allows same method name for different typeIds', () => {
    const pack1: ExtensionPack = {
      manifest: {
        id: 'pgvector',
        version: '1.2.0',
        operations: [
          {
            for: 'pgvector/vector@1',
            method: 'distance',
            args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
            returns: { kind: 'builtin', type: 'number' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'infix',
              template: '${self} <=> ${arg0}',
            },
          },
        ],
      },
      path: '/path/to/pack1',
    };

    const pack2: ExtensionPack = {
      manifest: {
        id: 'pgpoint',
        version: '1.0.0',
        operations: [
          {
            for: 'pg/point@1',
            method: 'distance',
            args: [{ kind: 'typeId', type: 'pg/point@1' }],
            returns: { kind: 'builtin', type: 'number' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'function',
              template: 'distance(${self}, ${arg0})',
            },
          },
        ],
      },
      path: '/path/to/pack2',
    };

    const registry = assembleOperationRegistry([pack1, pack2]);
    expect(registry.byType('pgvector/vector@1')).toHaveLength(1);
    expect(registry.byType('pg/point@1')).toHaveLength(1);
  });
});
