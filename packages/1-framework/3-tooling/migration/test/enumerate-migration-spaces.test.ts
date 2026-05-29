import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { join, resolve } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  enumerateMigrationSpaces,
  resolveRefsByContractHash,
} from '../src/enumerate-migration-spaces';
import { writeRef } from '../src/refs';
import { writeTestPackage } from './fixtures';

const HASH_INITIAL = `sha256:${'a'.repeat(64)}`;
const HASH_MIGRATION = `sha256:${'b'.repeat(64)}`;
const HASH_BRANCH_A = `sha256:${'c'.repeat(64)}`;
const HASH_BRANCH_B = `sha256:${'d'.repeat(64)}`;
const HASH_BOOKEND = `sha256:${'e'.repeat(64)}`;
const HASH_POSTGIS = `sha256:${'f'.repeat(64)}`;
const HASH_CIPHER = `sha256:${'1'.repeat(64)}`;

const ADDITIVE_OP: MigrationPlanOperation = {
  id: 'table.users',
  label: 'Create table users',
  operationClass: 'additive',
};

const BACKFILL_OP = {
  id: 'data.backfill_emails',
  label: 'Backfill emails',
  operationClass: 'data',
  invariantId: 'backfill_emails_v1',
} as unknown as MigrationPlanOperation;

