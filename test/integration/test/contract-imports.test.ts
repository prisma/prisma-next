import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { loadExtensionPacks } from '@prisma-next/cli/pack-loading';
import type { EmitOptions } from '@prisma-next/emitter';
import { emit } from '@prisma-next/emitter';
import {
  assembleOperationRegistryFromPacks,
  extractCodecTypeImportsFromPacks,
  extractExtensionIdsFromPacks,
  extractOperationTypeImportsFromPacks,
} from '@prisma-next/family-sql/test-utils';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContractIR } from '../../../packages/1-framework/3-tooling/emitter/test/utils';

const execFileAsync = promisify(execFile);

/**
 * Runs TypeScript compiler on a tsconfig and asserts success.
 * On failure, includes the generated contract.d.ts content in the error for debugging.
 */
async function runTscAndAssertSuccess(
  tsconfigPath: string,
  workspaceRoot: string,
  contractDtsContent: string,
): Promise<void> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'pnpm',
      ['exec', 'tsc', '--noEmit', '--project', tsconfigPath],
      {
        cwd: workspaceRoot,
      },
    );

    if (stderr?.trim() && !stderr.includes('Found 0 errors')) {
      throw new Error(`TypeScript compilation failed:\n${stderr}`);
    }

    // If we get here, all imports resolved successfully
    expect(stdout).toBeDefined();
  } catch (error: unknown) {
    if (error && typeof error === 'object') {
      const errorObj = error as { stderr?: string; stdout?: string; message?: string };
      const stderr = errorObj.stderr || '';
      const stdout = errorObj.stdout || '';
      const message = errorObj.message || '';
      const fullError = stderr || stdout || message;

      throw new Error(
        `TypeScript compilation failed:\n${fullError}\n\nGenerated contract.d.ts:\n${contractDtsContent}`,
      );
    }
    throw error;
  }
}

