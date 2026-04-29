import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { Codec, Ctx } from '@prisma-next/framework-components/codec';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import { describe, expect, it } from 'vitest';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
} from '../src/sql-context';
import { createStubAdapter, createTestContext } from './utils';

// Phase 3 of the codec-registry-unification project introduced
// `ContractCodecRegistry` (see ADR 205 and the surface-segregation rationale
// in `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts`). The
// registry is built once at `createExecutionContext` and exposes:
//
// - `forColumn(table, column)`: per-column resolved codec — the per-instance
//   parameterized codec for parameterized columns, the shared codec from the
//   legacy registry for non-parameterized columns.
// - `forCodecId(codecId)`: codec-id-keyed fallback for sites that don't carry
//   `(table, column)` through to the encode/decode call site (the SQL builder
//   param-encoding path is the load-bearing example).

// A vector factory whose returned codec keeps `length` on its `meta` so the
// per-instance differentiation across columns is observable from tests.
function makeVectorFactory(): (params: {
  readonly length: number;
}) => (ctx: Ctx) => Codec & { readonly meta: { readonly length: number } } {
  return (params) => (_ctx) =>
    ({
      id: 'pg/vector@1',
      targetTypes: ['vector'] as const,
      decode: (wire: unknown) => wire,
      encodeJson: (v) => v as never,
      decodeJson: (j) => j as never,
      meta: { length: params.length },
    }) as Codec & { readonly meta: { readonly length: number } };
}

function createVectorExtensionDescriptor(): SqlRuntimeExtensionDescriptor<'postgres'> {
  const parameterizedCodecs: RuntimeParameterizedCodecDescriptor<{ length: number }>[] = [
    {
      codecId: 'pg/vector@1',
      traits: ['equality'] as const,
      targetTypes: ['vector'] as const,
      paramsSchema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (value) => ({ value: value as { length: number } }),
        },
      },
      factory: makeVectorFactory(),
    },
  ];

  // The legacy `codecs:` registration exposes a representative codec used as
  // the codec-id fallback. Production parameterized codec runtime descriptors
  // ship the same shape today.
  const registry = createCodecRegistry();
  registry.register(
    codec({
      typeId: 'pg/vector@1',
      targetTypes: ['vector'],
      encode: (v: number[]) => v,
      decode: (w: number[]) => w,
    }),
  );

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
  // Use a custom codec id to avoid colliding with the default test target
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
    // The per-instance codec carries the column's `length`. Confirms the
    // dispatch path resolves to the descriptor's factory(typeParams)(ctx),
    // not the codec-id-keyed fallback. The `meta.length` field is a test-
    // local marker; the framework `Codec` type allows arbitrary `meta`, so
    // the cast through `unknown` is a structural narrow rather than a type
    // assertion against the framework shape.
    expect(
      (resolved as unknown as { readonly meta: { readonly length: number } }).meta.length,
    ).toBe(768);
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
    // Both columns share the named instance — ergo the same codec object.
    // Phase 3's per-column walk reuses the codec materialized by
    // `initializeTypeHelpers` for typeRef columns, so per-instance state
    // (e.g. encryption keys derived from `ctx.usedAt`) is shared across
    // the column set.
    expect(docCodec).toBe(pageCodec);
    expect(
      (docCodec as unknown as { readonly meta: { readonly length: number } }).meta.length,
    ).toBe(1536);
  });

  it('forColumn returns the shared legacy codec for non-parameterized columns', () => {
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

  it('forCodecId returns the legacy registry codec by id', () => {
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
    // CodecRegistry.get(id) returns.
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

// Phase 3.5 of codec-registry-unification: descriptorFor is the codec-id-keyed
// metadata read; it returns the registered descriptor for parameterized AND
// non-parameterized codec ids without branching. The descriptor map is the
// single source of truth for `traits`, `targetTypes`, and (via the descriptor's
// factory) the resolved codec instances. See spec § Decision and AC-3.
describe('CodecDescriptorRegistry (unified)', () => {
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
    // This test asserts the non-branching read site (spec § Decision).
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
    // Synthesized descriptors carry empty traits if the codec didn't declare
    // any (the legacy `codec(...)` factory in this fixture omits the field).
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
});
