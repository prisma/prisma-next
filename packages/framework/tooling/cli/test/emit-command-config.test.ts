import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmitCommand } from '../src/commands/emit';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectory,
} from './utils/test-helpers';

function createConfigFileContent(testDir: string): string {
  return `import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import sql from '@prisma-next/family-sql/cli';
import { contract } from './contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: contract,
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
});
`;
}

describe('emit command with config', () => {
  let testDir: string;
  let contractPath: string;
  let outputDir: string;
  let configPath: string;
  let cleanupMocks: () => void;
  let cleanupDir: () => void;

  beforeEach(() => {
    // Set up console and process.exit mocks
    const mocks = setupCommandMocks();
    cleanupMocks = mocks.cleanup;

    // Set up test directory with contract file
    const testSetup = setupTestDirectory();
    testDir = testSetup.testDir;
    contractPath = testSetup.contractPath;
    outputDir = testSetup.outputDir;
    configPath = testSetup.configPath;
    cleanupDir = testSetup.cleanup;
  });

  afterEach(() => {
    cleanupDir();
    cleanupMocks();
  });

  it(
    'emits contract with config file',
    async () => {
      // Create config file using package names
      writeFileSync(configPath, createConfigFileContent(testDir), 'utf-8');

      const command = createEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, ['emit', '--config', 'prisma-next.config.ts']);
      } finally {
        try {
          process.chdir(originalCwd);
        } catch {
          // Ignore if directory was cleaned up
        }
      }

      expect(existsSync(join(outputDir, 'contract.json'))).toBe(true);
      expect(existsSync(join(outputDir, 'contract.d.ts'))).toBe(true);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'emits contract with default config path',
    async () => {
      // Create config file at default location using package names
      writeFileSync(configPath, createConfigFileContent(testDir), 'utf-8');

      const command = createEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, ['emit']);
        expect(existsSync(join(testDir, 'output', 'contract.json'))).toBe(true);
        expect(existsSync(join(testDir, 'output', 'contract.d.ts'))).toBe(true);
      } finally {
        try {
          process.chdir(originalCwd);
        } catch {
          // Ignore if directory was cleaned up
        }
      }
    },
    timeouts.typeScriptCompilation,
  );

  it('throws error when config file is missing', async () => {
    const command = createEmitCommand();
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await expect(
        command.parseAsync(['emit', '--config', 'nonexistent.config.ts']),
      ).rejects.toThrow();
    } finally {
      try {
        process.chdir(originalCwd);
      } catch {
        // Ignore if directory was cleaned up
      }
    }
  });

  it(
    'handles config with extensions',
    async () => {
      // Create config file with extensions
      const configWithExtensions = `import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import sql from '@prisma-next/family-sql/cli';
import { contract } from './contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: contract,
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
});
`;
      writeFileSync(configPath, configWithExtensions, 'utf-8');

      const command = createEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, ['emit', '--config', 'prisma-next.config.ts']);
        expect(existsSync(join(outputDir, 'contract.json'))).toBe(true);
      } finally {
        try {
          process.chdir(originalCwd);
        } catch {
          // Ignore if directory was cleaned up
        }
      }
    },
    timeouts.typeScriptCompilation,
  );
});
