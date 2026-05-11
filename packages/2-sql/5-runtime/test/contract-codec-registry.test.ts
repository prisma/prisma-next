import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type {
  CodecDescriptor,
  CodecInstanceContext,
} from '@prisma-next/framework-components/codec';
import { voidParamsSchema } from '@prisma-next/framework-components/codec';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Codec } from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import { describe, expect, it } from 'vitest';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
} from '../src/sql-context';
import { defineTestCodec } from './test-codec';
import { createStubAdapter, createTestContext } from './utils';

// The codec-registry layer exposes two runtime registries:
//
// - `ContractCodecRegistry` (`context.contractCodecs`): per-column resolved-codec dispatch with `forColumn(table, column)` and a codec-id-keyed fallback `forCodecId(codecId)` for sites without a column ref.
// - `CodecDescriptorRegistry` (`context.codecDescriptors`): codec-id-keyed metadata read with `descriptorFor(codecId)` — non-branching for parameterized vs. non-parameterized codecs (every non-parameterized codec is auto-lifted into a synthesized `CodecDescriptor<void>`).

function makeVectorCodec(meta?: Record<string, unknown>): Codec {
  const baseCodec = defineTestCodec({
    typeId: 'pg/vector@1',
    encode: (v: number[]) => v,
    decode: (w: number[]) => w,
  });
  if (!meta) return baseCodec;
  // The narrow `Codec` shape is conversion-only (TML-2357); the `meta` sentinel here is test-side bookkeeping that downstream assertions read off the exact instance handed back by the factory.
  return { ...baseCodec, meta } as unknown as Codec;
}

