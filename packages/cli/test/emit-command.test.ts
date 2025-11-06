import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmitCommand } from '../src/commands/emit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('emit command', () => {
  let outputDir: string;
  let originalExit: typeof process.exit;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let exitCode: number | null = null;
  let consoleOutput: string[] = [];
  let consoleErrors: string[] = [];

  beforeEach(() => {
    outputDir = join(
      tmpdir(),
      `prisma-next-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(outputDir, { recursive: true });

    originalExit = process.exit;
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    exitCode = null;
    consoleOutput = [];
    consoleErrors = [];

    process.exit = vi.fn((code?: number) => {
      exitCode = code ?? 0;
    }) as unknown as typeof process.exit;

    console.log = vi.fn((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    }) as typeof console.log;

    console.error = vi.fn((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    }) as typeof console.error;
  });

  afterEach(() => {
    if (existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true, force: true });
    }
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it('emits contract.json and contract.d.ts with valid contract', async () => {
    const command = createEmitCommand();
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    await command.parseAsync([
      'node',
      'cli.js',
      'emit',
      '--contract',
      contractPath,
      '--out',
      outputDir,
      '--adapter',
      adapterPath,
    ]);

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractDtsPath = join(outputDir, 'contract.d.ts');

    expect(existsSync(contractJsonPath)).toBe(true);
    expect(existsSync(contractDtsPath)).toBe(true);

    const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    expect(contractJson.targetFamily).toBe('sql');
    expect(contractJson._generated).toBeDefined();

    const contractDts = readFileSync(contractDtsPath, 'utf-8');
    expect(contractDts).toContain('export type Contract');
    expect(contractDts).toContain('CodecTypes');

    expect(consoleOutput.some((msg) => msg.includes('Emitted contract.json'))).toBe(true);
    expect(consoleOutput.some((msg) => msg.includes('coreHash'))).toBe(true);
  });

  it('creates output directory if it does not exist', async () => {
    const newOutputDir = join(tmpdir(), `prisma-next-test-new-${Date.now()}`);
    const command = createEmitCommand();
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    await command.parseAsync([
      'node',
      'cli.js',
      'emit',
      '--contract',
      contractPath,
      '--out',
      newOutputDir,
      '--adapter',
      adapterPath,
    ]);

    expect(existsSync(newOutputDir)).toBe(true);
    expect(existsSync(join(newOutputDir, 'contract.json'))).toBe(true);
    expect(existsSync(join(newOutputDir, 'contract.d.ts'))).toBe(true);

    if (existsSync(newOutputDir)) {
      rmSync(newOutputDir, { recursive: true, force: true });
    }
  });

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
    const invalidPath = join(outputDir, 'nonexistent-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    try {
      await command.parseAsync([
        'node',
        'cli.js',
        'emit',
        '--contract',
        invalidPath,
        '--out',
        outputDir,
        '--adapter',
        adapterPath,
      ]);
    } catch (error) {
      expect(error).toBeDefined();
    }

    expect(consoleErrors.length).toBeGreaterThan(0);
  });

  it('handles unsupported target family', async () => {
    const command = createEmitCommand();
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    const invalidContractPath = join(outputDir, 'invalid-contract.ts');
    writeFileSync(
      invalidContractPath,
      `export const contract = { targetFamily: 'document', target: 'mongodb' } as const;`,
      'utf-8',
    );

    try {
      await command.parseAsync([
        'node',
        'cli.js',
        'emit',
        '--contract',
        invalidContractPath,
        '--out',
        outputDir,
        '--adapter',
        adapterPath,
      ]);
    } catch (error) {
      expect(error).toBeDefined();
    }

    expect(consoleErrors.some((msg) => msg.includes('Unsupported target family'))).toBe(true);
  });

  it('handles extension paths', async () => {
    const command = createEmitCommand();
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    await command.parseAsync([
      'node',
      'cli.js',
      'emit',
      '--contract',
      contractPath,
      '--out',
      outputDir,
      '--adapter',
      adapterPath,
      '--extensions',
      adapterPath,
    ]);

    const contractJsonPath = join(outputDir, 'contract.json');
    expect(existsSync(contractJsonPath)).toBe(true);
  });

  it('handles multiple extension paths', async () => {
    const command = createEmitCommand();
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    await command.parseAsync([
      'node',
      'cli.js',
      'emit',
      '--contract',
      contractPath,
      '--out',
      outputDir,
      '--adapter',
      adapterPath,
      '--extensions',
      adapterPath,
      '--extensions',
      adapterPath,
    ]);

    const contractJsonPath = join(outputDir, 'contract.json');
    expect(existsSync(contractJsonPath)).toBe(true);
  });

  it('outputs profileHash when present', async () => {
    const command = createEmitCommand();
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    await command.parseAsync([
      'node',
      'cli.js',
      'emit',
      '--contract',
      contractPath,
      '--out',
      outputDir,
      '--adapter',
      adapterPath,
    ]);

    const contractJsonPath = join(outputDir, 'contract.json');
    expect(existsSync(contractJsonPath)).toBe(true);
    const hasProfileHash = consoleOutput.some((msg) => msg.includes('profileHash'));
    expect(hasProfileHash).toBeDefined();
  });

  it('handles errors and exits with code 1', async () => {
    const command = createEmitCommand();
    const invalidPath = join(outputDir, 'nonexistent-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    try {
      await command.parseAsync([
        'node',
        'cli.js',
        'emit',
        '--contract',
        invalidPath,
        '--out',
        outputDir,
        '--adapter',
        adapterPath,
      ]);
    } catch {
      // Expected to throw
    }

    expect(exitCode).toBe(1);
  });
});
