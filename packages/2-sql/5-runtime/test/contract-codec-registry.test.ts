import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { Ctx } from '@prisma-next/framework-components/codec';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Codec } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import { describe, expect, it } from 'vitest';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
} from '../src/sql-context';
import { createStubAdapter, createTestContext } from './utils';

// Phase B of the codec-registry-unification project introduces two
// runtime registries:
//
// - `ContractCodecRegistry` (`context.contractCodecs`): per-column
//   resolved-codec dispatch with `forColumn(table, column)` and a codec-
//   id-keyed fallback `forCodecId(codecId)` (the AC-5-deferred carve-out
//   for sites without a column ref).
// - `CodecDescriptorRegistry` (`context.codecDescriptors`): codec-id-
//   keyed metadata read with `descriptorFor(codecId)` — non-branching for
//   parameterized vs. non-parameterized codecs (every non-parameterized
//   codec is auto-lifted into a synthesized `CodecDescriptor<void>`).
//
// See spec § Decision and AC-3, AC-4.

function makeVectorCodec(meta?: Record<string, unknown>): Codec {
  const baseCodec = codec({
    typeId: 'pg/vector@1',
    targetTypes: ['vector'],
    encode: (v: number[]) => v,
    decode: (w: number[]) => w,
  });
  if (!meta) return baseCodec;
  // SQL-side `Codec` declares `meta?: CodecMeta`; cast to the
  // non-undefined branch under `exactOptionalPropertyTypes`.
  return { ...baseCodec, meta: meta as NonNullable<Codec['meta']> };
}

function createVectorExtensionDescriptor(): SqlRuntimeExtensionDescriptor<'postgres'> {
  // The factory returns a per-instance codec whose `meta.length` carries
  // the parameter — so tests can observe per-instance differentiation.
  const factory: (params: { length: number }) => (ctx: Ctx) => Codec = (params) => (_ctx) =>
    makeVectorCodec({ length: params.length });

  const parameterizedCodecs: RuntimeParameterizedCodecDescriptor<{ length: number }>[] = [
    {
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
      factory,
    },
  ];

  // The legacy `codecs:` registration carries a representative codec used
  // as the codec-id fallback. Production parameterized descriptors ship
  // the same shape today.
  const registry = createCodecRegistry();
  registry.register(makeVectorCodec());

  return {
    kind: 'extension' as const,
    id: 'pgvector-test',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => registry,
    parameterizedCodecs: () => parameterizedCodecs,
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createNonParameterizedExtensionDescriptor(): SqlRuntimeExtensionDescriptor<'postgres'> {
  const registry = createCodecRegistry();
  // Custom codec id avoids colliding with the default test target
  // descriptor's pre-registered codecs (`pg/text@1`, etc.).
  registry.register(
    codec({
      typeId: 'test/scalar@1',
      targetTypes: ['scalar'],
      encode: (v: string) => v,
      decode: (w: string) => w,
    }),
  );

  return {
    kind: 'extension' as const,
    id: 'scalar-test',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => registry,
    parameterizedCodecs: () => [],
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
    // The per-instance codec carries the column's `length` on its meta —
    // confirms the dispatch path resolves through `factory(typeParams)
    // (ctx)`, not the codec-id-keyed fallback.
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
    // Non-parameterized codec ids share one codec instance across every
    // column with that id.
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
    // The codec-id fallback returns the same instance the legacy
    // CodecRegistry.get(id) returns for non-parameterized codecs.
    expect(codecById).toBe(context.codecs.get('test/scalar@1'));
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
    // The defining property of the unified descriptor map: callers don't
    // need to know whether a codec id is parameterized to read its traits.
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
    // Synthesized descriptors carry empty traits if the codec didn't
    // declare any.
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
