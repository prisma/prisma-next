import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContractEmitCommand } from '../src/commands/contract-emit';
import { createEmitCommand } from '../src/commands/emit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../../../../../');
const fixturesDir = join(__dirname, 'fixtures');

function createConfigFileContent(includeContract = true, outputOverride?: string): string {
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
  const contractPath = resolve(fixturesDir, 'valid-contract.ts');

  const contractImport = includeContract ? `import { contract } from '${contractPath}';` : '';
  const contractField = includeContract
    ? `  contract: {
    source: contract,
    output: '${outputOverride ?? 'output/contract.json'}',
    types: '${outputOverride ? outputOverride.replace('.json', '.d.ts') : 'output/contract.d.ts'}',
  },`
    : '';

  return `import { defineConfig } from '${configTypesPath}';
import postgresAdapter from '${adapterPath}';
import postgres from '${targetPath}';
import sql from '${familyPath}';
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
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let consoleOutput: string[] = [];
  let consoleErrors: string[] = [];

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `prisma-next-e2e-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    'emits contract.json and contract.d.ts with canonical command',
    async () => {
      const command = createContractEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        await command.parseAsync(['node', 'cli.js', 'contract', 'emit', '--config', configPath]);
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
        await command.parseAsync(['node', 'cli.js', 'emit', '--config', configPath]);
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
        await command.parseAsync([
          'node',
          'cli.js',
          'contract',
          'emit',
          '--config',
          configPath,
          '--json',
        ]);
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
        command.parseAsync([
          'node',
          'cli.js',
          'contract',
          'emit',
          '--config',
          'nonexistent.config.ts',
        ]),
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
    writeFileSync(configWithoutContract, createConfigFileContent(false), 'utf-8');

    const command = createContractEmitCommand();
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await expect(
        command.parseAsync([
          'node',
          'cli.js',
          'contract',
          'emit',
          '--config',
          configWithoutContract,
        ]),
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
        await command.parseAsync([
          'node',
          'cli.js',
          'contract',
          'emit',
          '--config',
          configPath,
          '--verbose',
        ]);
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
        await command.parseAsync([
          'node',
          'cli.js',
          'contract',
          'emit',
          '--config',
          configPath,
          '--quiet',
        ]);
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