function createVectorExtensionDescriptor(): SqlRuntimeExtensionDescriptor<'postgres'> {
  // The factory returns a per-instance codec whose `meta.length` carries the parameter — so tests can observe per-instance differentiation.
  const factory: (params: { length: number }) => (ctx: CodecInstanceContext) => Codec =
    (params) => (_ctx) =>
      makeVectorCodec({ length: params.length });

  const vectorDescriptor: RuntimeParameterizedCodecDescriptor<{ length: number }> = {
    codecId: 'pg/vector@1',
    traits: ['equality'],
    targetTypes: ['vector'],
    paramsSchema: {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => ({ value: value as { length: number } }),
      },
    },
    isParameterized: true,
    factory,
  };

  const descriptors: ReadonlyArray<CodecDescriptor> = [
    vectorDescriptor as unknown as CodecDescriptor,
  ];

  return {
    kind: 'extension' as const,
    id: 'pgvector-test',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptors,
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createNonParameterizedExtensionDescriptor(): SqlRuntimeExtensionDescriptor<'postgres'> {
  // Custom codec id avoids colliding with the default test target descriptor's pre-registered codecs (`pg/text@1`, etc.).
  const scalarCodec = defineTestCodec({
    typeId: 'test/scalar@1',
    targetTypes: ['scalar'],
    encode: (v: string) => v,
    decode: (w: string) => w,
  });

  const scalarDescriptor: CodecDescriptor = {
    codecId: 'test/scalar@1',
    traits: [],
    targetTypes: ['scalar'],
    paramsSchema: voidParamsSchema,
    isParameterized: false,
    factory: () => () => scalarCodec,
  };

  return {
    kind: 'extension' as const,
    id: 'scalar-test',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => [scalarDescriptor],
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createTestContract(
  tables: Record<
    string,
    Record<
      string,
      {
        nativeType: string;
        codecId: string;
        nullable: boolean;
        typeParams?: Record<string, unknown>;
        typeRef?: string;
      }
    >
  >,
  types?: SqlStorage['types'],
): Contract<SqlStorage> {
  const tableEntries = Object.fromEntries(
    Object.entries(tables).map(([tableName, columns]) => [
      tableName,
      {
        columns,
        primaryKey: { columns: [Object.keys(columns)[0] ?? 'id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    ]),
  );

  return {
    targetFamily: 'sql',
    target: 'postgres',
    profileHash: profileHash('sha256:test'),
    models: {},
    roots: {},
    storage: {
      storageHash: coreHash('sha256:test'),
      tables: tableEntries,
      ...ifDefined('types', types),
    },
    extensionPacks: {},
    capabilities: {},
    meta: {},
  };
}

describe('ContractCodecRegistry', () => {
  it('forColumn returns the per-instance codec for inline-typeParams parameterized columns', () => {
    const contract = createTestContract({
      Doc: {
        embedding: {
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: false,
          typeParams: { length: 768 },
        },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [createVectorExtensionDescriptor()],
    });

    const resolved = context.contractCodecs.forColumn('Doc', 'embedding');
    expect(resolved).toBeDefined();
    // The per-instance codec carries the column's `length` on its meta — confirms the dispatch path resolves through `factory(typeParams) (ctx)`, not the codec-id-keyed fallback.
    expect((resolved as Codec & { meta: { length: number } }).meta.length).toBe(768);
  });

  it('forColumn returns the same per-instance codec for typeRef columns sharing a named storage type', () => {
    const contract = createTestContract(
      {
        Doc: {
          embedding: {
            nativeType: 'vector',
            codecId: 'pg/vector@1',
            nullable: false,
            typeRef: 'Vector1536',
          },
        },
        Page: {
          embedding: {
            nativeType: 'vector',
            codecId: 'pg/vector@1',
            nullable: false,
            typeRef: 'Vector1536',
          },
        },
      },
      {
        Vector1536: {
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      },
    );

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [createVectorExtensionDescriptor()],
    });

    const docCodec = context.contractCodecs.forColumn('Doc', 'embedding');
    const pageCodec = context.contractCodecs.forColumn('Page', 'embedding');

    expect(docCodec).toBeDefined();
    expect(pageCodec).toBeDefined();
    // Both columns share the named instance — same codec object.
    expect(docCodec).toBe(pageCodec);
    expect((docCodec as Codec & { meta: { length: number } }).meta.length).toBe(1536);
  });

  it('forColumn returns the shared codec for non-parameterized columns', () => {
    const contract = createTestContract({
      User: {
        primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false },
        secondary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: true },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [createNonParameterizedExtensionDescriptor()],
    });

    const primaryCodec = context.contractCodecs.forColumn('User', 'primary');
    const secondaryCodec = context.contractCodecs.forColumn('User', 'secondary');

    expect(primaryCodec).toBeDefined();
    expect(secondaryCodec).toBeDefined();
    // Non-parameterized codec ids share one codec instance across every column with that id.
    expect(primaryCodec).toBe(secondaryCodec);
    expect(primaryCodec?.id).toBe('test/scalar@1');
  });

  it('forColumn returns undefined for an unknown column', () => {
    const contract = createTestContract({
      User: {
        primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [createNonParameterizedExtensionDescriptor()],
    });

    expect(context.contractCodecs.forColumn('User', 'nonexistent')).toBeUndefined();
    expect(context.contractCodecs.forColumn('NoSuchTable', 'whatever')).toBeUndefined();
  });

  it('forCodecId returns a codec by id (legacy registry fallback)', () => {
    const contract = createTestContract({
      User: { primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false } },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [createNonParameterizedExtensionDescriptor()],
    });

    const codecById = context.contractCodecs.forCodecId('test/scalar@1');
    expect(codecById).toBeDefined();
    expect(codecById?.id).toBe('test/scalar@1');
  });

  it('forCodecId returns undefined for an unknown codec id', () => {
    const contract = createTestContract({
      User: { primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false } },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [createNonParameterizedExtensionDescriptor()],
    });

    expect(context.contractCodecs.forCodecId('does-not-exist@1')).toBeUndefined();
  });

  // Two parameterized columns with distinct typeParams resolve to two
  // distinct codec instances under the same codec id. By default that's
  // ambiguous — `forCodecId` rejects rather than silently bind to the
  // first registered instance.
  it('forCodecId throws RUNTIME.TYPE_PARAMS_INVALID when multiple distinct instances share a parameterized codec id', () => {
    const contract = createTestContract({
      Doc: {
        small: {
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: false,
          typeParams: { length: 768 },
        },
        large: {
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: false,
          typeParams: { length: 1536 },
        },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [createVectorExtensionDescriptor()],
    });

    expect(() => context.contractCodecs.forCodecId('pg/vector@1')).toThrow(
      /resolves to multiple parameterized instances/,
    );
  });

  // Descriptors that declare `encodeIsParamsIndependent: true` opt out of
  // the ambiguity rejection. Two distinct resolved instances under the
  // same codec id are then acceptable for the encode-side `forCodecId`
  // fallback because every instance encodes equivalently. Decode still
  // uses `forColumn` to get the instance-specific schema.
  it('forCodecId tolerates multiple instances when descriptor.encodeIsParamsIndependent is true', () => {
    const factory: (params: { length: number }) => (ctx: CodecInstanceContext) => Codec =
      (params) => () =>
        makeVectorCodec({ length: params.length });

    const vectorDescriptor: RuntimeParameterizedCodecDescriptor<{ length: number }> = {
      codecId: 'pg/vector@1',
      traits: ['equality'],
      targetTypes: ['vector'],
      paramsSchema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (value: unknown) => ({ value: value as { length: number } }),
        },
      },
      isParameterized: true,
      factory,
      encodeIsParamsIndependent: true,
    };

    const descriptors: ReadonlyArray<CodecDescriptor> = [
      vectorDescriptor as unknown as CodecDescriptor,
    ];

    const paramsIndependentDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
      kind: 'extension' as const,
      id: 'pgvector-params-independent',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      codecs: () => descriptors,
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    };

    const contract = createTestContract({
      Doc: {
        small: {
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: false,
          typeParams: { length: 768 },
        },
        large: {
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: false,
          typeParams: { length: 1536 },
        },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [paramsIndependentDescriptor],
    });

    // forCodecId resolves to one of the registered instances rather than
    // throwing. Per-column dispatch via forColumn still distinguishes
    // them.
    const fromCodecId = context.contractCodecs.forCodecId('pg/vector@1');
    expect(fromCodecId).toBeDefined();

    const small = context.contractCodecs.forColumn('Doc', 'small');
    const large = context.contractCodecs.forColumn('Doc', 'large');
    expect((small as Codec & { meta: { length: number } }).meta.length).toBe(768);
    expect((large as Codec & { meta: { length: number } }).meta.length).toBe(1536);
  });
});

describe('CodecDescriptorRegistry', () => {
  it('descriptorFor returns the parameterized descriptor for a parameterized codec id', () => {
    const contract = createTestContract({
      Doc: {
        embedding: {
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: false,
          typeParams: { length: 768 },
        },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [createVectorExtensionDescriptor()],
    });

    const descriptor = context.codecDescriptors.descriptorFor('pg/vector@1');
    expect(descriptor).toBeDefined();
    expect(descriptor?.codecId).toBe('pg/vector@1');
    expect(descriptor?.traits).toEqual(['equality']);
    expect(descriptor?.targetTypes).toEqual(['vector']);
  });

  it('descriptorFor returns the synthesized descriptor for a non-parameterized codec id', () => {
    const contract = createTestContract({
      User: { primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false } },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [createNonParameterizedExtensionDescriptor()],
    });

    const descriptor = context.codecDescriptors.descriptorFor('test/scalar@1');
    expect(descriptor).toBeDefined();
    expect(descriptor?.codecId).toBe('test/scalar@1');
    expect(descriptor?.targetTypes).toEqual(['scalar']);
  });

  it('descriptorFor reads use the same call shape for parameterized and non-parameterized codec ids', () => {
    // The defining property of the unified descriptor map: callers don't need to know whether a codec id is parameterized to read its traits.
    const contract = createTestContract({
      Doc: {
        embedding: {
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: false,
          typeParams: { length: 384 },
        },
      },
      User: {
        primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [
        createVectorExtensionDescriptor(),
        createNonParameterizedExtensionDescriptor(),
      ],
    });

    const traitsByCodecId = (codecId: string): readonly string[] =>
      context.codecDescriptors.descriptorFor(codecId)?.traits ?? [];

    expect(traitsByCodecId('pg/vector@1')).toEqual(['equality']);
    // Synthesized descriptors carry empty traits if the codec didn't declare any.
    expect(traitsByCodecId('test/scalar@1')).toEqual([]);
  });

  it('descriptorFor returns undefined for an unknown codec id', () => {
    const contract = createTestContract({
      User: { primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false } },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [createNonParameterizedExtensionDescriptor()],
    });

    expect(context.codecDescriptors.descriptorFor('unknown/codec@1')).toBeUndefined();
  });

  it('values() iterates every registered descriptor', () => {
    const contract = createTestContract({
      User: { primary: { nativeType: 'scalar', codecId: 'test/scalar@1', nullable: false } },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [createNonParameterizedExtensionDescriptor()],
    });

    const codecIds = Array.from(context.codecDescriptors.values()).map((d) => d.codecId);
    expect(codecIds).toContain('test/scalar@1');
  });

  it('byTargetType returns descriptors for a given target type', () => {
    const contract = createTestContract({
      Doc: {
        embedding: {
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: false,
          typeParams: { length: 1536 },
        },
      },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [createVectorExtensionDescriptor()],
    });

    const byVector = context.codecDescriptors.byTargetType('vector');
    expect(byVector.length).toBeGreaterThan(0);
    expect(byVector.some((d) => d.codecId === 'pg/vector@1')).toBe(true);
  });
});
