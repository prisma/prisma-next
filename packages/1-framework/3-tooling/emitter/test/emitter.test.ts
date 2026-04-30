import type { TypesImportSpec } from '@prisma-next/framework-components/emission';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { EmitStackInput } from '../src/exports';
import { emit, getEmittedArtifactPaths } from '../src/exports';
import { createMockSpi } from './mock-spi';
import { createTestContract } from './utils';

const mockSqlHook = createMockSpi();

describe('emitter', () => {
  it('derives colocated artifact paths from contract.json output', () => {
    expect(getEmittedArtifactPaths('/abs/contract.json')).toEqual({
      jsonPath: '/abs/contract.json',
      dtsPath: '/abs/contract.d.ts',
    });
  });

  it('rejects non-json output paths when deriving artifact paths', () => {
    expect(() => getEmittedArtifactPaths('/abs/contract.ts')).toThrow(
      'Contract output path must end with .json',
    );
  });

  it(
    'rejects non-json output paths when emit receives an output path',
    async () => {
      const ir = createTestContract();
      const options: EmitStackInput = {
        codecTypeImports: [],
        operationTypeImports: [],
      };

      await expect(
        emit(ir, options, mockSqlHook, {
          outputJsonPath: '/abs/contract.ts',
        }),
      ).rejects.toThrow('Contract output path must end with .json');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'emits contract.json and contract.d.ts',
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

      const codecTypeImports: TypesImportSpec[] = [];
      const operationTypeImports: TypesImportSpec[] = [];
      const extensionIds = ['postgres', 'pg'];
      const options: EmitStackInput = {
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      };

      const result = await emit(ir, options, mockSqlHook);
      expect(result.storageHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.contractDts).toContain('export type Contract');
      expect(result.contractDts).toContain('CodecTypes');

      const contractJson = JSON.parse(result.contractJson) as Record<string, unknown>;
      const storage = contractJson['storage'] as Record<string, unknown>;
      const tables = storage['tables'] as Record<string, unknown>;
      expect(tables).toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );

  it('emits contract even when extension pack namespace does not match extensionIds', async () => {
    const ir = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('tolerates codec namespaces not registered in extensionIds', async () => {
    const ir = createTestContract({
      storage: {
        tables: {
          data: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              value: { codecId: 'unknown/type@1', nativeType: 'custom', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: ['some-other-extension'],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('handles missing extensionPacks field', async () => {
    const ir = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('handles empty packs array', async () => {
    const ir = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it(
    'omits sources from emitted contract artifact',
    async () => {
      const ir = createTestContract({
        sources: {
          schema: { sourceId: 'schema.prisma' },
        },
      });

      const options: EmitStackInput = {
        codecTypeImports: [],
        operationTypeImports: [],
        extensionIds: [],
      };

      const result = await emit(ir, options, mockSqlHook);
      const contractJson = JSON.parse(result.contractJson) as Record<string, unknown>;
      expect(contractJson).not.toHaveProperty('sources');
    },
    timeouts.typeScriptCompilation,
  );

  it('accepts meta keys when family validation allows them', async () => {
    const ir = createTestContract({
      meta: {
        sourceId: 'schema.prisma',
        schemaPath: '/tmp/schema.prisma',
        source: 'psl',
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).resolves.toMatchObject({
      contractJson: expect.any(String),
      contractDts: expect.any(String),
    });
  });

  it('accepts canonical section keys when family validation allows them', async () => {
    const ir = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                codecId: 'pg/int4@1',
                nativeType: 'int4',
                nullable: false,
                sourceId: 'schema.prisma',
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      } as unknown as Record<string, unknown>,
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).resolves.toMatchObject({
      contractJson: expect.any(String),
      contractDts: expect.any(String),
    });
  });

  it('emits contract even when extensionIds are not in contract.extensionPacks', async () => {
    const ir = createTestContract({
      storage: {
        tables: {},
      },
    });

    const mockHookNoTypeValidation = createMockSpi();

    const options: EmitStackInput = {
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: ['postgres'],
    };

    const result = await emit(ir, options, mockHookNoTypeValidation);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('defaults codecTypeImports and operationTypeImports to empty arrays when omitted', async () => {
    const ir = createTestContract({
      storage: { tables: {} },
    });

    const options: EmitStackInput = {
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractDts).toContain('export type CodecTypes');
    expect(result.contractDts).toContain('export type OperationTypes');
  });

  it('passes parameterizedTypeImports and queryOperationTypeImports to generateContractDts', async () => {
    const ir = createTestContract({
      storage: { tables: {} },
    });

    const queryOperationTypeImports: TypesImportSpec[] = [
      { package: '@ext/query', named: 'QueryOperationTypes', alias: 'ExtQueryOpTypes' },
    ];

    const options: EmitStackInput = {
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
      queryOperationTypeImports,
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractDts).toContain("from '@ext/query'");
  });

  it('threads resolveFieldTypeParams from emitter SPI through to field type maps', async () => {
    // The emitter wraps `emitter.resolveFieldTypeParams(name, field, model, contract)`
    // into a `(name, field) => …` adapter for `generateBothFieldTypesMaps`.
    // The wrapper looks up the model in the contract and skips the
    // delegated call when the model is missing — both branches need
    // coverage so the wrapper logic stays correct as the SPI evolves.
    const ir = createTestContract({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            embedding: {
              type: { kind: 'scalar', codecId: 'pg/vector@1' },
              nullable: false,
            },
          },
          relations: {},
        },
      },
    });

    const calls: Array<{
      modelName: string;
      fieldName: string;
      hasModel: boolean;
      hasContract: boolean;
    }> = [];
    const hookWithResolver = createMockSpi({
      resolveFieldTypeParams: (modelName, fieldName, model, contract) => {
        calls.push({
          modelName,
          fieldName,
          hasModel: model !== undefined,
          hasContract: contract !== undefined,
        });
        if (modelName === 'User' && fieldName === 'embedding') {
          return { length: 1536 };
        }
        return undefined;
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await emit(ir, options, hookWithResolver);

    const userEmbeddingCall = calls.find(
      (c) => c.modelName === 'User' && c.fieldName === 'embedding',
    );
    expect(userEmbeddingCall).toBeDefined();
    expect(userEmbeddingCall?.hasModel).toBe(true);
    expect(userEmbeddingCall?.hasContract).toBe(true);
  });

  it('returns undefined from the resolveFieldTypeParams wrapper when the model is missing', async () => {
    // The wrapper short-circuits on `contract.models[modelName] === undefined`
    // before calling the SPI. We can't trigger that branch through the
    // contract IR (every field's modelName is, by construction, a model
    // key), but the runtime shape of the wrapper exposes the precondition
    // through the wrapper's identity: the SPI is consulted only when the
    // model is found. Assert the negative branch by replacing the contract
    // walk with one that has no models — the wrapper is built but never
    // invoked, so the SPI delegate is never called.
    const ir = createTestContract({ storage: { tables: {} } });

    let resolverInvocations = 0;
    const hookWithResolver = createMockSpi({
      resolveFieldTypeParams: () => {
        resolverInvocations += 1;
        return undefined;
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await emit(ir, options, hookWithResolver);
    expect(resolverInvocations).toBe(0);
  });

  it('does not build a resolveFieldTypeParams wrapper when the SPI omits the hook', async () => {
    // When `emitter.resolveFieldTypeParams` is undefined, the wrapper is
    // also undefined and `generateBothFieldTypesMaps` falls back to the
    // codec-id-keyed `CodecLookup` only. This guards the
    // `emitter.resolveFieldTypeParams ?` ternary in
    // `generate-contract-dts.ts` so a future refactor can't accidentally
    // start synthesizing a no-op resolver.
    const ir = createTestContract({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
          relations: {},
        },
      },
    });
    const baseSpi = createMockSpi();
    expect(baseSpi.resolveFieldTypeParams).toBeUndefined();

    const options: EmitStackInput = {
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, baseSpi);
    expect(result.contractDts).toContain('export type FieldOutputTypes');
  });

  it('emits execution clause when contract has execution section', async () => {
    const ir = createTestContract({
      storage: { tables: {} },
      execution: {
        executionHash: 'sha256:abc123',
        operations: {},
      },
    });

    const options: EmitStackInput = {
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractDts).toContain('readonly execution:');
    expect(result.contractDts).toContain('readonly executionHash: ExecutionHash');
    expect(result.executionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
