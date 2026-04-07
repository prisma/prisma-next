import { describe, expect, it } from 'vitest';
import type { CreateControlStackInput } from '../src/control-stack';
import {
  assembleAuthoringContributions,
  createControlStack,
  extractCodecTypeImports,
  extractComponentIds,
  extractOperationTypeImports,
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
              package: '@prisma-next/adapter-mongo/codec-types',
              named: 'CodecTypes',
              alias: 'MongoCodecTypes',
            },
          },
        },
      }),
    ]);
    expect(result).toEqual([
      {
        package: '@prisma-next/adapter-mongo/codec-types',
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
                package: '@prisma-next/adapter-mongo/codec-types',
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
    expect(state.authoringContributions).toEqual({ field: {}, type: {} });
  });
});
