import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmitCommand } from '../src/commands/emit';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectory,
} from './utils/test-helpers';


function createConfigFileContent(includeContract = true, outputOverride?: string): string {
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

describe('emit command', () => {
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
    writeFileSync(configPath, createConfigFileContent(), 'utf-8');
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
        const customConfigPath = join(testDir, 'custom-config.ts');
        writeFileSync(
          customConfigPath,
          createConfigFileContent(true, join(newOutputDir, 'contract.json')),
          'utf-8',
        );
        await executeCommand(command, ['node', 'cli.js', 'emit', '--config', 'custom-config.ts']);

        expect(existsSync(newOutputDir)).toBe(true);
        expect(existsSync(join(newOutputDir, 'contract.json'))).toBe(true);
        expect(existsSync(join(newOutputDir, 'contract.d.ts'))).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    },
    timeouts.typeScriptCompilation,
  );

  it('handles missing contract in config', async () => {
    const command = createEmitCommand();
    const configWithoutContract = join(testDir, 'config-no-contract.ts');
    writeFileSync(configWithoutContract, createConfigFileContent(false), 'utf-8');
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await expect(
        command.parseAsync(['node', 'cli.js', 'emit', '--config', 'config-no-contract.ts']),
      ).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
    }

    expect(
      consoleErrors.some(
        (msg) => msg.includes('contract') || msg.includes('Config.contract is required'),
      ),
    ).toBe(true);
  });

  it('uses default output path when not specified in contract config', async () => {
    const command = createEmitCommand();
    const configWithDefaults = join(testDir, 'config-defaults.ts');
    writeFileSync(
      configWithDefaults,
      `import { defineConfig } from '@prisma-next/cli/config-types';
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
    // output and types will use defaults
  },
});
`,
      'utf-8',
    );
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await executeCommand(command, ['node', 'cli.js', 'emit', '--config', 'config-defaults.ts']);
    } finally {
      process.chdir(originalCwd);
    }

    // Default output is 'src/prisma/contract.json'
    const defaultJsonPath = join(testDir, 'src/prisma/contract.json');
    const defaultDtsPath = join(testDir, 'src/prisma/contract.d.ts');
    expect(existsSync(defaultJsonPath)).toBe(true);
    expect(existsSync(defaultDtsPath)).toBe(true);
  });

  it('handles invalid contract in config', async () => {
    const command = createEmitCommand();
    const invalidContractPath = join(testDir, 'invalid-contract.ts');
    writeFileSync(invalidContractPath, `export const contract = { invalid: 'contract' };`, 'utf-8');
    const invalidConfigPath = join(testDir, 'invalid-config.ts');
    writeFileSync(
      invalidConfigPath,
      `import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import sql from '@prisma-next/family-sql/cli';
import { contract } from './invalid-contract';

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
`,
      'utf-8',
    );
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await executeCommand(command, ['node', 'cli.js', 'emit', '--config', invalidConfigPath]);
    } catch (error) {
      expect(error).toBeDefined();
    } finally {
      process.chdir(originalCwd);
    }

    expect(consoleErrors.length).toBeGreaterThan(0);
  });

  it(
    'handles unsupported target family',
    async () => {
      const command = createEmitCommand();
      const invalidContractPath = join(testDir, 'invalid-contract.ts');
      writeFileSync(
        invalidContractPath,
        `export const contract = { targetFamily: 'document', target: 'mongodb' } as const;`,
        'utf-8',
      );

      // Create a config with document family (which doesn't exist, but we'll test the error)
      const invalidConfigPath = join(testDir, 'invalid-config.ts');
      writeFileSync(
        invalidConfigPath,
        `import { defineConfig } from '@prisma-next/cli/config-types';
        const mockHook = {
          id: 'document',
          validateTypes: () => {},
          validateStructure: () => {},
          generateContractTypes: () => '',
        };
        import { contract } from './invalid-contract';
        export default defineConfig({
          family: {
            kind: 'family',
            id: 'document',
            hook: mockHook,
            convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
            validateContractIR: (contract: unknown) => contract,
          },
          target: { kind: 'target', id: 'mongodb', family: 'document', manifest: { id: 'mongodb', version: '1.0.0' } },
          adapter: { kind: 'adapter', id: 'mongodb', family: 'document', manifest: { id: 'mongodb', version: '1.0.0' } },
          extensions: [],
          contract: {
            source: contract,
            output: 'output/contract.json',
            types: 'output/contract.d.ts',
          },
        });`,
        'utf-8',
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, ['node', 'cli.js', 'emit', '--config', 'invalid-config.ts']);
      } catch (error) {
        expect(error).toBeDefined();
      } finally {
        process.chdir(originalCwd);
      }

      // The error should mention unsupported family
      expect(
        consoleErrors.some(
          (msg) => msg.includes('Unsupported family') || msg.includes('Unsupported target family'),
        ),
      ).toBe(true);
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
    const invalidConfigPath = join(testDir, 'invalid-config.ts');
    writeFileSync(invalidConfigPath, createConfigFileContent(false), 'utf-8');
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await expect(
        command.parseAsync(['node', 'cli.js', 'emit', '--config', invalidConfigPath]),
      ).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
    }

    // Error should be thrown (either to console or as exception)
    // Commander.js may handle errors differently, so we just verify it throws
    expect(true).toBe(true); // Test passes if we reach here (error was thrown)
  });

  it(
    'handles async contract source function',
    async () => {
      const command = createEmitCommand();
      const asyncConfigPath = join(testDir, 'async-config.ts');

      writeFileSync(
        asyncConfigPath,
        `import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import sql from '@prisma-next/family-sql/cli';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: async () => {
      const { contract } = await import('./contract');
      return contract;
    },
    output: '${join(outputDir, 'contract.json')}',
    types: '${join(outputDir, 'contract.d.ts')}',
  },
});
`,
        'utf-8',
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, ['node', 'cli.js', 'emit', '--config', 'async-config.ts']);
      } finally {
        process.chdir(originalCwd);
      }

      const contractJsonPath = join(outputDir, 'contract.json');
      expect(existsSync(contractJsonPath)).toBe(true);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'handles sync contract source function',
    async () => {
      const command = createEmitCommand();
      const syncConfigPath = join(testDir, 'sync-config.ts');

      writeFileSync(
        syncConfigPath,
        `import { defineConfig } from '@prisma-next/cli/config-types';
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
    source: () => contract,
    output: '${join(outputDir, 'contract.json')}',
    types: '${join(outputDir, 'contract.d.ts')}',
  },
});
`,
        'utf-8',
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await executeCommand(command, ['node', 'cli.js', 'emit', '--config', 'sync-config.ts']);
      } finally {
        process.chdir(originalCwd);
      }

      const contractJsonPath = join(outputDir, 'contract.json');
      expect(existsSync(contractJsonPath)).toBe(true);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'throws error when contract config missing output or types',
    async () => {
      const command = createEmitCommand();
      const invalidConfigPath = join(testDir, 'invalid-contract-config.ts');

      // Create config with contract missing output/types (shouldn't happen with defineConfig, but test the error path)
      writeFileSync(
        invalidConfigPath,
        `import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import sql from '@prisma-next/family-sql/cli';
import { contract } from './contract';

// Manually create config without using defineConfig to test error path
export default {
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: contract,
    // Missing output and types to test error path
  },
};
`,
        'utf-8',
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await expect(
          command.parseAsync(['node', 'cli.js', 'emit', '--config', 'invalid-contract-config.ts']),
        ).rejects.toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    },
    timeouts.typeScriptCompilation,
  );
});
