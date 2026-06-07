import type { JsonValue } from '@prisma-next/contract/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';
import type { CreateControlStackInput } from '../src/control/control-stack';
import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
  assembleScalarTypeDescriptors,
  buildExtensionLoadOrder,
  createControlStack,
  extractCodecLookup,
  extractCodecTypeImports,
  extractComponentIds,
  extractQueryOperationTypeImports,
  validateScalarTypeCodecIds,
} from '../src/control/control-stack';
import type { Codec } from '../src/shared/codec';
import type { AnyCodecDescriptor } from '../src/shared/codec-descriptor';
import type { CodecLookup } from '../src/shared/codec-types';
import type { ComponentDescriptor } from '../src/shared/framework-components';

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
    expect(result).toEqual({ field: {}, type: {}, entityTypes: {} });
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

  it('rejects malformed descriptor values during merge instead of recursing into primitives', () => {
    // A descriptor missing `output` fails the canonical leaf guard but is a plain object, so the walker would historically recurse INTO it and, on the second registration of the same path, try to walk through the inner `'fieldPreset'` string of the `kind` property — either silently mangling state or infinite-looping. The walker now rejects the malformed value with a clear path-aware error.
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            field: {
              malformed: { kind: 'fieldPreset' } as unknown as never,
            },
          },
        }),
        createDescriptor({
          id: 'other',
          authoring: {
            field: {
              malformed: { kind: 'fieldPreset' } as unknown as never,
            },
          },
        }),
      ]),
    ).toThrow(/Invalid authoring field helper "malformed\.kind"/);
  });

  it('rejects field preset and type constructor path collisions', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            field: {
              custom: {
                Json: { kind: 'fieldPreset', output: { codecId: 'a@1', nativeType: 'json' } },
              },
            },
          },
        }),
        createDescriptor({
          id: 'other',
          authoring: {
            type: {
              custom: {
                Json: {
                  kind: 'typeConstructor',
                  output: { codecId: 'b@1', nativeType: 'jsonb' },
                },
              },
            },
          },
        }),
      ]),
    ).toThrow(/Ambiguous authoring registry path "custom.Json"/);
  });

  it('merges entityTypes namespaces from multiple descriptors', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        authoring: {
          entityTypes: {
            enum: {
              kind: 'entity',
              discriminator: 'postgres-enum',
              output: { factory: () => ({}) },
            },
          },
        },
      }),
      createDescriptor({
        id: 'other',
        authoring: {
          entityTypes: {
            demo: {
              kind: 'entity',
              discriminator: 'demo-entity',
              output: { factory: () => ({}) },
            },
          },
        },
      }),
    ]);
    expect(Object.keys(result.entityTypes)).toEqual(['enum', 'demo']);
  });
});

describe('extractCodecLookup', () => {
  const stubCodec = (id: string) =>
    ({
      id,
      encode: async (v: unknown) => v,
      decode: async (v: unknown) => v,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => j,
    }) as unknown as Codec;

  const stubDescriptor = (id: string): AnyCodecDescriptor => ({
    codecId: id,
    traits: [],
    targetTypes: [],
    paramsSchema: {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ value: undefined }),
      },
    } as unknown as StandardSchemaV1<void>,
    isParameterized: false,
    factory: () => () => stubCodec(id),
  });

  it('builds a lookup from codec descriptors across components', () => {
    const lookup = extractCodecLookup([
      { id: 'desc-1', types: { codecTypes: { codecDescriptors: [stubDescriptor('a@1')] } } },
      { id: 'desc-2', types: { codecTypes: { codecDescriptors: [stubDescriptor('b@1')] } } },
    ]);
    expect(lookup.get('a@1')?.id).toBe('a@1');
    expect(lookup.get('b@1')?.id).toBe('b@1');
  });

  it('returns undefined for unknown codec ids', () => {
    const lookup = extractCodecLookup([
      { id: 'desc', types: { codecTypes: { codecDescriptors: [stubDescriptor('a@1')] } } },
    ]);
    expect(lookup.get('z@1')).toBeUndefined();
  });

  it('throws on duplicate codec ids from different descriptors', () => {
    expect(() =>
      extractCodecLookup([
        { id: 'desc-1', types: { codecTypes: { codecDescriptors: [stubDescriptor('a@1')] } } },
        { id: 'desc-2', types: { codecTypes: { codecDescriptors: [stubDescriptor('a@1')] } } },
      ]),
    ).toThrow(/Duplicate codec descriptor for codecId "a@1"/);
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
  });

  it('returns empty state when descriptors have no types', () => {
    const state = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'fam' }),
        target: createDescriptor({ kind: 'target', id: 'tgt' }),
      }),
    );
    expect(state.codecTypeImports).toEqual([]);
    expect(state.queryOperationTypeImports).toEqual([]);
    expect(state.extensionIds).toEqual(['fam', 'tgt']);
    expect(state.authoringContributions).toEqual({ field: {}, type: {}, entityTypes: {} });
  });
});

describe('validateScalarTypeCodecIds', () => {
  it('returns errors for unregistered codec IDs', () => {
    const descriptors = new Map([['String', 'missing/codec@1']]);
    const lookup: CodecLookup = {
      get: () => undefined,
      targetTypesFor: () => undefined,
      metaFor: () => undefined,
      renderOutputTypeFor: () => undefined,
      parsePslLiteralFor: (id) => ({ ok: false, error: `codec "${id}" is not registered` }),
    };
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
              encode: async (v: unknown) => v,
              decode: async (v: unknown) => v,
              encodeJson: (v: unknown) => v as JsonValue,
              decodeJson: (v: JsonValue) => v,
            }
          : undefined,
      targetTypesFor: (id: string) => (id === 'test/text@1' ? ['text'] : undefined),
      metaFor: () => undefined,
      renderOutputTypeFor: () => undefined,
      parsePslLiteralFor: (id) => ({ ok: false, error: `codec "${id}" is not registered` }),
    };
    const errors = validateScalarTypeCodecIds(descriptors, lookup);
    expect(errors).toEqual([]);
  });
});

