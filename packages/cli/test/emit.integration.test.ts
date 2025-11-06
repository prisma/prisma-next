import { describe, it, expect, beforeEach, afterEach, expectTypeOf } from 'vitest';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadContractFromTs } from '../src/load-ts-contract';
import { emit, loadExtensionPacks } from '@prisma-next/emitter';
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

const fixturesDir = join(__dirname, 'fixtures');

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

describe('emit integration', () => {
  let testDir: string;
  let outputDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `prisma-next-integration-${randomUUID()}`);
    outputDir = join(testDir, 'output');
    mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('loads TS contract, emits artifacts, and uses them with lanes', async () => {
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    const contract = await loadContractFromTs(contractPath);
    const packs = loadExtensionPacks(adapterPath, []);

    const result = await emit(
      contract,
      {
        outputDir,
        packs,
      },
      sqlTargetFamilyHook,
    );

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractDtsPath = join(outputDir, 'contract.d.ts');

    writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
    writeFileSync(contractDtsPath, result.contractDts, 'utf-8');

    const contractJson = JSON.parse(result.contractJson);
    const validatedContract = validateContract(contractJson);

    const adapter = createStubAdapter();

    type Contract = typeof validatedContract;
    type CodecTypes = Record<string, { input: unknown; output: unknown }>;

    const tables = schema<Contract, CodecTypes>(validatedContract).tables;
    const userTable = tables['user'];
    if (!userTable) {
      throw new Error('User table not found');
    }
    const idColumn = userTable.columns['id'];
    const emailColumn = userTable.columns['email'];
    if (!idColumn || !emailColumn) {
      throw new Error('Columns not found');
    }
    const plan = sql<Contract, CodecTypes>({ contract: validatedContract, adapter })
      .from(userTable)
      .select({ id: idColumn, email: emailColumn })
      .build();

    expect(plan).toBeDefined();
    expect(plan.sql).toBeDefined();
    expect(plan.params).toBeDefined();
    expect(plan.meta).toBeDefined();
    expect(plan.meta.coreHash).toBe(result.coreHash);

    type UserRow = ResultType<typeof plan>;
    expectTypeOf<UserRow>().toHaveProperty('id');
    expectTypeOf<UserRow>().toHaveProperty('email');
  });

  it('round-trip test: TS contract → IR → JSON → IR → JSON (both JSON outputs identical)', async () => {
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    const contract1 = await loadContractFromTs(contractPath);
    const packs = loadExtensionPacks(adapterPath, []);

    const result1 = await emit(
      contract1,
      {
        outputDir,
        packs,
      },
      sqlTargetFamilyHook,
    );

    const contractJson1 = JSON.parse(result1.contractJson);

    if (!contractJson1.extensions) {
      contractJson1.extensions = {};
    }
    if (!contractJson1.extensions.pg) {
      contractJson1.extensions.pg = {};
    }

    const contract2 = contractJson1;

    const result2 = await emit(
      contract2,
      {
        outputDir,
        packs,
      },
      sqlTargetFamilyHook,
    );

    expect(result1.contractJson).toBe(result2.contractJson);
    expect(result1.coreHash).toBe(result2.coreHash);
  });
});
