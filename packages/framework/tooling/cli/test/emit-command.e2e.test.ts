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
  let consoleOutput: string[] = [];
  let consoleErrors: string[] = [];
  let cleanupMocks: () => void;

  beforeEach(() => {
    // Set up console and process.exit mocks
    const mocks = setupCommandMocks();
    consoleOutput = mocks.consoleOutput;
    consoleErrors = mocks.consoleErrors;
    cleanupMocks = mocks.cleanup;
  });

  afterEach(() => {
    cleanupMocks();
  });

  it(
    'emits contract.json and contract.d.ts with canonical command',
    async () => {
      // Set up test directory from fixtures
      const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.emit.ts');
      const testDir = testSetup.testDir;
      const outputDir = testSetup.outputDir;
      const cleanupDir = testSetup.cleanup;

      try {
        const command = createContractEmitCommand();
        const originalCwd = process.cwd();
        try {
          process.chdir(testDir);
          const exitCode = await executeCommand(command, [
            '--config',
            'prisma-next.config.ts',
            '--json',
          ]);
          expect(exitCode).toBe(0);
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

        // Parse JSON output and verify structure
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
      } finally {
        cleanupDir();
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'emits contract.json and contract.d.ts with legacy emit alias',
    async () => {
      // Set up test directory from fixtures
      const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.emit.ts');
      const testDir = testSetup.testDir;
      const outputDir = testSetup.outputDir;
      const cleanupDir = testSetup.cleanup;

      try {
        const command = createEmitCommand();
        const originalCwd = process.cwd();
        try {
          process.chdir(testDir);
          const exitCode = await executeCommand(command, ['--config', 'prisma-next.config.ts']);
          expect(exitCode).toBe(0);
        } finally {
          process.chdir(originalCwd);
        }

        const contractJsonPath = join(outputDir, 'contract.json');
        const contractDtsPath = join(outputDir, 'contract.d.ts');

        expect(existsSync(contractJsonPath)).toBe(true);
        expect(existsSync(contractDtsPath)).toBe(true);
      } finally {
        cleanupDir();
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'outputs JSON when --json flag is provided',
    async () => {
      // Set up test directory from fixtures
      const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.emit.ts');
      const testDir = testSetup.testDir;
      const cleanupDir = testSetup.cleanup;

      try {
        const command = createContractEmitCommand();
        const originalCwd = process.cwd();
        try {
          process.chdir(testDir);
          const exitCode = await executeCommand(command, [
            '--config',
            'prisma-next.config.ts',
            '--json',
          ]);
          expect(exitCode).toBe(0);
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
      } finally {
        cleanupDir();
      }
    },
    timeouts.typeScriptCompilation,
  );

  it('throws error with PN-CLI code when config file is missing', async () => {
    // Set up test directory from fixtures (but we'll use a non-existent config)
    const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.emit.ts');
    const testDir = testSetup.testDir;
    const cleanupDir = testSetup.cleanup;

    try {
      const command = createContractEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        const exitCode = await executeCommand(command, [
          'node',
          'cli.js',
          'emit',
          '--config',
          'nonexistent.config.ts',
          '--json',
        ]);
        expect(exitCode).not.toBe(0);
      } finally {
        process.chdir(originalCwd);
      }

      // Parse JSON error output and verify structure
      const errorOutput = consoleErrors.join('\n');
      expect(() => JSON.parse(errorOutput)).not.toThrow();

      const parsed = JSON.parse(errorOutput);
      expect(parsed).toMatchObject({
        code: 'PN-CLI-4001',
        summary: expect.any(String),
        why: expect.any(String),
        fix: expect.any(String),
      });
    } finally {
      cleanupDir();
    }
  });

  it('throws error with PN-CLI code when contract config is missing', async () => {
    // Set up test directory from fixtures with no-contract config
    const testSetup = setupTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.no-contract.ts',
    );
    const testDir = testSetup.testDir;
    const cleanupDir = testSetup.cleanup;

    try {
      const command = createContractEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        const exitCode = await executeCommand(command, [
          'node',
          'cli.js',
          'emit',
          '--config',
          'prisma-next.config.ts',
          '--json',
        ]);
        expect(exitCode).not.toBe(0);
      } finally {
        process.chdir(originalCwd);
      }

      // Parse JSON error output and verify structure
      const errorOutput = consoleErrors.join('\n');
      expect(() => JSON.parse(errorOutput)).not.toThrow();

      const parsed = JSON.parse(errorOutput);
      expect(parsed).toMatchObject({
        code: expect.stringMatching(/^PN-CLI-/),
        summary: expect.any(String),
        why: expect.any(String),
        fix: expect.any(String),
      });
    } finally {
      cleanupDir();
    }
  });

  it(
    'outputs timings in verbose mode',
    async () => {
      // Set up test directory from fixtures
      const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.emit.ts');
      const testDir = testSetup.testDir;
      const cleanupDir = testSetup.cleanup;

      try {
        const command = createContractEmitCommand();
        const originalCwd = process.cwd();
        try {
          process.chdir(testDir);
          const exitCode = await executeCommand(command, [
            '--config',
            'prisma-next.config.ts',
            '--verbose',
          ]);
          expect(exitCode).toBe(0);
        } finally {
          process.chdir(originalCwd);
        }

        // Check that output includes timing information
        const output = consoleOutput.join('\n');
        expect(output).toContain('Total time');
      } finally {
        cleanupDir();
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'suppresses output in quiet mode',
    async () => {
      // Set up test directory from fixtures
      const testSetup = setupTestDirectoryFromFixtures(fixtureSubdir, 'prisma-next.config.emit.ts');
      const testDir = testSetup.testDir;
      const cleanupDir = testSetup.cleanup;

      try {
        const command = createContractEmitCommand();
        const originalCwd = process.cwd();
        try {
          process.chdir(testDir);
          const exitCode = await executeCommand(command, [
            '--config',
            'prisma-next.config.ts',
            '--quiet',
          ]);
          expect(exitCode).toBe(0);
        } finally {
          process.chdir(originalCwd);
        }

        // In quiet mode, only errors should be output
        // Since this is a success case, consoleOutput should be empty or minimal
        const output = consoleOutput.join('\n');
        expect(output).toBe('');
      } finally {
        cleanupDir();
      }
    },
    timeouts.typeScriptCompilation,
  );
});
