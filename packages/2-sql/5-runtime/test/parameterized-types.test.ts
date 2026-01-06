import type { SqlContract, SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { Type } from 'arktype';
import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  type RuntimeParameterizedCodecDescriptor,
  type SqlRuntimeExtensionDescriptor,
  type SqlRuntimeExtensionInstance,
} from '../src/sql-context';

// =============================================================================
// Test helpers
// =============================================================================

function createTestContract(
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
    coreHash: 'sha256:test',
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
      ...(options?.types ? { types: options.types } : {}),
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

function createTestAdapterDescriptor() {
  const codecs = createCodecRegistry();
  codecs.register(
    codec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
  );

  return {
    kind: 'adapter' as const,
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create() {
      return {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        profile: {
          id: 'test-profile',
          target: 'postgres',
          capabilities: {},
          codecs() {
            return codecs;
          },
        },
        lower(ast: SelectAst) {
          return {
            profileId: 'test-profile',
            body: Object.freeze({ sql: JSON.stringify(ast), params: [] }),
          };
        },
      };
    },
  };
}

function createTestTargetDescriptor() {
  return {
    kind: 'target' as const,
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

// =============================================================================
// Tests: Parameterized type validation
// =============================================================================

describe('parameterized types', () => {
  describe('storage.types validation', () => {
    it('creates context with empty storage.types', () => {
      const contract = createTestContract({ types: {} });
      const context = createRuntimeContext({
        contract,
        target: createTestTargetDescriptor(),
        adapter: createTestAdapterDescriptor(),
      });

      expect(context.contract.storage.types).toEqual({});
      expect(context.types).toEqual({});
    });

    it('creates context with storage.types containing valid type instances', () => {
      const contract = createTestContract({
        types: {
          Vector1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      });
      const context = createRuntimeContext({
        contract,
        target: createTestTargetDescriptor(),
        adapter: createTestAdapterDescriptor(),
      });

      expect(context.contract.storage.types).toEqual({
        Vector1536: {
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      });
      // types registry should contain the raw type instance (no init hook provided)
      expect(context.types?.['Vector1536']).toBeDefined();
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
          ...(options?.init ? { init: options.init } : {}),
        },
      ];

      return {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        create(): SqlRuntimeExtensionInstance<'postgres'> {
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
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
            codecs: () => registry,
            parameterizedCodecs: () => parameterizedCodecs,
          };
        },
      };
    }

    it('validates typeParams against codec paramsSchema', () => {
      const contract = createTestContract({
        types: {
          Vector1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      });

      const context = createRuntimeContext({
        contract,
        target: createTestTargetDescriptor(),
        adapter: createTestAdapterDescriptor(),
        extensionPacks: [createVectorExtensionDescriptor()],
      });

      expect(context.types?.['Vector1536']).toBeDefined();
    });

    it('rejects invalid typeParams with stable error code', () => {
      const contract = createTestContract({
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
        createRuntimeContext({
          contract,
          target: createTestTargetDescriptor(),
          adapter: createTestAdapterDescriptor(),
          extensionPacks: [createVectorExtensionDescriptor()],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      const error = thrownError as {
        code?: string;
        category?: string;
        severity?: string;
        details?: Record<string, unknown>;
      };
      expect(error.code).toBe('RUNTIME.TYPE_PARAMS_INVALID');
      expect(error.category).toBe('RUNTIME');
      expect(error.severity).toBe('error');
      expect(error.details).toBeDefined();
      expect(error.details?.codecId).toBe('pg/vector@1');
      expect(error.details?.typeName).toBe('InvalidVector');
    });

    it('rejects missing required typeParams with stable error code', () => {
      const contract = createTestContract({
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
        createRuntimeContext({
          contract,
          target: createTestTargetDescriptor(),
          adapter: createTestAdapterDescriptor(),
          extensionPacks: [createVectorExtensionDescriptor()],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      const error = thrownError as { code?: string; category?: string; severity?: string };
      expect(error.code).toBe('RUNTIME.TYPE_PARAMS_INVALID');
      expect(error.category).toBe('RUNTIME');
      expect(error.severity).toBe('error');
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

      const extensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        create(): SqlRuntimeExtensionInstance<'postgres'> {
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
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
            codecs: () => registry,
            parameterizedCodecs: () => [
              {
                codecId: 'pg/vector@1',
                paramsSchema: vectorParamsSchema,
                init: initFn,
              },
            ],
          };
        },
      };

      const contract = createTestContract({
        types: {
          Vector1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      });

      const context = createRuntimeContext({
        contract,
        target: createTestTargetDescriptor(),
        adapter: createTestAdapterDescriptor(),
        extensionPacks: [extensionDescriptor],
      });

      expect(context.types?.['Vector1536']).toEqual({
        dimensions: 1536,
        isVector: true,
      });
    });

    it('stores raw typeParams when no init hook is provided', () => {
      const vectorParamsSchema = arktype({
        length: 'number',
      });

      const extensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        create(): SqlRuntimeExtensionInstance<'postgres'> {
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
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
            codecs: () => registry,
            parameterizedCodecs: () => [
              {
                codecId: 'pg/vector@1',
                paramsSchema: vectorParamsSchema,
                // No init hook
              },
            ],
          };
        },
      };

      const contract = createTestContract({
        types: {
          Vector1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      });

      const context = createRuntimeContext({
        contract,
        target: createTestTargetDescriptor(),
        adapter: createTestAdapterDescriptor(),
        extensionPacks: [extensionDescriptor],
      });

      // Without init hook, stores the validated typeParams
      expect(context.types?.['Vector1536']).toEqual({ length: 1536 });
    });
  });

  describe('column typeParams validation', () => {
    it('validates inline column typeParams against codec paramsSchema', () => {
      const vectorParamsSchema = arktype({
        length: 'number',
      });

      const extensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        create(): SqlRuntimeExtensionInstance<'postgres'> {
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
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
            codecs: () => registry,
            parameterizedCodecs: () => [
              {
                codecId: 'pg/vector@1',
                paramsSchema: vectorParamsSchema,
              },
            ],
          };
        },
      };

      const contract = createTestContract({
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
      const context = createRuntimeContext({
        contract,
        target: createTestTargetDescriptor(),
        adapter: createTestAdapterDescriptor(),
        extensionPacks: [extensionDescriptor],
      });

      expect(context.contract).toBe(contract);
    });

    it('rejects invalid inline column typeParams with stable error code', () => {
      const vectorParamsSchema = arktype({
        length: 'number',
      });

      const extensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension' as const,
        id: 'pgvector',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        create(): SqlRuntimeExtensionInstance<'postgres'> {
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
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
            codecs: () => registry,
            parameterizedCodecs: () => [
              {
                codecId: 'pg/vector@1',
                paramsSchema: vectorParamsSchema,
              },
            ],
          };
        },
      };

      const contract = createTestContract({
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
        createRuntimeContext({
          contract,
          target: createTestTargetDescriptor(),
          adapter: createTestAdapterDescriptor(),
          extensionPacks: [extensionDescriptor],
        });
      } catch (e) {
        thrownError = e;
      }

      expect(thrownError).toBeDefined();
      const error = thrownError as {
        code?: string;
        category?: string;
        severity?: string;
        details?: Record<string, unknown>;
      };
      expect(error.code).toBe('RUNTIME.TYPE_PARAMS_INVALID');
      expect(error.category).toBe('RUNTIME');
      expect(error.severity).toBe('error');
      expect(error.details?.tableName).toBe('test');
      expect(error.details?.columnName).toBe('embedding');
    });
  });
});
