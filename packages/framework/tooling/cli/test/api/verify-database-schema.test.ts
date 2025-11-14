import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { emitContract } from '@prisma-next/core-control-plane/emit-contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyDatabaseSchema } from '../../src/api/verify-database-schema';
import { loadConfig } from '../../src/config-loader';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '../../src/pack-assembly';
import { CliStructuredError } from '../../src/utils/cli-errors';
import { setupIntegrationTestDirectoryFromFixtures } from '../utils/test-helpers';

// Fixture subdirectory for verify-database-schema tests
const fixtureSubdir = 'verify-database';

/**
 * Emits the contract to disk using the config file.
 * Returns the validated contract for use in tests.
 */
async function emitContractFromConfig(
  configPath: string,
  testDir: string,
): Promise<SqlContract<SqlStorage>> {
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
  const extensionIds = extractExtensionIds(config.adapter, config.target, config.extensions ?? []);

  const emitResult = await emitContract({
    contractIR: contractIR as ContractIR,
    targetFamily: config.family.hook,
    operationRegistry,
    codecTypeImports,
    operationTypeImports,
    extensionIds,
  });

  // Write contract files
  const contractJsonPath = resolve(testDir, contractConfig.output ?? 'output/contract.json');
  const contractDtsPath = resolve(testDir, contractConfig.types ?? 'output/contract.d.ts');
  mkdirSync(dirname(contractJsonPath), { recursive: true });
  mkdirSync(dirname(contractDtsPath), { recursive: true });
  writeFileSync(contractJsonPath, emitResult.contractJson, 'utf-8');
  writeFileSync(contractDtsPath, emitResult.contractDts, 'utf-8');

  const contractJson = JSON.parse(emitResult.contractJson) as Record<string, unknown>;
  return validateContract<SqlContract<SqlStorage>>(contractJson);
}

