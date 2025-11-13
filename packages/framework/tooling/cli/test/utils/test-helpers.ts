import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { vi } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Use a shared fixture package directory that has the necessary dependencies
// This allows jiti to resolve workspace packages when loading config files
// The fixture app can be used by any CLI test that needs to load config files
export const fixtureAppDir = join(__dirname, '../cli-e2e-test-app');
export const integrationFixtureAppDir = join(__dirname, '../cli-integration-test-app');

/**
 * Executes a command and catches process.exit errors (which are expected in tests).
 * For success cases (exit code 0), swallows the error.
 * For error cases (non-zero exit codes), re-throws the error so tests can check console errors.
 */
export async function executeCommand(command: Command, args: string[]): Promise<void> {
  try {
    await command.parseAsync(args);
  } catch (error) {
    // process.exit throws an error in tests - check the exit code
    if (error instanceof Error && error.message === 'process.exit called') {
      const exitCall = (process.exit as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const exitCode = exitCall?.[0] ?? 0; // process.exit() without argument defaults to 0
      // For success (exit code 0), swallow the error
      // For errors (non-zero), re-throw so tests can check console errors
      if (exitCode !== 0) {
        throw error;
      }
      // Exit code 0 - success, don't throw
    } else {
      // Real error (not process.exit), re-throw
      throw error;
    }
  }
}

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
    `import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';

const contractObj = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', { type: 'pg/int4@1', nullable: false })
      .column('email', { type: 'pg/text@1', nullable: false })
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
 * Sets up console and process.exit mocks for CLI command tests.
 * Returns cleanup functions and arrays to capture console output.
 */
export function setupCommandMocks(): {
  consoleOutput: string[];
  consoleErrors: string[];
  cleanup: () => void;
} {
  const consoleOutput: string[] = [];
  const consoleErrors: string[] = [];

  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalExit = process.exit;

  // Mock console first (before process.exit) so errors are captured
  console.log = vi.fn((...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  }) as typeof console.log;

  console.error = vi.fn((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  }) as typeof console.error;

  // Mock process.exit to throw instead of actually exiting (Vitest doesn't allow process.exit)
  process.exit = vi.fn(() => {
    throw new Error('process.exit called');
  }) as unknown as typeof process.exit;

  const cleanup = () => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalExit;
  };

  return { consoleOutput, consoleErrors, cleanup };
}

/**
 * Sets up a test directory by copying files from a fixture subdirectory.
 * Copies the static package.json from the root of cli-e2e-test-app,
 * then copies all files from the specified fixture subdirectory.
 * Optionally replaces placeholders in config files.
 * Returns paths and cleanup function.
 */
export function setupTestDirectoryFromFixtures(
  fixtureSubdir: string,
  configFileName = 'prisma-next.config.ts',
  replacements?: Record<string, string>,
) {
  const testDir = createTestDir();
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });

  // Copy static package.json from root of cli-e2e-test-app
  const rootPackageJson = join(fixtureAppDir, 'package.json');
  if (existsSync(rootPackageJson)) {
    copyFileSync(rootPackageJson, join(testDir, 'package.json'));
  }

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
 * Sets up a test directory for integration tests by copying files from a fixture subdirectory.
 * Copies the static package.json from the root of cli-integration-test-app,
 * then copies all files from the specified fixture subdirectory.
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

  // Copy static package.json from root of cli-integration-test-app
  const rootPackageJson = join(integrationFixtureAppDir, 'package.json');
  if (existsSync(rootPackageJson)) {
    copyFileSync(rootPackageJson, join(testDir, 'package.json'));
  }

  // Copy files from fixture subdirectory
  const fixturesSubdirPath = join(integrationFixtureAppDir, 'fixtures', fixtureSubdir);
  if (!existsSync(fixturesSubdirPath)) {
    throw new Error(`Fixture subdirectory not found: ${fixturesSubdirPath}`);
  }

  // Copy contract.ts if it exists
  const fixtureContractPath = join(fixturesSubdirPath, 'contract.ts');
  if (existsSync(fixtureContractPath)) {
    const contractPath = join(testDir, 'contract.ts');
    copyFileSync(fixtureContractPath, contractPath);
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
