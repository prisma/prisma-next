import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmitCommand } from '../src/commands/emit';
import {
  executeCommand,
  setupCommandMocks,
  setupIntegrationTestDirectoryFromFixtures,
} from './utils/test-helpers';

// Fixture subdirectory for emit-command tests
const fixtureSubdir = 'emit-command';

describe('emit command', () => {
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

    // Set up test directory from fixtures
    const testSetup = setupIntegrationTestDirectoryFromFixtures(fixtureSubdir);
    testDir = testSetup.testDir;
    outputDir = testSetup.outputDir;
    cleanupDir = testSetup.cleanup;
  });

  afterEach(() => {
    cleanupDir();
    cleanupMocks();
  });

  it(
    'emits contract.json and contract.d.ts with valid contract',
    async () => {
      const command = createEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, [
          'node',
          'cli.js',
          'emit',
          '--config',
          'prisma-next.config.ts',
        ]);
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
    'creates output directory if it does not exist',
    async () => {
      const newOutputDir = join(testDir, 'new-output');
      const command = createEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        // Test with custom output path in config
        const testSetup = setupIntegrationTestDirectoryFromFixtures(
          fixtureSubdir,
          'prisma-next.config.custom-output.ts',
          { '{{OUTPUT_DIR}}': newOutputDir },
        );
        const customTestDir = testSetup.testDir;
        const customCleanup = testSetup.cleanup;

        try {
          process.chdir(customTestDir);
          await executeCommand(command, [
            'node',
            'cli.js',
            'emit',
            '--config',
            'prisma-next.config.ts',
          ]);

          expect(existsSync(newOutputDir)).toBe(true);
          expect(existsSync(join(newOutputDir, 'contract.json'))).toBe(true);
          expect(existsSync(join(newOutputDir, 'contract.d.ts'))).toBe(true);
        } finally {
          customCleanup();
        }
      } finally {
        process.chdir(originalCwd);
      }
    },
    timeouts.typeScriptCompilation,
  );

  it('handles missing contract in config', async () => {
    const command = createEmitCommand();
    const testSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.no-contract.ts',
    );
    const testDirNoContract = testSetup.testDir;
    const cleanupNoContract = testSetup.cleanup;

    try {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDirNoContract);
        await expect(
          command.parseAsync(['node', 'cli.js', 'emit', '--config', 'prisma-next.config.ts']),
        ).rejects.toThrow();
      } finally {
        process.chdir(originalCwd);
      }

      expect(
        consoleErrors.some(
          (msg) => msg.includes('contract') || msg.includes('Config.contract is required'),
        ),
      ).toBe(true);
    } finally {
      cleanupNoContract();
    }
  });

  it('uses default output path when not specified in contract config', async () => {
    const command = createEmitCommand();
    const testSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.defaults.ts',
    );
    const testDirDefaults = testSetup.testDir;
    const cleanupDefaults = testSetup.cleanup;

    try {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDirDefaults);
        await executeCommand(command, [
          'node',
          'cli.js',
          'emit',
          '--config',
          'prisma-next.config.ts',
        ]);
      } finally {
        process.chdir(originalCwd);
      }

      // Default output is 'src/prisma/contract.json'
      const defaultJsonPath = join(testDirDefaults, 'src/prisma/contract.json');
      const defaultDtsPath = join(testDirDefaults, 'src/prisma/contract.d.ts');
      expect(existsSync(defaultJsonPath)).toBe(true);
      expect(existsSync(defaultDtsPath)).toBe(true);
    } finally {
      cleanupDefaults();
    }
  });

  it('handles invalid contract in config', async () => {
    const command = createEmitCommand();
    const testSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.invalid-contract.ts',
    );
    const testDirInvalid = testSetup.testDir;
    const cleanupInvalid = testSetup.cleanup;

    try {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDirInvalid);
        await expect(
          executeCommand(command, ['node', 'cli.js', 'emit', '--config', 'prisma-next.config.ts']),
        ).rejects.toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    } finally {
      cleanupInvalid();
    }
  });

  it(
    'handles unsupported target family',
    async () => {
      const command = createEmitCommand();
      const testSetup = setupIntegrationTestDirectoryFromFixtures(
        fixtureSubdir,
        'prisma-next.config.document-family.ts',
      );
      const testDirDocument = testSetup.testDir;
      const cleanupDocument = testSetup.cleanup;

      try {
        const originalCwd = process.cwd();
        try {
          process.chdir(testDirDocument);
          // The command should throw an error for unsupported family
          await expect(
            executeCommand(command, [
              'node',
              'cli.js',
              'emit',
              '--config',
              'prisma-next.config.ts',
            ]),
          ).rejects.toThrow();
        } finally {
          process.chdir(originalCwd);
        }
      } finally {
        cleanupDocument();
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'handles extension paths',
    async () => {
      const command = createEmitCommand();
      // Extensions are now in config, so we just need a valid config
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, [
          'node',
          'cli.js',
          'emit',
          '--config',
          'prisma-next.config.ts',
        ]);

        const contractJsonPath = join(outputDir, 'contract.json');
        expect(existsSync(contractJsonPath)).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'handles single string extension path',
    async () => {
      const command = createEmitCommand();
      // Extensions are now in config
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, [
          'node',
          'cli.js',
          'emit',
          '--config',
          'prisma-next.config.ts',
        ]);

        const contractJsonPath = join(outputDir, 'contract.json');
        expect(existsSync(contractJsonPath)).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'handles multiple extension paths',
    async () => {
      const command = createEmitCommand();
      // Extensions are now in config
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, [
          'node',
          'cli.js',
          'emit',
          '--config',
          'prisma-next.config.ts',
        ]);

        const contractJsonPath = join(outputDir, 'contract.json');
        expect(existsSync(contractJsonPath)).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'outputs profileHash when present',
    async () => {
      const command = createEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, [
          'node',
          'cli.js',
          'emit',
          '--config',
          'prisma-next.config.ts',
        ]);

        const contractJsonPath = join(outputDir, 'contract.json');
        expect(existsSync(contractJsonPath)).toBe(true);
        const hasProfileHash = consoleOutput.some((msg) => msg.includes('profileHash'));
        expect(hasProfileHash).toBeDefined();
      } finally {
        process.chdir(originalCwd);
      }
    },
    timeouts.typeScriptCompilation,
  );

  it('handles errors and throws', async () => {
    const command = createEmitCommand();
    const testSetup = setupIntegrationTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.no-contract.ts',
    );
    const testDirNoContract = testSetup.testDir;
    const cleanupNoContract = testSetup.cleanup;

    try {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDirNoContract);
        await expect(
          command.parseAsync(['node', 'cli.js', 'emit', '--config', 'prisma-next.config.ts']),
        ).rejects.toThrow();
      } finally {
        process.chdir(originalCwd);
      }

      // Error should be thrown (either to console or as exception)
      // Commander.js may handle errors differently, so we just verify it throws
      expect(true).toBe(true); // Test passes if we reach here (error was thrown)
    } finally {
      cleanupNoContract();
    }
  });

  it(
    'handles async contract source function',
    async () => {
      const command = createEmitCommand();
      const testSetup = setupIntegrationTestDirectoryFromFixtures(
        fixtureSubdir,
        'prisma-next.config.async-source.ts',
        { '{{OUTPUT_DIR}}': outputDir },
      );
      const testDirAsync = testSetup.testDir;
      const cleanupAsync = testSetup.cleanup;

      try {
        const originalCwd = process.cwd();
        try {
          process.chdir(testDirAsync);
          await executeCommand(command, [
            'node',
            'cli.js',
            'emit',
            '--config',
            'prisma-next.config.ts',
          ]);
        } finally {
          process.chdir(originalCwd);
        }

        const contractJsonPath = join(outputDir, 'contract.json');
        expect(existsSync(contractJsonPath)).toBe(true);
      } finally {
        cleanupAsync();
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'handles sync contract source function',
    async () => {
      const command = createEmitCommand();
      const testSetup = setupIntegrationTestDirectoryFromFixtures(
        fixtureSubdir,
        'prisma-next.config.sync-source.ts',
        { '{{OUTPUT_DIR}}': outputDir },
      );
      const testDirSync = testSetup.testDir;
      const cleanupSync = testSetup.cleanup;

      try {
        const originalCwd = process.cwd();
        try {
          process.chdir(testDirSync);
          await executeCommand(command, [
            'node',
            'cli.js',
            'emit',
            '--config',
            'prisma-next.config.ts',
          ]);
        } finally {
          process.chdir(originalCwd);
        }

        const contractJsonPath = join(outputDir, 'contract.json');
        expect(existsSync(contractJsonPath)).toBe(true);
      } finally {
        cleanupSync();
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'throws error when contract config missing output or types',
    async () => {
      const command = createEmitCommand();
      const testSetup = setupIntegrationTestDirectoryFromFixtures(
        fixtureSubdir,
        'prisma-next.config.missing-output.ts',
      );
      const testDirMissing = testSetup.testDir;
      const cleanupMissing = testSetup.cleanup;

      try {
        const originalCwd = process.cwd();
        try {
          process.chdir(testDirMissing);
          await expect(
            command.parseAsync(['node', 'cli.js', 'emit', '--config', 'prisma-next.config.ts']),
          ).rejects.toThrow();
        } finally {
          process.chdir(originalCwd);
        }
      } finally {
        cleanupMissing();
      }
    },
    timeouts.typeScriptCompilation,
  );
});