describe('contract.d.ts imports resolution', () => {
  let testDir: string;
  const workspaceRoot = join(__dirname, '../../..');

  beforeEach(async () => {
    testDir = join(tmpdir(), `prisma-next-imports-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it(
    'generates contract.d.ts with all imports resolving correctly',
    async () => {
      const ir = createContractIR({
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
              createdAt: { column: 'createdAt' },
            },
            relations: {},
          },
          Post: {
            storage: { table: 'post' },
            fields: {
              id: { column: 'id' },
              title: { column: 'title' },
              userId: { column: 'userId' },
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
                createdAt: {
                  codecId: 'pg/timestamptz@1',
                  nativeType: 'timestamptz',
                  nullable: false,
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            post: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                userId: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });

      const packs = loadExtensionPacks(
        join(__dirname, '../../../packages/3-targets/6-adapters/postgres'),
        [],
      );
      const operationRegistry = assembleOperationRegistryFromPacks(packs);
      const codecTypeImports = extractCodecTypeImportsFromPacks(packs);
      const operationTypeImports = extractOperationTypeImportsFromPacks(packs);
      const extensionIds = extractExtensionIdsFromPacks(packs);
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

      // Verify the generated contract.d.ts contains the correct import
      const contractDtsContent = await readFile(contractDtsPath, 'utf-8');
      expect(contractDtsContent).toContain("from '@prisma-next/sql-contract/types'");
      expect(contractDtsContent).toContain('SqlContract');
      expect(contractDtsContent).toContain('SqlStorage');
      expect(contractDtsContent).toContain('SqlMappings');
      expect(contractDtsContent).toContain('ModelDefinition');
      expect(contractDtsContent).not.toContain("from './contract-types'");

      // Create a test TypeScript file that imports the generated contract.d.ts
      const testFileContent = `import type { Contract, CodecTypes } from './contract.d.ts';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';

// Verify we can use the Contract type
// biome-ignore lint/suspicious/noExplicitAny: test code with type assertions
const _contract: Contract = {} as any;
const _storage: Contract['storage'] = _contract.storage;
const _tables: Contract['storage']['tables'] = _storage.tables;

// Verify we can access CodecTypes
const _codecTypes: CodecTypes = {} as any;

// Verify the contract type is correctly structured
type UserTable = Contract['storage']['tables']['user'];
type UserColumns = UserTable['columns'];
type UserIdColumn = UserColumns['id'];
`;

      const testFilePath = join(testDir, 'test-imports.ts');
      await writeFile(testFilePath, testFileContent, 'utf-8');

      // Create a tsconfig.json for the test directory
      // Use path mappings to resolve workspace packages from their dist directories
      const relativeToWorkspace = relative(testDir, workspaceRoot).replace(/\\/g, '/');
      const tsconfigContent = JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'nodenext',
          moduleResolution: 'nodenext',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          types: [],
          baseUrl: '.',
          paths: {
            '@prisma-next/sql-contract/types': [
              `${relativeToWorkspace}/packages/2-sql/1-core/contract/dist/exports/types.d.ts`,
            ],
            '@prisma-next/sql-contract/types/*': [
              `${relativeToWorkspace}/packages/2-sql/1-core/contract/dist/exports/types/*`,
            ],
            '@prisma-next/adapter-postgres/*': [
              `${relativeToWorkspace}/packages/3-targets/6-adapters/postgres/dist/exports/*`,
            ],
          },
        },
        include: ['*.ts', '*.d.ts'],
      });

      // Create a package.json to mark the directory as ESM
      const packageJsonContent = JSON.stringify({ type: 'module' });
      const packageJsonPath = join(testDir, 'package.json');
      await writeFile(packageJsonPath, packageJsonContent, 'utf-8');

      const tsconfigPath = join(testDir, 'tsconfig.json');
      await writeFile(tsconfigPath, tsconfigContent, 'utf-8');

      // Use TypeScript compiler to verify all imports resolve
      // Use pnpm to run TypeScript from the workspace root so path mappings work
      await runTscAndAssertSuccess(tsconfigPath, workspaceRoot, contractDtsContent);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'generated contract.d.ts can be imported and used in TypeScript',
    async () => {
      const ir = createContractIR({
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
      });

      const packs = loadExtensionPacks(
        join(__dirname, '../../../packages/3-targets/6-adapters/postgres'),
        [],
      );
      const operationRegistry = assembleOperationRegistryFromPacks(packs);
      const codecTypeImports = extractCodecTypeImportsFromPacks(packs);
      const operationTypeImports = extractOperationTypeImportsFromPacks(packs);
      const extensionIds = extractExtensionIdsFromPacks(packs);
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

      // Verify the contract.d.ts imports are correct
      const contractDtsContent = await readFile(contractDtsPath, 'utf-8');
      expect(contractDtsContent).toContain("from '@prisma-next/sql-contract/types'");
      expect(contractDtsContent).toContain("from '@prisma-next/adapter-postgres/codec-types'");

      // Create a comprehensive test file that uses all exported types
      const testFileContent = `import type { Contract, CodecTypes, Tables, Models, Relations } from './contract.d.ts';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import contractJson from './contract.json' with { type: 'json' };

// Verify we can validate the contract
const contract = validateContract<Contract>(contractJson);

// Verify we can access all exported types
const _tables: Tables = contract.storage.tables;
const _models: Models = contract.models;
const _relations: Relations = contract.relations;

// Verify we can access nested types
type UserTable = Tables['user'];
type UserColumns = UserTable['columns'];
type UserIdColumn = UserColumns['id'];
type UserIdCodecId = UserIdColumn['codecId'];

// Verify CodecTypes is available
// biome-ignore lint/suspicious/noExplicitAny: test code with type assertions
const _codecTypes: CodecTypes = {} as any;
type CodecTextType = CodecTypes['pg/text@1'];
type CodecIntType = CodecTypes['pg/int4@1'];
`;

      const testFilePath = join(testDir, 'test-usage.ts');
      await writeFile(testFilePath, testFileContent, 'utf-8');

      // Create a tsconfig.json that includes node_modules resolution
      // Use path mappings to resolve workspace packages from their dist directories
      const relativeToWorkspace = relative(testDir, workspaceRoot).replace(/\\/g, '/');
      const tsconfigContent = JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'nodenext',
          moduleResolution: 'nodenext',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          types: [],
          baseUrl: '.',
          paths: {
            '@prisma-next/sql-contract-ts/*': [
              `${relativeToWorkspace}/packages/2-sql/2-authoring/contract-ts/dist/exports/*.d.ts`,
            ],
            '@prisma-next/sql-contract/types': [
              `${relativeToWorkspace}/packages/2-sql/1-core/contract/dist/exports/types.d.ts`,
            ],
            '@prisma-next/sql-contract/types/*': [
              `${relativeToWorkspace}/packages/2-sql/1-core/contract/dist/exports/*`,
            ],
            '@prisma-next/adapter-postgres/*': [
              `${relativeToWorkspace}/packages/3-targets/6-adapters/postgres/dist/exports/*`,
            ],
            '@prisma-next/sql-query/*': [
              `${relativeToWorkspace}/packages/sql-query/dist/exports/*.d.ts`,
            ],
          },
        },
        include: ['*.ts', '*.d.ts'],
      });

      // Create a package.json to mark the directory as ESM
      const packageJsonContent = JSON.stringify({ type: 'module' });
      const packageJsonPath = join(testDir, 'package.json');
      await writeFile(packageJsonPath, packageJsonContent, 'utf-8');

      const tsconfigPath = join(testDir, 'tsconfig.json');
      await writeFile(tsconfigPath, tsconfigContent, 'utf-8');

      // Use TypeScript compiler to verify all imports resolve
      // Use pnpm to run TypeScript from the workspace root so path mappings work
      await runTscAndAssertSuccess(tsconfigPath, workspaceRoot, contractDtsContent);
    },
    timeouts.typeScriptCompilation,
  );
});
