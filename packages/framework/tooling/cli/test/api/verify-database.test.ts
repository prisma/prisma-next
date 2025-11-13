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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emitContract } from '../../src/api/emit-contract';
import { verifyDatabase } from '../../src/api/verify-database';
import { loadConfig } from '../../src/config-loader';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '../../src/pack-assembly';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../../../../../');
const fixturesDir = join(__dirname, '../fixtures');

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

/**
 * Creates a query runner factory code string for use in config files.
 * This wraps a pg Client to provide the queryRunnerFactory interface.
 */
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

describe('verifyDatabase API', () => {
  let testDir: string;
  let configPath: string;
  let contract: SqlContract<SqlStorage>;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `prisma-next-verify-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    configPath = join(testDir, 'prisma-next.config.ts');

    // Create config file
    writeFileSync(configPath, createConfigFileContent(), 'utf-8');

    // Load config and emit contract to get contract.json
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

    // Emit contract to get proper hashes
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

    // Load the emitted contract
    const contractJsonContent = readFileSync(emitResult.files.json, 'utf-8');
    const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
    contract = validateContract<SqlContract<SqlStorage>>(contractJson);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it(
    'returns success when marker matches contract',
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

            const result = await verifyDatabase({
              dbUrl: connectionString,
              configPath,
            });

            expect(result.ok).toBe(true);
            expect(result.summary).toBe('Database matches contract');
            expect(result.contract.coreHash).toBe(contract.coreHash);
            if (contract.profileHash) {
              expect(result.contract.profileHash).toBe(contract.profileHash);
            }
            expect(result.timings.total).toBeGreaterThanOrEqual(0);
            expect(result.meta?.contractPath).toBeDefined();
          });
        },
        { acceleratePort: 54050, databasePort: 54051, shadowDatabasePort: 54052 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns error when marker is missing',
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

            const result = await verifyDatabase({
              dbUrl: connectionString,
              configPath,
            });

            expect(result.ok).toBe(false);
            expect(result.code).toBe('PN-RTM-3001');
            expect(result.summary).toBe('Marker missing');
            expect(result.marker).toBeUndefined();
            expect(result.contract.coreHash).toBe(contract.coreHash);
          });
        },
        { acceleratePort: 54053, databasePort: 54054, shadowDatabasePort: 54055 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns error when coreHash mismatch',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Setup marker schema and table
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            // Write marker with different hash
            const write = writeContractMarker({
              coreHash: 'sha256:different-hash',
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

            const result = await verifyDatabase({
              dbUrl: connectionString,
              configPath,
            });

            expect(result.ok).toBe(false);
            expect(result.code).toBe('PN-RTM-3002');
            expect(result.summary).toBe('Hash mismatch');
            expect(result.contract.coreHash).toBe(contract.coreHash);
            expect(result.marker?.coreHash).toBe('sha256:different-hash');
          });
        },
        { acceleratePort: 54056, databasePort: 54057, shadowDatabasePort: 54058 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns error when profileHash mismatch',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Setup marker schema and table
            await executeStatement(client, ensureSchemaStatement);
            await executeStatement(client, ensureTableStatement);

            // Write marker with matching coreHash but different profileHash
            const write = writeContractMarker({
              coreHash: contract.coreHash,
              profileHash: 'sha256:different-profile-hash',
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

            const result = await verifyDatabase({
              dbUrl: connectionString,
              configPath,
            });

            expect(result.ok).toBe(false);
            expect(result.code).toBe('PN-RTM-3002');
            expect(result.summary).toBe('Hash mismatch');
            if (contract.profileHash) {
              expect(result.contract.profileHash).toBe(contract.profileHash);
            }
            expect(result.marker?.profileHash).toBe('sha256:different-profile-hash');
          });
        },
        { acceleratePort: 54059, databasePort: 54060, shadowDatabasePort: 54061 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'includes timings in result',
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

            const result = await verifyDatabase({
              dbUrl: connectionString,
              configPath,
            });

            expect(result.timings).toBeDefined();
            expect(result.timings.total).toBeGreaterThanOrEqual(0);
          });
        },
        { acceleratePort: 54062, databasePort: 54063, shadowDatabasePort: 54064 },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
