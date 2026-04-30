import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { Ctx } from '@prisma-next/framework-components/codec';
import type { SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { Codec } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import type { Type } from 'arktype';
import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
} from '../src/sql-context';
import { createStubAdapter, createTestContext } from './utils';

function vectorCodecInstance(meta?: Record<string, unknown>): Codec {
  const baseCodec = codec({
    typeId: 'pg/vector@1',
    targetTypes: ['vector'],
    encode: (v: number[]) => v,
    decode: (w: number[]) => w,
  });
  if (!meta) return baseCodec;
  // Attach SQL-side `meta` on the resolved codec; the SQL `Codec` shape
  // declares `meta?: CodecMeta` so spreading the optional onto the base
  // requires conditional inclusion under `exactOptionalPropertyTypes`.
  return { ...baseCodec, meta: meta as NonNullable<Codec['meta']> };
}

// =============================================================================
// Test helpers
// =============================================================================

function createParamTypesTestContract(
  options?: Partial<{
    types: Record<string, StorageTypeInstance>;
    tableColumns: Record<
      string,
      {
        nativeType: string;
        codecId: string;
        nullable: boolean;
        typeParams?: Record<string, unknown>;
        typeRef?: string;
      }
    >;
  }>,
): Contract<SqlStorage> {
  return {
    targetFamily: 'sql',
    target: 'postgres',
    profileHash: profileHash('sha256:test'),
    models: {},
    roots: {},
    storage: {
      storageHash: coreHash('sha256:test'),
      tables: {
        test: {
          columns: options?.tableColumns ?? {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      ...ifDefined('types', options?.types),
    },
    extensionPacks: {},
    capabilities: {},
    meta: {},
  };
}

// =============================================================================
// Tests: Parameterized type validation
// =============================================================================

describe('parameterized types', () => {
  describe('storage.types validation', () => {
    it('creates context with empty storage.types', () => {
      const contract = createParamTypesTestContract({ types: {} });
      const context = createTestContext(contract, createStubAdapter());

      expect(context.contract.storage.types).toEqual({});
      expect(context.types).toEqual({});
    });

    it('creates context with storage.types containing valid type instances', () => {
      const contract = createParamTypesTestContract({
        types: {
          Vector1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      });
      const context = createTestContext(contract, createStubAdapter());

      expect(context.contract.storage.types).toEqual({
        Vector1536: {
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      });
      // types registry should contain the raw type instance (no init hook provided)
      expect(context.types['Vector1536']).toBeDefined();
    });
  });

  describe('typeParams validation with paramsSchema', () => {
    const vectorParamsSchema = arktype({
      length: 'number',
    });

    function createVectorExtensionDescriptor(options?: {
      paramsSchema?: Type<{ length: number }>;
    }): SqlRuntimeExtensionDescriptor<'postgres'> {
      const sharedCodec = vectorCodecInstance();
      const parameterizedCodecs: RuntimeParameterizedCodecDescriptor<{ length: number }>[] = [
        {
          codecId: 'pg/vector@1',
          traits: [],
          targetTypes: ['vector'],
          paramsSchema: options?.paramsSchema ?? vectorParamsSchema,
          factory: (_params) => (_ctx) => sharedCodec,
        },
      ];

      const registry = createCodecRegistry();
      registry.register(sharedCodec);

      return {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => registry,
        parameterizedCodecs: () => parameterizedCodecs,
        create() {
          return {
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
          };
        },
      };
    }

    it('validates typeParams against codec paramsSchema', () => {
      const contract = createParamTypesTestContract({
        types: {
          Vector1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      });

      const context = createTestContext(contract, createStubAdapter(), {
        extensionPacks: [createVectorExtensionDescriptor()],
      });

      expect(context.types['Vector1536']).toBeDefined();
    });

    it('rejects invalid typeParams with stable error code', () => {
      const contract = createParamTypesTestContract({
        types: {
          InvalidVector: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 'not-a-number' },
          },
        },
      });

      let thrownError: unknown;
      try {
        createTestContext(contract, createStubAdapter(), {
          extensionPacks: [createVectorExtensionDescriptor()],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError).toMatchObject({
        code: 'RUNTIME.TYPE_PARAMS_INVALID',
        category: 'RUNTIME',
        severity: 'error',
        details: {
          codecId: 'pg/vector@1',
          typeName: 'InvalidVector',
        },
      });
    });

    it('rejects missing required typeParams with stable error code', () => {
      const contract = createParamTypesTestContract({
        types: {
          InvalidVector: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: {},
          },
        },
      });

      let thrownError: unknown;
      try {
        createTestContext(contract, createStubAdapter(), {
          extensionPacks: [createVectorExtensionDescriptor()],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError).toMatchObject({
        code: 'RUNTIME.TYPE_PARAMS_INVALID',
        category: 'RUNTIME',
        severity: 'error',
      });
    });
  });

  // Phase B note: `init` was the predecessor hook returning a helper. The
  // unified descriptor uses `factory: (P) => (Ctx) => Codec`; per-instance
  // state lives in the resolved codec returned by the factory. The
  // `TypeHelperRegistry` (`context.types`) carries the resolved codec for
  // every typed instance — or, for codec ids without a parameterized
  // descriptor, the raw `StorageTypeInstance` for typeParams metadata.
  describe('factory for type helpers', () => {
    function createPgVectorExt(opts?: {
      paramsSchema?: Type<{ length: number }>;
      factory?: (params: { length: number }) => (ctx: Ctx) => Codec;
    }): SqlRuntimeExtensionDescriptor<'postgres'> {
      const sharedCodec = vectorCodecInstance();
      const paramsSchema =
        opts?.paramsSchema ??
        arktype({
          length: 'number',
        });
      const factory = opts?.factory ?? ((_params: { length: number }) => () => sharedCodec);
      const parameterizedCodecs: RuntimeParameterizedCodecDescriptor<{ length: number }>[] = [
        {
          codecId: 'pg/vector@1',
          traits: [],
          targetTypes: ['vector'],
          paramsSchema,
          factory,
        },
      ];
      const registry = createCodecRegistry();
      registry.register(sharedCodec);
      return {
        kind: 'extension' as const,
        id: 'pgvector',
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

    it('calls factory(params)(ctx) and stores resolved codec in context.types', () => {
      const taggedCodec = vectorCodecInstance({ dimensions: 1536, isVector: true });
      const factory = (_params: { length: number }) => (_ctx: Ctx) => taggedCodec;
      const extensionDescriptor = createPgVectorExt({ factory });

      const contract = createParamTypesTestContract({
        types: {
          Vector1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      });

      const context = createTestContext(contract, createStubAdapter(), {
        extensionPacks: [extensionDescriptor],
      });

      expect(context.types['Vector1536']).toBe(taggedCodec);
      expect(
        (context.types['Vector1536'] as Codec & { meta: { dimensions: number } }).meta?.dimensions,
      ).toBe(1536);
    });

    it('threads ctx (name + usedAt) through to the factory', () => {
      const observedCtxs: Ctx[] = [];
      const sharedCodec = vectorCodecInstance();
      const factory = (_params: { length: number }) => (ctx: Ctx) => {
        observedCtxs.push(ctx);
        return sharedCodec;
      };
      const extensionDescriptor = createPgVectorExt({ factory });

      const contract = createParamTypesTestContract({
        types: {
          Vector1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
        tableColumns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          embedding: {
            nativeType: 'vector',
            codecId: 'pg/vector@1',
            nullable: false,
            typeRef: 'Vector1536',
          },
        },
      });

      createTestContext(contract, createStubAdapter(), {
        extensionPacks: [extensionDescriptor],
      });

      expect(observedCtxs[0]?.name).toBe('Vector1536');
      expect(observedCtxs[0]?.usedAt).toEqual([{ table: 'test', column: 'embedding' }]);
    });

    it('stores full type instance for codec ids without a parameterized descriptor', () => {
      // No extension contributes a parameterized descriptor for
      // `pg/vector@1`. The named instance can't be materialized; the
      // helper falls back to the raw type instance for callers that need
      // typeParams metadata.
      const contract = createParamTypesTestContract({
        types: {
          Vector1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      });

      const context = createTestContext(contract, createStubAdapter());

      expect(context.types['Vector1536']).toEqual({
        codecId: 'pg/vector@1',
        nativeType: 'vector',
        typeParams: { length: 1536 },
      });
    });
  });

  describe('column typeParams validation', () => {
    function createBasicVectorExt(): SqlRuntimeExtensionDescriptor<'postgres'> {
      const sharedCodec = vectorCodecInstance();
      const parameterizedCodecs: RuntimeParameterizedCodecDescriptor<{ length: number }>[] = [
        {
          codecId: 'pg/vector@1',
          traits: [],
          targetTypes: ['vector'],
          paramsSchema: arktype({ length: 'number' }),
          factory: (_params) => () => sharedCodec,
        },
      ];
      const registry = createCodecRegistry();
      registry.register(sharedCodec);
      return {
        kind: 'extension' as const,
        id: 'pgvector',
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

    it('validates inline column typeParams against codec paramsSchema', () => {
      const contract = createParamTypesTestContract({
        tableColumns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          embedding: {
            nativeType: 'vector',
            codecId: 'pg/vector@1',
            nullable: false,
            typeParams: { length: 1536 },
          },
        },
      });

      const context = createTestContext(contract, createStubAdapter(), {
        extensionPacks: [createBasicVectorExt()],
      });

      expect(context.contract).toBe(contract);
    });

    it('rejects invalid inline column typeParams with stable error code', () => {
      const contract = createParamTypesTestContract({
        tableColumns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          embedding: {
            nativeType: 'vector',
            codecId: 'pg/vector@1',
            nullable: false,
            typeParams: { length: 'invalid' },
          },
        },
      });

      let thrownError: unknown;
      try {
        createTestContext(contract, createStubAdapter(), {
          extensionPacks: [createBasicVectorExt()],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError).toMatchObject({
        code: 'RUNTIME.TYPE_PARAMS_INVALID',
        category: 'RUNTIME',
        severity: 'error',
        details: {
          tableName: 'test',
          columnName: 'embedding',
        },
      });
    });
  });

  describe('duplicate codec descriptor detection', () => {
    it('throws RUNTIME.DUPLICATE_PARAMETERIZED_CODEC when multiple extensions provide same codecId', () => {
      const vectorParamsSchema = arktype({
        length: 'number',
      });

      function createVectorExtension(id: string): SqlRuntimeExtensionDescriptor<'postgres'> {
        const sharedCodec = vectorCodecInstance();
        const parameterizedCodecs: RuntimeParameterizedCodecDescriptor<{ length: number }>[] = [
          {
            codecId: 'pg/vector@1',
            traits: [],
            targetTypes: ['vector'],
            paramsSchema: vectorParamsSchema,
            factory: (_params) => () => sharedCodec,
          },
        ];

        return {
          kind: 'extension' as const,
          id,
          version: '0.0.1',
          familyId: 'sql' as const,
          targetId: 'postgres' as const,
          codecs: () => createCodecRegistry(),
          parameterizedCodecs: () => parameterizedCodecs,
          create() {
            return {
              familyId: 'sql' as const,
              targetId: 'postgres' as const,
            };
          },
        };
      }

      const contract = createParamTypesTestContract();

      expect(() =>
        createTestContext(contract, createStubAdapter(), {
          extensionPacks: [createVectorExtension('ext-1'), createVectorExtension('ext-2')],
        }),
      ).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.DUPLICATE_PARAMETERIZED_CODEC',
          category: 'RUNTIME',
          severity: 'error',
          details: {
            codecId: 'pg/vector@1',
          },
        }),
      );
    });
  });
});
