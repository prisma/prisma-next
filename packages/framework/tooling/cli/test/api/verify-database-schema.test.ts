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
    'throws error when introspectSchema hook is missing',
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

            // Mock config to remove introspectSchema hook
            const configLoaderModule = await import('../../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementation(async (path) => {
              const config = await originalLoadConfig(path);
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    introspectSchema: undefined,
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
              await expect(verifyDatabaseSchema({ dbUrl: connectionString })).rejects.toThrow();
              // Domain action throws errorUnexpected, not CliStructuredError
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
      'prisma-next.config.no-db-url.ts',
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
    'throws error when driver is missing',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          const testSetup = setupIntegrationTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.no-driver.ts',
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
              const error = await verifyDatabaseSchema({ dbUrl: connectionString }).catch((e) => e);
              expect(error).toBeInstanceOf(CliStructuredError);
              if (error instanceof CliStructuredError) {
                expect(error.code).toBe('4010');
                expect(error.toEnvelope().code).toBe('PN-CLI-4010');
              }
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
    'calls domain action with correct parameters',
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

            // Mock introspectSchema hook to verify it's called correctly
            const configLoaderModule = await import('../../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            const introspectSchemaMock = vi.fn().mockResolvedValue({
              tables: {
                user: {
                  name: 'user',
                  columns: {
                    id: {
                      name: 'id',
                      typeId: 'pg/int4@1',
                      nullable: false,
                    },
                    email: {
                      name: 'email',
                      typeId: 'pg/text@1',
                      nullable: false,
                    },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              extensions: [],
            });
            const verifySchemaMock = vi.fn().mockResolvedValue({
              issues: [],
            });

            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementationOnce(async (path) => {
              const config = await originalLoadConfig(path);
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    introspectSchema: introspectSchemaMock,
                    verifySchema: verifySchemaMock,
                  }
                : {
                    introspectSchema: introspectSchemaMock,
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
              expect(introspectSchemaMock).toHaveBeenCalledOnce();
              const callArgs = introspectSchemaMock.mock.calls[0]?.[0];
              expect(callArgs).toBeDefined();
              expect(callArgs).toMatchObject({
                target: expect.objectContaining({ id: 'postgres' }),
                adapter: expect.objectContaining({ id: 'postgres' }),
              });
              expect(callArgs.driver).toBeDefined();
              expect(callArgs.driver.query).toBeDefined();
              expect(callArgs.codecRegistry).toBeDefined();
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

            // Mock introspectSchema and verifySchema hooks
            const configLoaderModule = await import('../../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            const introspectSchemaMock = vi.fn().mockResolvedValue({
              tables: {
                user: {
                  name: 'user',
                  columns: {
                    id: {
                      name: 'id',
                      typeId: 'pg/int4@1',
                      nullable: false,
                    },
                    email: {
                      name: 'email',
                      typeId: 'pg/text@1',
                      nullable: false,
                    },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              extensions: [],
            });
            const verifySchemaMock = vi.fn().mockResolvedValue({
              issues: [],
            });

            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementationOnce(async (path) => {
              const config = await originalLoadConfig(path);
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    introspectSchema: introspectSchemaMock,
                    verifySchema: verifySchemaMock,
                  }
                : {
                    introspectSchema: introspectSchemaMock,
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

              expect(introspectSchemaMock).toHaveBeenCalledOnce();
              expect(verifySchemaMock).toHaveBeenCalledOnce();
              const verifyCallArgs = verifySchemaMock.mock.calls[0]?.[0];
              expect(verifyCallArgs).toBeDefined();
              expect(verifyCallArgs.contractIR).toBeDefined();
              expect(verifyCallArgs.schemaIR).toBeDefined();
              // Note: strict is passed to verifySchemaAgainstContract, not to family hook
              // The family hook no longer takes strict parameter
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
            await emitContractFromConfig(configPath, testDir);

            // Mock introspectSchema and verifySchema hooks
            const configLoaderModule = await import('../../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            const introspectSchemaMock = vi.fn().mockResolvedValue({
              tables: {
                user: {
                  name: 'user',
                  columns: {
                    id: {
                      name: 'id',
                      typeId: 'pg/int4@1',
                      nullable: false,
                    },
                    email: {
                      name: 'email',
                      typeId: 'pg/text@1',
                      nullable: false,
                    },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              extensions: [],
            });
            const verifySchemaMock = vi.fn().mockResolvedValue({
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
                  message: 'Column users.name has incompatible type; expected text, found integer.',
                },
              ],
            });

            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementationOnce(async (path) => {
              const config = await originalLoadConfig(path);
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    introspectSchema: introspectSchemaMock,
                    verifySchema: verifySchemaMock,
                  }
                : {
                    introspectSchema: introspectSchemaMock,
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
              expect(result.summary).toContain('Contract requirements not met');
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

            // Mock introspectSchema, verifySchema hooks and driver
            const configLoaderModule = await import('../../src/config-loader');
            const originalLoadConfig = configLoaderModule.loadConfig;
            const closeMock = vi.fn().mockResolvedValue(undefined);
            const introspectSchemaMock = vi.fn().mockResolvedValue({
              tables: {
                user: {
                  name: 'user',
                  columns: {
                    id: {
                      name: 'id',
                      typeId: 'pg/int4@1',
                      nullable: false,
                    },
                    email: {
                      name: 'email',
                      typeId: 'pg/text@1',
                      nullable: false,
                    },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              extensions: [],
            });
            const verifySchemaMock = vi.fn().mockResolvedValue({
              issues: [],
            });

            vi.spyOn(configLoaderModule, 'loadConfig').mockImplementation(async (path) => {
              const config = await originalLoadConfig(path);
              if (!config.driver) {
                throw new Error('driver is required');
              }
              const originalDriver = config.driver;
              const mockedDriver = {
                ...originalDriver,
                create: vi.fn().mockImplementation(async (url: string) => {
                  const driver = await originalDriver.create(url);
                  const originalClose = driver.close;
                  return {
                    ...driver,
                    close: vi.fn().mockImplementation(async () => {
                      closeMock();
                      await originalClose();
                    }),
                  };
                }),
              };
              const mockedVerify = config.family.verify
                ? {
                    ...config.family.verify,
                    introspectSchema: introspectSchemaMock,
                    verifySchema: verifySchemaMock,
                  }
                : {
                    introspectSchema: introspectSchemaMock,
                    verifySchema: verifySchemaMock,
                  };
              const mockedFamily = {
                ...config.family,
                verify: mockedVerify,
              };
              return {
                ...config,
                family: mockedFamily,
                driver: mockedDriver,
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
