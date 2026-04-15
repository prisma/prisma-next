import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { join, resolve } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Migration } from '../src/migration-base';

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '../../../..');

describe('Migration', () => {
  describe('plan() contract', () => {
    it('can be subclassed and plan() called directly', () => {
      class TestMigration extends Migration<{ id: string }> {
        plan() {
          return [{ id: 'op1' }, { id: 'op2' }];
        }
      }

      const m = new TestMigration();
      const ops = m.plan();
      expect(ops).toEqual([{ id: 'op1' }, { id: 'op2' }]);
    });
  });
});

describe('Migration.run() subprocess', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'migration-run-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const migrationBasePath = join(packageRoot, 'src/migration-base.ts').replace(/\\/g, '/');

  function migrationScript(planReturn: string): string {
    return [
      `import { Migration } from '${migrationBasePath}';`,
      '',
      'export default class extends Migration {',
      '  plan() {',
      `    return ${planReturn};`,
      '  }',
      '}',
      '',
      'Migration.run(import.meta.url);',
    ].join('\n');
  }

  async function runMigration(
    filename: string,
    args: string[] = [],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const filePath = join(tmpDir, filename);
    const tsxPath = join(repoRoot, 'node_modules/.bin/tsx');
    try {
      const result = await execFileAsync(tsxPath, [filePath, ...args], { cwd: tmpDir });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error) {
      const e = error as { stdout: string; stderr: string; code: number };
      return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.code || 1 };
    }
  }

  it('writes ops.json when run as entrypoint', async () => {
    const script = migrationScript('[{ id: "op1", label: "Test op" }]');
    await writeFile(join(tmpDir, 'migration.ts'), script);

    const result = await runMigration('migration.ts');
    expect(result.exitCode).toBe(0);

    const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
    const ops = JSON.parse(opsJson);
    expect(ops).toEqual([{ id: 'op1', label: 'Test op' }]);
  });

  it('prints operations with --dry-run and does not write ops.json', async () => {
    const script = migrationScript('[{ id: "op1", label: "Dry run op" }]');
    await writeFile(join(tmpDir, 'migration.ts'), script);

    const result = await runMigration('migration.ts', ['--dry-run']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('op1');
    expect(result.stdout).toContain('Dry run op');

    const opsExists = await readFile(join(tmpDir, 'ops.json'), 'utf-8').catch(() => null);
    expect(opsExists).toBeNull();
  });

  it('prints usage with --help', async () => {
    const script = migrationScript('[]');
    await writeFile(join(tmpDir, 'migration.ts'), script);

    const result = await runMigration('migration.ts', ['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--dry-run');
    expect(result.stdout).toContain('--help');
  });

  it('is a no-op when the file is imported', async () => {
    const migrationFile = migrationScript('[{ id: "op1" }]');
    await writeFile(join(tmpDir, 'migration.ts'), migrationFile);

    const importerScript = [
      `import Migration from '${join(tmpDir, 'migration.ts').replace(/\\/g, '/')}';`,
      'const m = new Migration();',
      'const ops = m.plan();',
      'console.log(JSON.stringify(ops));',
    ].join('\n');
    await writeFile(join(tmpDir, 'importer.ts'), importerScript);

    const result = await runMigration('importer.ts');
    expect(result.exitCode).toBe(0);

    const opsExists = await readFile(join(tmpDir, 'ops.json'), 'utf-8').catch(() => null);
    expect(opsExists).toBeNull();

    const importedOps = JSON.parse(result.stdout.trim());
    expect(importedOps).toEqual([{ id: 'op1' }]);
  });

  it('exits with error when plan() returns non-array', async () => {
    const script = migrationScript('"not an array"');
    await writeFile(join(tmpDir, 'migration.ts'), script);

    const result = await runMigration('migration.ts');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('plan()');
  });
});
