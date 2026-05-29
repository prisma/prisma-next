import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  MigrationOperationClass,
  MigrationPlanOperation,
} from '@prisma-next/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import {
  formatMigrationDirName,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';
import type { MigrationShowSpaceResult } from '../../src/commands/migration-show';
import {
  resolveAppTargetPath,
  resolveByHashPrefix,
  resolveLatestFromDir,
} from '../../src/commands/migration-show';
import { formatMigrationShowOutput } from '../../src/utils/formatters/migrations';
import { parseGlobalFlags } from '../../src/utils/global-flags';

// Track every temp dir handed out by `createTempDir` so the suite-wide
// `afterEach` can remove them — even when an assertion fails — keeping
// ephemeral state out of the shared `tmpdir()` between runs.
const createdTempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `test-migration-show-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  createdTempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const dirs = createdTempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function createOp(
  id: string,
  label: string,
  operationClass: MigrationOperationClass,
  sql?: string[],
): MigrationPlanOperation {
  const op: Record<string, unknown> = { id, label, operationClass };
  if (sql) {
    op['execute'] = sql.map((s) => ({ sql: s }));
  }
  return op as unknown as MigrationPlanOperation;
}

/**
 * Build a draft (un-attested) base metadata. The actual on-disk metadata
 * is attested inside `setupMigrationDir`, where the `migrationHash` is
 * computed once we know the full ops list.
 */
function createMetadata(from: string, to: string): Omit<MigrationMetadata, 'migrationHash'> {
  return {
    from,
    to,
    providedInvariants: [],
    createdAt: new Date().toISOString(),
  };
}

async function setupMigrationDir(
  migrationsDir: string,
  name: string,
  baseMetadata: Omit<MigrationMetadata, 'migrationHash'>,
  ops: MigrationPlanOperation[],
  dateOffset = 0,
): Promise<string> {
  const date = new Date(2026, 0, 1 + dateOffset, 10, 0);
  const dirName = formatMigrationDirName(date, name);
  const packageDir = join(migrationsDir, dirName);
  const metadata: MigrationMetadata = {
    ...baseMetadata,
    migrationHash: computeMigrationHash(baseMetadata, ops),
  };
  await writeMigrationPackage(packageDir, metadata, ops);
  return packageDir;
}

describe('resolveByHashPrefix', () => {
  it('resolves exact migrationHash match', async () => {
    const tempDir = await createTempDir('exact');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await setupMigrationDir(
      migrationsDir,
      'add-user',
      createMetadata(EMPTY_CONTRACT_HASH, 'sha256:hash-a'),
      [createOp('table.user', 'Create table "user"', 'additive')],
    );

    const { packages } = await readMigrationsDir(migrationsDir);
    const pkg = packages[0]!;
    const migrationHash = pkg.metadata.migrationHash;

    const result = resolveByHashPrefix(packages, migrationHash);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata.migrationHash).toBe(migrationHash);
    }
  });

  it('resolves unique prefix', async () => {
    const tempDir = await createTempDir('prefix');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await setupMigrationDir(
      migrationsDir,
      'add-user',
      createMetadata(EMPTY_CONTRACT_HASH, 'sha256:hash-a'),
      [createOp('table.user', 'Create table "user"', 'additive')],
    );

    const { packages } = await readMigrationsDir(migrationsDir);
    const migrationHash = packages[0]!.metadata.migrationHash;
    const prefix = migrationHash.slice(0, 12);

    const result = resolveByHashPrefix(packages, prefix);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata.migrationHash).toBe(migrationHash);
    }
  });

  it('returns error for no matches', () => {
    const packages: OnDiskMigrationPackage[] = [
      {
        dirName: '20260101_100000_test',
        dirPath: '/tmp/test',
        metadata: {
          from: null,
          to: 'sha256:hash-a',
          migrationHash: 'sha256:abc123',
          providedInvariants: [],
          createdAt: new Date().toISOString(),
        },
        ops: [],
      },
    ];

    const result = resolveByHashPrefix(packages, 'sha256:zzz');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('No migration found');
    }
  });

  it('returns error for ambiguous prefix', () => {
    const packages: OnDiskMigrationPackage[] = [
      {
        dirName: '20260101_100000_first',
        dirPath: '/tmp/first',
        metadata: {
          from: null,
          to: 'sha256:hash-a',
          migrationHash: 'sha256:abc111',
          providedInvariants: [],
          createdAt: new Date().toISOString(),
        },
        ops: [],
      },
      {
        dirName: '20260102_100000_second',
        dirPath: '/tmp/second',
        metadata: {
          from: 'sha256:hash-a',
          to: 'sha256:hash-b',
          migrationHash: 'sha256:abc222',
          providedInvariants: [],
          createdAt: new Date().toISOString(),
        },
        ops: [],
      },
    ];

    const result = resolveByHashPrefix(packages, 'sha256:abc');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('Ambiguous');
    }
  });

  it('resolves prefix without sha256: scheme', () => {
    const packages: OnDiskMigrationPackage[] = [
      {
        dirName: '20260101_100000_test',
        dirPath: '/tmp/test',
        metadata: {
          from: null,
          to: 'sha256:hash-a',
          migrationHash: 'sha256:abc123def456',
          providedInvariants: [],
          createdAt: new Date().toISOString(),
        },
        ops: [],
      },
    ];

    const result = resolveByHashPrefix(packages, 'abc123');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata.migrationHash).toBe('sha256:abc123def456');
    }
  });

  it('returns no match when prefix matches nothing', () => {
    // After the draft state was collapsed, every package has a real
    // `migrationHash` — there is no longer a "skip draft" branch. The
    // prefix lookup simply returns no-match if nothing in the chain
    // shares the requested prefix.
    const packages: OnDiskMigrationPackage[] = [
      {
        dirName: '20260101_100000_only',
        dirPath: '/tmp/only',
        metadata: {
          from: null,
          to: 'sha256:hash-a',
          migrationHash: 'sha256:abc999000000',
          providedInvariants: [],
          createdAt: new Date().toISOString(),
        },
        ops: [],
      },
    ];

    const result = resolveByHashPrefix(packages, 'sha256:zzz');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('No migration found');
    }
  });
});

describe('resolveLatestFromDir', () => {
  it('returns ok(null) for an empty migrations directory', async () => {
    const tempDir = await createTempDir('latest-empty');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const result = await resolveLatestFromDir(migrationsDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('returns notOk when on-disk packages exist but no latest can be resolved', async () => {
    const tempDir = await createTempDir('latest-corrupt');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    // Construct a corrupt history: a single self-loop migration whose
    // from === to === EMPTY_CONTRACT_HASH leaves the reconstructed graph
    // with no reachable leaf, so findLatestMigration() returns null.
    await setupMigrationDir(
      migrationsDir,
      'self-loop',
      createMetadata(EMPTY_CONTRACT_HASH, EMPTY_CONTRACT_HASH),
      [createOp('data.backfill', 'Backfill data', 'data')],
    );

    const result = await resolveLatestFromDir(migrationsDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('Could not resolve latest migration');
      expect(result.failure.why ?? '').toContain('No latest migration found');
    }
  });
});

describe('resolveAppTargetPath', () => {
  // Mirror the on-disk layout: <migrationsDir>/<spaceId>/.
  const migrationsDir = '/tmp/proj/migrations';
  const appMigrationsDir = `${migrationsDir}/app`;
  const appMigrationsRelative = 'migrations/app';

  it('returns the resolved path when the target is inside the app migrations dir', () => {
    const target = `${appMigrationsDir}/20260101_000000_init`;

    const result = resolveAppTargetPath(target, appMigrationsDir, appMigrationsRelative);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(target);
    }
  });

  it('rejects an extension-space package path (sibling of the app dir)', () => {
    const extensionPackage = `${migrationsDir}/cipherstash/0000000001-init`;

    const result = resolveAppTargetPath(extensionPackage, appMigrationsDir, appMigrationsRelative);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('app-space migration');
      expect(result.failure.why ?? '').toContain(`Expected a path under ${appMigrationsRelative}`);
    }
  });

  it('rejects an unrelated path outside the migrations tree', () => {
    const outsideTarget = '/tmp/other/extensions/cipherstash/0000000001-init';

    const result = resolveAppTargetPath(outsideTarget, appMigrationsDir, appMigrationsRelative);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('app-space migration');
    }
  });

  it('rejects the app migrations dir itself as a target', () => {
    const result = resolveAppTargetPath(appMigrationsDir, appMigrationsDir, appMigrationsRelative);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('app-space migration');
    }
  });

  it('rejects a cross-drive target where pathe.relative returns an absolute path', () => {
    // On Windows, comparing a target on a different drive than the app
    // migrations dir makes pathe.relative return an absolute Windows path
    // (e.g. "D:/elsewhere/foo"), which does not start with "..". The guard
    // must reject this case via isAbsolute(relativeToApp) rather than
    // mislabeling it as app-space.
    const windowsAppMigrationsDir = 'C:/app/migrations/app';
    const crossDriveTarget = 'D:/elsewhere/foo';

    const result = resolveAppTargetPath(
      crossDriveTarget,
      windowsAppMigrationsDir,
      'migrations/app',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('app-space migration');
    }
  });
});

function singleSpace(space: MigrationShowSpaceResult): {
  spaces: readonly MigrationShowSpaceResult[];
} {
  return { spaces: [space] };
}

describe('formatMigrationShowOutput', () => {
  it('shows migration metadata', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      singleSpace({
        kind: 'present',
        spaceId: 'app',
        dirName: '20260101_100000_add_user',
        dirPath: 'migrations/20260101_100000_add_user',
        from: null,
        to: 'sha256:hash-a',
        migrationHash: 'sha256:edge-abc',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [
          { id: 'table.user', label: 'Create table "user"', operationClass: 'additive' },
        ],
        preview: {
          statements: [{ text: 'CREATE TABLE "user" (id int4 NOT NULL)', language: 'sql' }],
        },
        summary: '1 operation(s)',
      }),
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('20260101_100000_add_user');
    expect(stripped).toContain('from: (baseline)');
    expect(stripped).toContain('to:   sha256:hash-a');
    expect(stripped).toContain('migrationHash: sha256:edge-abc');
    expect(stripped).toContain('2026-01-01T10:00:00.000Z');
  });

  it('shows operations tree with class labels', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      singleSpace({
        kind: 'present',
        spaceId: 'app',
        dirName: '20260101_100000_test',
        dirPath: 'migrations/20260101_100000_test',
        from: null,
        to: 'sha256:hash-a',
        migrationHash: 'sha256:edge-abc',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [
          { id: 'table.user', label: 'Create table "user"', operationClass: 'additive' },
          {
            id: 'column.post.legacy',
            label: 'Drop column legacy on post',
            operationClass: 'destructive',
          },
        ],
        preview: { statements: [] },
        summary: '2 operation(s)',
      }),
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('├');
    expect(stripped).toContain('└');
    // Operation-class tags are no longer inlined in the human-readable
    // line. Destructive ops still render a "(destructive)" marker
    // (replacing the old "[destructive]" tag); additive/widening/
    // mutative/data render bare.
    expect(stripped).not.toContain('[additive]');
    expect(stripped).not.toContain('[destructive]');
    expect(stripped).toContain('(destructive)');
  });

  it('shows destructive warning when operations include destructive', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      singleSpace({
        kind: 'present',
        spaceId: 'app',
        dirName: '20260101_100000_test',
        dirPath: 'migrations/20260101_100000_test',
        from: null,
        to: 'sha256:hash-a',
        migrationHash: 'sha256:edge-abc',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [
          {
            id: 'column.post.legacy',
            label: 'Drop column legacy on post',
            operationClass: 'destructive',
          },
        ],
        preview: {
          statements: [{ text: 'ALTER TABLE "post" DROP COLUMN "legacy"', language: 'sql' }],
        },
        summary: '1 operation(s)',
      }),
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('⚠');
    expect(stripped).toContain('destructive operations');
    expect(stripped).toContain('data loss');
  });

  it('omits destructive warning when all additive', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      singleSpace({
        kind: 'present',
        spaceId: 'app',
        dirName: '20260101_100000_test',
        dirPath: 'migrations/20260101_100000_test',
        from: null,
        to: 'sha256:hash-a',
        migrationHash: 'sha256:edge-abc',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [
          { id: 'table.user', label: 'Create table "user"', operationClass: 'additive' },
        ],
        preview: {
          statements: [{ text: 'CREATE TABLE "user" (id int4 NOT NULL)', language: 'sql' }],
        },
        summary: '1 operation(s)',
      }),
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).not.toContain('⚠');
    expect(stripped).not.toContain('data loss');
  });

  it('shows DDL preview', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      singleSpace({
        kind: 'present',
        spaceId: 'app',
        dirName: '20260101_100000_test',
        dirPath: 'migrations/20260101_100000_test',
        from: null,
        to: 'sha256:hash-a',
        migrationHash: 'sha256:edge-abc',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [
          { id: 'table.user', label: 'Create table "user"', operationClass: 'additive' },
        ],
        preview: {
          statements: [{ text: 'CREATE TABLE "user" (id int4 NOT NULL)', language: 'sql' }],
        },
        summary: '1 operation(s)',
      }),
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('DDL preview');
    expect(stripped).toContain('CREATE TABLE "user" (id int4 NOT NULL);');
  });

  it('returns empty string in quiet mode', () => {
    const flags = parseGlobalFlags({ quiet: true });
    const output = formatMigrationShowOutput(
      singleSpace({
        kind: 'present',
        spaceId: 'app',
        dirName: '20260101_100000_test',
        dirPath: 'migrations/20260101_100000_test',
        from: null,
        to: 'sha256:hash-a',
        migrationHash: 'sha256:edge-abc',
        createdAt: '2026-01-01T10:00:00.000Z',
        operations: [],
        preview: { statements: [] },
        summary: '0 operation(s)',
      }),
      flags,
    );

    expect(output).toBe('');
  });

  it('renders per-space section headings when multiple spaces are present', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      {
        spaces: [
          {
            kind: 'present',
            spaceId: 'app',
            dirName: '20260101_100000_app_init',
            dirPath: 'migrations/app/20260101_100000_app_init',
            from: null,
            to: 'sha256:hash-app',
            migrationHash: 'sha256:mhash-app',
            createdAt: '2026-01-01T10:00:00.000Z',
            operations: [],
            preview: { statements: [] },
            summary: '0 operation(s)',
          },
          {
            kind: 'present',
            spaceId: 'cipherstash',
            dirName: '0000000001-init',
            dirPath: 'migrations/cipherstash/0000000001-init',
            from: null,
            to: 'sha256:hash-cs',
            migrationHash: 'sha256:mhash-cs',
            createdAt: '2026-01-01T10:00:00.000Z',
            operations: [],
            preview: { statements: [] },
            summary: '0 operation(s)',
          },
        ],
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('── app ──');
    expect(stripped).toContain('── cipherstash ──');
    expect(stripped).toContain('20260101_100000_app_init');
    expect(stripped).toContain('0000000001-init');

    // Ordering matters: the app section must precede the extension section
    // in the rendered output so reordering the spaces array (or accidentally
    // alphabetising) is caught.
    const appHeadingIdx = stripped.indexOf('── app ──');
    const cipherstashHeadingIdx = stripped.indexOf('── cipherstash ──');
    expect(appHeadingIdx).toBeLessThan(cipherstashHeadingIdx);
    expect(stripped.indexOf('20260101_100000_app_init')).toBeLessThan(
      stripped.indexOf('0000000001-init'),
    );
  });

  it('renders a placeholder block for an extension space with no on-disk package', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationShowOutput(
      {
        spaces: [
          {
            kind: 'present',
            spaceId: 'app',
            dirName: '20260101_100000_app_init',
            dirPath: 'migrations/app/20260101_100000_app_init',
            from: null,
            to: 'sha256:hash-app',
            migrationHash: 'sha256:mhash-app',
            createdAt: '2026-01-01T10:00:00.000Z',
            operations: [],
            preview: { statements: [] },
            summary: '0 operation(s)',
          },
          {
            kind: 'missing',
            spaceId: 'cipherstash',
            summary: 'No on-disk migration package for this space',
          },
        ],
      },
      flags,
    );
    const stripped = stripAnsi(output);

    expect(stripped).toContain('── cipherstash ──');
    expect(stripped).toContain('No on-disk migration package for this space');
  });
});
