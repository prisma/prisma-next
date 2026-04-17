import type { JsonValue } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import type { CodecLookup } from '../src/codec-types';
import type { CreateControlStackInput } from '../src/control-stack';
import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
  assembleScalarTypeDescriptors,
  createControlStack,
  extractCodecLookup,
  extractCodecTypeImports,
  extractComponentIds,
  extractOperationTypeImports,
  extractQueryOperationTypeImports,
  validateScalarTypeCodecIds,
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

describe('extractCodecLookup', () => {
  const stubCodec = (id: string) =>
    ({
      id,
      targetTypes: [],
      decode: (w: unknown) => w,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => j,
    }) as unknown as import('../src/codec-types').Codec;

  it('builds a lookup from codec instances across descriptors', () => {
    const codec1 = stubCodec('a@1');
    const codec2 = stubCodec('b@1');
    const lookup = extractCodecLookup([
      { id: 'desc-1', types: { codecTypes: { codecInstances: [codec1] } } },
      { id: 'desc-2', types: { codecTypes: { codecInstances: [codec2] } } },
    ]);
    expect(lookup.get('a@1')).toBe(codec1);
    expect(lookup.get('b@1')).toBe(codec2);
  });

  it('returns undefined for unknown codec ids', () => {
    const lookup = extractCodecLookup([
      { id: 'desc', types: { codecTypes: { codecInstances: [stubCodec('a@1')] } } },
    ]);
    expect(lookup.get('z@1')).toBeUndefined();
  });

  it('throws on duplicate codec ids from different descriptors', () => {
    expect(() =>
      extractCodecLookup([
        { id: 'desc-1', types: { codecTypes: { codecInstances: [stubCodec('a@1')] } } },
        { id: 'desc-2', types: { codecTypes: { codecInstances: [stubCodec('a@1')] } } },
      ]),
    ).toThrow(/Duplicate codec instance for codecId "a@1"/);
  });
});

describe('assembleScalarTypeDescriptors', () => {
  it('returns empty map when no descriptors contribute', () => {
    const result = assembleScalarTypeDescriptors([createDescriptor()]);
    expect(result.size).toBe(0);
  });

  it('merges scalar type descriptors from multiple descriptors', () => {
    const result = assembleScalarTypeDescriptors([
      createDescriptor({
        id: 'target',
        scalarTypeDescriptors: new Map([
          ['String', 'pg/text@1'],
          ['Int', 'pg/int4@1'],
        ]),
      }),
      createDescriptor({
        id: 'extension',
        scalarTypeDescriptors: new Map([['Vector', 'pgvector/vector@1']]),
      }),
    ]);
    expect(result.size).toBe(3);
    expect(result.get('String')).toBe('pg/text@1');
    expect(result.get('Int')).toBe('pg/int4@1');
    expect(result.get('Vector')).toBe('pgvector/vector@1');
  });

  it('throws on duplicate type name from different descriptors', () => {
    expect(() =>
      assembleScalarTypeDescriptors([
        createDescriptor({
          id: 'desc-a',
          scalarTypeDescriptors: new Map([['String', 'a/text@1']]),
        }),
        createDescriptor({
          id: 'desc-b',
          scalarTypeDescriptors: new Map([['String', 'b/text@1']]),
        }),
      ]),
    ).toThrow(/Duplicate scalar type descriptor "String".*"desc-b".*"desc-a"/);
  });
});

describe('assembleControlMutationDefaults', () => {
  const stubLower = () => ({
    ok: true as const,
    value: { kind: 'storage' as const, defaultValue: { kind: 'literal' as const, value: 0 } },
  });

  it('returns empty registry and generators when no descriptors contribute', () => {
    const result = assembleControlMutationDefaults([createDescriptor()]);
    expect(result.defaultFunctionRegistry.size).toBe(0);
    expect(result.generatorDescriptors).toEqual([]);
  });

  it('merges function registries from multiple descriptors', () => {
    const result = assembleControlMutationDefaults([
      createDescriptor({
        id: 'desc-a',
        controlMutationDefaults: {
          defaultFunctionRegistry: new Map([['now', { lower: stubLower }]]),
          generatorDescriptors: [],
        },
      }),
      createDescriptor({
        id: 'desc-b',
        controlMutationDefaults: {
          defaultFunctionRegistry: new Map([['uuid', { lower: stubLower }]]),
          generatorDescriptors: [{ id: 'uuidv4', applicableCodecIds: ['pg/text@1'] }],
        },
      }),
    ]);
    expect(result.defaultFunctionRegistry.size).toBe(2);
    expect(result.defaultFunctionRegistry.has('now')).toBe(true);
    expect(result.defaultFunctionRegistry.has('uuid')).toBe(true);
    expect(result.generatorDescriptors).toHaveLength(1);
  });

  it('throws on duplicate function name', () => {
    expect(() =>
      assembleControlMutationDefaults([
        createDescriptor({
          id: 'desc-a',
          controlMutationDefaults: {
            defaultFunctionRegistry: new Map([['now', { lower: stubLower }]]),
            generatorDescriptors: [],
          },
        }),
        createDescriptor({
          id: 'desc-b',
          controlMutationDefaults: {
            defaultFunctionRegistry: new Map([['now', { lower: stubLower }]]),
            generatorDescriptors: [],
          },
        }),
      ]),
    ).toThrow(/Duplicate mutation default function "now".*"desc-b".*"desc-a"/);
  });

  it('throws on duplicate generator id', () => {
    expect(() =>
      assembleControlMutationDefaults([
        createDescriptor({
          id: 'desc-a',
          controlMutationDefaults: {
            defaultFunctionRegistry: new Map(),
            generatorDescriptors: [{ id: 'uuidv4', applicableCodecIds: ['a@1'] }],
          },
        }),
        createDescriptor({
          id: 'desc-b',
          controlMutationDefaults: {
            defaultFunctionRegistry: new Map(),
            generatorDescriptors: [{ id: 'uuidv4', applicableCodecIds: ['b@1'] }],
          },
        }),
      ]),
    ).toThrow(/Duplicate mutation default generator id "uuidv4".*"desc-b".*"desc-a"/);
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

describe('validateScalarTypeCodecIds', () => {
  it('returns errors for unregistered codec IDs', () => {
    const descriptors = new Map([['String', 'missing/codec@1']]);
    const lookup = { get: () => undefined };
    const errors = validateScalarTypeCodecIds(descriptors, lookup);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Scalar type "String" references codec "missing\/codec@1"/);
  });

  it('returns empty array when all codec IDs are registered', () => {
    const descriptors = new Map([['String', 'test/text@1']]);
    const lookup: CodecLookup = {
      get: (id: string) =>
        id === 'test/text@1'
          ? {
              id,
              targetTypes: ['text'],
              decode: (v: unknown) => v,
              encodeJson: (v: unknown) => v as JsonValue,
              decodeJson: (v: JsonValue) => v,
            }
          : undefined,
    };
    const errors = validateScalarTypeCodecIds(descriptors, lookup);
    expect(errors).toEqual([]);
  });
});