function makeExtension(
  id: string,
  deps: readonly string[] = [],
): { id: string; contractSpace?: { contractJson: { extensionPacks?: Record<string, unknown> } } } {
  return {
    id,
    contractSpace:
      deps.length > 0
        ? {
            contractJson: {
              extensionPacks: Object.fromEntries(deps.map((dep) => [dep, {}])),
            },
          }
        : { contractJson: {} },
  };
}

describe('buildExtensionLoadOrder', () => {
  it('returns an empty list when no extensions are provided', () => {
    expect(buildExtensionLoadOrder([])).toEqual([]);
  });

  it('returns a single extension with no dependencies in a one-element list', () => {
    const ext = makeExtension('a');
    expect(buildExtensionLoadOrder([ext])).toEqual(['a']);
  });

  it('places a dependency before the extension that depends on it (linear A→B→C chain)', () => {
    const a = makeExtension('a');
    const b = makeExtension('b', ['a']);
    const c = makeExtension('c', ['b']);
    const order = buildExtensionLoadOrder([c, b, a]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('handles an extension with multiple dependencies', () => {
    const a = makeExtension('a');
    const b = makeExtension('b');
    const c = makeExtension('c', ['a', 'b']);
    const order = buildExtensionLoadOrder([c, a, b]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('places a declared dependency before the pack that depends on it', () => {
    const a = makeExtension('a');
    const b = makeExtension('b', ['a']);
    const order = buildExtensionLoadOrder([b, a]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  });

  it('throws when a declared dependency is absent from the provided set', () => {
    const b = makeExtension('b', ['missing-pack']);
    expect(() => buildExtensionLoadOrder([b])).toThrow(
      /missing dependency|add .* to extensionPacks/i,
    );
    expect(() => buildExtensionLoadOrder([b])).toThrow(/missing-pack/);
  });

  it('rejects a 2-cycle (A↔B) and names both members in the error', () => {
    const a = makeExtension('a', ['b']);
    const b = makeExtension('b', ['a']);
    expect(() => buildExtensionLoadOrder([a, b])).toThrow(/cycle/i);
    expect(() => buildExtensionLoadOrder([a, b])).toThrow(/a/);
    expect(() => buildExtensionLoadOrder([a, b])).toThrow(/b/);
  });

  it('rejects a 3-cycle (A→B→C→A) and names the cycle members in the error', () => {
    const a = makeExtension('a', ['c']);
    const b = makeExtension('b', ['a']);
    const c = makeExtension('c', ['b']);
    expect(() => buildExtensionLoadOrder([a, b, c])).toThrow(/cycle/i);
    const msg = (() => {
      try {
        buildExtensionLoadOrder([a, b, c]);
        return '';
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    })();
    expect(msg).toMatch(/a/);
    expect(msg).toMatch(/b/);
    expect(msg).toMatch(/c/);
  });

  it('extensions without contractSpace are treated as having no declared dependencies', () => {
    const plain = { id: 'plain' };
    const withSpace = makeExtension('withSpace', ['plain']);
    const order = buildExtensionLoadOrder([withSpace, plain]);
    expect(order.indexOf('plain')).toBeLessThan(order.indexOf('withSpace'));
  });

  it('extensions with contractSpace but empty extensionPacks have no declared dependencies', () => {
    const a = makeExtension('a');
    const b = makeExtension('b');
    const order = buildExtensionLoadOrder([a, b]);
    expect(order).toContain('a');
    expect(order).toContain('b');
  });

  it('createControlStack throws on a 2-cycle in extension dependencies', () => {
    const a = {
      ...createDescriptor({ kind: 'extension' as const, id: 'ext-a' }),
      contractSpace: { contractJson: { extensionPacks: { 'ext-b': {} } } },
    };
    const b = {
      ...createDescriptor({ kind: 'extension' as const, id: 'ext-b' }),
      contractSpace: { contractJson: { extensionPacks: { 'ext-a': {} } } },
    };
    expect(() =>
      createControlStack(
        stubInput({
          family: createDescriptor({ kind: 'family', id: 'sql' }),
          target: createDescriptor({ kind: 'target', id: 'postgres' }),
          extensionPacks: [a, b],
        }),
      ),
    ).toThrow(/cycle/i);
  });

  it('assembles extensionPacks in dependency order even when input lists dependent before dependency', () => {
    const dep = {
      ...createDescriptor({ kind: 'extension' as const, id: 'dep' }),
      contractSpace: { contractJson: {} },
    };
    const consumer = {
      ...createDescriptor({ kind: 'extension' as const, id: 'consumer' }),
      contractSpace: { contractJson: { extensionPacks: { dep: {} } } },
    };
    // Input order: consumer first (would fail ordering if not reordered)
    const stack = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'sql' }),
        target: createDescriptor({ kind: 'target', id: 'postgres' }),
        extensionPacks: [consumer, dep],
      }),
    );
    const extIds = stack.extensionPacks.map((e: { id: string }) => e.id);
    expect(extIds.indexOf('dep')).toBeLessThan(extIds.indexOf('consumer'));
  });
});
