import sqlFamilyDescriptor from '@prisma-next/family-sql/cli';
import { describe, expect, it } from 'vitest';
import {
  assembleOperationRegistryFromPacks,
  extractCodecTypeImportsFromPacks,
  extractExtensionIdsFromPacks,
  extractOperationTypeImportsFromPacks,
} from '../src/exports/pack-assembly';
import type { ExtensionPackManifest, OperationManifest } from '../src/exports/pack-manifest-types';

type ExtensionPack = {
  readonly manifest: ExtensionPackManifest;
  readonly path: string;
};

describe('operationManifestToSignature via SQL family', () => {
  it('converts OperationManifest to SqlOperationSignature', () => {
    const manifest: OperationManifest = {
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
    };

    const signature = sqlFamilyDescriptor.convertOperationManifest(manifest);
    expect(signature.forTypeId).toBe('pgvector/vector@1');
    expect(signature.method).toBe('cosineDistance');
    expect(signature.args).toEqual([{ kind: 'typeId', type: 'pgvector/vector@1' }]);
    expect(signature.returns).toEqual({ kind: 'builtin', type: 'number' });
    expect((signature as { lowering?: unknown }).lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'infix',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
      template: '${self} <=> ${arg0}',
    });
  });

  it('converts manifest with param and literal args', () => {
    const manifest: OperationManifest = {
      for: 'pg/text@1',
      method: 'test',
      args: [{ kind: 'param' }, { kind: 'literal' }],
      returns: { kind: 'builtin', type: 'string' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self}, ${arg0}, ${arg1})',
      },
    };

    const signature = sqlFamilyDescriptor.convertOperationManifest(manifest);
    expect(signature.args).toEqual([{ kind: 'param' }, { kind: 'literal' }]);
  });

  it('converts manifest with typeId return type', () => {
    const manifest: OperationManifest = {
      for: 'pg/text@1',
      method: 'normalize',
      args: [],
      returns: { kind: 'typeId', type: 'pg/text@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    const signature = sqlFamilyDescriptor.convertOperationManifest(manifest);
    expect(signature.returns).toEqual({ kind: 'typeId', type: 'pg/text@1' });
  });

  it('converts manifest with capabilities', () => {
    const manifest: OperationManifest = {
      for: 'pg/text@1',
      method: 'test',
      args: [],
      returns: { kind: 'builtin', type: 'string' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self})',
      },
      capabilities: ['test.capability'],
    };

    const signature = sqlFamilyDescriptor.convertOperationManifest(manifest);
    expect(signature.capabilities).toEqual(['test.capability']);
  });

  it('throws error for typeId arg without type property', () => {
    const manifest: OperationManifest = {
      for: 'pg/text@1',
      method: 'test',
      args: [{ kind: 'typeId' } as OperationManifest['args'][0]],
      returns: { kind: 'builtin', type: 'string' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self})',
      },
    };

    expect(() => {
      sqlFamilyDescriptor.convertOperationManifest(manifest);
    }).toThrow('typeId arg must have type property');
  });

  it('throws error for invalid arg kind', () => {
    const manifest: OperationManifest = {
      for: 'pg/text@1',
      method: 'test',
      args: [{ kind: 'invalid' as 'typeId', type: 'pg/text@1' }],
      returns: { kind: 'builtin', type: 'string' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self})',
      },
    };

    expect(() => {
      sqlFamilyDescriptor.convertOperationManifest(manifest);
    }).toThrow('Invalid arg kind: invalid');
  });

  it('throws error for invalid return kind', () => {
    const manifest: OperationManifest = {
      for: 'pg/text@1',
      method: 'test',
      args: [],
      returns: { kind: 'invalid' as 'builtin', type: 'string' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'test(${self})',
      },
    };

    expect(() => {
      sqlFamilyDescriptor.convertOperationManifest(manifest);
    }).toThrow('Invalid return kind: invalid');
  });
});

