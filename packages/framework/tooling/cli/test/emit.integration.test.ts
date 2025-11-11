import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { ResultType } from '@prisma-next/contract/types';
import { emit } from '@prisma-next/emitter';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql } from '@prisma-next/sql-lane/sql';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createRuntimeContext } from '@prisma-next/sql-runtime';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { loadContractFromTs } from '../src/load-ts-contract';
import {
  assembleOperationRegistryFromPacks,
  extractExtensionIds,
  extractTypeImports,
} from '../src/pack-assembly';
import { loadExtensionPacks } from '../src/pack-loading';

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

  it(
    'loads TS contract, emits artifacts, and uses them with lanes',
    async () => {
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      const adapterPath = resolve(__dirname, '../../../../sql/runtime/adapters/postgres');

      const contract = await loadContractFromTs(contractPath);
      const packs = loadExtensionPacks(adapterPath, []);

      // Assemble operation registry and extract type imports from packs
      const operationRegistry = assembleOperationRegistryFromPacks(packs);
      const typeImports = extractTypeImports(packs);
      const extensionIds = extractExtensionIds(packs);

      const result = await emit(
        contract,
        {
          outputDir,
          operationRegistry,
          typeImports,
          extensionIds,
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

      const context = createRuntimeContext({
        contract: validatedContract,
        adapter,
        extensions: [],
      });
      const tables = schema(context).tables;
      const userTable = tables['user'];
      if (!userTable) {
        throw new Error('User table not found');
      }
      const idColumn = userTable.columns['id'];
      const emailColumn = userTable.columns['email'];
      if (!idColumn || !emailColumn) {
        throw new Error('Columns not found');
      }
      const plan = sql({ context })
        .from(userTable)
        .select({ id: idColumn, email: emailColumn })
        .build();

      expect(plan).toMatchObject({
        sql: expect.anything(),
        params: expect.anything(),
        meta: expect.objectContaining({
          coreHash: result.coreHash,
        }),
      });

      type UserRow = ResultType<typeof plan>;
      expectTypeOf<UserRow>().toHaveProperty('id');
      expectTypeOf<UserRow>().toHaveProperty('email');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'round-trip test: TS contract → IR → JSON → IR → JSON (both JSON outputs identical)',
    async () => {
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      const adapterPath = resolve(__dirname, '../../../../sql/runtime/adapters/postgres');

      const contract1 = await loadContractFromTs(contractPath);
      const packs = loadExtensionPacks(adapterPath, []);
      const operationRegistry = assembleOperationRegistryFromPacks(packs);
      const typeImports = extractTypeImports(packs);
      const extensionIds = extractExtensionIds(packs);

      const result1 = await emit(
        contract1,
        {
          outputDir,
          operationRegistry,
          typeImports,
          extensionIds,
        },
        sqlTargetFamilyHook,
      );

      // Parse JSON and validate/normalize it (normal way to load contract JSON)
      // This ensures all required fields are present (nullable, uniques, indexes, foreignKeys, etc.)
      const contractJson1 = JSON.parse(result1.contractJson) as Record<string, unknown>;
      const validatedContract = validateContract<SqlContract<SqlStorage>>(contractJson1);

      // SqlContract has all required ContractIR fields (validateContract normalizes them)
      // The cast is needed because SqlContract has a 'mappings' field that ContractIR doesn't have
      const contract2 = validatedContract as unknown as ContractIR;

      const result2 = await emit(
        contract2,
        {
          outputDir,
          operationRegistry,
          typeImports,
          extensionIds,
        },
        sqlTargetFamilyHook,
      );

      const json1 = JSON.parse(result1.contractJson) as Record<string, unknown>;
      const json2 = JSON.parse(result2.contractJson) as Record<string, unknown>;

      expect(JSON.stringify(json1, null, 2)).toBe(JSON.stringify(json2, null, 2));
      expect(result1.coreHash).toBe(result2.coreHash);
    },
    timeouts.typeScriptCompilation,
  );
});
