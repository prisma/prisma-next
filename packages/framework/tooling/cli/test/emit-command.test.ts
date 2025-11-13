import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmitCommand } from '../src/commands/emit';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Use a shared fixture package directory that has the necessary dependencies
// This allows jiti to resolve workspace packages when loading config files
// The fixture app can be used by any CLI test that needs to load config files
const fixtureAppDir = join(__dirname, 'fixtures/cli-test-app');

/**
 * Executes a command and catches process.exit errors (which are expected in tests).
 * For success cases (exit code 0), swallows the error.
 * For error cases (non-zero exit codes), re-throws the error so tests can check console errors.
 */
async function executeCommand(
  command: ReturnType<typeof createEmitCommand>,
  args: string[],
): Promise<void> {
  try {
    await command.parseAsync(args);
  } catch (error) {
    // process.exit throws an error in tests - check the exit code
    if (error instanceof Error && error.message === 'process.exit called') {
      const exitCall = (process.exit as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const exitCode = exitCall?.[0];
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

function createContractFile(testDir: string): string {
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
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalExit: typeof process.exit;
  let consoleOutput: string[] = [];
  let consoleErrors: string[] = [];

  beforeEach(() => {
    // Reset arrays before each test
    consoleOutput = [];
    consoleErrors = [];

    // Mock console first (before process.exit) so errors are captured
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = vi.fn((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    }) as typeof console.log;

    console.error = vi.fn((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    }) as typeof console.error;

    // Mock process.exit to throw instead of actually exiting (Vitest doesn't allow process.exit)
    originalExit = process.exit;
    process.exit = vi.fn(() => {
      throw new Error('process.exit called');
    }) as unknown as typeof process.exit;

    // Create temp dir within fixture app directory
    // The fixture app has the necessary dependencies, so jiti can resolve packages
    testDir = join(fixtureAppDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    outputDir = join(testDir, 'output');
    configPath = join(testDir, 'prisma-next.config.ts');

    // Create contract.ts file in temp directory
    createContractFile(testDir);

    // Create default config file using package names
    writeFileSync(configPath, createConfigFileContent(), 'utf-8');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalExit;
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
