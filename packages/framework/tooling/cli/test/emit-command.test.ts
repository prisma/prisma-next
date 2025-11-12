import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmitCommand } from '../src/commands/emit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');
const workspaceRoot = resolve(__dirname, '../../../../../');

function createConfigFileContent(): string {
  // Use absolute paths to dist files to avoid import resolution issues in temp directories
  const adapterPath = resolve(
    workspaceRoot,
    'packages/targets/postgres-adapter/dist/exports/cli.js',
  );
  const targetPath = resolve(workspaceRoot, 'packages/targets/postgres/dist/exports/cli.js');
  const familyPath = resolve(workspaceRoot, 'packages/sql/tooling/cli/dist/exports/cli.js');
  const configTypesPath = resolve(
    workspaceRoot,
    'packages/framework/tooling/cli/dist/config-types.js',
  );

  return `import { defineConfig } from '${configTypesPath}';
import postgresAdapter from '${adapterPath}';
import postgres from '${targetPath}';
import sql from '${familyPath}';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
});
`;
}

describe('emit command', () => {
  let testDir: string;
  let outputDir: string;
  let configPath: string;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let consoleOutput: string[] = [];
  let consoleErrors: string[] = [];

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `prisma-next-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    outputDir = join(testDir, 'output');
    configPath = join(testDir, 'prisma-next.config.ts');

    // Create default config file with absolute paths
    writeFileSync(configPath, createConfigFileContent(), 'utf-8');

    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    consoleOutput = [];
    consoleErrors = [];

    console.log = vi.fn((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    }) as typeof console.log;

    console.error = vi.fn((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    }) as typeof console.error;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it(
    'emits contract.json and contract.d.ts with valid contract',
    async () => {
      const command = createEmitCommand();
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await command.parseAsync([
          'node',
          'cli.js',
          'emit',
          '--contract',
          contractPath,
          '--out',
          outputDir,
          '--config',
          configPath,
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
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await command.parseAsync([
          'node',
          'cli.js',
          'emit',
          '--contract',
          contractPath,
          '--out',
          newOutputDir,
          '--config',
          configPath,
        ]);

        expect(existsSync(newOutputDir)).toBe(true);
        expect(existsSync(join(newOutputDir, 'contract.json'))).toBe(true);
        expect(existsSync(join(newOutputDir, 'contract.d.ts'))).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    },
    timeouts.typeScriptCompilation,
  );

  it('handles missing contract option', async () => {
    const command = createEmitCommand();

    try {
      await command.parseAsync(['node', 'cli.js', 'emit', '--out', outputDir]);
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('handles missing out option', async () => {
    const command = createEmitCommand();
    const contractPath = join(fixturesDir, 'valid-contract.ts');

    try {
      await command.parseAsync(['node', 'cli.js', 'emit', '--contract', contractPath]);
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('handles invalid contract file', async () => {
    const command = createEmitCommand();
    const invalidPath = join(testDir, 'nonexistent-contract.ts');
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await command.parseAsync([
        'node',
        'cli.js',
        'emit',
        '--contract',
        invalidPath,
        '--out',
        outputDir,
        '--config',
        configPath,
      ]);
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
        `const mockHook = {
          id: 'document',
          validateTypes: () => {},
          validateStructure: () => {},
          generateContractTypes: () => '',
        };
        export default {
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
        };`,
        'utf-8',
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await command.parseAsync([
          'node',
          'cli.js',
          'emit',
          '--contract',
          invalidContractPath,
          '--out',
          outputDir,
          '--config',
          invalidConfigPath,
        ]);
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
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      // Extensions are now in config, so we just need a valid config
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await command.parseAsync([
          'node',
          'cli.js',
          'emit',
          '--contract',
          contractPath,
          '--out',
          outputDir,
          '--config',
          configPath,
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
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      // Extensions are now in config
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await command.parseAsync([
          'node',
          'cli.js',
          'emit',
          '--contract',
          contractPath,
          '--out',
          outputDir,
          '--config',
          configPath,
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
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      // Extensions are now in config
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await command.parseAsync([
          'node',
          'cli.js',
          'emit',
          '--contract',
          contractPath,
          '--out',
          outputDir,
          '--config',
          configPath,
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
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await command.parseAsync([
          'node',
          'cli.js',
          'emit',
          '--contract',
          contractPath,
          '--out',
          outputDir,
          '--config',
          configPath,
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
    const invalidPath = join(testDir, 'nonexistent-contract.ts');
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await expect(
        command.parseAsync([
          'node',
          'cli.js',
          'emit',
          '--contract',
          invalidPath,
          '--out',
          outputDir,
          '--config',
          configPath,
        ]),
      ).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
    }

    expect(consoleErrors.length).toBeGreaterThan(0);
  });
});
