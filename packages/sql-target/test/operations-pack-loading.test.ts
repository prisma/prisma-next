import type { ExtensionPack } from '@prisma-next/emitter';
import { describe, expect, it } from 'vitest';
import { assembleOperationRegistry } from '../src/operations-registry';

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
              // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
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
              // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
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
              // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
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

  it('throws error for invalid arg kind', () => {
    const pack: ExtensionPack = {
      manifest: {
        id: 'test',
        version: '1.0.0',
        operations: [
          {
            for: 'pg/text@1',
            method: 'test',
            args: [{ kind: 'invalid' as 'typeId' }],
            returns: { kind: 'builtin', type: 'string' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'function',
              template: 'test(${self})',
            },
          },
        ],
      },
      path: '/path/to/pack',
    };

    expect(() => {
      assembleOperationRegistry([pack]);
    }).toThrow('Invalid arg kind: invalid');
  });

  it('throws error for typeId arg without type property', () => {
    const pack: ExtensionPack = {
      manifest: {
        id: 'test',
        version: '1.0.0',
        operations: [
          {
            for: 'pg/text@1',
            method: 'test',
            args: [{ kind: 'typeId' } as { kind: 'typeId'; type?: string }],
            returns: { kind: 'builtin', type: 'string' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'function',
              template: 'test(${self})',
            },
          },
        ],
      },
      path: '/path/to/pack',
    };

    expect(() => {
      assembleOperationRegistry([pack]);
    }).toThrow('typeId arg must have type property');
  });

  it('assembles registry with param and literal args', () => {
    const pack: ExtensionPack = {
      manifest: {
        id: 'test',
        version: '1.0.0',
        operations: [
          {
            for: 'pg/text@1',
            method: 'test',
            args: [{ kind: 'param' }, { kind: 'literal' }],
            returns: { kind: 'builtin', type: 'string' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'function',
              template: 'test(${self}, ${arg0}, ${arg1})',
            },
          },
        ],
      },
      path: '/path/to/pack',
    };

    const registry = assembleOperationRegistry([pack]);
    const operations = registry.byType('pg/text@1');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.args).toEqual([{ kind: 'param' }, { kind: 'literal' }]);
  });

  it('assembles registry with typeId return type', () => {
    const pack: ExtensionPack = {
      manifest: {
        id: 'test',
        version: '1.0.0',
        operations: [
          {
            for: 'pg/text@1',
            method: 'normalize',
            args: [],
            returns: { kind: 'typeId', type: 'pg/text@1' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'function',
              template: 'normalize(${self})',
            },
          },
        ],
      },
      path: '/path/to/pack',
    };

    const registry = assembleOperationRegistry([pack]);
    const operations = registry.byType('pg/text@1');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.returns).toEqual({ kind: 'typeId', type: 'pg/text@1' });
  });

  it('assembles registry with capabilities', () => {
    const pack: ExtensionPack = {
      manifest: {
        id: 'test',
        version: '1.0.0',
        operations: [
          {
            for: 'pg/text@1',
            method: 'test',
            args: [],
            returns: { kind: 'builtin', type: 'string' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'function',
              template: 'test(${self})',
            },
            capabilities: ['test.capability'],
          },
        ],
      },
      path: '/path/to/pack',
    };

    const registry = assembleOperationRegistry([pack]);
    const operations = registry.byType('pg/text@1');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.capabilities).toEqual(['test.capability']);
  });

  it('throws error for invalid return kind', () => {
    const pack: ExtensionPack = {
      manifest: {
        id: 'test',
        version: '1.0.0',
        operations: [
          {
            for: 'pg/text@1',
            method: 'test',
            args: [],
            returns: { kind: 'invalid' as 'builtin' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'function',
              template: 'test(${self})',
            },
          },
        ],
      },
      path: '/path/to/pack',
    };

    expect(() => {
      assembleOperationRegistry([pack]);
    }).toThrow('Invalid return kind: invalid');
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
              // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
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
              // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
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
              // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
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
              // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
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
