import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { ContractIR, EmitOptions } from '@prisma-next/emitter';
import { emit, loadExtensionPacks } from '@prisma-next/emitter';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

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
      const ir: ContractIR = {
        schemaVersion: '1',
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
        relations: {},
        storage: {
          tables: {
            user: {
              columns: {
                id: { type: 'pg/int4@1', nullable: false },
                email: { type: 'pg/text@1', nullable: false },
                createdAt: { type: 'pg/timestamptz@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            post: {
              columns: {
                id: { type: 'pg/int4@1', nullable: false },
                title: { type: 'pg/text@1', nullable: false },
                userId: { type: 'pg/int4@1', nullable: false },
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

      const packs = loadExtensionPacks(
        join(__dirname, '../../../packages/sql/runtime/adapters/postgres'),
        [],
      );
      const options: EmitOptions = {
        outputDir: testDir,
        packs,
      };

      const result = await emit(ir, options, sqlTargetFamilyHook);

      const contractJsonPath = join(testDir, 'contract.json');
      const contractDtsPath = join(testDir, 'contract.d.ts');

      await writeFile(contractJsonPath, result.contractJson);
      await writeFile(contractDtsPath, result.contractDts);

      // Verify the generated contract.d.ts contains the correct import
      const contractDtsContent = await readFile(contractDtsPath, 'utf-8');
      expect(contractDtsContent).toContain("from '@prisma-next/sql-contract-types'");
      expect(contractDtsContent).toContain('SqlContract');
      expect(contractDtsContent).toContain('SqlStorage');
      expect(contractDtsContent).toContain('SqlMappings');
      expect(contractDtsContent).toContain('ModelDefinition');
      expect(contractDtsContent).not.toContain("from './contract-types'");

      // Create a test TypeScript file that imports the generated contract.d.ts
      const testFileContent = `import type { Contract, CodecTypes } from './contract.d.ts';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract-types';

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
            '@prisma-next/sql-contract-types': [
              `${relativeToWorkspace}/packages/targets/sql/contract-types/dist/index.d.ts`,
            ],
            '@prisma-next/sql-contract-types/*': [
              `${relativeToWorkspace}/packages/targets/sql/contract-types/dist/*`,
            ],
            '@prisma-next/adapter-postgres/*': [
              `${relativeToWorkspace}/packages/sql/runtime/adapters/postgres/dist/exports/*`,
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
      try {
        const { stdout, stderr } = await execFileAsync(
          'pnpm',
          ['exec', 'tsc', '--noEmit', '--project', tsconfigPath],
          {
            cwd: workspaceRoot,
          },
        );

        if (stderr?.trim()) {
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

          if (
            fullError.includes('Cannot find module') ||
            fullError.includes('Cannot resolve') ||
            fullError.includes('error TS')
          ) {
            throw new Error(
              `Import resolution failed in generated contract.d.ts:\n${fullError}\n\nGenerated contract.d.ts:\n${contractDtsContent}`,
            );
          }
        }
        throw error;
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'generated contract.d.ts can be imported and used in TypeScript',
    async () => {
      const ir: ContractIR = {
        schemaVersion: '1',
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
            relations: {},
          },
        },
        relations: {},
        storage: {
          tables: {
            user: {
              columns: {
                id: { type: 'pg/int4@1', nullable: false },
                email: { type: 'pg/text@1', nullable: false },
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

      const packs = loadExtensionPacks(
        join(__dirname, '../../../packages/sql/runtime/adapters/postgres'),
        [],
      );
      const options: EmitOptions = {
        outputDir: testDir,
        packs,
      };

      const result = await emit(ir, options, sqlTargetFamilyHook);

      const contractJsonPath = join(testDir, 'contract.json');
      const contractDtsPath = join(testDir, 'contract.d.ts');

      await writeFile(contractJsonPath, result.contractJson);
      await writeFile(contractDtsPath, result.contractDts);

      // Verify the contract.d.ts imports are correct
      const contractDtsContent = await readFile(contractDtsPath, 'utf-8');
      expect(contractDtsContent).toContain("from '@prisma-next/sql-contract-types'");
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
type UserIdType = UserIdColumn['type'];

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
              `${relativeToWorkspace}/packages/sql/authoring/sql-contract-ts/dist/exports/*.d.ts`,
            ],
            '@prisma-next/sql-contract-types': [
              `${relativeToWorkspace}/packages/targets/sql/contract-types/dist/index.d.ts`,
            ],
            '@prisma-next/sql-contract-types/*': [
              `${relativeToWorkspace}/packages/targets/sql/contract-types/dist/*`,
            ],
            '@prisma-next/adapter-postgres/*': [
              `${relativeToWorkspace}/packages/sql/runtime/adapters/postgres/dist/exports/*`,
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

        expect(stdout).toBeDefined();
      } catch (error: unknown) {
        if (error && typeof error === 'object') {
          const errorObj = error as { stderr?: string; stdout?: string; message?: string };
          const stderr = errorObj.stderr || '';
          const stdout = errorObj.stdout || '';
          const message = errorObj.message || '';
          const fullError = stderr || stdout || message;

          // Always show the error for debugging
          throw new Error(
            `TypeScript compilation failed:\n${fullError}\n\nGenerated contract.d.ts:\n${contractDtsContent}`,
          );
        }
        throw error;
      }
    },
    timeouts.typeScriptCompilation,
  );
});
