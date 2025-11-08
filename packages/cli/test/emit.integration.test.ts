import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResultType } from '@prisma-next/contract/types';
import type { ContractIR } from '@prisma-next/emitter';
import { emit, loadExtensionPacks } from '@prisma-next/emitter';
import { schema, validateContract } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import type {
  Adapter,
  LoweredStatement,
  SelectAst,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-target';
import { createCodecRegistry, sqlTargetFamilyHook } from '@prisma-next/sql-target';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { loadContractFromTs } from '../src/load-ts-contract';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

    const contractJson = JSON.parse(result.contractJson) as Record<string, unknown>;
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

    const contractJson1 = JSON.parse(result1.contractJson) as Record<string, unknown>;

    if (!contractJson1['extensions']) {
      contractJson1['extensions'] = {};
    }
    const extensions = contractJson1['extensions'] as Record<string, unknown>;
    if (!extensions['pg']) {
      extensions['pg'] = {};
    }

    const contract2 = contractJson1 as unknown as ContractIR;

    const result2 = await emit(
      contract2,
      {
        outputDir,
        packs,
      },
      sqlTargetFamilyHook,
    );

    const json1 = JSON.parse(result1.contractJson) as Record<string, unknown>;
    const json2 = JSON.parse(result2.contractJson) as Record<string, unknown>;
    // Normalize: remove empty relations if present
    if (json1['relations'] && Object.keys(json1['relations'] as Record<string, unknown>).length === 0) {
      delete json1['relations'];
    }
    if (json2['relations'] && Object.keys(json2['relations'] as Record<string, unknown>).length === 0) {
      delete json2['relations'];
    }
    expect(JSON.stringify(json1, null, 2)).toBe(JSON.stringify(json2, null, 2));
    expect(result1.coreHash).toBe(result2.coreHash);
  });
});
