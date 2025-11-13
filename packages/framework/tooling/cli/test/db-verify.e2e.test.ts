import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import {
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { executeStatement } from '@prisma-next/sql-runtime/test/utils';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitContract } from '../src/api/emit-contract';
import { createDbVerifyCommand } from '../src/commands/db-verify';
import { loadConfig } from '../src/config-loader';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '../src/pack-assembly';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../../../../../');
const fixturesDir = join(__dirname, 'fixtures');

function createConfigFileContent(
  includeContract = true,
  outputOverride?: string,
  queryRunnerFactoryCode?: string,
): string {
  const adapterPath = resolve(
    workspaceRoot,
    'packages/targets/postgres-adapter/dist/exports/cli.js',
  );
  const targetPath = resolve(workspaceRoot, 'packages/targets/postgres/dist/exports/cli.js');
  const familyPath = resolve(workspaceRoot, 'packages/sql/tooling/cli/dist/exports/cli.js');
  const configTypesPath = resolve(
    workspaceRoot,
    'packages/framework/tooling/cli/dist/config-types.js',
  );
  const contractPath = resolve(fixturesDir, 'valid-contract.ts');

  const contractImport = includeContract ? `import { contract } from '${contractPath}';` : '';
  const contractField = includeContract
    ? `  contract: {
    source: contract,
    output: '${outputOverride ?? 'output/contract.json'}',
    types: '${outputOverride ? outputOverride.replace('.json', '.d.ts') : 'output/contract.d.ts'}',
  },`
    : '';

  const dbField = queryRunnerFactoryCode
    ? `  db: {
    queryRunnerFactory: ${queryRunnerFactoryCode},
  },`
    : '';

  return `import { defineConfig } from '${configTypesPath}';
import postgresAdapter from '${adapterPath}';
import postgres from '${targetPath}';
import sql from '${familyPath}';
${contractImport}

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
${contractField}${dbField}
});
`;
}

function createQueryRunnerFactoryCode(): string {
  return `(url) => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: url });
    client.connect();
    return {
      query: async (sql, params) => {
        const result = await client.query(sql, params);
        return { rows: result.rows };
      },
      close: async () => {
        await client.end();
      },
    };
  }`;
}

