import type { ParameterizedCodecDescriptor } from '@prisma-next/contract/types';
import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import {
  extractCodecTypeImports,
  extractExtensionIds,
  extractParameterizedCodecs,
  extractParameterizedRenderers,
} from '../src/core/assembly';

// Minimal mock descriptors for testing
function createMockTarget(
  overrides: Partial<ControlTargetDescriptor<'sql', 'postgres'>> = {},
): ControlTargetDescriptor<'sql', 'postgres'> {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    ...overrides,
  };
}

function createMockAdapter(
  overrides: Partial<ControlAdapterDescriptor<'sql', 'postgres'>> = {},
): ControlAdapterDescriptor<'sql', 'postgres'> {
  return {
    kind: 'adapter',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    ...overrides,
  };
}

function createMockExtension(
  id: string,
  overrides: Partial<ControlExtensionDescriptor<'sql', 'postgres'>> = {},
): ControlExtensionDescriptor<'sql', 'postgres'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    ...overrides,
  };
}

describe('extractParameterizedCodecs', () => {
  it('returns empty map when no descriptors have parameterized codecs', () => {
    const target = createMockTarget();
    const adapter = createMockAdapter();

    const result = extractParameterizedCodecs([target, adapter]);

    expect(result.size).toBe(0);
  });

  it('extracts parameterized codecs from extension descriptor', () => {
    const target = createMockTarget();
    const adapter = createMockAdapter();
    const vectorCodec: ParameterizedCodecDescriptor = {
      codecId: 'pg/vector@1',
      outputTypeRenderer: 'Vector<{{length}}>',
    };
    const extension = createMockExtension('pgvector', {
      types: {
        parameterizedCodecs: [vectorCodec],
      },
    });

    const result = extractParameterizedCodecs([target, adapter, extension]);

    expect(result.size).toBe(1);
    expect(result.get('pg/vector@1')).toEqual(vectorCodec);
  });

  it('extracts parameterized codecs from adapter descriptor', () => {
    const target = createMockTarget();
    const decimalCodec: ParameterizedCodecDescriptor = {
      codecId: 'pg/decimal@1',
      outputTypeRenderer: 'Decimal<{{precision}}, {{scale}}>',
    };
    const adapter = createMockAdapter({
      types: {
        parameterizedCodecs: [decimalCodec],
      },
    });

    const result = extractParameterizedCodecs([target, adapter]);

    expect(result.size).toBe(1);
    expect(result.get('pg/decimal@1')).toEqual(decimalCodec);
  });

  it('collects parameterized codecs from multiple descriptors', () => {
    const target = createMockTarget();
    const decimalCodec: ParameterizedCodecDescriptor = {
      codecId: 'pg/decimal@1',
      outputTypeRenderer: 'Decimal<{{precision}}, {{scale}}>',
    };
    const adapter = createMockAdapter({
      types: {
        parameterizedCodecs: [decimalCodec],
      },
    });
    const vectorCodec: ParameterizedCodecDescriptor = {
      codecId: 'pg/vector@1',
      outputTypeRenderer: 'Vector<{{length}}>',
    };
    const extension = createMockExtension('pgvector', {
      types: {
        parameterizedCodecs: [vectorCodec],
      },
    });

    const result = extractParameterizedCodecs([target, adapter, extension]);

    expect(result.size).toBe(2);
    expect(result.get('pg/decimal@1')).toEqual(decimalCodec);
    expect(result.get('pg/vector@1')).toEqual(vectorCodec);
  });

  it('throws error for duplicate codecId across descriptors', () => {
    const target = createMockTarget();
    const adapterVector: ParameterizedCodecDescriptor = {
      codecId: 'pg/vector@1',
      outputTypeRenderer: 'AdapterVector<{{size}}>',
    };
    const adapter = createMockAdapter({
      types: {
        parameterizedCodecs: [adapterVector],
      },
    });
    const extensionVector: ParameterizedCodecDescriptor = {
      codecId: 'pg/vector@1',
      outputTypeRenderer: 'ExtensionVector<{{length}}>',
      typesImport: {
        package: '@prisma-next/extension-pgvector/vector-types',
        named: 'Vector',
        alias: 'Vector',
      },
    };
    const extension = createMockExtension('pgvector', {
      types: {
        parameterizedCodecs: [extensionVector],
      },
    });

    expect(() => extractParameterizedCodecs([target, adapter, extension])).toThrow(
      /Duplicate parameterized codec for codecId "pg\/vector@1".*"pgvector" conflicts with "postgres"/,
    );
  });

  it('handles descriptors with empty parameterizedCodecs array', () => {
    const target = createMockTarget();
    const adapter = createMockAdapter({
      types: {
        parameterizedCodecs: [],
      },
    });

    const result = extractParameterizedCodecs([target, adapter]);

    expect(result.size).toBe(0);
  });

  it('preserves typesImport in extracted descriptor', () => {
    const target = createMockTarget();
    const adapter = createMockAdapter();
    const vectorCodec: ParameterizedCodecDescriptor = {
      codecId: 'pg/vector@1',
      outputTypeRenderer: 'Vector<{{length}}>',
      typesImport: {
        package: '@prisma-next/extension-pgvector/vector-types',
        named: 'Vector',
        alias: 'Vector',
      },
    };
    const extension = createMockExtension('pgvector', {
      types: {
        parameterizedCodecs: [vectorCodec],
      },
    });

    const result = extractParameterizedCodecs([target, adapter, extension]);

    expect(result.get('pg/vector@1')?.typesImport).toEqual({
      package: '@prisma-next/extension-pgvector/vector-types',
      named: 'Vector',
      alias: 'Vector',
    });
  });

  it('preserves inputTypeRenderer when present', () => {
    const target = createMockTarget();
    const adapter = createMockAdapter();
    const asymmetricCodec: ParameterizedCodecDescriptor = {
      codecId: 'pg/asymmetric@1',
      outputTypeRenderer: 'Output<{{param}}>',
      inputTypeRenderer: 'Input<{{param}}>',
    };
    const extension = createMockExtension('asymmetric', {
      types: {
        parameterizedCodecs: [asymmetricCodec],
      },
    });

    const result = extractParameterizedCodecs([target, adapter, extension]);

    const extracted = result.get('pg/asymmetric@1');
    expect(extracted?.outputTypeRenderer).toBe('Output<{{param}}>');
    expect(extracted?.inputTypeRenderer).toBe('Input<{{param}}>');
  });
});

