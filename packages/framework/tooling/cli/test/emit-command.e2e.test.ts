import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContractEmitCommand } from '../src/commands/contract-emit';
import { createEmitCommand } from '../src/commands/emit';
import { executeCommand, setupCommandMocks, setupTestDirectory } from './utils/test-helpers';

function createConfigFileContent(
  _testDir: string,
  includeContract = true,
  outputOverride?: string,
): string {
  const contractImport = includeContract ? `import { contract } from './contract';` : '';
  const contractField = includeContract
    ? `  contract: {
    source: contract,
    output: '${outputOverride ?? 'output/contract.json'}',
    types: '${outputOverride ? outputOverride.replace('.json', '.d.ts') : 'output/contract.d.ts'}',
  },`
    : '';

  return `import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import sql from '@prisma-next/family-sql/cli';
${contractImport}

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
${contractField}
});
`;
}

describe('contract emit command (e2e)', () => {
  let testDir: string;
  let outputDir: string;
  let configPath: string;
  let consoleOutput: string[] = [];
  let consoleErrors: string[] = [];
  let cleanupMocks: () => void;
  let cleanupDir: () => void;

  beforeEach(() => {
    // Set up console and process.exit mocks
    const mocks = setupCommandMocks();
    consoleOutput = mocks.consoleOutput;
    consoleErrors = mocks.consoleErrors;
    cleanupMocks = mocks.cleanup;

    // Set up test directory with contract file
    const testSetup = setupTestDirectory();
    testDir = testSetup.testDir;
    outputDir = testSetup.outputDir;
    configPath = testSetup.configPath;
    cleanupDir = testSetup.cleanup;

    // Create default config file using package names
    writeFileSync(configPath, createConfigFileContent(testDir), 'utf-8');
  });

  afterEach(() => {
    cleanupDir();
    cleanupMocks();
  });

  it(
    'emits contract.json and contract.d.ts with canonical command',
    async () => {
      const command = createContractEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, ['--config', 'prisma-next.config.ts']);
      } finally {
        process.chdir(originalCwd);
      }

      const contractJsonPath = join(outputDir, 'contract.json');
      const contractDtsPath = join(outputDir, 'contract.d.ts');

      expect(existsSync(contractJsonPath)).toBe(true);
      expect(existsSync(contractDtsPath)).toBe(true);

      const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
      expect(contractJson).toMatchObject({
        targetFamily: 'sql',
        _generated: expect.anything(),
      });

      const contractDts = readFileSync(contractDtsPath, 'utf-8');
      expect(contractDts).toContain('export type Contract');
      expect(contractDts).toContain('CodecTypes');

      expect(consoleOutput.some((msg) => msg.includes('Emitted contract.json'))).toBe(true);
      expect(consoleOutput.some((msg) => msg.includes('coreHash'))).toBe(true);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'emits contract.json and contract.d.ts with legacy emit alias',
    async () => {
      const command = createEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, ['--config', 'prisma-next.config.ts']);
      } finally {
        process.chdir(originalCwd);
      }

      const contractJsonPath = join(outputDir, 'contract.json');
      const contractDtsPath = join(outputDir, 'contract.d.ts');

      expect(existsSync(contractJsonPath)).toBe(true);
      expect(existsSync(contractDtsPath)).toBe(true);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'outputs JSON when --json flag is provided',
    async () => {
      const command = createContractEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, ['--config', 'prisma-next.config.ts', '--json']);
      } finally {
        process.chdir(originalCwd);
      }

      // Check that output is valid JSON
      const jsonOutput = consoleOutput.join('\n');
      expect(() => JSON.parse(jsonOutput)).not.toThrow();

      const parsed = JSON.parse(jsonOutput);
      expect(parsed).toMatchObject({
        ok: true,
        coreHash: expect.any(String),
        outDir: expect.any(String),
        files: {
          json: expect.any(String),
          dts: expect.any(String),
        },
        timings: {
          total: expect.any(Number),
        },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it('throws error with PN-CLI code when config file is missing', async () => {
    const command = createContractEmitCommand();
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await expect(
        command.parseAsync(['node', 'cli.js', 'emit', '--config', 'nonexistent.config.ts']),
      ).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
    }

    // Check that error output contains PN-CLI code
    const errorOutput = consoleErrors.join('\n');
    expect(errorOutput).toContain('PN-CLI-');
    // Config errors should have exit code 2 (usage/config error)
    expect(errorOutput).toContain('PN-CLI-4001');
  });

  it('throws error with PN-CLI code when contract config is missing', async () => {
    const configWithoutContract = join(testDir, 'no-contract-config.ts');
    writeFileSync(configWithoutContract, createConfigFileContent(testDir, false), 'utf-8');

    const command = createContractEmitCommand();
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await expect(
        command.parseAsync(['node', 'cli.js', 'emit', '--config', 'no-contract-config.ts']),
      ).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
    }

    // Check that error output contains PN-CLI code
    const errorOutput = consoleErrors.join('\n');
    expect(errorOutput).toContain('PN-CLI-');
  });

  it(
    'outputs timings in verbose mode',
    async () => {
      const command = createContractEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, ['--config', 'prisma-next.config.ts', '--verbose']);
      } finally {
        process.chdir(originalCwd);
      }

      // Check that output includes timing information
      const output = consoleOutput.join('\n');
      expect(output).toContain('Total time');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'suppresses output in quiet mode',
    async () => {
      const command = createContractEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, ['--config', 'prisma-next.config.ts', '--quiet']);
      } finally {
        process.chdir(originalCwd);
      }

      // In quiet mode, only errors should be output
      // Since this is a success case, consoleOutput should be empty or minimal
      const output = consoleOutput.join('\n');
      expect(output).toBe('');
    },
    timeouts.typeScriptCompilation,
  );
});
