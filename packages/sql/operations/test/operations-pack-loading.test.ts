import { describe, expect, it } from 'vitest';
import { assembleOperationRegistry, type OperationManifestLike } from '../src/index';

describe('assembleOperationRegistry', () => {
  it('assembles registry from operation manifests', () => {
    const manifest1: OperationManifestLike = {
      for: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const registry = assembleOperationRegistry([manifest1]);
    const operations = registry.byType('pgvector/vector@1');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.method).toBe('cosineDistance');
  });

  it('assembles registry from multiple manifests', () => {
    const manifest1: OperationManifestLike = {
      for: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const manifest2: OperationManifestLike = {
      for: 'pgvector/vector@1',
      method: 'l2Distance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <-> ${arg0}',
      },
    };

    const registry = assembleOperationRegistry([manifest1, manifest2]);
    const operations = registry.byType('pgvector/vector@1');
    expect(operations).toHaveLength(2);
    expect(operations.map((op) => op.method)).toEqual(['cosineDistance', 'l2Distance']);
  });

  it('handles empty manifest array', () => {
    const registry = assembleOperationRegistry([]);
    expect(registry.byType('pgvector/vector@1')).toEqual([]);
  });

  it('throws error for invalid arg kind', () => {
    const manifest: OperationManifestLike = {
      for: 'pg/text@1',
      method: 'test',
      args: [{ kind: 'invalid' as 'typeId', type: 'pg/text@1' }],
      returns: { kind: 'builtin', type: 'string' },
      lowering: {
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self})',
      },
    };

    expect(() => {
      assembleOperationRegistry([manifest]);
    }).toThrow('Invalid arg kind: invalid');
  });

  it('throws error for typeId arg without type property', () => {
    const manifest: OperationManifestLike = {
      for: 'pg/text@1',
      method: 'test',
      args: [{ kind: 'typeId' } as { kind: 'typeId'; type?: string }],
      returns: { kind: 'builtin', type: 'string' },
      lowering: {
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self})',
      },
    };

    expect(() => {
      assembleOperationRegistry([manifest]);
    }).toThrow('typeId arg must have type property');
  });

  it('assembles registry with param and literal args', () => {
    const manifest: OperationManifestLike = {
      for: 'pg/text@1',
      method: 'test',
      args: [{ kind: 'param' }, { kind: 'literal' }],
      returns: { kind: 'builtin', type: 'string' },
      lowering: {
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self}, ${arg0}, ${arg1})',
      },
    };

    const registry = assembleOperationRegistry([manifest]);
    const operations = registry.byType('pg/text@1');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.args).toEqual([{ kind: 'param' }, { kind: 'literal' }]);
  });

  it('assembles registry with typeId return type', () => {
    const manifest: OperationManifestLike = {
      for: 'pg/text@1',
      method: 'normalize',
      args: [],
      returns: { kind: 'typeId', type: 'pg/text@1' },
      lowering: {
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    const registry = assembleOperationRegistry([manifest]);
    const operations = registry.byType('pg/text@1');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.returns).toEqual({ kind: 'typeId', type: 'pg/text@1' });
  });

  it('assembles registry with capabilities', () => {
    const manifest: OperationManifestLike = {
      for: 'pg/text@1',
      method: 'test',
      args: [],
      returns: { kind: 'builtin', type: 'string' },
      lowering: {
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self})',
      },
      capabilities: ['test.capability'],
    };

    const registry = assembleOperationRegistry([manifest]);
    const operations = registry.byType('pg/text@1');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.capabilities).toEqual(['test.capability']);
  });

  it('throws error for invalid return kind', () => {
    const manifest: OperationManifestLike = {
      for: 'pg/text@1',
      method: 'test',
      args: [],
      returns: { kind: 'invalid' as 'builtin', type: 'string' },
      lowering: {
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self})',
      },
    };

    expect(() => {
      assembleOperationRegistry([manifest]);
    }).toThrow('Invalid return kind: invalid');
  });

  it('throws error for duplicate method name on same typeId', () => {
    const manifest1: OperationManifestLike = {
      for: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const manifest2: OperationManifestLike = {
      for: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'cosine_similarity(${self}, ${arg0})',
      },
    };

    expect(() => {
      assembleOperationRegistry([manifest1, manifest2]);
    }).toThrow(
      'Operation method "cosineDistance" already registered for typeId "pgvector/vector@1"',
    );
  });

  it('allows same method name for different typeIds', () => {
    const manifest1: OperationManifestLike = {
      for: 'pgvector/vector@1',
      method: 'distance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const manifest2: OperationManifestLike = {
      for: 'pg/point@1',
      method: 'distance',
      args: [{ kind: 'typeId', type: 'pg/point@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'distance(${self}, ${arg0})',
      },
    };

    const registry = assembleOperationRegistry([manifest1, manifest2]);
    expect(registry.byType('pgvector/vector@1')).toHaveLength(1);
    expect(registry.byType('pg/point@1')).toHaveLength(1);
  });
});