type TestDescriptor =
  | ControlTargetDescriptor<'sql', string>
  | ControlAdapterDescriptor<'sql', string>
  | ControlExtensionDescriptor<'sql', string>;

describe('extractParameterizedRenderers', () => {
  it('returns empty map when no descriptors have parameterized renderers', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@prisma-next/adapter-postgres/codec-types',
              named: 'CodecTypes',
              alias: 'PgTypes',
            },
          },
        },
        create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
      },
    ];

    const renderers = extractParameterizedRenderers(descriptors);

    expect(renderers.size).toBe(0);
  });

  it('extracts and normalizes template-based renderers', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'extension',
        id: 'pgvector',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@prisma-next/extension-pgvector/codec-types',
              named: 'CodecTypes',
              alias: 'VectorTypes',
            },
            parameterized: {
              'pg/vector@1': {
                kind: 'template',
                template: 'Vector<{{length}}>',
              },
            },
          },
        },
        create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
      },
    ];

    const renderers = extractParameterizedRenderers(descriptors);

    expect(renderers.size).toBe(1);
    expect(renderers.has('pg/vector@1')).toBe(true);

    const renderer = renderers.get('pg/vector@1');
    expect(renderer?.codecId).toBe('pg/vector@1');

    // Test that template was normalized to a function
    const result = renderer?.render({ length: 1536 }, { codecTypesName: 'CodecTypes' });
    expect(result).toBe('Vector<1536>');
  });

  it('extracts function-based renderers', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'extension',
        id: 'test-ext',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/codec-types',
              named: 'CodecTypes',
              alias: 'TestTypes',
            },
            parameterized: {
              'test/custom@1': {
                kind: 'function',
                render: (params, ctx) => `Custom<${params['precision']}, ${ctx.codecTypesName}>`,
              },
            },
          },
        },
        create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
      },
    ];

    const renderers = extractParameterizedRenderers(descriptors);

    expect(renderers.size).toBe(1);
    const renderer = renderers.get('test/custom@1');
    const result = renderer?.render({ precision: 10 }, { codecTypesName: 'CodecTypes' });
    expect(result).toBe('Custom<10, CodecTypes>');
  });

  it('collects renderers from multiple descriptors', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@prisma-next/adapter-postgres/codec-types',
              named: 'CodecTypes',
              alias: 'PgTypes',
            },
            parameterized: {
              'pg/numeric@1': {
                kind: 'template',
                template: 'Decimal<{{precision}}, {{scale}}>',
              },
            },
          },
        },
        create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
      },
      {
        kind: 'extension',
        id: 'pgvector',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@prisma-next/extension-pgvector/codec-types',
              named: 'CodecTypes',
              alias: 'VectorTypes',
            },
            parameterized: {
              'pg/vector@1': {
                kind: 'template',
                template: 'Vector<{{length}}>',
              },
            },
          },
        },
        create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
      },
    ];

    const renderers = extractParameterizedRenderers(descriptors);

    expect(Array.from(renderers.keys())).toEqual(['pg/numeric@1', 'pg/vector@1']);
  });

  it('throws error for duplicate codecId across descriptors', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@prisma-next/adapter-postgres/codec-types',
              named: 'CodecTypes',
              alias: 'PgTypes',
            },
            parameterized: {
              'pg/vector@1': {
                kind: 'template',
                template: 'AdapterVector<{{length}}>',
              },
            },
          },
        },
        create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
      },
      {
        kind: 'extension',
        id: 'pgvector',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@prisma-next/extension-pgvector/codec-types',
              named: 'CodecTypes',
              alias: 'VectorTypes',
            },
            parameterized: {
              'pg/vector@1': {
                kind: 'template',
                template: 'ExtensionVector<{{length}}>',
              },
            },
          },
        },
        create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
      },
    ];

    expect(() => extractParameterizedRenderers(descriptors)).toThrow(
      /Duplicate parameterized renderer for codecId "pg\/vector@1".*"pgvector" conflicts with "postgres"/,
    );
  });

  it('template interpolates {{CodecTypes}} placeholder with context value', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'extension',
        id: 'test-ext',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/codec-types',
              named: 'CodecTypes',
              alias: 'TestTypes',
            },
            parameterized: {
              'test/custom@1': {
                kind: 'template',
                template: "{{CodecTypes}}['test/custom@1']['output'] & { length: {{length}} }",
              },
            },
          },
        },
        create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
      },
    ];

    const renderers = extractParameterizedRenderers(descriptors);
    const renderer = renderers.get('test/custom@1');
    const result = renderer?.render({ length: 256 }, { codecTypesName: 'MyCodecTypes' });

    expect(result).toBe("MyCodecTypes['test/custom@1']['output'] & { length: 256 }");
  });

  it('throws error for missing template parameter', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'extension',
        id: 'test-ext',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/codec-types',
              named: 'CodecTypes',
              alias: 'TestTypes',
            },
            parameterized: {
              'test/vector@1': {
                kind: 'template',
                template: 'Vector<{{length}}>',
              },
            },
          },
        },
        create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
      },
    ];

    const renderers = extractParameterizedRenderers(descriptors);
    const renderer = renderers.get('test/vector@1')!;

    expect(() => renderer.render({}, { codecTypesName: 'CodecTypes' })).toThrow(
      /Missing template parameter "length" in template "Vector<\{\{length\}\}>"/,
    );
  });
});

describe('extractCodecTypeImports', () => {
  it('extracts codec type imports from descriptors', () => {
    const adapter = createMockAdapter({
      types: {
        codecTypes: {
          import: {
            package: '@prisma-next/adapter-postgres/codec-types',
            named: 'CodecTypes',
            alias: 'PgTypes',
          },
        },
      },
    });

    const result = extractCodecTypeImports([adapter]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      package: '@prisma-next/adapter-postgres/codec-types',
      named: 'CodecTypes',
      alias: 'PgTypes',
    });
  });
});

describe('extractExtensionIds', () => {
  it('extracts extension IDs in deterministic order', () => {
    const target = createMockTarget();
    const adapter = createMockAdapter();
    const extension1 = createMockExtension('pgvector');
    const extension2 = createMockExtension('postgis');

    const result = extractExtensionIds(adapter, target, [extension1, extension2]);

    expect(result).toEqual(['postgres', 'pgvector', 'postgis']);
  });
});
