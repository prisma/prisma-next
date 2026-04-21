import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { CliStructuredError } from '@prisma-next/errors/control';
import { type MigrationManifest, writeMigrationPackage } from '@prisma-next/migration-tools/io';
import { join, resolve } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postgresEmit } from '../../src/core/migrations/postgres-emit';

const repoRoot = resolve(import.meta.dirname, '../../../../../..');
const familySqlMigrationExport = join(
  repoRoot,
  'packages/2-sql/9-family/src/exports/migration.ts',
).replace(/\\/g, '/');
const targetPostgresMigrationExport = join(
  repoRoot,
  'packages/3-targets/3-targets/postgres/src/exports/migration.ts',
).replace(/\\/g, '/');

const errorsMigrationExport = join(
  repoRoot,
  'packages/1-framework/1-core/errors/src/exports/migration.ts',
).replace(/\\/g, '/');

const STORAGE_HASH = 'sha256:test';

function makeManifest(): MigrationManifest {
  return {
    from: STORAGE_HASH,
    to: STORAGE_HASH,
    migrationId: null,
    kind: 'regular',
    fromContract: null,
    toContract: {
      storage: { storageHash: STORAGE_HASH },
    } as unknown as MigrationManifest['toContract'],
    hints: {
      used: [],
      applied: [],
      plannerVersion: '2.0.0',
      planningStrategy: 'descriptors',
    },
    labels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('postgresEmit', () => {
  let tmpDir: string;
  let pkgDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'pg-emit-'));
    pkgDir = join(tmpDir, '20260101_test');
    await writeFile(join(tmpDir, 'package.json'), '{"type":"module"}');
    await writeMigrationPackage(pkgDir, makeManifest(), []);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('given a class-flow migration.ts with no placeholders', () => {
    const validMigration = [
      `import { Migration } from '${familySqlMigrationExport}';`,
      `import { createTable } from '${targetPostgresMigrationExport}';`,
      '',
      'class M extends Migration {',
      '  override get operations() {',
      '    return [',
      '      createTable("public", "users", [{ name: "id", typeSql: "serial", nullable: false }]),',
      '    ];',
      '  }',
      '  override describe() {',
      '    return { from: "sha256:aaa", to: "sha256:bbb" };',
      '  }',
      '}',
      'export default M;',
      'Migration.run(import.meta.url, M);',
      '',
    ].join('\n');

    it('writes ops.json and returns the operations without attesting', async () => {
      await writeFile(join(pkgDir, 'migration.ts'), validMigration);

      const operations = await postgresEmit({
        dir: pkgDir,
        frameworkComponents: [],
      });

      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({
        id: expect.any(String),
        operationClass: 'additive',
      });

      const opsJson = JSON.parse(await readFile(join(pkgDir, 'ops.json'), 'utf-8'));
      expect(opsJson).toHaveLength(1);

      const manifest = JSON.parse(
        await readFile(join(pkgDir, 'migration.json'), 'utf-8'),
      ) as MigrationManifest;
      expect(manifest.migrationId).toBeNull();
    });
  });

  describe('given a class-flow migration.ts with an unfilled placeholder', () => {
    const placeholderMigration = [
      `import { Migration } from '${familySqlMigrationExport}';`,
      `import { placeholder } from '${errorsMigrationExport}';`,
      '',
      'class M extends Migration {',
      '  override get operations() {',
      '    return placeholder("backfill-users-email:run");',
      '  }',
      '  override describe() {',
      '    return { from: "sha256:aaa", to: "sha256:bbb" };',
      '  }',
      '}',
      'export default M;',
      'Migration.run(import.meta.url, M);',
      '',
    ].join('\n');

    it('propagates PN-MIG-2001 with the slot in meta', async () => {
      await writeFile(join(pkgDir, 'migration.ts'), placeholderMigration);

      await expect(postgresEmit({ dir: pkgDir, frameworkComponents: [] })).rejects.toMatchObject({
        code: '2001',
        domain: 'MIG',
        meta: { slot: 'backfill-users-email:run' },
      });
    });
  });

  describe('given a factory-form migration.ts', () => {
    it('writes ops.json and returns operations', async () => {
      const migration = [
        `import { createTable } from '${targetPostgresMigrationExport}';`,
        '',
        'export default () => ({',
        '  targetId: "postgres",',
        '  destination: { storageHash: "sha256:bbb" },',
        '  operations: [createTable("public", "users", [{ name: "id", typeSql: "serial", nullable: false }])],',
        '});',
        '',
      ].join('\n');
      await writeFile(join(pkgDir, 'migration.ts'), migration);

      const operations = await postgresEmit({ dir: pkgDir, frameworkComponents: [] });

      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({
        id: expect.any(String),
        operationClass: 'additive',
      });

      const opsJson = JSON.parse(await readFile(join(pkgDir, 'ops.json'), 'utf-8'));
      expect(opsJson).toHaveLength(1);
    });
  });

  describe('given a missing migration.ts', () => {
    it('throws PN-MIG-2002', async () => {
      await expect(postgresEmit({ dir: pkgDir, frameworkComponents: [] })).rejects.toMatchObject({
        code: '2002',
        domain: 'MIG',
      });
    });
  });

  describe('given a non-function default export', () => {
    it('throws PN-MIG-2003', async () => {
      await writeFile(join(pkgDir, 'migration.ts'), 'export default 42;\n');

      let thrown: unknown;
      try {
        await postgresEmit({ dir: pkgDir, frameworkComponents: [] });
      } catch (error) {
        thrown = error;
      }

      expect(CliStructuredError.is(thrown)).toBe(true);
      expect(thrown).toMatchObject({ code: '2003', domain: 'MIG' });
    });
  });

  describe('given a class whose operations is not an array', () => {
    it('throws PN-MIG-2004', async () => {
      const migration = [
        `import { Migration } from '${familySqlMigrationExport}';`,
        '',
        'class M extends Migration {',
        '  override get operations() {',
        '    return "not an array" as unknown as never;',
        '  }',
        '  override describe() {',
        '    return { from: "sha256:aaa", to: "sha256:bbb" };',
        '  }',
        '}',
        'export default M;',
        'Migration.run(import.meta.url, M);',
        '',
      ].join('\n');
      await writeFile(join(pkgDir, 'migration.ts'), migration);

      let thrown: unknown;
      try {
        await postgresEmit({ dir: pkgDir, frameworkComponents: [] });
      } catch (error) {
        thrown = error;
      }

      expect(CliStructuredError.is(thrown)).toBe(true);
      expect(thrown).toMatchObject({ code: '2004', domain: 'MIG' });
    });
  });
});
