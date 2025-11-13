import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContractEmitCommand } from '../src/commands/contract-emit';
import { createEmitCommand } from '../src/commands/emit';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
} from './utils/test-helpers';

// Fixture subdirectory for emit tests
const fixtureSubdir = 'emit';

describe('contract emit command (e2e)', () => {
  let testDir: string;
  let outputDir: string;
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
  });

  afterEach(() => {
    cleanupDir?.();
    cleanupMocks();
  });

  it(
    'emits contract.json and contract.d.ts with canonical command',
    async () => {
      // Set up test directory from fixtures
      const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.emit.ts');
      testDir = testSetup.testDir;
      outputDir = testSetup.outputDir;
      cleanupDir = testSetup.cleanup;

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
      // Set up test directory from fixtures
      const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.emit.ts');
      testDir = testSetup.testDir;
      outputDir = testSetup.outputDir;
      cleanupDir = testSetup.cleanup;

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
      // Set up test directory from fixtures
      const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.emit.ts');
      testDir = testSetup.testDir;
      outputDir = testSetup.outputDir;
      cleanupDir = testSetup.cleanup;

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
    // Set up test directory from fixtures (but we'll use a non-existent config)
    const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.emit.ts');
    testDir = testSetup.testDir;
    outputDir = testSetup.outputDir;
    cleanupDir = testSetup.cleanup;

    const command = createContractEmitCommand();
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      // Commands don't throw - they call process.exit() with non-zero exit code
      // executeCommand will catch the process.exit error and re-throw for non-zero codes
      // Match the pattern from emit-command.test.ts: include command name in args
      await expect(
        executeCommand(command, ['node', 'cli.js', 'emit', '--config', 'nonexistent.config.ts']),
      ).rejects.toThrow('process.exit called');
    } finally {
      process.chdir(originalCwd);
    }

    // Check that error output contains PN-CLI code
    // handleResult should have logged the error to console.error before process.exit was called
    const errorOutput = consoleErrors.join('\n');
    expect(errorOutput).toContain('PN-CLI-');
    // Config errors should have exit code 2 (usage/config error)
    expect(errorOutput).toContain('PN-CLI-4001');
  });

  it('throws error with PN-CLI code when contract config is missing', async () => {
    // Set up test directory from fixtures with no-contract config
    const testSetup = setupTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.no-contract.ts',
    );
    testDir = testSetup.testDir;
    outputDir = testSetup.outputDir;
    cleanupDir = testSetup.cleanup;

    const command = createContractEmitCommand();
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      // Commands don't throw - they call process.exit() with non-zero exit code
      // executeCommand will catch the process.exit error and re-throw for non-zero codes
      // Match the pattern from emit-command.test.ts: include command name in args
      await expect(
        executeCommand(command, ['node', 'cli.js', 'emit', '--config', 'prisma-next.config.ts']),
      ).rejects.toThrow('process.exit called');
    } finally {
      process.chdir(originalCwd);
    }

    // Check that error output contains PN-CLI code
    // handleResult should have logged the error to console.error before process.exit was called
    const errorOutput = consoleErrors.join('\n');
    expect(errorOutput).toContain('PN-CLI-');
  });

  it(
    'outputs timings in verbose mode',
    async () => {
      // Set up test directory from fixtures
      const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.emit.ts');
      testDir = testSetup.testDir;
      outputDir = testSetup.outputDir;
      cleanupDir = testSetup.cleanup;

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
      // Set up test directory from fixtures
      const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.emit.ts');
      testDir = testSetup.testDir;
      outputDir = testSetup.outputDir;
      cleanupDir = testSetup.cleanup;

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
