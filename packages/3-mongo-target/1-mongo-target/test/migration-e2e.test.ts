import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { writeMigrationTs } from '@prisma-next/migration-tools/migration-ts';
import { join, resolve } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '../../..');
const tsxPath = join(repoRoot, 'node_modules/.bin/tsx');

const familyMongoRoot = resolve(repoRoot, 'packages/2-mongo-family/9-family');
const migrationExport = join(familyMongoRoot, 'src/exports/migration.ts').replace(/\\/g, '/');
const factoryExport = join(packageRoot, 'src/exports/migration.ts').replace(/\\/g, '/');

/**
 * `Migration.run(..., { dryRun })` prints both `--- migration.json ---` and
 * `--- ops.json ---` sections to stdout. Tests only care about the ops body,
 * so this helper extracts it.
 */
function extractDryRunOpsSection(stdout: string): string {
  const marker = '--- ops.json ---\n';
  const idx = stdout.indexOf(marker);
  if (idx < 0) return stdout;
  return stdout.slice(idx + marker.length);
}

describe('migration file E2E', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'migration-e2e-'));
    await writeFile(join(tmpDir, 'package.json'), '{"type":"module"}');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function runFile(
    filename: string,
    args: string[] = [],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const filePath = join(tmpDir, filename);
    try {
      const result = await execFileAsync(tsxPath, [filePath, ...args], { cwd: tmpDir });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error) {
      const e = error as { stdout: string; stderr: string; code: number };
      return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.code || 1 };
    }
  }

  describe('factory-based migration', () => {
    const factoryMigration = [
      `import { Migration } from '${migrationExport}';`,
      `import { createIndex, createCollection } from '${factoryExport}';`,
      '',
      'class M extends Migration {',
      "  readonly targetId = 'mongo';",
      "  describe() { return { from: 'sha256:00', to: 'sha256:01' }; }",
      '  get operations() {',
      '    return [',
      '      createCollection("users", {',
      '        validator: { $jsonSchema: { required: ["email"] } },',
      '        validationLevel: "strict",',
      '      }),',
      '      createIndex("users", [{ field: "email", direction: 1 }], { unique: true }),',
      '    ];',
      '  }',
      '}',
      'export default M;',
      '',
      'Migration.run(import.meta.url, M);',
    ].join('\n');

    it('produces ops.json with correct structure', async () => {
      await writeFile(join(tmpDir, 'migration.ts'), factoryMigration);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);

      const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
      const ops = JSON.parse(opsJson);

      expect(ops).toHaveLength(2);
      expect(ops[0].id).toBe('collection.users.create');
      expect(ops[0].operationClass).toBe('additive');
      expect(ops[0].execute[0].command.kind).toBe('createCollection');

      expect(ops[1].id).toContain('index.users.create');
      expect(ops[1].execute[0].command.kind).toBe('createIndex');
      expect(ops[1].execute[0].command.unique).toBe(true);
    });

    it('prints operations with --dry-run and does not write ops.json', async () => {
      await writeFile(join(tmpDir, 'migration.ts'), factoryMigration);

      const result = await runFile('migration.ts', ['--dry-run']);
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(extractDryRunOpsSection(result.stdout));
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe('collection.users.create');

      const opsExists = await readFile(join(tmpDir, 'ops.json'), 'utf-8').catch(() => null);
      expect(opsExists).toBeNull();
    });
  });

  describe('strategy-based migration', () => {
    const strategyMigration = [
      `import { Migration } from '${migrationExport}';`,
      `import { validatedCollection } from '${factoryExport}';`,
      '',
      'class M extends Migration {',
      "  readonly targetId = 'mongo';",
      "  describe() { return { from: 'sha256:00', to: 'sha256:01' }; }",
      '  get operations() {',
      '    return validatedCollection(',
      '      "users",',
      '      { required: ["email", "name"] },',
      '      [{ keys: [{ field: "email", direction: 1 }], unique: true }],',
      '    );',
      '  }',
      '}',
      'export default M;',
      '',
      'Migration.run(import.meta.url, M);',
    ].join('\n');

    it('produces ops.json from strategy composition', async () => {
      await writeFile(join(tmpDir, 'migration.ts'), strategyMigration);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);

      const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
      const ops = JSON.parse(opsJson);

      expect(ops).toHaveLength(2);

      expect(ops[0].id).toBe('collection.users.create');
      expect(ops[0].execute[0].command.validator).toEqual({
        $jsonSchema: { required: ['email', 'name'] },
      });
      expect(ops[0].execute[0].command.validationLevel).toBe('strict');

      expect(ops[1].id).toContain('index.users.create');
      expect(ops[1].execute[0].command.unique).toBe(true);
    });
  });

  describe('renderCallsToTypeScript round-trip', () => {
    const defaultMeta = {
      from: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      to: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    } as const;

    it('produces ops.json identical to direct factory invocation', async () => {
      const { renderCallsToTypeScript } = await import('../src/core/render-typescript');
      const { CreateCollectionCall, CreateIndexCall } = await import('../src/core/op-factory-call');
      const calls = [
        new CreateCollectionCall('users', {
          validator: { $jsonSchema: { required: ['email'] } },
          validationLevel: 'strict',
        }),
        new CreateIndexCall('users', [{ field: 'email', direction: 1 as const }], { unique: true }),
      ];

      const tsSource = renderCallsToTypeScript(calls, defaultMeta);
      const resolvedSource = tsSource
        .replace("'@prisma-next/family-mongo/migration'", `'${migrationExport}'`)
        .replace("'@prisma-next/target-mongo/migration'", `'${factoryExport}'`);
      await writeFile(join(tmpDir, 'migration.ts'), resolvedSource);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));

      expect(ops).toHaveLength(2);
      expect(ops[0].id).toBe('collection.users.create');
      expect(ops[0].operationClass).toBe('additive');
      expect(ops[0].execute[0].command.kind).toBe('createCollection');
      expect(ops[0].execute[0].command.validator).toEqual({ $jsonSchema: { required: ['email'] } });

      expect(ops[1].id).toContain('index.users.create');
      expect(ops[1].execute[0].command.kind).toBe('createIndex');
      expect(ops[1].execute[0].command.unique).toBe(true);
    });

    it('round-trips collMod with meta through TypeScript execution', async () => {
      const { renderCallsToTypeScript } = await import('../src/core/render-typescript');
      const { CollModCall } = await import('../src/core/op-factory-call');
      const calls = [
        new CollModCall(
          'users',
          {
            validator: { $jsonSchema: { required: ['email'] } },
            validationLevel: 'strict',
            validationAction: 'error',
          },
          {
            id: 'validator.users.add',
            label: 'Add validator on users',
            operationClass: 'destructive',
          },
        ),
      ];

      const tsSource = renderCallsToTypeScript(calls, defaultMeta);
      const resolvedSource = tsSource
        .replace("'@prisma-next/family-mongo/migration'", `'${migrationExport}'`)
        .replace("'@prisma-next/target-mongo/migration'", `'${factoryExport}'`);
      await writeFile(join(tmpDir, 'migration.ts'), resolvedSource);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));

      expect(ops).toHaveLength(1);
      expect(ops[0].id).toBe('validator.users.add');
      expect(ops[0].label).toBe('Add validator on users');
      expect(ops[0].operationClass).toBe('destructive');
      expect(ops[0].execute[0].command.kind).toBe('collMod');
    });

    it('round-trips describe() meta through TypeScript execution', async () => {
      const { renderCallsToTypeScript } = await import('../src/core/render-typescript');
      const { DropCollectionCall } = await import('../src/core/op-factory-call');
      const calls = [new DropCollectionCall('legacy')];

      const tsSource = renderCallsToTypeScript(calls, {
        from: 'sha256:aaa',
        to: 'sha256:bbb',
        labels: ['cleanup'],
      });
      const resolvedSource = tsSource
        .replace("'@prisma-next/family-mongo/migration'", `'${migrationExport}'`)
        .replace("'@prisma-next/target-mongo/migration'", `'${factoryExport}'`);
      await writeFile(join(tmpDir, 'migration.ts'), resolvedSource);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);

      const opsJson = await readFile(join(tmpDir, 'ops.json'), 'utf-8');
      const ops = JSON.parse(opsJson);
      expect(ops).toHaveLength(1);
      expect(ops[0].id).toBe('collection.legacy.drop');

      const manifestJson = await readFile(join(tmpDir, 'migration.json'), 'utf-8');
      const manifest = JSON.parse(manifestJson);
      expect(manifest.from).toBe('sha256:aaa');
      expect(manifest.to).toBe('sha256:bbb');
      expect(manifest.labels).toEqual(['cleanup']);
    });
  });

  describe('scaffolded migration is directly runnable', () => {
    const familyMongoDistMigration = join(familyMongoRoot, 'dist/migration.mjs').replace(
      /\\/g,
      '/',
    );
    const targetMongoDistMigration = join(packageRoot, 'dist/migration.mjs').replace(/\\/g, '/');

    it('runs via ./migration.ts on POSIX (or node migration.ts on Windows) and prints operations JSON', async (ctx) => {
      const distsExist = await Promise.all([
        stat(familyMongoDistMigration).then(
          () => true,
          () => false,
        ),
        stat(targetMongoDistMigration).then(
          () => true,
          () => false,
        ),
      ]);
      if (!distsExist.every(Boolean)) {
        ctx.skip(
          `dist migration entrypoints not built: ${familyMongoDistMigration}, ${targetMongoDistMigration} — run \`pnpm build\` for @prisma-next/family-mongo and @prisma-next/target-mongo`,
        );
      }

      const { renderCallsToTypeScript } = await import('../src/core/render-typescript');
      const { CreateCollectionCall, CreateIndexCall } = await import('../src/core/op-factory-call');
      const calls = [
        new CreateCollectionCall('users'),
        new CreateIndexCall('users', [{ field: 'email', direction: 1 as const }], { unique: true }),
      ];

      const migrationSource = renderCallsToTypeScript(calls, {
        from: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        to: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      })
        .replace("'@prisma-next/family-mongo/migration'", `'${familyMongoDistMigration}'`)
        .replace("'@prisma-next/target-mongo/migration'", `'${targetMongoDistMigration}'`);
      await writeMigrationTs(tmpDir, migrationSource);

      const migrationPath = join(tmpDir, 'migration.ts');
      const content = await readFile(migrationPath, 'utf-8');
      expect(content.split('\n')[0]).toBe('#!/usr/bin/env -S node');

      const isWindows = process.platform === 'win32';
      if (!isWindows) {
        const s = await stat(migrationPath);
        expect(s.mode & 0o100).toBe(0o100);
      }

      const spawn = isWindows
        ? spawnSync(process.execPath, [migrationPath, '--dry-run'], {
            cwd: tmpDir,
            encoding: 'utf-8',
          })
        : spawnSync(migrationPath, ['--dry-run'], { cwd: tmpDir, encoding: 'utf-8' });

      expect(spawn.status, `stderr: ${spawn.stderr}`).toBe(0);

      const ops = JSON.parse(extractDryRunOpsSection(spawn.stdout));
      expect(ops).toHaveLength(2);
      expect(ops[0].id).toBe('collection.users.create');
      expect(ops[1].id).toContain('index.users.create');
    });
  });

  describe('serialization format', () => {
    it('produces JSON that the runner can consume (correct kind discriminants)', async () => {
      const migration = [
        `import { Migration } from '${migrationExport}';`,
        `import { createIndex, dropIndex, createCollection, dropCollection, setValidation } from '${factoryExport}';`,
        '',
        'class M extends Migration {',
        "  readonly targetId = 'mongo';",
        "  describe() { return { from: 'sha256:00', to: 'sha256:01' }; }",
        '  get operations() {',
        '    return [',
        '      createCollection("users"),',
        '      createIndex("users", [{ field: "email", direction: 1 }]),',
        '      setValidation("users", { required: ["email"] }),',
        '      dropIndex("users", [{ field: "email", direction: 1 }]),',
        '      dropCollection("users"),',
        '    ];',
        '  }',
        '}',
        'export default M;',
        '',
        'Migration.run(import.meta.url, M);',
      ].join('\n');

      await writeFile(join(tmpDir, 'migration.ts'), migration);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);

      const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));
      expect(ops).toHaveLength(5);

      const commandKinds = ops.map((op: Record<string, unknown[]>) =>
        (op['execute'] as Record<string, unknown>[]).map(
          (s: Record<string, unknown>) => (s['command'] as Record<string, string>)['kind'],
        ),
      );
      expect(commandKinds).toEqual([
        ['createCollection'],
        ['createIndex'],
        ['collMod'],
        ['dropIndex'],
        ['dropCollection'],
      ]);

      for (const op of ops) {
        expect(op).toHaveProperty('id');
        expect(op).toHaveProperty('label');
        expect(op).toHaveProperty('operationClass');
        expect(op).toHaveProperty('precheck');
        expect(op).toHaveProperty('execute');
        expect(op).toHaveProperty('postcheck');
      }
    });
  });
});
