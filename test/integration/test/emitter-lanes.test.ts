import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { EmitOptions } from '@prisma-next/emitter';
import { emit } from '@prisma-next/emitter';
import {
  assembleOperationRegistry,
  convertOperationManifest,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '@prisma-next/family-sql/test-utils';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql } from '@prisma-next/sql-lane/sql';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { createRuntimeContext } from '@prisma-next/sql-runtime';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { getSqlDescriptorBundle } from '../utils/framework-components';

function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(ast: SelectAst, ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      return {
        profileId: this.profile.id,
        body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
      };
    },
  };
}

describe('emitter → lanes integration', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `prisma-next-integration-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it(
    'emits contract and uses it with lanes',
    async () => {
      const ir: ContractIR = {
        schemaVersion: '1',
        targetFamily: 'sql',
        target: 'postgres',
        extensionPacks: {
          postgres: { version: '0.0.1' },
          pg: {},
        },
        models: {
          User: {
            storage: { table: 'user' },
            fields: {
              id: { column: 'id' },
              email: { column: 'email' },
            },
            relations: {},
          },
        },
        relations: {},
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
        capabilities: {},
        meta: {},
        sources: {},
      };

      const {
        adapter: adapterDescriptor,
        target: targetDescriptor,
        extensions: extensionDescriptors,
        descriptors,
      } = getSqlDescriptorBundle();
      const operationRegistry = assembleOperationRegistry(descriptors, convertOperationManifest);
      const codecTypeImports = extractCodecTypeImports(descriptors);
      const operationTypeImports = extractOperationTypeImports(descriptors);
      const extensionIds = extractExtensionIds(
        adapterDescriptor,
        targetDescriptor,
        extensionDescriptors,
      );
      const options: EmitOptions = {
        outputDir: testDir,
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      };

      const result = await emit(ir, options, sqlTargetFamilyHook);

      const contractJsonPath = join(testDir, 'contract.json');
      const contractDtsPath = join(testDir, 'contract.d.ts');

      await writeFile(contractJsonPath, result.contractJson);
      await writeFile(contractDtsPath, result.contractDts);

      const contractJson = JSON.parse(result.contractJson) as Record<string, unknown>;
      const contract = validateContract(contractJson);
      expect(contract.targetFamily).toBe('sql');
      expect(contract.target).toBe('postgres');
      expect(contract.storage).toBeDefined();

      const contractDtsContent = result.contractDts;

      expect(contractDtsContent).toContain('export type CodecTypes');
      expect(contractDtsContent).toContain('export type LaneCodecTypes');
      expect(contractDtsContent).toContain('export type Contract');

      const adapter = createStubAdapter();
      const context = createRuntimeContext({ contract, adapter, extensions: [] });
      const tables = schema(context).tables;
      const userTable = tables['user'];
      if (!userTable) throw new Error('user table not found');

      const plan = sql({ context })
        .from(userTable)
        .select({
          id: userTable.columns['id']!,
          email: userTable.columns['email']!,
        })
        .limit(10)
        .build();

      // SqlQueryPlan doesn't have sql property - lowering happens in runtime
      expect(plan.ast).toBeDefined();
      expect(plan.meta.coreHash).toBe(result.coreHash);
      expect(plan.meta.lane).toBe('dsl');

      type UserRow = ResultType<typeof plan>;
      expectTypeOf<UserRow>().toHaveProperty('id');
      expectTypeOf<UserRow>().toHaveProperty('email');
    },
    timeouts.typeScriptCompilation,
  );

  it('emits contract with nullable fields and infers types correctly', async () => {
    const ir: ContractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      extensionPacks: {
        postgres: { version: '0.0.1' },
        pg: {},
      },
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
            name: { column: 'name' },
          },
          relations: {},
        },
      },
      relations: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              name: { codecId: 'pg/text@1', nativeType: 'text', nullable: true },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      capabilities: {},
      meta: {},
      sources: {},
    };

    const {
      adapter: adapterDescriptor,
      target: targetDescriptor,
      extensions: extensionDescriptors,
      descriptors,
    } = getSqlDescriptorBundle();
    const operationRegistry = assembleOperationRegistry(descriptors, convertOperationManifest);
    const codecTypeImports = extractCodecTypeImports(descriptors);
    const operationTypeImports = extractOperationTypeImports(descriptors);
    const extensionIds = extractExtensionIds(
      adapterDescriptor,
      targetDescriptor,
      extensionDescriptors,
    );
    const options: EmitOptions = {
      outputDir: testDir,
      operationRegistry,
      codecTypeImports,
      operationTypeImports,
      extensionIds,
    };

    const result = await emit(ir, options, sqlTargetFamilyHook);
    const contractJson = JSON.parse(result.contractJson) as Record<string, unknown>;
    const contract = validateContract(contractJson);

    const adapter = createStubAdapter();
    const context = createRuntimeContext({ contract, adapter, extensions: [] });
    const tables = schema(context).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');

    const plan = sql({ context })
      .from(userTable)
      .select({
        id: userTable.columns['id']!,
        email: userTable.columns['email']!,
        name: userTable.columns['name']!,
      })
      .build();

    // SqlQueryPlan doesn't have sql property - lowering happens in runtime
    expect(plan.ast).toBeDefined();

    type UserRow = ResultType<typeof plan>;
    expectTypeOf<UserRow>().toHaveProperty('id');
    expectTypeOf<UserRow>().toHaveProperty('email');
    expectTypeOf<UserRow>().toHaveProperty('name');
  });

  it('round-trip: IR → JSON → lanes → plan', async () => {
    const ir: ContractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      extensionPacks: {
        postgres: { version: '0.0.1' },
        pg: {},
      },
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
          },
          relations: {},
        },
      },
      relations: {},
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
      capabilities: {},
      meta: {},
      sources: {},
    };

    const {
      adapter: adapterDescriptor,
      target: targetDescriptor,
      extensions: extensionDescriptors,
      descriptors,
    } = getSqlDescriptorBundle();
    const operationRegistry = assembleOperationRegistry(descriptors, convertOperationManifest);
    const codecTypeImports = extractCodecTypeImports(descriptors);
    const operationTypeImports = extractOperationTypeImports(descriptors);
    const extensionIds = extractExtensionIds(
      adapterDescriptor,
      targetDescriptor,
      extensionDescriptors,
    );
    const options: EmitOptions = {
      outputDir: testDir,
      operationRegistry,
      codecTypeImports,
      operationTypeImports,
      extensionIds,
    };

    const result1 = await emit(ir, options, sqlTargetFamilyHook);
    const contractJson1 = JSON.parse(result1.contractJson) as Record<string, unknown>;
    const validatedContract = validateContract<SqlContract<SqlStorage>>(contractJson1);

    // Cast to ContractIR for the emitter (SqlContract has all required ContractIR fields)
    const ir2 = validatedContract as unknown as ContractIR;

    // Intentionally load extension packs independently a second time to ensure
    // the emit -> validate -> re-emit flow produces consistent results
    const descriptorsBundle2 = getSqlDescriptorBundle();
    const operationRegistry2 = assembleOperationRegistry(
      descriptorsBundle2.descriptors,
      convertOperationManifest,
    );
    const codecTypeImports2 = extractCodecTypeImports(descriptorsBundle2.descriptors);
    const operationTypeImports2 = extractOperationTypeImports(descriptorsBundle2.descriptors);
    const extensionIds2 = extractExtensionIds(
      descriptorsBundle2.adapter,
      descriptorsBundle2.target,
      descriptorsBundle2.extensions,
    );
    const options2: EmitOptions = {
      outputDir: testDir,
      operationRegistry: operationRegistry2,
      codecTypeImports: codecTypeImports2,
      operationTypeImports: operationTypeImports2,
      extensionIds: extensionIds2,
    };

    const result2 = await emit(ir2, options2, sqlTargetFamilyHook);
    const contractJson2 = JSON.parse(result2.contractJson) as Record<string, unknown>;
    const contract2 = validateContract<SqlContract<SqlStorage>>(contractJson2);

    expect(result1.contractJson).toBe(result2.contractJson);
    expect(result1.coreHash).toBe(result2.coreHash);

    const adapter = createStubAdapter();
    const context1 = createRuntimeContext({
      contract: validatedContract,
      adapter,
      extensions: [],
    });
    const context2 = createRuntimeContext({ contract: contract2, adapter, extensions: [] });
    const tables1 = schema(context1).tables;
    const userTable1 = tables1['user'];
    if (!userTable1) throw new Error('user table not found');

    const tables2 = schema(context2).tables;
    const userTable2 = tables2['user'];
    if (!userTable2) throw new Error('user table not found');

    const plan1 = sql({ context: context1 })
      .from(userTable1)
      .select({
        id: userTable1.columns['id']!,
        email: userTable1.columns['email']!,
      })
      .build();

    const plan2 = sql({ context: context2 })
      .from(userTable2)
      .select({
        id: userTable2.columns['id']!,
        email: userTable2.columns['email']!,
      })
      .build();

    // SqlQueryPlan doesn't have sql property - lowering happens in runtime
    expect(plan1.ast).toBeDefined();
    expect(plan2.ast).toBeDefined();
    expect(plan1.meta.coreHash).toBe(plan2.meta.coreHash);
    expect(plan1.meta.coreHash).toBe(result1.coreHash);
  });
});