describe('verifyDatabaseSchema API', () => {
  let cleanupDir: () => void;

  beforeEach(() => {
    // Set up test directory from fixtures
    const testSetup = setupIntegrationTestDirectoryFromFixtures(fixtureSubdir);
    cleanupDir = testSetup.cleanup;
  });

  afterEach(() => {
    if (cleanupDir) {
      cleanupDir();
    }
  });

  it(
    'throws error when verifySchema hook is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          const testSetup = setupIntegrationTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanup = testSetup.cleanup;

          try {
            await emitContractFromConfig(configPath, testDir);

            // Mock config to remove verifySchema hook
            const configLoaderModule = await import('../../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementationOnce(async (path) => {
              const config = await originalLoadConfig(path);
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    verifySchema: undefined,
                  }
                : undefined;
              const mockedFamily = {
                ...config.family,
                verify: mockedVerify,
              };
              return {
                ...config,
                family: mockedFamily,
              } as unknown as Awaited<ReturnType<typeof originalLoadConfig>>;
            });

            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(verifyDatabaseSchema({ dbUrl: connectionString })).rejects.toThrow(
                CliStructuredError,
              );
              await expect(verifyDatabaseSchema({ dbUrl: connectionString })).rejects.toMatchObject(
                {
                  code: '4008',
                },
              );
            } finally {
              process.chdir(originalCwd);
              vi.restoreAllMocks();
            }
          } finally {
            cleanup();
          }
        },
        { acceleratePort: 54210, databasePort: 54211, shadowDatabasePort: 54212 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it('throws error when DB URL is missing', async () => {
    const testSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.ts',
    );
    const testDir = testSetup.testDir;
    const cleanup = testSetup.cleanup;

    try {
      await emitContractFromConfig(join(testDir, 'prisma-next.config.ts'), testDir);

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await expect(verifyDatabaseSchema({})).rejects.toThrow(CliStructuredError);
        await expect(verifyDatabaseSchema({})).rejects.toMatchObject({
          code: '4005',
        });
      } finally {
        process.chdir(originalCwd);
      }
    } finally {
      cleanup();
    }
  });

  it(
    'throws error when queryRunnerFactory is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          const testSetup = setupIntegrationTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.no-query-runner.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const cleanup = testSetup.cleanup;

          try {
            await emitContractFromConfig(join(testDir, 'prisma-next.config.ts'), testDir);

            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(verifyDatabaseSchema({ dbUrl: connectionString })).rejects.toThrow(
                CliStructuredError,
              );
              await expect(verifyDatabaseSchema({ dbUrl: connectionString })).rejects.toMatchObject(
                {
                  code: '4006',
                },
              );
            } finally {
              process.chdir(originalCwd);
            }
          } finally {
            cleanup();
          }
        },
        { acceleratePort: 54213, databasePort: 54214, shadowDatabasePort: 54215 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'throws error when contract file is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          const testSetup = setupIntegrationTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const cleanup = testSetup.cleanup;

          try {
            // Don't emit contract - test missing file
            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await expect(verifyDatabaseSchema({ dbUrl: connectionString })).rejects.toThrow(
                CliStructuredError,
              );
              await expect(verifyDatabaseSchema({ dbUrl: connectionString })).rejects.toMatchObject(
                {
                  code: '4004',
                },
              );
            } finally {
              process.chdir(originalCwd);
            }
          } finally {
            cleanup();
          }
        },
        { acceleratePort: 54216, databasePort: 54217, shadowDatabasePort: 54218 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'calls verifySchema hook with correct parameters',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          const testSetup = setupIntegrationTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanup = testSetup.cleanup;

          try {
            const contract = await emitContractFromConfig(configPath, testDir);

            // Mock verifySchema hook
            const configLoaderModule = await import('../../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            const verifySchemaMock = vi.fn().mockResolvedValue({
              ok: true,
              summary: 'Database schema satisfies contract',
              contract: {
                coreHash: contract.coreHash,
                profileHash: contract.profileHash,
              },
              target: {
                expected: 'postgres',
                actual: 'postgres',
              },
              schema: {
                issues: [],
              },
              timings: {
                total: 10,
              },
            });

            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementationOnce(async (path) => {
              const config = await originalLoadConfig(path);
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    verifySchema: verifySchemaMock,
                  }
                : {
                    verifySchema: verifySchemaMock,
                  };
              const mockedFamily = {
                ...config.family,
                verify: mockedVerify,
              };
              return {
                ...config,
                family: mockedFamily,
              } as unknown as Awaited<ReturnType<typeof originalLoadConfig>>;
            });

            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              const result = await verifyDatabaseSchema({ dbUrl: connectionString });

              expect(result.ok).toBe(true);
              expect(result.summary).toBe('Database schema satisfies contract');
              expect(verifySchemaMock).toHaveBeenCalledOnce();
              const callArgs = verifySchemaMock.mock.calls[0]?.[0];
              expect(callArgs).toBeDefined();
              expect(callArgs).toMatchObject({
                contractIR: expect.anything(),
                target: expect.objectContaining({ id: 'postgres' }),
                adapter: expect.objectContaining({ id: 'postgres' }),
                strict: false,
                contractPath: expect.stringContaining('contract.json'),
              });
              expect(callArgs.driver).toBeDefined();
              expect(callArgs.driver.query).toBeDefined();
            } finally {
              process.chdir(originalCwd);
              vi.restoreAllMocks();
            }
          } finally {
            cleanup();
          }
        },
        { acceleratePort: 54219, databasePort: 54220, shadowDatabasePort: 54221 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'propagates strict mode to verifySchema hook',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          const testSetup = setupIntegrationTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanup = testSetup.cleanup;

          try {
            await emitContractFromConfig(configPath, testDir);

            // Mock verifySchema hook
            const configLoaderModule = await import('../../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            const verifySchemaMock = vi.fn().mockResolvedValue({
              ok: true,
              summary: 'Database schema satisfies contract',
              contract: {
                coreHash: 'sha256:test',
              },
              target: {
                expected: 'postgres',
              },
              schema: {
                issues: [],
              },
              timings: {
                total: 10,
              },
            });

            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementationOnce(async (path) => {
              const config = await originalLoadConfig(path);
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    verifySchema: verifySchemaMock,
                  }
                : {
                    verifySchema: verifySchemaMock,
                  };
              const mockedFamily = {
                ...config.family,
                verify: mockedVerify,
              };
              return {
                ...config,
                family: mockedFamily,
              } as unknown as Awaited<ReturnType<typeof originalLoadConfig>>;
            });

            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await verifyDatabaseSchema({ dbUrl: connectionString, strict: true });

              expect(verifySchemaMock).toHaveBeenCalledOnce();
              const callArgs = verifySchemaMock.mock.calls[0]?.[0];
              expect(callArgs).toBeDefined();
              expect(callArgs.strict).toBe(true);
            } finally {
              process.chdir(originalCwd);
              vi.restoreAllMocks();
            }
          } finally {
            cleanup();
          }
        },
        { acceleratePort: 54222, databasePort: 54223, shadowDatabasePort: 54224 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns schema issues when verification fails',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          const testSetup = setupIntegrationTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanup = testSetup.cleanup;

          try {
            const contract = await emitContractFromConfig(configPath, testDir);

            // Mock verifySchema hook to return schema issues
            const configLoaderModule = await import('../../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            const verifySchemaMock = vi.fn().mockResolvedValue({
              ok: false,
              code: 'PN-SCHEMA-0001',
              summary: 'Contract requirements not met',
              contract: {
                coreHash: contract.coreHash,
              },
              target: {
                expected: 'postgres',
                actual: 'postgres',
              },
              schema: {
                issues: [
                  {
                    kind: 'missing_table',
                    table: 'posts',
                    message: 'Table posts is required by the contract but not present.',
                  },
                  {
                    kind: 'type_mismatch',
                    table: 'users',
                    column: 'name',
                    expected: 'text',
                    actual: 'integer',
                    message:
                      'Column users.name has incompatible type; expected text, found integer.',
                  },
                ],
              },
              timings: {
                total: 15,
              },
            });

            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementationOnce(async (path) => {
              const config = await originalLoadConfig(path);
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    verifySchema: verifySchemaMock,
                  }
                : {
                    verifySchema: verifySchemaMock,
                  };
              const mockedFamily = {
                ...config.family,
                verify: mockedVerify,
              };
              return {
                ...config,
                family: mockedFamily,
              } as unknown as Awaited<ReturnType<typeof originalLoadConfig>>;
            });

            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              const result = await verifyDatabaseSchema({ dbUrl: connectionString });

              expect(result.ok).toBe(false);
              expect(result.code).toBe('PN-SCHEMA-0001');
              expect(result.summary).toBe('Contract requirements not met');
              expect(result.schema.issues).toHaveLength(2);
              expect(result.schema.issues[0]).toMatchObject({
                kind: 'missing_table',
                table: 'posts',
              });
              expect(result.schema.issues[1]).toMatchObject({
                kind: 'type_mismatch',
                table: 'users',
                column: 'name',
                expected: 'text',
                actual: 'integer',
              });
            } finally {
              process.chdir(originalCwd);
              vi.restoreAllMocks();
            }
          } finally {
            cleanup();
          }
        },
        { acceleratePort: 54225, databasePort: 54226, shadowDatabasePort: 54227 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'closes query runner after verification',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          const testSetup = setupIntegrationTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );
          const testDir = testSetup.testDir;
          const configPath = testSetup.configPath;
          const cleanup = testSetup.cleanup;

          try {
            await emitContractFromConfig(configPath, testDir);

            // Mock verifySchema hook and query runner
            const configLoaderModule = await import('../../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            const closeMock = vi.fn().mockResolvedValue(undefined);
            const verifySchemaMock = vi.fn().mockResolvedValue({
              ok: true,
              summary: 'Database schema satisfies contract',
              contract: {
                coreHash: 'sha256:test',
              },
              target: {
                expected: 'postgres',
              },
              schema: {
                issues: [],
              },
              timings: {
                total: 10,
              },
            });

            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementationOnce(async (path) => {
              const config = await originalLoadConfig(path);
              const dbConfig = config.db as
                | { url?: string; queryRunnerFactory?: (url: string) => unknown }
                | undefined;
              if (!dbConfig?.queryRunnerFactory) {
                throw new Error('queryRunnerFactory is required');
              }
              const originalFactory = dbConfig.queryRunnerFactory;
              const mockedFactory = async (url: string) => {
                const runnerResult = originalFactory(url);
                const runner = runnerResult instanceof Promise ? await runnerResult : runnerResult;
                return {
                  ...runner,
                  close: closeMock,
                };
              };
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    verifySchema: verifySchemaMock,
                  }
                : {
                    verifySchema: verifySchemaMock,
                  };
              const mockedFamily = {
                ...config.family,
                verify: mockedVerify,
              };
              return {
                ...config,
                family: mockedFamily,
                db: {
                  ...config.db,
                  queryRunnerFactory: mockedFactory,
                },
              } as unknown as Awaited<ReturnType<typeof originalLoadConfig>>;
            });

            const originalCwd = process.cwd();
            try {
              process.chdir(testDir);
              await verifyDatabaseSchema({ dbUrl: connectionString });

              expect(closeMock).toHaveBeenCalledOnce();
            } finally {
              process.chdir(originalCwd);
              vi.restoreAllMocks();
            }
          } finally {
            cleanup();
          }
        },
        { acceleratePort: 54228, databasePort: 54229, shadowDatabasePort: 54230 },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
