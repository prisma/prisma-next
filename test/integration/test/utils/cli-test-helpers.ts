import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  executeCommand,
  getExitCode,
  setupCommandMocks,
  withTempDir,
} from '@prisma-next/cli/test/utils/test-helpers';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { afterEach, beforeEach, vi } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Use a shared fixture package directory that has the necessary dependencies
// This allows jiti to resolve workspace packages when loading config files
// The fixture app can be used by any CLI test that needs to load config files
export const fixtureAppDir = join(__dirname, '../fixtures/cli/cli-e2e-test-app');
export const integrationFixtureAppDir = join(__dirname, '../fixtures/cli/cli-integration-test-app');

/**
 * Creates a test directory within the fixture app directory.
 * The fixture app has the necessary dependencies, so jiti can resolve packages.
 */
export function createTestDir(): string {
  const testDir = join(fixtureAppDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

/**
 * Creates a test directory within the integration fixture app directory.
 * The fixture app has the necessary dependencies, so jiti can resolve packages.
 */
export function createIntegrationTestDir(): string {
  const testDir = join(
    integrationFixtureAppDir,
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

/**
 * Creates a contract.ts file in the given test directory.
 */
export function createContractFile(testDir: string): string {
  const contractPath = join(testDir, 'contract.ts');
  writeFileSync(
    contractPath,
    `import { int4Column, textColumn } from '@prisma-next/test-utils/column-descriptors';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';

type CodecTypes = Record<string, never>;

const contractObj = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .build();

export const contract = {
  ...contractObj,
  extensions: {
    postgres: {
      version: '15.0.0',
    },
    pg: {},
  },
};
`,
    'utf-8',
  );
  return contractPath;
}

/**
 * Sets up a test directory by copying files from a fixture subdirectory.
 * Test directories are subdirectories of cli-e2e-test-app and inherit workspace
 * dependencies from the parent package.json at the root. jiti will resolve workspace
 * packages by walking up to find the parent package.json.
 * Optionally replaces placeholders in config files.
 * Returns paths (cleanup is handled automatically by withTempDir decorator).
 */
export function setupTestDirectoryFromFixtures(
  createTempDir: () => string,
  fixtureSubdir: string,
  configFileName = 'prisma-next.config.ts',
  replacements?: Record<string, string>,
) {
  const testDir = createTempDir();
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });

  // Copy files from fixture subdirectory
  const fixturesSubdirPath = join(fixtureAppDir, 'fixtures', fixtureSubdir);
  if (!existsSync(fixturesSubdirPath)) {
    throw new Error(`Fixture subdirectory not found: ${fixturesSubdirPath}`);
  }

  // Copy contract.ts if it exists
  const fixtureContractPath = join(fixturesSubdirPath, 'contract.ts');
  if (existsSync(fixtureContractPath)) {
    const contractPath = join(testDir, 'contract.ts');
    copyFileSync(fixtureContractPath, contractPath);
  }

  // Copy precomputed contract.json and contract.d.ts if they exist
  // Note: outputDir was already created above, so no need for mkdirSync here
  const fixtureContractJsonPath = join(fixturesSubdirPath, 'contract.json');
  const fixtureContractDtsPath = join(fixturesSubdirPath, 'contract.d.ts');
  if (existsSync(fixtureContractJsonPath)) {
    const contractJsonPath = join(outputDir, 'contract.json');
    copyFileSync(fixtureContractJsonPath, contractJsonPath);
  }
  if (existsSync(fixtureContractDtsPath)) {
    const contractDtsPath = join(outputDir, 'contract.d.ts');
    copyFileSync(fixtureContractDtsPath, contractDtsPath);
  }

  // Copy and process config file
  const configPath = join(testDir, 'prisma-next.config.ts');
  const fixtureConfigPath = join(fixturesSubdirPath, configFileName);
  if (existsSync(fixtureConfigPath)) {
    let configContent = readFileSync(fixtureConfigPath, 'utf-8');
    // Replace placeholders if provided
    if (replacements) {
      for (const [key, value] of Object.entries(replacements)) {
        configContent = configContent.replace(new RegExp(key, 'g'), value);
      }
    }
    writeFileSync(configPath, configContent, 'utf-8');
  }

  return { testDir, contractPath: join(testDir, 'contract.ts'), outputDir, configPath };
}

/**
 * Sets up a test directory for integration tests by copying files from a fixture subdirectory.
 * Test directories are subdirectories of cli-integration-test-app and inherit workspace
 * dependencies from the parent package.json at the root. jiti will resolve workspace
 * packages by walking up to find the parent package.json.
 * Optionally replaces placeholders in config files.
 * Returns paths and cleanup function.
 */
export function setupIntegrationTestDirectoryFromFixtures(
  fixtureSubdir: string,
  configFileName = 'prisma-next.config.ts',
  replacements?: Record<string, string>,
) {
  const testDir = createIntegrationTestDir();
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });

  // Copy files from fixture subdirectory
  const fixturesSubdirPath = join(integrationFixtureAppDir, 'fixtures', fixtureSubdir);
  if (!existsSync(fixturesSubdirPath)) {
    throw new Error(`Fixture subdirectory not found: ${fixturesSubdirPath}`);
  }

  // Copy all .ts files from fixture directory (contract.ts, invalid-contract.ts, etc.)
  // Exclude the config file as it will be processed separately
  const fixtureFiles = readdirSync(fixturesSubdirPath);
  for (const file of fixtureFiles) {
    if (file.endsWith('.ts') && file !== configFileName) {
      const fixtureFilePath = join(fixturesSubdirPath, file);
      const destFilePath = join(testDir, file);
      copyFileSync(fixtureFilePath, destFilePath);
    }
  }

  // Copy and process config file
  const configPath = join(testDir, 'prisma-next.config.ts');
  const fixtureConfigPath = join(fixturesSubdirPath, configFileName);
  if (existsSync(fixtureConfigPath)) {
    let configContent = readFileSync(fixtureConfigPath, 'utf-8');
    // Replace placeholders if provided
    if (replacements) {
      for (const [key, value] of Object.entries(replacements)) {
        configContent = configContent.replace(new RegExp(key, 'g'), value);
      }
    }
    writeFileSync(configPath, configContent, 'utf-8');
  }

  const cleanup = () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  };

  return { testDir, contractPath: join(testDir, 'contract.ts'), outputDir, configPath, cleanup };
}

