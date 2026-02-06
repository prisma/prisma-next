import type { SqlContract, SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
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
): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    coreHash: 'sha256:test' as never,
    models: {},
    relations: {},
    storage: {
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
    sources: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    },
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
      init?: (params: { length: number }) => { dimensions: number };
    }): SqlRuntimeExtensionDescriptor<'postgres'> {
      // biome-ignore lint/suspicious/noExplicitAny: test helper with flexible type params
      const parameterizedCodecs: RuntimeParameterizedCodecDescriptor<any, any>[] = [
        {
          codecId: 'pg/vector@1',
          paramsSchema: options?.paramsSchema ?? vectorParamsSchema,
          ...ifDefined('init', options?.init),
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
        operationSignatures: () => [],
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

  describe('init hook for type helpers', () => {
    it('calls init hook and stores result in context.types', () => {
      const vectorParamsSchema = arktype({
        length: 'number',
      });

      const initFn = (params: { length: number }) => ({
        dimensions: params.length,
        isVector: true,
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
          init: initFn,
        },
      ];

      const extensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => registry,
        operationSignatures: () => [],
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

      expect(context.types['Vector1536']).toEqual({
        dimensions: 1536,
        isVector: true,
      });
    });

    it('stores full type instance when no init hook is provided', () => {
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
        },
      ];

      const extensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => registry,
        operationSignatures: () => [],
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

      // Without init hook, stores the full type instance (matches contract typing)
      expect(context.types['Vector1536']).toEqual({
        codecId: 'pg/vector@1',
        nativeType: 'vector',
        typeParams: { length: 1536 },
      });
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
        },
      ];

      const extensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => registry,
        operationSignatures: () => [],
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
        },
      ];

      const extensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => registry,
        operationSignatures: () => [],
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
          },
        ];

        return {
          kind: 'extension' as const,
          id,
          version: '0.0.1',
          familyId: 'sql' as const,
          targetId: 'postgres' as const,
          codecs: () => createCodecRegistry(),
          operationSignatures: () => [],
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
