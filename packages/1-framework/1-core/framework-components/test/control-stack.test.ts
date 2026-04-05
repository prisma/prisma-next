import { describe, expect, it } from 'vitest';
import type { CreateControlStackInput } from '../src/control-stack';
import {
  assembleAuthoringContributions,
  createControlStack,
  extractCodecTypeImports,
  extractComponentIds,
  extractOperationTypeImports,
  extractParameterizedRenderers,
  extractParameterizedTypeImports,
  extractQueryOperationTypeImports,
} from '../src/control-stack';
import type { ComponentDescriptor } from '../src/framework-components';

function createDescriptor<K extends string = 'target'>(
  overrides: Partial<ComponentDescriptor<string>> & { kind?: K } = {} as Partial<
    ComponentDescriptor<string>
  > & { kind?: K },
): ComponentDescriptor<K> {
  return {
    kind: 'target' as K,
    id: 'test',
    version: '0.0.1',
    ...overrides,
  } as ComponentDescriptor<K>;
}

// Tests only exercise metadata extraction; stub shapes satisfy the runtime paths
function stubInput(input: Record<string, unknown>): CreateControlStackInput {
  return input as unknown as CreateControlStackInput;
}

describe('extractCodecTypeImports', () => {
  it('returns empty array for descriptors without codec types', () => {
    const result = extractCodecTypeImports([createDescriptor()]);
    expect(result).toEqual([]);
  });

  it('extracts base codec type import', () => {
    const result = extractCodecTypeImports([
      createDescriptor({
        types: {
          codecTypes: {
            import: {
              package: '@prisma-next/mongo-core/codec-types',
              named: 'CodecTypes',
              alias: 'MongoCodecTypes',
            },
          },
        },
      }),
    ]);
    expect(result).toEqual([
      {
        package: '@prisma-next/mongo-core/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
    ]);
  });

  it('extracts typeImports alongside base import', () => {
    const result = extractCodecTypeImports([
      createDescriptor({
        types: {
          codecTypes: {
            import: { package: '@test/codec-types', named: 'CodecTypes', alias: 'T' },
            typeImports: [{ package: '@test/extra', named: 'Extra', alias: 'E' }],
          },
        },
      }),
    ]);
    expect(result).toHaveLength(2);
  });
});

describe('extractOperationTypeImports', () => {
  it('returns empty array for descriptors without operation types', () => {
    const result = extractOperationTypeImports([createDescriptor()]);
    expect(result).toEqual([]);
  });

  it('extracts operation type import', () => {
    const result = extractOperationTypeImports([
      createDescriptor({
        types: {
          operationTypes: {
            import: { package: '@test/ops', named: 'Ops', alias: 'O' },
          },
        },
      }),
    ]);
    expect(result).toEqual([{ package: '@test/ops', named: 'Ops', alias: 'O' }]);
  });
});

describe('extractQueryOperationTypeImports', () => {
  it('returns empty array for descriptors without query operation types', () => {
    const result = extractQueryOperationTypeImports([createDescriptor()]);
    expect(result).toEqual([]);
  });

  it('extracts query operation type import', () => {
    const result = extractQueryOperationTypeImports([
      createDescriptor({
        types: {
          queryOperationTypes: {
            import: { package: '@test/qops', named: 'QOps', alias: 'Q' },
          },
        },
      }),
    ]);
    expect(result).toEqual([{ package: '@test/qops', named: 'QOps', alias: 'Q' }]);
  });
});

describe('extractComponentIds', () => {
  it('collects IDs in order: family, target, adapter, extensions', () => {
    const result = extractComponentIds(
      { id: 'family-1' },
      { id: 'target-1' },
      { id: 'adapter-1' },
      [{ id: 'ext-1' }, { id: 'ext-2' }],
    );
    expect(result).toEqual(['family-1', 'target-1', 'adapter-1', 'ext-1', 'ext-2']);
  });

  it('deduplicates IDs preserving first occurrence', () => {
    const result = extractComponentIds({ id: 'shared' }, { id: 'shared' }, { id: 'shared' }, [
      { id: 'shared' },
    ]);
    expect(result).toEqual(['shared']);
  });

  it('handles undefined adapter', () => {
    const result = extractComponentIds({ id: 'fam' }, { id: 'target' }, undefined, [{ id: 'ext' }]);
    expect(result).toEqual(['fam', 'target', 'ext']);
  });
});

describe('extractParameterizedRenderers', () => {
  it('returns empty map when no descriptors have parameterized renderers', () => {
    const result = extractParameterizedRenderers([createDescriptor()]);
    expect(result.size).toBe(0);
  });

  it('extracts and normalizes template renderers', () => {
    const renderers = extractParameterizedRenderers([
      createDescriptor({
        types: {
          codecTypes: {
            parameterized: {
              'test/vector@1': { kind: 'template', template: 'Vector<{{length}}>' },
            },
          },
        },
      }),
    ]);
    expect(renderers.size).toBe(1);
    const r = renderers.get('test/vector@1');
    expect(r?.render({ length: 1536 }, { codecTypesName: 'CodecTypes' })).toBe('Vector<1536>');
  });

  it('extracts and normalizes raw string template renderers', () => {
    const renderers = extractParameterizedRenderers([
      createDescriptor({
        types: {
          codecTypes: {
            parameterized: {
              'pg/vector@1': 'Vector<{{length}}>',
            },
          },
        },
      }),
    ]);
    expect(renderers.size).toBe(1);
    const r = renderers.get('pg/vector@1');
    expect(r?.render({ length: 1536 }, { codecTypesName: 'CodecTypes' })).toBe('Vector<1536>');
  });

  it('extracts and normalizes raw function renderers', () => {
    const renderers = extractParameterizedRenderers([
      createDescriptor({
        types: {
          codecTypes: {
            parameterized: {
              'test/custom@1': (params: Record<string, unknown>, ctx: { codecTypesName: string }) =>
                `Custom<${params['precision']}, ${ctx.codecTypesName}>`,
            },
          },
        },
      }),
    ]);
    expect(renderers.size).toBe(1);
    const r = renderers.get('test/custom@1');
    expect(r?.render({ precision: 10 }, { codecTypesName: 'CodecTypes' })).toBe(
      'Custom<10, CodecTypes>',
    );
  });

  it('extracts structured function-based renderers', () => {
    const renderers = extractParameterizedRenderers([
      createDescriptor({
        types: {
          codecTypes: {
            parameterized: {
              'test/custom@1': {
                kind: 'function',
                render: (params: Record<string, unknown>, ctx: { codecTypesName: string }) =>
                  `Custom<${params['precision']}, ${ctx.codecTypesName}>`,
              },
            },
          },
        },
      }),
    ]);
    expect(renderers.size).toBe(1);
    const r = renderers.get('test/custom@1');
    expect(r?.render({ precision: 10 }, { codecTypesName: 'CodecTypes' })).toBe(
      'Custom<10, CodecTypes>',
    );
  });

  it('collects renderers from multiple descriptors', () => {
    const renderers = extractParameterizedRenderers([
      createDescriptor({
        id: 'adapter',
        types: {
          codecTypes: {
            parameterized: {
              'pg/numeric@1': { kind: 'template', template: 'Decimal<{{precision}}, {{scale}}>' },
            },
          },
        },
      }),
      createDescriptor({
        id: 'ext',
        types: {
          codecTypes: {
            parameterized: {
              'pg/vector@1': { kind: 'template', template: 'Vector<{{length}}>' },
            },
          },
        },
      }),
    ]);
    expect(Array.from(renderers.keys())).toEqual(['pg/numeric@1', 'pg/vector@1']);
  });

  it('throws on duplicate codecId across descriptors', () => {
    expect(() =>
      extractParameterizedRenderers([
        createDescriptor({
          id: 'first',
          types: {
            codecTypes: {
              parameterized: { 'dup@1': 'T<{{x}}>' },
            },
          },
        }),
        createDescriptor({
          id: 'second',
          types: {
            codecTypes: {
              parameterized: { 'dup@1': 'T<{{x}}>' },
            },
          },
        }),
      ]),
    ).toThrow(/Duplicate.*"dup@1".*"second" conflicts with "first"/);
  });

  it('interpolates {{CodecTypes}} placeholder with context value', () => {
    const renderers = extractParameterizedRenderers([
      createDescriptor({
        types: {
          codecTypes: {
            parameterized: {
              'test/custom@1': {
                kind: 'template',
                template: "{{CodecTypes}}['test/custom@1']['output'] & { length: {{length}} }",
              },
            },
          },
        },
      }),
    ]);
    const r = renderers.get('test/custom@1');
    expect(r?.render({ length: 256 }, { codecTypesName: 'MyCodecTypes' })).toBe(
      "MyCodecTypes['test/custom@1']['output'] & { length: 256 }",
    );
  });

  it('throws for missing template parameter', () => {
    const renderers = extractParameterizedRenderers([
      createDescriptor({
        types: {
          codecTypes: {
            parameterized: {
              'test/vector@1': { kind: 'template', template: 'Vector<{{length}}>' },
            },
          },
        },
      }),
    ]);
    const r = renderers.get('test/vector@1')!;
    expect(() => r.render({}, { codecTypesName: 'CodecTypes' })).toThrow(
      /Missing template parameter "length" in template "Vector<\{\{length\}\}>"/,
    );
  });
});

describe('extractParameterizedTypeImports', () => {
  it('returns empty array for descriptors without type imports', () => {
    const result = extractParameterizedTypeImports([createDescriptor()]);
    expect(result).toEqual([]);
  });

  it('extracts type imports from codec types', () => {
    const result = extractParameterizedTypeImports([
      createDescriptor({
        types: {
          codecTypes: {
            typeImports: [{ package: '@test/vec', named: 'Vector', alias: 'V' }],
          },
        },
      }),
    ]);
    expect(result).toEqual([{ package: '@test/vec', named: 'Vector', alias: 'V' }]);
  });
});

describe('assembleAuthoringContributions', () => {
  it('returns empty namespaces for descriptors without authoring', () => {
    const result = assembleAuthoringContributions([createDescriptor()]);
    expect(result).toEqual({ field: {}, type: {} });
  });

  it('merges field namespaces from multiple descriptors', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        authoring: {
          field: {
            ns1: { kind: 'fieldPreset', output: { codecId: 'a@1', nativeType: 'text' } },
          },
        },
      }),
      createDescriptor({
        id: 'other',
        authoring: {
          field: {
            ns2: { kind: 'fieldPreset', output: { codecId: 'b@1', nativeType: 'int' } },
          },
        },
      }),
    ]);
    expect(Object.keys(result.field)).toEqual(['ns1', 'ns2']);
  });

  it('throws on duplicate field preset paths', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            field: {
              dup: { kind: 'fieldPreset', output: { codecId: 'a@1', nativeType: 'text' } },
            },
          },
        }),
        createDescriptor({
          id: 'other',
          authoring: {
            field: {
              dup: { kind: 'fieldPreset', output: { codecId: 'b@1', nativeType: 'int' } },
            },
          },
        }),
      ]),
    ).toThrow(/Duplicate authoring field helper "dup"/);
  });
});