describe('assembleOperationRegistryFromPacks', () => {
  it('assembles registry from packs with operations', () => {
    const pack1: { readonly manifest: ExtensionPackManifest; readonly path: string } = {
      manifest: {
        id: 'test-pack-1',
        version: '1.0.0',
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
      path: '/test/pack1',
    };

    const registry = assembleOperationRegistryFromPacks([pack1], sqlFamilyDescriptor);
    const operations = registry.byType('pgvector/vector@1');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.method).toBe('cosineDistance');
  });

  it('assembles registry from multiple packs', () => {
    const pack1: { readonly manifest: ExtensionPackManifest; readonly path: string } = {
      manifest: {
        id: 'test-pack-1',
        version: '1.0.0',
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
      path: '/test/pack1',
    };

    const pack2: { readonly manifest: ExtensionPackManifest; readonly path: string } = {
      manifest: {
        id: 'test-pack-2',
        version: '1.0.0',
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
      path: '/test/pack2',
    };

    const registry = assembleOperationRegistryFromPacks([pack1, pack2], sqlFamilyDescriptor);
    const operations = registry.byType('pgvector/vector@1');
    expect(operations).toHaveLength(2);
    expect(operations.map((op) => op.method)).toEqual(['cosineDistance', 'l2Distance']);
  });

  it('handles packs without operations', () => {
    const pack: { readonly manifest: ExtensionPackManifest; readonly path: string } = {
      manifest: {
        id: 'test-pack',
        version: '1.0.0',
      },
      path: '/test/pack',
    };

    const registry = assembleOperationRegistryFromPacks([pack], sqlFamilyDescriptor);
    expect(registry.byType('pgvector/vector@1')).toEqual([]);
  });

  it('handles empty packs array', () => {
    const registry = assembleOperationRegistryFromPacks([], sqlFamilyDescriptor);
    expect(registry.byType('pgvector/vector@1')).toEqual([]);
  });

  it('throws error for duplicate method name on same typeId', () => {
    const pack: { readonly manifest: ExtensionPackManifest; readonly path: string } = {
      manifest: {
        id: 'test-pack',
        version: '1.0.0',
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
      path: '/test/pack',
    };

    expect(() => {
      assembleOperationRegistryFromPacks([pack], sqlFamilyDescriptor);
    }).toThrow(
      'Operation method "cosineDistance" already registered for typeId "pgvector/vector@1"',
    );
  });
});

describe('extractTypeImports', () => {
  it('extracts codec type imports from packs', () => {
    const pack: ExtensionPack = {
      manifest: {
        id: 'test-pack',
        version: '1.0.0',
        types: {
          codecTypes: {
            import: {
              package: '@prisma-next/adapter-postgres/exports/codec-types',
              named: 'CodecTypes',
              alias: 'PgTypes',
            },
          },
        },
      },
      path: '/test/pack',
    };

    const imports = extractCodecTypeImportsFromPacks([pack]);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toEqual({
      package: '@prisma-next/adapter-postgres/exports/codec-types',
      named: 'CodecTypes',
      alias: 'PgTypes',
    });
  });

  it('extracts operation type imports from packs', () => {
    const pack: { readonly manifest: ExtensionPackManifest; readonly path: string } = {
      manifest: {
        id: 'test-pack',
        version: '1.0.0',
        types: {
          operationTypes: {
            import: {
              package: '@prisma-next/ext-pgvector/exports/operation-types',
              named: 'OperationTypes',
              alias: 'PgVectorTypes',
            },
          },
        },
      },
      path: '/test/pack',
    };

    const imports = extractOperationTypeImportsFromPacks([pack]);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toEqual({
      package: '@prisma-next/ext-pgvector/exports/operation-types',
      named: 'OperationTypes',
      alias: 'PgVectorTypes',
    });
  });

  it('extracts both codec and operation type imports', () => {
    const pack: { readonly manifest: ExtensionPackManifest; readonly path: string } = {
      manifest: {
        id: 'test-pack',
        version: '1.0.0',
        types: {
          codecTypes: {
            import: {
              package: '@prisma-next/adapter-postgres/exports/codec-types',
              named: 'CodecTypes',
              alias: 'PgTypes',
            },
          },
          operationTypes: {
            import: {
              package: '@prisma-next/ext-pgvector/exports/operation-types',
              named: 'OperationTypes',
              alias: 'PgVectorTypes',
            },
          },
        },
      },
      path: '/test/pack',
    };

    const codecImports = extractCodecTypeImportsFromPacks([pack]);
    const operationImports = extractOperationTypeImportsFromPacks([pack]);
    expect(codecImports).toHaveLength(1);
    expect(codecImports[0]).toEqual({
      package: '@prisma-next/adapter-postgres/exports/codec-types',
      named: 'CodecTypes',
      alias: 'PgTypes',
    });
    expect(operationImports).toHaveLength(1);
    expect(operationImports[0]).toEqual({
      package: '@prisma-next/ext-pgvector/exports/operation-types',
      named: 'OperationTypes',
      alias: 'PgVectorTypes',
    });
  });

  it('handles packs without type imports', () => {
    const pack: { readonly manifest: ExtensionPackManifest; readonly path: string } = {
      manifest: {
        id: 'test-pack',
        version: '1.0.0',
      },
      path: '/test/pack',
    };

    const codecImports = extractCodecTypeImportsFromPacks([pack]);
    const operationImports = extractOperationTypeImportsFromPacks([pack]);
    expect(codecImports).toEqual([]);
    expect(operationImports).toEqual([]);
  });

  it('handles empty packs array', () => {
    const codecImports = extractCodecTypeImportsFromPacks([]);
    const operationImports = extractOperationTypeImportsFromPacks([]);
    expect(codecImports).toEqual([]);
    expect(operationImports).toEqual([]);
  });
});

describe('extractExtensionIdsFromPacks', () => {
  it('extracts extension IDs from packs', () => {
    const pack1: { readonly manifest: ExtensionPackManifest; readonly path: string } = {
      manifest: {
        id: 'test-pack-1',
        version: '1.0.0',
      },
      path: '/test/pack1',
    };

    const pack2: { readonly manifest: ExtensionPackManifest; readonly path: string } = {
      manifest: {
        id: 'test-pack-2',
        version: '1.0.0',
      },
      path: '/test/pack2',
    };

    const ids = extractExtensionIdsFromPacks([pack1, pack2]);
    expect(ids).toEqual(['test-pack-1', 'test-pack-2']);
  });

  it('handles empty packs array', () => {
    const ids = extractExtensionIdsFromPacks([]);
    expect(ids).toEqual([]);
  });
});
