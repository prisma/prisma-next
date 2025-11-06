import { describe, it, expect, beforeEach, afterEach, expectTypeOf } from 'vitest';
import { emit } from '@prisma-next/emitter';
import { loadExtensionPacks } from '@prisma-next/emitter';
import type { ContractIR, EmitOptions } from '@prisma-next/emitter';
import { sql } from '@prisma-next/sql-query/sql';
import { schema, validateContract } from '@prisma-next/sql-query/schema';
import type {
  ResultType,
  Adapter,
  SelectAst,
  LoweredStatement,
} from '@prisma-next/sql-query/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { sqlTargetFamilyHook, createCodecRegistry } from '@prisma-next/sql-target';
import { join } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

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

  it('emits contract and uses it with lanes', async () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      extensions: {
        postgres: { version: '15.0.0' },
        pg: {},
      },
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const packs = loadExtensionPacks(join(__dirname, '../../adapter-postgres'), []);
    const options: EmitOptions = {
      outputDir: testDir,
      packs,
    };

    const result = await emit(ir, options, sqlTargetFamilyHook);

    const contractJsonPath = join(testDir, 'contract.json');
    const contractDtsPath = join(testDir, 'contract.d.ts');

    await writeFile(contractJsonPath, result.contractJson);
    await writeFile(contractDtsPath, result.contractDts);

    const contractJson = JSON.parse(result.contractJson) as Record<string, unknown>;
    const contract = validateContract(contractJson);
    expect(contract['targetFamily']).toBe('sql');
    expect(contract['target']).toBe('postgres');
    expect(contract['storage']).toBeDefined();

    const contractDtsContent = result.contractDts;

    expect(contractDtsContent).toContain('export type CodecTypes');
    expect(contractDtsContent).toContain('export type LaneCodecTypes');
    expect(contractDtsContent).toContain('export type Contract');

    const tables = schema(contract).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');

    const adapter = createStubAdapter();

    const plan = sql({ contract, adapter })
      .from(userTable)
      .select({
        id: userTable.columns['id']!,
        email: userTable.columns['email']!,
      })
      .limit(10)
      .build();

    expect(plan.sql).toBeTruthy();
    expect(plan.meta.coreHash).toBe(result.coreHash);
    expect(plan.meta.lane).toBe('dsl');

    type UserRow = ResultType<typeof plan>;
    expectTypeOf<UserRow>().toHaveProperty('id');
    expectTypeOf<UserRow>().toHaveProperty('email');
  });

  it('emits contract with nullable fields and infers types correctly', async () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      extensions: {
        postgres: { version: '15.0.0' },
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
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
              name: { type: 'pg/text@1', nullable: true },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const packs = loadExtensionPacks(join(__dirname, '../../adapter-postgres'), []);
    const options: EmitOptions = {
      outputDir: testDir,
      packs,
    };

    const result = await emit(ir, options, sqlTargetFamilyHook);
    const contractJson = JSON.parse(result.contractJson) as Record<string, unknown>;
    const contract = validateContract(contractJson);

    const tables = schema(contract).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');

    const adapter = createStubAdapter();

    const plan = sql({ contract, adapter })
      .from(userTable)
      .select({
        id: userTable.columns['id']!,
        email: userTable.columns['email']!,
        name: userTable.columns['name']!,
      })
      .build();

    expect(plan.sql).toBeTruthy();

    type UserRow = ResultType<typeof plan>;
    expectTypeOf<UserRow>().toHaveProperty('id');
    expectTypeOf<UserRow>().toHaveProperty('email');
    expectTypeOf<UserRow>().toHaveProperty('name');
  });

  it('round-trip: IR → JSON → lanes → plan', async () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      extensions: {
        postgres: { version: '15.0.0' },
        pg: {},
      },
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const packs = loadExtensionPacks(join(__dirname, '../../adapter-postgres'), []);
    const options: EmitOptions = {
      outputDir: testDir,
      packs,
    };

    const result1 = await emit(ir, options, sqlTargetFamilyHook);
    const contractJson1 = JSON.parse(result1.contractJson) as Record<string, unknown>;
    const contract1 = validateContract(contractJson1);

    expect(contractJson1['extensions']).toHaveProperty('postgres');

    const extensions = ((contractJson1['extensions'] as Record<string, unknown>) || {}) as Record<
      string,
      unknown
    >;
    const relations = contractJson1['relations'] as Record<string, unknown> | undefined;
    const ir2: ContractIR = {
      schemaVersion: contractJson1['schemaVersion'] as string,
      targetFamily: contractJson1['targetFamily'] as string,
      target: contractJson1['target'] as string,
      extensions: {
        postgres: extensions['postgres'],
        pg: extensions['pg'] || {},
      },
      models: contractJson1['models'] as Record<string, unknown>,
      storage: contractJson1['storage'] as Record<string, unknown>,
      capabilities: contractJson1['capabilities'] as
        | Record<string, Record<string, boolean>>
        | undefined,
      meta: contractJson1['meta'] as Record<string, unknown> | undefined,
      sources: (contractJson1['sources'] as Record<string, unknown>) || undefined,
      ...(relations ? { relations } : {}),
    } as ContractIR;

    const packs2 = loadExtensionPacks(join(__dirname, '../../adapter-postgres'), []);
    const options2: EmitOptions = {
      outputDir: testDir,
      packs: packs2,
    };

    const result2 = await emit(ir2, options2, sqlTargetFamilyHook);
    const contractJson2 = JSON.parse(result2.contractJson) as Record<string, unknown>;
    const contract2 = validateContract(contractJson2);

    expect(result1.contractJson).toBe(result2.contractJson);
    expect(result1.coreHash).toBe(result2.coreHash);

    const tables1 = schema(contract1).tables;
    const userTable1 = tables1['user'];
    if (!userTable1) throw new Error('user table not found');

    const tables2 = schema(contract2).tables;
    const userTable2 = tables2['user'];
    if (!userTable2) throw new Error('user table not found');

    const adapter = createStubAdapter();

    const plan1 = sql({ contract: contract1, adapter })
      .from(userTable1)
      .select({
        id: userTable1.columns['id']!,
        email: userTable1.columns['email']!,
      })
      .build();

    const plan2 = sql({ contract: contract2, adapter })
      .from(userTable2)
      .select({
        id: userTable2.columns['id']!,
        email: userTable2.columns['email']!,
      })
      .build();

    expect(plan1.sql).toBe(plan2.sql);
    expect(plan1.meta.coreHash).toBe(plan2.meta.coreHash);
    expect(plan1.meta.coreHash).toBe(result1.coreHash);
  });
});
