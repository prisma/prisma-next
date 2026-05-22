import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

const fixtureSubdir = 'emit';

withTempDir(({ createTempDir }) => {
  describe('contract emit: output path override (integration)', () => {
    let cleanupMocks: () => void;

    beforeEach(() => {
      const mocks = setupCommandMocks();
      cleanupMocks = mocks.cleanup;
    });

    afterEach(() => {
      cleanupMocks();
    });

    it(
      '--output redirects artifacts to the override path with byte-identical JSON content',
      async () => {
        const originalCwd = process.cwd();

        // Run 1: default output path (config has output: 'output/contract.json')
        const defaultSetup = setupTestDirectoryFromFixtures(
          createTempDir,
          fixtureSubdir,
          'prisma-next.config.emit.ts',
        );
        try {
          process.chdir(defaultSetup.testDir);
          await executeCommand(createContractEmitCommand(), ['--config', 'prisma-next.config.ts']);
        } finally {
          process.chdir(originalCwd);
        }

        const defaultJsonPath = join(defaultSetup.outputDir, 'contract.json');
        const defaultDtsPath = join(defaultSetup.outputDir, 'contract.d.ts');
        expect(existsSync(defaultJsonPath)).toBe(true);
        expect(existsSync(defaultDtsPath)).toBe(true);
        const defaultJsonContent = readFileSync(defaultJsonPath, 'utf-8');
        const defaultDtsContent = readFileSync(defaultDtsPath, 'utf-8');

        // Run 2: --output overrides the config's output path
        const overrideSetup = setupTestDirectoryFromFixtures(
          createTempDir,
          fixtureSubdir,
          'prisma-next.config.emit.ts',
        );
        const customJsonPath = join(overrideSetup.testDir, 'custom-out', 'contract.json');
        const customDtsPath = join(overrideSetup.testDir, 'custom-out', 'contract.d.ts');
        mkdirSync(join(overrideSetup.testDir, 'custom-out'), { recursive: true });

        try {
          process.chdir(overrideSetup.testDir);
          await executeCommand(createContractEmitCommand(), [
            '--config',
            'prisma-next.config.ts',
            '--output',
            'custom-out/contract.json',
          ]);
        } finally {
          process.chdir(originalCwd);
        }

        // Artifacts land at the override path, not the config's output path
        expect(existsSync(customJsonPath)).toBe(true);
        expect(existsSync(customDtsPath)).toBe(true);
        expect(existsSync(join(overrideSetup.outputDir, 'contract.json'))).toBe(false);

        // JSON content is byte-identical (same contract, same hash, deterministic emission)
        const overrideJsonContent = readFileSync(customJsonPath, 'utf-8');
        expect(overrideJsonContent).toBe(defaultJsonContent);

        // .d.ts content is byte-identical
        const overrideDtsContent = readFileSync(customDtsPath, 'utf-8');
        expect(overrideDtsContent).toBe(defaultDtsContent);
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'config output field routes artifacts to the configured path',
      async () => {
        const originalCwd = process.cwd();
        const setup = setupTestDirectoryFromFixtures(
          createTempDir,
          fixtureSubdir,
          'prisma-next.config.emit.ts',
        );

        try {
          process.chdir(setup.testDir);
          await executeCommand(createContractEmitCommand(), ['--config', 'prisma-next.config.ts']);
        } finally {
          process.chdir(originalCwd);
        }

        // The fixture config has output: 'output/contract.json'
        expect(existsSync(join(setup.outputDir, 'contract.json'))).toBe(true);
        expect(existsSync(join(setup.outputDir, 'contract.d.ts'))).toBe(true);
      },
      timeouts.typeScriptCompilation,
    );
  });
});
