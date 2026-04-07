import type { TypesImportSpec } from '@prisma-next/framework-components/emission';
import { createOperationRegistry } from '@prisma-next/operations';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { EmitStackInput } from '../src/exports';
import { emit } from '../src/exports';
import { createMockSpi } from './mock-spi';
import { createTestContract } from './utils';

const mockSqlHook = createMockSpi();

describe('emitter integration', () => {
  it(
    'emits complete contract from IR to artifacts',
    async () => {
      const ir = createTestContract({
        models: {
          User: {
            storage: {
              table: 'user',
              fields: {
                id: { column: 'id' },
                email: { column: 'email' },
              },
            },
            fields: {
              id: { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false },
              email: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        extensionPacks: {
          postgres: {
            version: '0.0.1',
          },
          pg: {},
        },
      });

      const operationRegistry = createOperationRegistry();
      const codecTypeImports: TypesImportSpec[] = [];
      const operationTypeImports: TypesImportSpec[] = [];
      const extensionIds = ['postgres', 'pg'];
      const options: EmitStackInput = {
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      };

      const result = await emit(ir, options, mockSqlHook);

      expect(result.storageHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.contractDts).toContain('export type Contract');
      expect(result.contractDts).toContain('CodecTypes');
      expect(result.contractDts).toContain('LaneCodecTypes');

      const contractJson = JSON.parse(result.contractJson);
      expect(contractJson).toMatchObject({
        schemaVersion: '1',
        targetFamily: 'sql',
        target: 'postgres',
        profileHash: expect.stringMatching(/^sha256:/),
        roots: {},
        storage: {
          storageHash: result.storageHash,
          tables: {
            user: expect.anything(),
          },
        },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'produces stable hashes for identical input',
    async () => {
      const ir = createTestContract({
        models: {
          User: {
            storage: {
              table: 'user',
              fields: {
                id: { column: 'id' },
              },
            },
            fields: {
              id: { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        extensionPacks: {
          postgres: {
            version: '0.0.1',
          },
          pg: {},
        },
      });

      const operationRegistry = createOperationRegistry();
      const codecTypeImports: TypesImportSpec[] = [];
      const operationTypeImports: TypesImportSpec[] = [];
      const extensionIds = ['postgres', 'pg'];
      const options: EmitStackInput = {
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      };

      const result1 = await emit(ir, options, mockSqlHook);
      const result2 = await emit(ir, options, mockSqlHook);

      expect(result1.storageHash).toBe(result2.storageHash);
      expect(result1.contractDts).toBe(result2.contractDts);
      expect(result1.contractJson).toBe(result2.contractJson);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'round-trip: IR → JSON → parse JSON → compare',
    async () => {
      const ir = createTestContract({
        models: {
          User: {
            storage: {
              table: 'user',
              fields: {
                id: { column: 'id' },
                email: { column: 'email' },
              },
            },
            fields: {
              id: { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false },
              email: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        extensionPacks: {
          postgres: {
            version: '0.0.1',
          },
          pg: {},
        },
      });

      const operationRegistry = createOperationRegistry();
      const codecTypeImports: TypesImportSpec[] = [];
      const operationTypeImports: TypesImportSpec[] = [];
      const extensionIds = ['postgres', 'pg'];
      const options: EmitStackInput = {
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      };

      const result1 = await emit(ir, options, mockSqlHook);
      const contractJson1 = JSON.parse(result1.contractJson) as Record<string, unknown>;

      const ir2 = createTestContract({
        targetFamily: contractJson1['targetFamily'] as string,
        target: contractJson1['target'] as string,
        roots: contractJson1['roots'] as Record<string, string>,
        models: contractJson1['models'] as Record<string, unknown>,
        storage: contractJson1['storage'] as Record<string, unknown>,
        extensionPacks: contractJson1['extensionPacks'] as Record<string, unknown>,
        capabilities:
          (contractJson1['capabilities'] as Record<string, Record<string, boolean>>) || {},
        meta: (contractJson1['meta'] as Record<string, unknown>) || {},
      });

      const result2 = await emit(ir2, options, mockSqlHook);

      expect(result1.contractJson).toBe(result2.contractJson);
      expect(result1.storageHash).toBe(result2.storageHash);
    },
    timeouts.typeScriptCompilation,
  );
});
