import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { Codec, Ctx } from '@prisma-next/framework-components/codec';
import type { SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
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

// Trivial passthrough factory used by tests that don't care about the resolved codec
// — they exercise descriptor wiring (paramsSchema validation, duplicate detection)
// rather than the curried factory's per-instance state.
function passthroughFactory(_params: unknown): (ctx: Ctx) => Codec {
  return (_ctx) => ({
    id: 'pg/vector@1',
    targetTypes: ['vector'],
    decode: (wire: unknown) => wire,
    encodeJson: (value) => value as never,
    decodeJson: (json) => json as never,
  });
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
      const parameterizedCodecs: RuntimeParameterizedCodecDescriptor<{ length: number }>[] = [
        {
          codecId: 'pg/vector@1',
          paramsSchema: options?.paramsSchema ?? vectorParamsSchema,
          factory: passthroughFactory,
        },
      ];

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

  describe('curried factory for type helpers', () => {
    it('stores the codec returned by descriptor.factory(params)(ctx) in context.types', () => {
      const vectorParamsSchema = arktype({ length: 'number' });

      const factoryFn = (params: { length: number }): ((ctx: Ctx) => Codec) => {
        return (_ctx) =>
          ({
            id: 'pg/vector@1',
            targetTypes: ['vector'],
            decode: (wire: unknown) => wire,
            encodeJson: (v) => v as never,
            decodeJson: (j) => j as never,
            // ad-hoc per-instance state riding on the resolved codec — this is what
            // M4 hands JSON validators / CipherStash key derivation through.
            dimensions: params.length,
            isVector: true,
          }) as Codec & { dimensions: number; isVector: true };
      };

      const registry = createCodecRegistry();
      registry.register(
        codec({
          typeId: 'pg/vector@1',
          targetTypes: ['vector'],
          encode: (v: number[]) => v,
          decode: (w: number[]) => w,
        }),
      );

      const parameterizedCodecs = [
        {
          codecId: 'pg/vector@1',
          paramsSchema: vectorParamsSchema,
          factory: factoryFn,
        },
      ];

      const extensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
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

      const helper = context.types['Vector1536'] as {
        dimensions?: unknown;
        isVector?: unknown;
      };
      expect(helper.dimensions).toBe(1536);
      expect(helper.isVector).toBe(true);
    });

    it('passes ctx.name and ctx.usedAt to the factory for storage.types entries', () => {
      const vectorParamsSchema = arktype({ length: 'number' });

      let observedCtx: Ctx | undefined;
      const factoryFn = (_params: { length: number }): ((ctx: Ctx) => Codec) => {
        return (ctx) => {
          observedCtx = ctx;
          return {
            id: 'pg/vector@1',
            targetTypes: ['vector'],
            decode: (wire: unknown) => wire,
            encodeJson: (v) => v as never,
            decodeJson: (j) => j as never,
          };
        };
      };

      const parameterizedCodecs = [
        {
          codecId: 'pg/vector@1',
          paramsSchema: vectorParamsSchema,
          factory: factoryFn,
        },
      ];

      const extensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => createCodecRegistry(),
        parameterizedCodecs: () => parameterizedCodecs,
        create() {
          return { familyId: 'sql' as const, targetId: 'postgres' as const };
        },
      };

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
          backup: {
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

      expect(observedCtx).toBeDefined();
      expect(observedCtx?.name).toBe('Vector1536');
      expect(observedCtx?.usedAt).toEqual([
        { table: 'test', column: 'embedding' },
        { table: 'test', column: 'backup' },
      ]);
    });
  });

  describe('column typeParams validation', () => {
    it('validates inline column typeParams against codec paramsSchema', () => {
      const vectorParamsSchema = arktype({
        length: 'number',
      });

      const registry = createCodecRegistry();
      registry.register(
        codec({
          typeId: 'pg/vector@1',
          targetTypes: ['vector'],
          encode: (v: number[]) => v,
          decode: (w: number[]) => w,
        }),
      );

      const parameterizedCodecs = [
        {
          codecId: 'pg/vector@1',
          paramsSchema: vectorParamsSchema,
          factory: passthroughFactory,
        },
      ];

      const extensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
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

      // Should not throw - valid typeParams
      const context = createTestContext(contract, createStubAdapter(), {
        extensionPacks: [extensionDescriptor],
      });

      expect(context.contract).toBe(contract);
    });

    it('rejects invalid inline column typeParams with stable error code', () => {
      const vectorParamsSchema = arktype({
        length: 'number',
      });

      const registry = createCodecRegistry();
      registry.register(
        codec({
          typeId: 'pg/vector@1',
          targetTypes: ['vector'],
          encode: (v: number[]) => v,
          decode: (w: number[]) => w,
        }),
      );

      const parameterizedCodecs = [
        {
          codecId: 'pg/vector@1',
          paramsSchema: vectorParamsSchema,
          factory: passthroughFactory,
        },
      ];

      const extensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
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
          extensionPacks: [extensionDescriptor],
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
        const parameterizedCodecs = [
          {
            codecId: 'pg/vector@1',
            paramsSchema: vectorParamsSchema,
            factory: passthroughFactory,
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