describe('createControlStack', () => {
  it('assembles all component state from family + target + adapter + extensions', () => {
    const state = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'sql' }),
        target: createDescriptor({
          kind: 'target',
          id: 'target',
          types: {
            codecTypes: {
              import: { package: '@test/codec', named: 'C', alias: 'TC' },
            },
          },
        }),
        adapter: createDescriptor({
          kind: 'adapter',
          id: 'adapter',
          types: {
            codecTypes: {
              parameterized: { 'test/p@1': 'P<{{n}}>' },
              typeImports: [{ package: '@test/param', named: 'P', alias: 'TP' }],
            },
            operationTypes: {
              import: { package: '@test/ops', named: 'O', alias: 'TO' },
            },
            queryOperationTypes: {
              import: { package: '@test/qops', named: 'Q', alias: 'TQ' },
            },
          },
          authoring: {
            type: {
              myType: {
                kind: 'typeConstructor',
                output: { codecId: 'a@1', nativeType: 'text' },
              },
            },
          },
        }),
        extensionPacks: [],
      }),
    );

    expect(state.codecTypeImports).toHaveLength(2);
    expect(state.operationTypeImports).toHaveLength(1);
    expect(state.queryOperationTypeImports).toHaveLength(1);
    expect(state.extensionIds).toEqual(['sql', 'target', 'adapter']);
    expect(state.parameterizedRenderers.size).toBe(1);
    expect(state.parameterizedTypeImports).toHaveLength(1);
    expect(Object.keys(state.authoringContributions.type)).toEqual(['myType']);
  });

  it('preserves ID ordering: family, target, adapter, extensions', () => {
    const state = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'fam' }),
        target: createDescriptor({ kind: 'target', id: 'tgt' }),
        adapter: createDescriptor({ kind: 'adapter', id: 'adp' }),
        extensionPacks: [
          createDescriptor({ kind: 'extension', id: 'ext1' }),
          createDescriptor({ kind: 'extension', id: 'ext2' }),
        ],
      }),
    );
    expect(state.extensionIds).toEqual(['fam', 'tgt', 'adp', 'ext1', 'ext2']);
  });

  it('works with family + target only (Mongo case)', () => {
    const state = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'mongo' }),
        target: createDescriptor({
          kind: 'target',
          id: 'mongo',
          types: {
            codecTypes: {
              import: {
                package: '@prisma-next/mongo-core/codec-types',
                named: 'CodecTypes',
                alias: 'MongoCodecTypes',
              },
            },
          },
        }),
      }),
    );

    expect(state.codecTypeImports).toHaveLength(1);
    expect(state.extensionIds).toEqual(['mongo']);
    expect(state.operationTypeImports).toEqual([]);
    expect(state.parameterizedRenderers.size).toBe(0);
  });

  it('assembles operationRegistry from descriptor operationSignatures', () => {
    const state = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'sql' }),
        target: createDescriptor({
          kind: 'target',
          id: 'postgres',
          operationSignatures: () => [
            {
              forTypeId: 'int4',
              method: 'increment',
              args: [{ kind: 'param' as const }],
              returns: { kind: 'typeId' as const, type: 'int4' },
            },
          ],
        }),
        adapter: createDescriptor({
          kind: 'adapter',
          id: 'pg-adapter',
          operationSignatures: () => [
            {
              forTypeId: 'text',
              method: 'concat',
              args: [{ kind: 'param' as const }],
              returns: { kind: 'typeId' as const, type: 'text' },
            },
          ],
        }),
        extensionPacks: [
          createDescriptor({
            kind: 'extension',
            id: 'pgvector',
            operationSignatures: () => [
              {
                forTypeId: 'vector',
                method: 'distance',
                args: [{ kind: 'typeId' as const, type: 'vector' }],
                returns: { kind: 'builtin' as const, type: 'number' as const },
              },
            ],
          }),
        ],
      }),
    );

    expect(state.operationRegistry.byType('int4')).toHaveLength(1);
    expect(state.operationRegistry.byType('int4')[0]?.method).toBe('increment');
    expect(state.operationRegistry.byType('text')).toHaveLength(1);
    expect(state.operationRegistry.byType('text')[0]?.method).toBe('concat');
    expect(state.operationRegistry.byType('vector')).toHaveLength(1);
    expect(state.operationRegistry.byType('vector')[0]?.method).toBe('distance');
  });

  it('returns empty operationRegistry when descriptors lack operationSignatures', () => {
    const state = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'fam' }),
        target: createDescriptor({ kind: 'target', id: 'tgt' }),
      }),
    );
    expect(state.operationRegistry.byType('anything')).toEqual([]);
  });

  it('returns empty state when descriptors have no types', () => {
    const state = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'fam' }),
        target: createDescriptor({ kind: 'target', id: 'tgt' }),
      }),
    );
    expect(state.codecTypeImports).toEqual([]);
    expect(state.operationTypeImports).toEqual([]);
    expect(state.queryOperationTypeImports).toEqual([]);
    expect(state.extensionIds).toEqual(['fam', 'tgt']);
    expect(state.parameterizedRenderers.size).toBe(0);
    expect(state.parameterizedTypeImports).toEqual([]);
    expect(state.authoringContributions).toEqual({ field: {}, type: {} });
  });
});
