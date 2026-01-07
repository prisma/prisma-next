import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import { extractParameterizedRenderers } from '../src/core/assembly';

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
                render: (params, ctx) => `Custom<${params.precision}, ${ctx.codecTypesName}>`,
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