describe('db verify command (e2e)', () => {
  let testDir: string;
  let configPath: string;
  let contract: SqlContract<SqlStorage>;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let consoleOutput: string[] = [];
  let consoleErrors: string[] = [];

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `prisma-next-db-verify-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    configPath = join(testDir, 'prisma-next.config.ts');

    // Create config file
    writeFileSync(configPath, createConfigFileContent(), 'utf-8');

    // Load config and emit contract
    const config = await loadConfig(configPath);
    if (!config.contract) {
      throw new Error('Config.contract is required');
    }

    const contractConfig = config.contract;
    let contractRaw: unknown;
    if (typeof contractConfig.source === 'function') {
      contractRaw = await contractConfig.source();
    } else {
      contractRaw = contractConfig.source;
    }

    const contractWithoutMappings = config.family.stripMappings
      ? config.family.stripMappings(contractRaw)
      : contractRaw;

    const contractIR = config.family.validateContractIR(contractWithoutMappings);

    const descriptors = [config.adapter, config.target, ...(config.extensions ?? [])];
    const operationRegistry = assembleOperationRegistry(descriptors, config.family);
    const codecTypeImports = extractCodecTypeImports(descriptors);
    const operationTypeImports = extractOperationTypeImports(descriptors);
    const extensionIds = extractExtensionIds(
      config.adapter,
      config.target,
      config.extensions ?? [],
    );

    const emitResult = await emitContract({
      contractIR: contractIR as ContractIR,
      outputJsonPath: resolve(contractConfig.output ?? 'src/prisma/contract.json'),
      outputDtsPath: resolve(contractConfig.types ?? 'src/prisma/contract.d.ts'),
      targetFamily: config.family.hook,
      operationRegistry,
      codecTypeImports,
      operationTypeImports,
      extensionIds,
    });

    const contractJsonContent = readFileSync(emitResult.files.json, 'utf-8');
    const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
    contract = validateContract<SqlContract<SqlStorage>>(contractJson);

    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    consoleOutput = [];
    consoleErrors = [];

    console.log = vi.fn((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    }) as typeof console.log;

    console.error = vi.fn((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    }) as typeof console.error;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it(
    'verifies database with matching marker',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Setup marker schema and table
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            // Write marker matching contract
            const write = writeContractMarker({
              coreHash: contract.coreHash,
              profileHash: contract.profileHash ?? contract.coreHash,
              contractJson: contract,
              canonicalVersion: 1,
            });
            await executeStatement(client, write.insert);

            // Update config with queryRunnerFactory
            const configContent = createConfigFileContent(
              true,
              undefined,
              createQueryRunnerFactoryCode(),
            );
            writeFileSync(configPath, configContent, 'utf-8');

            const command = createDbVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await command.parseAsync([
                'node',
                'cli.js',
                'db',
                'verify',
                '--db',
                connectionString,
                '--config',
                configPath,
              ]);
            } finally {
              process.chdir(originalCwd);
            }

            const output = consoleOutput.join('\n');
            expect(output).toContain('✔ Database matches contract');
            expect(output).toContain('coreHash:');
            expect(consoleErrors.length).toBe(0);
          });
        },
        { acceleratePort: 54070, databasePort: 54071, shadowDatabasePort: 54072 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports error when marker is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Setup marker schema and table but don't write marker
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            // Update config with queryRunnerFactory
            const configContent = createConfigFileContent(
              true,
              undefined,
              createQueryRunnerFactoryCode(),
            );
            writeFileSync(configPath, configContent, 'utf-8');

            const command = createDbVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(
                command.parseAsync([
                  'node',
                  'cli.js',
                  'db',
                  'verify',
                  '--db',
                  connectionString,
                  '--config',
                  configPath,
                ]),
              ).rejects.toThrow();
            } finally {
              process.chdir(originalCwd);
            }

            const errorOutput = consoleErrors.join('\n');
            expect(errorOutput).toContain('✖ Marker missing');
            expect(errorOutput).toContain('PN-RTM-3001');
            expect(errorOutput).toContain('Why:');
            expect(errorOutput).toContain('Fix:');
          });
        },
        { acceleratePort: 54073, databasePort: 54074, shadowDatabasePort: 54075 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'outputs JSON when --json flag is provided',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Setup marker schema and table
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            // Write marker matching contract
            const write = writeContractMarker({
              coreHash: contract.coreHash,
              profileHash: contract.profileHash ?? contract.coreHash,
              contractJson: contract,
              canonicalVersion: 1,
            });
            await executeStatement(client, write.insert);

            // Update config with queryRunnerFactory
            const configContent = createConfigFileContent(
              true,
              undefined,
              createQueryRunnerFactoryCode(),
            );
            writeFileSync(configPath, configContent, 'utf-8');

            const command = createDbVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await command.parseAsync([
                'node',
                'cli.js',
                'db',
                'verify',
                '--db',
                connectionString,
                '--config',
                configPath,
                '--json',
              ]);
            } finally {
              process.chdir(originalCwd);
            }

            const jsonOutput = consoleOutput.join('\n');
            expect(() => JSON.parse(jsonOutput)).not.toThrow();

            const parsed = JSON.parse(jsonOutput);
            expect(parsed).toMatchObject({
              ok: true,
              summary: expect.any(String),
              contract: {
                coreHash: expect.any(String),
              },
              marker: {
                coreHash: expect.any(String),
              },
              target: {
                expected: expect.any(String),
              },
              meta: {
                contractPath: expect.any(String),
              },
              timings: {
                total: expect.any(Number),
              },
            });
          });
        },
        { acceleratePort: 54076, databasePort: 54077, shadowDatabasePort: 54078 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports error with JSON when marker is missing and --json flag is provided',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Setup marker schema and table but don't write marker
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            // Update config with queryRunnerFactory
            const configContent = createConfigFileContent(
              true,
              undefined,
              createQueryRunnerFactoryCode(),
            );
            writeFileSync(configPath, configContent, 'utf-8');

            const command = createDbVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(
                command.parseAsync([
                  'node',
                  'cli.js',
                  'db',
                  'verify',
                  '--db',
                  connectionString,
                  '--config',
                  configPath,
                  '--json',
                ]),
              ).rejects.toThrow();
            } finally {
              process.chdir(originalCwd);
            }

            const errorOutput = consoleErrors.join('\n');
            expect(() => JSON.parse(errorOutput)).not.toThrow();

            const parsed = JSON.parse(errorOutput);
            expect(parsed).toMatchObject({
              code: 'PN-RTM-3001',
              summary: expect.stringContaining('Marker missing'),
              why: expect.any(String),
              fix: expect.any(String),
            });
          });
        },
        { acceleratePort: 54079, databasePort: 54080, shadowDatabasePort: 54081 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports PN-CLI-4006 when db.queryRunnerFactory is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Setup marker schema and table
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            // Write marker matching contract
            const write = writeContractMarker({
              coreHash: contract.coreHash,
              profileHash: contract.profileHash ?? contract.coreHash,
              contractJson: contract,
              canonicalVersion: 1,
            });
            await executeStatement(client, write.insert);

            // Create config WITHOUT queryRunnerFactory
            const configContent = createConfigFileContent(true, undefined, undefined);
            writeFileSync(configPath, configContent, 'utf-8');

            const command = createDbVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(
                command.parseAsync([
                  'node',
                  'cli.js',
                  'db',
                  'verify',
                  '--db',
                  connectionString,
                  '--config',
                  configPath,
                ]),
              ).rejects.toThrow();
            } finally {
              process.chdir(originalCwd);
            }

            const errorOutput = consoleErrors.join('\n');
            expect(errorOutput).toContain('PN-CLI-4006');
            expect(errorOutput).toContain('Query runner factory is required');
            expect(errorOutput).toContain('Add db.queryRunnerFactory to prisma-next.config.ts');
          });
        },
        { acceleratePort: 54082, databasePort: 54083, shadowDatabasePort: 54084 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports PN-CLI-4007 when family.verify.readMarkerSql is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Setup marker schema and table
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            // Write marker matching contract
            const write = writeContractMarker({
              coreHash: contract.coreHash,
              profileHash: contract.profileHash ?? contract.coreHash,
              contractJson: contract,
              canonicalVersion: 1,
            });
            await executeStatement(client, write.insert);

            // Create config with queryRunnerFactory but family without verify.readMarkerSql
            const adapterPath = resolve(
              workspaceRoot,
              'packages/targets/postgres-adapter/dist/exports/cli.js',
            );
            const targetPath = resolve(
              workspaceRoot,
              'packages/targets/postgres/dist/exports/cli.js',
            );
            const configTypesPath = resolve(
              workspaceRoot,
              'packages/framework/tooling/cli/dist/config-types.js',
            );
            const contractPath = resolve(fixturesDir, 'valid-contract.ts');
            const emitterPath = resolve(
              workspaceRoot,
              'packages/sql/tooling/emitter/dist/exports/emitter.js',
            );
            const queryRunnerFactoryCode = createQueryRunnerFactoryCode();

            // Create a family descriptor without verify.readMarkerSql
            const configContent = `import { defineConfig } from '${configTypesPath}';
import postgresAdapter from '${adapterPath}';
import postgres from '${targetPath}';
import { contract } from '${contractPath}';
import sqlTargetFamilyHook from '${emitterPath}';

// Create family descriptor without verify.readMarkerSql
const sqlFamilyWithoutVerify = {
  kind: 'family' as const,
  id: 'sql',
  hook: sqlTargetFamilyHook,
  // verify property is missing
};

export default defineConfig({
  family: sqlFamilyWithoutVerify,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: contract,
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
  db: {
    queryRunnerFactory: ${queryRunnerFactoryCode},
  },
});
`;
            writeFileSync(configPath, configContent, 'utf-8');

            const command = createDbVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(
                command.parseAsync([
                  'node',
                  'cli.js',
                  'db',
                  'verify',
                  '--db',
                  connectionString,
                  '--config',
                  configPath,
                ]),
              ).rejects.toThrow();
            } finally {
              process.chdir(originalCwd);
            }

            const errorOutput = consoleErrors.join('\n');
            expect(errorOutput).toContain('PN-CLI-4007');
            expect(errorOutput).toContain('Family readMarkerSql() is required');
            expect(errorOutput).toContain(
              'Ensure family.verify.readMarkerSql() is exported by your family package',
            );
          });
        },
        { acceleratePort: 54085, databasePort: 54086, shadowDatabasePort: 54087 },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
