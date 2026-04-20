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
  describe('operations + describe() contract', () => {
    it('subclasses expose operations via the getter and describe() metadata', () => {
      class TestMigration extends Migration<{
        id: string;
        label: string;
        operationClass: 'additive';
      }> {
        readonly targetId = 'test';
        override get operations() {
          return [
            { id: 'op1', label: 'Op 1', operationClass: 'additive' as const },
            { id: 'op2', label: 'Op 2', operationClass: 'additive' as const },
          ];
        }
        override describe() {
          return { from: 'abc', to: 'def', labels: ['test'] };
        }
      }

      const m = new TestMigration();
      expect(m.operations).toEqual([
        { id: 'op1', label: 'Op 1', operationClass: 'additive' },
        { id: 'op2', label: 'Op 2', operationClass: 'additive' },
      ]);
      expect(m.describe()).toEqual({ from: 'abc', to: 'def', labels: ['test'] });
    });

    it('derives origin/destination from describe()', () => {
      class TestMigration extends Migration {
        readonly targetId = 'test';
        override get operations() {
          return [];
        }
        override describe() {
          return { from: 'hashFrom', to: 'hashTo' };
        }
      }

      const m = new TestMigration();
      expect(m.origin).toEqual({ storageHash: 'hashFrom' });
      expect(m.destination).toEqual({ storageHash: 'hashTo' });
    });
  });
});

describe('Migration.run() subprocess', { timeout: 15_000 }, () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'migration-run-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const migrationBasePath = join(packageRoot, 'src/migration-base.ts').replace(/\\/g, '/');

  function migrationScript(opsReturn: string, meta = '{ from: "abc", to: "def" }'): string {
    return [
      `import { Migration } from '${migrationBasePath}';`,
      '',
      'class M extends Migration {',
      "  readonly targetId = 'test';",
      '  get operations() {',
      `    return ${opsReturn};`,
      '  }',
      '  describe() {',
      `    return ${meta};`,
      '  }',
      '}',
      'export default M;',
      '',
      'Migration.run(import.meta.url, M);',
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

  it('writes ops.json and migration.json when run as entrypoint', async () => {
    const script = migrationScript('[{ id: "op1", label: "Test op" }]');
    await writeFile(join(tmpDir, 'migration.ts'), script);

    const result = await runMigration('migration.ts');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ops.json + migration.json');

    const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
    const ops = JSON.parse(opsJson);
    expect(ops).toEqual([{ id: 'op1', label: 'Test op' }]);

    const manifest = JSON.parse(await readFile(join(tmpDir, 'migration.json'), 'utf-8'));
    expect(manifest.from).toBe('abc');
    expect(manifest.to).toBe('def');
    expect(manifest.migrationId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(manifest.kind).toBe('regular');
    expect(manifest.labels).toEqual([]);
    expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(manifest.fromContract).toBeNull();
    expect(manifest.toContract).toEqual({ storage: { storageHash: 'def' } });
    expect(manifest.hints).toMatchObject({
      used: [],
      applied: [],
      planningStrategy: 'class-based',
    });
  });

  it('preserves contract bookends and hints from an existing manifest when re-emitting', async () => {
    const existingManifest = {
      from: 'sha256:from',
      to: 'sha256:to',
      migrationId: null,
      kind: 'regular',
      fromContract: { storage: { storageHash: 'sha256:from' }, marker: 'preserved-from' },
      toContract: { storage: { storageHash: 'sha256:to' }, marker: 'preserved-to' },
      hints: {
        used: ['idx_a'],
        applied: ['additive_only'],
        plannerVersion: '2.0.0',
        planningStrategy: 'descriptors',
      },
      labels: ['scaffolded'],
      createdAt: '2026-01-15T10:00:00.000Z',
    };
    await writeFile(join(tmpDir, 'migration.json'), JSON.stringify(existingManifest, null, 2));

    const script = migrationScript(
      '[{ id: "op1", label: "Edited op", operationClass: "additive" }]',
      '{ from: "sha256:from", to: "sha256:to" }',
    );
    await writeFile(join(tmpDir, 'migration.ts'), script);

    const result = await runMigration('migration.ts');
    expect(result.exitCode).toBe(0);

    const manifest = JSON.parse(await readFile(join(tmpDir, 'migration.json'), 'utf-8'));
    expect(manifest.fromContract).toEqual(existingManifest.fromContract);
    expect(manifest.toContract).toEqual(existingManifest.toContract);
    expect(manifest.hints).toEqual(existingManifest.hints);
    expect(manifest.labels).toEqual(existingManifest.labels);
    expect(manifest.createdAt).toBe(existingManifest.createdAt);
    expect(manifest.migrationId).toMatch(/^sha256:[a-f0-9]{64}$/);
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
      `import M from '${join(tmpDir, 'migration.ts').replace(/\\/g, '/')}';`,
      'const m = new M();',
      'const ops = m.operations;',
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

  it('exits with error when operations is not an array', async () => {
    const script = migrationScript('"not an array"');
    await writeFile(join(tmpDir, 'migration.ts'), script);

    const result = await runMigration('migration.ts');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('operations');
  });

  it('rejects invalid describe() return with clear error', async () => {
    const script = migrationScript('[{ id: "op1" }]', '{ bad: true }');
    await writeFile(join(tmpDir, 'migration.ts'), script);

    const result = await runMigration('migration.ts');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('describe()');
    expect(result.stderr).toContain('invalid');
  });

  it('includes migration.json content in --dry-run output', async () => {
    const script = migrationScript(
      '[{ id: "op1" }]',
      '{ from: "abc", to: "def", labels: ["test"] }',
    );
    await writeFile(join(tmpDir, 'migration.ts'), script);

    const result = await runMigration('migration.ts', ['--dry-run']);
    expect(result.exitCode).toBe(0);

    const output = result.stdout;
    expect(output).toContain('"from"');
    expect(output).toContain('"to"');
    expect(output).toContain('"op1"');

    const manifestExists = await readFile(join(tmpDir, 'migration.json'), 'utf-8').catch(
      () => null,
    );
    expect(manifestExists).toBeNull();
  });
});
