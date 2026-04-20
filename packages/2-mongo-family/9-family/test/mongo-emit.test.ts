import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { CliStructuredError } from '@prisma-next/errors/control';
import { type MigrationManifest, writeMigrationPackage } from '@prisma-next/migration-tools/io';
import { join, resolve } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mongoEmit } from '../src/core/mongo-emit';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const familyMongoMigrationExport = join(
  repoRoot,
  'packages/2-mongo-family/9-family/src/exports/migration.ts',
).replace(/\\/g, '/');
const targetMongoMigrationExport = join(
  repoRoot,
  'packages/3-mongo-target/1-mongo-target/src/exports/migration.ts',
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

describe('mongoEmit', () => {
  let tmpDir: string;
  let pkgDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mongo-emit-'));
    pkgDir = join(tmpDir, '20260101_test');
    await writeFile(join(tmpDir, 'package.json'), '{"type":"module"}');
    await writeMigrationPackage(pkgDir, makeManifest(), []);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('given a class-flow migration.ts with no placeholders', () => {
    const validMigration = [
      `import { Migration } from '${familyMongoMigrationExport}';`,
      `import { createCollection, createIndex } from '${targetMongoMigrationExport}';`,
      '',
      'class M extends Migration {',
      '  override get operations() {',
      '    return [',
      '      createCollection("users"),',
      '      createIndex("users", [{ field: "email", direction: 1 }]),',
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

      const operations = await mongoEmit({
        dir: pkgDir,
        frameworkComponents: [],
      });

      expect(operations).toHaveLength(2);
      expect(operations[0]).toMatchObject({
        id: 'collection.users.create',
        operationClass: 'additive',
      });

      const opsJson = JSON.parse(await readFile(join(pkgDir, 'ops.json'), 'utf-8'));
      expect(opsJson).toHaveLength(2);

      const manifest = JSON.parse(
        await readFile(join(pkgDir, 'migration.json'), 'utf-8'),
      ) as MigrationManifest;
      expect(manifest.migrationId).toBeNull();
    });

    it('returns operations in the display-oriented MigrationPlanOperation shape', async () => {
      await writeFile(join(pkgDir, 'migration.ts'), validMigration);

      const operations = await mongoEmit({ dir: pkgDir, frameworkComponents: [] });

      for (const op of operations) {
        expect(op).toMatchObject({
          id: expect.any(String),
          label: expect.any(String),
          operationClass: expect.any(String),
        });
      }
    });

    it('does not double-emit when Migration.run is at module scope', async () => {
      await writeFile(join(pkgDir, 'migration.ts'), validMigration);

      await mongoEmit({ dir: pkgDir, frameworkComponents: [] });
      const opsJsonAfterFirst = await readFile(join(pkgDir, 'ops.json'), 'utf-8');

      await mongoEmit({ dir: pkgDir, frameworkComponents: [] });
      const opsJsonAfterSecond = await readFile(join(pkgDir, 'ops.json'), 'utf-8');

      expect(opsJsonAfterSecond).toBe(opsJsonAfterFirst);
    });
  });

  describe('given a class-flow migration.ts with an unfilled placeholder', () => {
    const placeholderMigration = [
      `import { Migration } from '${familyMongoMigrationExport}';`,
      `import { placeholder } from '${targetMongoMigrationExport}';`,
      '',
      'class M extends Migration {',
      '  override get operations() {',
      '    return placeholder("backfill-product-status:run");',
      '  }',
      '  override describe() {',
      '    return { from: "sha256:aaa", to: "sha256:bbb" };',
      '  }',
      '}',
      'export default M;',
      'Migration.run(import.meta.url, M);',
      '',
    ].join('\n');

    it('propagates a structured CliStructuredError with code PN-MIG-2001 and the slot in meta', async () => {
      await writeFile(join(pkgDir, 'migration.ts'), placeholderMigration);

      await expect(mongoEmit({ dir: pkgDir, frameworkComponents: [] })).rejects.toMatchObject({
        code: '2001',
        domain: 'MIG',
        meta: { slot: 'backfill-product-status:run' },
      });
    });
  });

  describe('given a function-form migration.ts (arrow factory returning MigrationPlan)', () => {
    it('writes ops.json and returns operations without attesting', async () => {
      const migration = [
        `import { createCollection } from '${targetMongoMigrationExport}';`,
        '',
        'export default () => ({',
        '  targetId: "mongo",',
        '  destination: { storageHash: "sha256:bbb" },',
        '  operations: [createCollection("users")],',
        '});',
        '',
      ].join('\n');
      await writeFile(join(pkgDir, 'migration.ts'), migration);

      const operations = await mongoEmit({ dir: pkgDir, frameworkComponents: [] });

      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({
        id: 'collection.users.create',
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

  describe('given a function-form migration.ts (async factory returning MigrationPlan)', () => {
    it('writes ops.json and returns operations without attesting', async () => {
      const migration = [
        `import { createCollection } from '${targetMongoMigrationExport}';`,
        '',
        'export default async () => ({',
        '  targetId: "mongo",',
        '  destination: { storageHash: "sha256:bbb" },',
        '  operations: [createCollection("users")],',
        '});',
        '',
      ].join('\n');
      await writeFile(join(pkgDir, 'migration.ts'), migration);

      const operations = await mongoEmit({ dir: pkgDir, frameworkComponents: [] });

      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({
        id: 'collection.users.create',
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

  describe('given a function-form migration.ts whose operations is not an array', () => {
    it('throws PN-MIG-2004', async () => {
      await writeFile(
        join(pkgDir, 'migration.ts'),
        [
          'export default () => ({',
          '  targetId: "mongo",',
          '  destination: { storageHash: "sha256:bbb" },',
          '  operations: "not an array",',
          '});',
          '',
        ].join('\n'),
      );

      let thrown: unknown;
      try {
        await mongoEmit({ dir: pkgDir, frameworkComponents: [] });
      } catch (error) {
        thrown = error;
      }

      expect(CliStructuredError.is(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: '2004',
        domain: 'MIG',
        meta: { dir: pkgDir },
      });
    });
  });

  describe('given a function-form migration.ts that does not return a MigrationPlan-shaped object', () => {
    it('throws PN-MIG-2003', async () => {
      await writeFile(join(pkgDir, 'migration.ts'), 'export default () => 42;\n');

      let thrown: unknown;
      try {
        await mongoEmit({ dir: pkgDir, frameworkComponents: [] });
      } catch (error) {
        thrown = error;
      }

      expect(CliStructuredError.is(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: '2003',
        domain: 'MIG',
        meta: { dir: pkgDir },
      });
    });
  });

  describe('given a missing migration.ts', () => {
    it('throws PN-MIG-2002 with the package dir in meta', async () => {
      let thrown: unknown;
      try {
        await mongoEmit({ dir: pkgDir, frameworkComponents: [] });
      } catch (error) {
        thrown = error;
      }

      expect(CliStructuredError.is(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: '2002',
        domain: 'MIG',
        meta: { dir: pkgDir },
      });
    });
  });

  describe('given a migration.ts whose default export is not a Migration subclass', () => {
    it('throws PN-MIG-2003 when the default export is not a constructor', async () => {
      await writeFile(join(pkgDir, 'migration.ts'), 'export default 42;\n');

      let thrown: unknown;
      try {
        await mongoEmit({ dir: pkgDir, frameworkComponents: [] });
      } catch (error) {
        thrown = error;
      }

      expect(CliStructuredError.is(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: '2003',
        domain: 'MIG',
        meta: { dir: pkgDir },
      });
    });

    it('throws PN-MIG-2003 when the default export is a class that does not extend Migration', async () => {
      await writeFile(
        join(pkgDir, 'migration.ts'),
        ['class NotAMigration {}', 'export default NotAMigration;', ''].join('\n'),
      );

      let thrown: unknown;
      try {
        await mongoEmit({ dir: pkgDir, frameworkComponents: [] });
      } catch (error) {
        thrown = error;
      }

      expect(CliStructuredError.is(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: '2003',
        domain: 'MIG',
        meta: { dir: pkgDir },
      });
    });
  });

  describe('given a class-flow migration.ts whose operations getter does not return an array', () => {
    it('throws PN-MIG-2004 with the package dir in meta', async () => {
      const migration = [
        `import { Migration } from '${familyMongoMigrationExport}';`,
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
        await mongoEmit({ dir: pkgDir, frameworkComponents: [] });
      } catch (error) {
        thrown = error;
      }

      expect(CliStructuredError.is(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: '2004',
        domain: 'MIG',
        meta: { dir: pkgDir },
      });
    });
  });
});
