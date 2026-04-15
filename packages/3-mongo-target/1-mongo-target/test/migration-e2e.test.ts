import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { join, resolve } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '../../..');
const tsxPath = join(repoRoot, 'node_modules/.bin/tsx');

const familyMongoRoot = resolve(repoRoot, 'packages/2-mongo-family/9-family');
const migrationExport = join(familyMongoRoot, 'src/exports/migration.ts').replace(/\\/g, '/');
const factoryExport = join(packageRoot, 'src/exports/migration.ts').replace(/\\/g, '/');

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
      'export default class extends Migration {',
      '  plan() {',
      '    return [',
      '      createCollection("users", {',
      '        validator: { $jsonSchema: { required: ["email"] } },',
      '        validationLevel: "strict",',
      '      }),',
      '      createIndex("users", [{ field: "email", direction: 1 }], { unique: true }),',
      '    ];',
      '  }',
      '}',
      '',
      'Migration.run(import.meta.url);',
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

      const parsed = JSON.parse(result.stdout);
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
      'export default class extends Migration {',
      '  plan() {',
      '    return validatedCollection(',
      '      "users",',
      '      { required: ["email", "name"] },',
      '      [{ keys: [{ field: "email", direction: 1 }], unique: true }],',
      '    );',
      '  }',
      '}',
      '',
      'Migration.run(import.meta.url);',
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

  describe('serialization format', () => {
    it('produces JSON that the runner can consume (correct kind discriminants)', async () => {
      const migration = [
        `import { Migration } from '${migrationExport}';`,
        `import { createIndex, dropIndex, createCollection, dropCollection, collMod } from '${factoryExport}';`,
        '',
        'export default class extends Migration {',
        '  plan() {',
        '    return [',
        '      createCollection("users"),',
        '      createIndex("users", [{ field: "email", direction: 1 }]),',
        '      collMod("users", { validator: { $jsonSchema: { required: ["email"] } } }),',
        '      dropIndex("users", [{ field: "email", direction: 1 }]),',
        '      dropCollection("users"),',
        '    ];',
        '  }',
        '}',
        '',
        'Migration.run(import.meta.url);',
      ].join('\n');

      await writeFile(join(tmpDir, 'migration.ts'), migration);

      const result = await runFile('migration.ts');
      expect(result.exitCode).toBe(0);

      const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));
      expect(ops).toHaveLength(5);

      const commandKinds = ops.map((op: Record<string, unknown[]>) =>
        (op['execute'] as Record<string, unknown>[]).map(
          (s) => (s as Record<string, Record<string, string>>)['command']['kind'],
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