/**
 * Loads a contract from disk (already-emitted artifact).
 * This helper DRYs up the common pattern of loading contracts in e2e tests.
 * The contract type should be specified from the emitted contract.d.ts file.
 */
export function loadContractFromDisk<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
>(contractJsonPath: string): TContract {
  if (!existsSync(contractJsonPath)) {
    throw new Error(`Contract file not found: ${contractJsonPath}`);
  }

  let contractJsonContent: string;
  try {
    contractJsonContent = readFileSync(contractJsonPath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read contract file ${contractJsonPath}: ${message}`);
  }

  let contractJson: Record<string, unknown>;
  try {
    contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse contract JSON from ${contractJsonPath}: ${message}`);
  }

  return validateContract<TContract>(contractJson);
}

/**
 * Sets up a test directory with contract.ts file and returns paths.
 * @deprecated Use setupTestDirectoryFromFixtures instead
 */
export function setupTestDirectory(): {
  testDir: string;
  contractPath: string;
  outputDir: string;
  configPath: string;
  cleanup: () => void;
} {
  const testDir = createTestDir();
  const contractPath = createContractFile(testDir);
  const outputDir = join(testDir, 'output');
  const configPath = join(testDir, 'prisma-next.config.ts');

  const cleanup = () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  };

  return { testDir, contractPath, outputDir, configPath, cleanup };
}

/**
 * Sets up a database schema and test directory for db-sign e2e tests.
 * Creates a "user" table with id and email columns, sets up the test directory,
 * and emits the contract. Returns the test setup and config path.
 */
export async function setupDbSignFixture(
  connectionString: string,
  createTempDir: () => string,
  fixtureSubdir: string,
  schemaSql?: string,
): Promise<{ testSetup: ReturnType<typeof setupTestDirectoryFromFixtures>; configPath: string }> {
  const { withClient } = await import('@prisma-next/test-utils');
  await withClient(connectionString, async (client) => {
    await client.query(
      schemaSql ??
        `
        CREATE TABLE IF NOT EXISTS "user" (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL
        )
      `,
    );
  });

  const testSetup = setupTestDirectoryFromFixtures(
    createTempDir,
    fixtureSubdir,
    'prisma-next.config.with-db.ts',
    { '{{DB_URL}}': connectionString },
  );
  const configPath = testSetup.configPath;

  // Emit contract first
  const { createContractEmitCommand } = await import(
    '../../../../packages/framework/tooling/cli/src/commands/contract-emit'
  );
  const emitCommand = createContractEmitCommand();
  const originalCwd = process.cwd();
  try {
    process.chdir(testSetup.testDir);
    await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
  } finally {
    process.chdir(originalCwd);
  }

  return { testSetup, configPath };
}

/**
 * Runs the db-sign command with the given arguments.
 * Handles process.chdir and restores the original working directory.
 */
export async function runDbSign(
  testSetup: ReturnType<typeof setupTestDirectoryFromFixtures>,
  _configPath: string,
  args: string[],
): Promise<number> {
  const { createDbSignCommand } = await import(
    '../../../../packages/framework/tooling/cli/src/commands/db-sign'
  );
  const command = createDbSignCommand();
  const originalCwd = process.cwd();
  try {
    process.chdir(testSetup.testDir);
    return await executeCommand(command, args);
  } finally {
    process.chdir(originalCwd);
  }
}

// Re-export framework-agnostic helpers from CLI package
export {
  executeCommand,
  getExitCode,
  setupCommandMocks,
  withTempDir,
} from '@prisma-next/cli/test/utils/test-helpers';