describe('enumerateMigrationSpaces', () => {
  let tmpRoot: string;
  let migrationsDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'enumerate-migration-spaces-'));
    migrationsDir = join(tmpRoot, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('returns an empty list when the migrations directory does not exist', async () => {
    const result = await enumerateMigrationSpaces({
      projectMigrationsDir: join(tmpRoot, 'no-such-migrations'),
    });
    expect(result).toEqual([]);
  });

  it('orders migrations within a space by dirName descending (latest first)', async () => {
    const appDir = join(migrationsDir, 'app');
    await writeTestPackage(
      join(appDir, '20260422T0720_initial'),
      { from: null, to: HASH_INITIAL },
      [ADDITIVE_OP],
    );
    await writeTestPackage(
      join(appDir, '20260601T1200_latest'),
      { from: HASH_MIGRATION, to: HASH_BOOKEND },
      [ADDITIVE_OP],
    );
    await writeTestPackage(
      join(appDir, '20260518T1701_middle'),
      { from: HASH_INITIAL, to: HASH_MIGRATION },
      [ADDITIVE_OP],
    );

    const result = await enumerateMigrationSpaces({ projectMigrationsDir: migrationsDir });

    expect(result).toHaveLength(1);
    expect(result[0]?.spaceId).toBe('app');
    expect(result[0]?.migrations.map((m) => m.dirName)).toEqual([
      '20260601T1200_latest',
      '20260518T1701_middle',
      '20260422T0720_initial',
    ]);
  });

  it('places the app space first and orders extension spaces lex-asc', async () => {
    for (const spaceId of ['postgis', 'app', 'cipherstash']) {
      await writeTestPackage(
        join(migrationsDir, spaceId, '20260101T0000_seed'),
        { from: null, to: `sha256:${spaceId.padEnd(64, '0').slice(0, 64)}` },
        [ADDITIVE_OP],
      );
    }

    const result = await enumerateMigrationSpaces({ projectMigrationsDir: migrationsDir });

    expect(result.map((s) => s.spaceId)).toEqual(['app', 'cipherstash', 'postgis']);
  });

  it('returns extension spaces lex-asc when the app space is absent', async () => {
    for (const spaceId of ['postgis', 'cipherstash']) {
      await writeTestPackage(
        join(migrationsDir, spaceId, '20260101T0000_seed'),
        { from: null, to: `sha256:${spaceId.padEnd(64, '0').slice(0, 64)}` },
        [ADDITIVE_OP],
      );
    }

    const result = await enumerateMigrationSpaces({ projectMigrationsDir: migrationsDir });

    expect(result.map((s) => s.spaceId)).toEqual(['cipherstash', 'postgis']);
  });

  it('returns { spaceId, migrations: [] } for a space directory with no migrations', async () => {
    await mkdir(join(migrationsDir, 'app'), { recursive: true });
    await mkdir(join(migrationsDir, 'postgis'), { recursive: true });
    await writeTestPackage(
      join(migrationsDir, 'postgis', '20260601T0000_install_postgis'),
      { from: null, to: HASH_POSTGIS },
      [ADDITIVE_OP],
    );

    const result = await enumerateMigrationSpaces({ projectMigrationsDir: migrationsDir });

    expect(result.map((s) => s.spaceId)).toEqual(['app', 'postgis']);
    expect(result[0]?.migrations).toEqual([]);
    expect(result[1]?.migrations).toHaveLength(1);
  });

  it('attaches each ref to every row whose destination contract hash matches', async () => {
    const appDir = join(migrationsDir, 'app');
    await writeTestPackage(
      join(appDir, '20260601T1200_branch_a'),
      { from: HASH_INITIAL, to: HASH_BRANCH_A },
      [ADDITIVE_OP],
    );
    await writeTestPackage(
      join(appDir, '20260518T1701_branch_b'),
      { from: HASH_INITIAL, to: HASH_BRANCH_A },
      [ADDITIVE_OP],
    );
    await writeTestPackage(
      join(appDir, '20260422T0720_initial'),
      { from: null, to: HASH_INITIAL },
      [ADDITIVE_OP],
    );

    const refsDir = join(appDir, 'refs');
    await writeRef(refsDir, 'production', { hash: HASH_BRANCH_A, invariants: [] });
    await writeRef(refsDir, 'staging', { hash: HASH_BRANCH_A, invariants: [] });

    const result = await enumerateMigrationSpaces({ projectMigrationsDir: migrationsDir });
    const migrations = result[0]?.migrations ?? [];

    expect(migrations[0]?.dirName).toBe('20260601T1200_branch_a');
    expect(migrations[0]?.refs).toEqual(['production', 'staging']);
    expect(migrations[1]?.dirName).toBe('20260518T1701_branch_b');
    expect(migrations[1]?.refs).toEqual(['production', 'staging']);
    expect(migrations[2]?.refs).toEqual([]);
  });

  it('omits orphan refs from the output (refs pointing at no on-disk destination)', async () => {
    const appDir = join(migrationsDir, 'app');
    await writeTestPackage(
      join(appDir, '20260422T0720_initial'),
      { from: null, to: HASH_INITIAL },
      [ADDITIVE_OP],
    );
    await writeRef(join(appDir, 'refs'), 'ghost', {
      hash: HASH_BRANCH_B,
      invariants: [],
    });

    const result = await enumerateMigrationSpaces({ projectMigrationsDir: migrationsDir });
    const migrations = result[0]?.migrations ?? [];

    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.refs).toEqual([]);
  });

  it('skips subdirectories whose name is not a valid space id', async () => {
    await mkdir(join(migrationsDir, 'NotASpace'), { recursive: true });
    await writeTestPackage(
      join(migrationsDir, 'app', '20260101T0000_seed'),
      { from: null, to: HASH_INITIAL },
      [ADDITIVE_OP],
    );

    const result = await enumerateMigrationSpaces({ projectMigrationsDir: migrationsDir });

    expect(result.map((s) => s.spaceId)).toEqual(['app']);
  });

  it('treats a top-level `refs/` subdirectory as reserved, not a contract space', async () => {
    // The per-space layout reserves `refs/` as a sub-directory of each
    // space (`migrations/<space>/refs/*.json`). If a project ends up with
    // a top-level `migrations/refs/` directory — for example because a
    // ref file was authored at the wrong layer — the enumerator must not
    // mistake it for a phantom contract space named `refs`.
    await writeTestPackage(
      join(migrationsDir, 'app', '20260101T0000_seed'),
      { from: null, to: HASH_INITIAL },
      [ADDITIVE_OP],
    );
    await writeRef(join(migrationsDir, 'refs'), 'production', {
      hash: HASH_BRANCH_A,
      invariants: [],
    });

    const result = await enumerateMigrationSpaces({ projectMigrationsDir: migrationsDir });

    expect(result.map((s) => s.spaceId)).toEqual(['app']);
  });

  it('treats `refs` as a reserved name even when it looks like a populated space directory', async () => {
    // Edge case: a user could theoretically name a contract space `refs`
    // and nest a migration package under it
    // (`migrations/refs/<dir>/migration.json`). The candidate-level filter
    // still excludes it — `refs` is reserved at the contract-space
    // candidate level regardless of contents — so the user's migration is
    // silently filtered out (the recommended remediation is to rename the
    // space).
    await writeTestPackage(
      join(migrationsDir, 'app', '20260101T0000_seed'),
      { from: null, to: HASH_INITIAL },
      [ADDITIVE_OP],
    );
    await writeTestPackage(
      join(migrationsDir, 'refs', '20260101T0000_misplaced'),
      { from: null, to: HASH_BRANCH_A },
      [ADDITIVE_OP],
    );

    const result = await enumerateMigrationSpaces({ projectMigrationsDir: migrationsDir });

    expect(result.map((s) => s.spaceId)).toEqual(['app']);
  });

  it('reads the prisma-next-demo fixture into a single app space, latest-first', async () => {
    const fixtureMigrationsDir = resolve(
      __dirname,
      '../../../../../examples/prisma-next-demo/migrations',
    );

    const result = await enumerateMigrationSpaces({ projectMigrationsDir: fixtureMigrationsDir });

    expect(result.map((s) => s.spaceId)).toEqual(['app']);
    const dirNames = result[0]?.migrations.map((m) => m.dirName) ?? [];
    expect(dirNames).toEqual([
      '20260518T1701_namespaces_bookend',
      '20260422T0748_migration',
      '20260422T0742_migration',
      '20260422T0720_initial',
    ]);
  });

  it('builds a multi-space + self-edge + convergence fixture end-to-end', async () => {
    const appDir = join(migrationsDir, 'app');
    await writeTestPackage(
      join(appDir, '20260422T0720_initial'),
      { from: null, to: HASH_INITIAL },
      [ADDITIVE_OP],
    );
    await writeTestPackage(
      join(appDir, '20260422T0742_migration'),
      { from: HASH_INITIAL, to: HASH_MIGRATION },
      [ADDITIVE_OP],
    );
    await writeTestPackage(
      join(appDir, '20260518T1701_branch_a'),
      { from: HASH_MIGRATION, to: HASH_BRANCH_A },
      [ADDITIVE_OP],
    );
    await writeTestPackage(
      join(appDir, '20260518T1702_branch_b'),
      { from: HASH_MIGRATION, to: HASH_BRANCH_A },
      [ADDITIVE_OP],
    );
    await writeTestPackage(
      join(appDir, '20260601T1200_backfill_emails'),
      { from: HASH_BRANCH_A, to: HASH_BRANCH_A },
      [BACKFILL_OP],
    );

    await writeTestPackage(
      join(migrationsDir, 'cipherstash', '20260601T0000_install_eql_bundle'),
      { from: null, to: HASH_CIPHER },
      [ADDITIVE_OP],
    );
    await writeTestPackage(
      join(migrationsDir, 'postgis', '20260601T0000_install_postgis'),
      { from: null, to: HASH_POSTGIS },
      [ADDITIVE_OP],
    );

    await writeRef(join(appDir, 'refs'), 'production', {
      hash: HASH_BRANCH_A,
      invariants: ['backfill_emails_v1'],
    });
    await writeRef(join(migrationsDir, 'postgis', 'refs'), 'db', {
      hash: HASH_POSTGIS,
      invariants: [],
    });

    const result = await enumerateMigrationSpaces({ projectMigrationsDir: migrationsDir });

    expect(result.map((s) => s.spaceId)).toEqual(['app', 'cipherstash', 'postgis']);

    const appMigrations = result[0]?.migrations ?? [];
    expect(appMigrations.map((m) => m.dirName)).toEqual([
      '20260601T1200_backfill_emails',
      '20260518T1702_branch_b',
      '20260518T1701_branch_a',
      '20260422T0742_migration',
      '20260422T0720_initial',
    ]);

    const selfEdge = appMigrations[0];
    expect(selfEdge?.from).toBe(HASH_BRANCH_A);
    expect(selfEdge?.to).toBe(HASH_BRANCH_A);
    expect(selfEdge?.providedInvariants).toEqual(['backfill_emails_v1']);
    expect(selfEdge?.refs).toEqual(['production']);

    const convergeB = appMigrations[1];
    const convergeA = appMigrations[2];
    expect(convergeB?.to).toBe(HASH_BRANCH_A);
    expect(convergeA?.to).toBe(HASH_BRANCH_A);
    expect(convergeB?.refs).toEqual(['production']);
    expect(convergeA?.refs).toEqual(['production']);

    expect(appMigrations[4]?.from).toBeNull();

    const postgisMigrations = result[2]?.migrations ?? [];
    expect(postgisMigrations).toHaveLength(1);
    expect(postgisMigrations[0]?.refs).toEqual(['db']);
  });
});

describe('resolveRefsByContractHash', () => {
  let refsDir: string;

  beforeEach(async () => {
    refsDir = await mkdtemp(join(tmpdir(), 'resolve-refs-'));
  });

  afterEach(async () => {
    await rm(refsDir, { recursive: true, force: true });
  });

  it('returns an empty map when the refs directory does not exist', async () => {
    const map = await resolveRefsByContractHash(join(refsDir, 'nope'));
    expect(map.size).toBe(0);
  });

  it('groups multiple refs that share a hash into a single sorted bucket', async () => {
    await writeRef(refsDir, 'staging', { hash: HASH_BRANCH_A, invariants: [] });
    await writeRef(refsDir, 'production', { hash: HASH_BRANCH_A, invariants: [] });
    await writeRef(refsDir, 'db', { hash: HASH_POSTGIS, invariants: [] });

    const map = await resolveRefsByContractHash(refsDir);

    expect(map.get(HASH_BRANCH_A)).toEqual(['production', 'staging']);
    expect(map.get(HASH_POSTGIS)).toEqual(['db']);
  });
});
