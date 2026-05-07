import {
  ensureMarkerTableStatement,
  migrateMarkerSchemaSqlite,
} from '@prisma-next/target-sqlite/statement-builders';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  executeStatement,
  type TestDatabase,
} from './fixtures/runner-fixtures';

/**
 * Validates the T1.1 SQLite marker schema migration (sub-spec
 * `framework-mechanism.spec.md § 2`):
 *
 * - Fresh database (`_prisma_marker` already in the new shape) -> no-op,
 *   table shape preserved, existing rows preserved.
 * - Legacy single-row marker (`id` PK, no `space` column) -> rebuilt
 *   into the per-space shape (`space TEXT PRIMARY KEY`) with the row
 *   tagged `space='app'`.
 * - Already-migrated database -> running the migration again is a no-op
 *   (idempotency).
 *
 * SQLite cannot `ALTER TABLE` a primary key, so the helper performs a
 * rebuild dance internally; these tests check the dance terminates in
 * the documented end state.
 */
describe('marker schema migration (T1.1) - sqlite', () => {
  let testDb: TestDatabase | undefined;

  afterEach(() => {
    testDb?.cleanup();
    testDb = undefined;
  });

  interface PragmaTableInfoRow {
    readonly name: string;
    readonly pk: number;
  }

  async function fetchTableInfo(
    db: TestDatabase['driver'],
  ): Promise<readonly PragmaTableInfoRow[]> {
    const result = await db.query<PragmaTableInfoRow>('PRAGMA table_info("_prisma_marker")');
    return result.rows;
  }

  function pkColumns(rows: readonly PragmaTableInfoRow[]): readonly string[] {
    return rows
      .filter((r) => r.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((r) => r.name);
  }

  function columnNames(rows: readonly PragmaTableInfoRow[]): readonly string[] {
    return rows.map((r) => r.name);
  }

  it('is a no-op on a fresh database where the marker table is already in the new shape', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;

    await executeStatement(driver, ensureMarkerTableStatement);
    await driver.query(
      'INSERT INTO _prisma_marker (space, core_hash, profile_hash) VALUES (?, ?, ?)',
      ['app', 'sha256:dest', 'sha256:profile'],
    );

    await migrateMarkerSchemaSqlite(driver);

    const info = await fetchTableInfo(driver);
    expect(pkColumns(info)).toEqual(['space']);
    expect(columnNames(info)).toContain('space');
    expect(columnNames(info)).not.toContain('id');

    const rows = await driver.query<{ space: string; core_hash: string }>(
      'SELECT space, core_hash FROM _prisma_marker',
    );
    expect(rows.rows).toEqual([{ space: 'app', core_hash: 'sha256:dest' }]);
  });

  it("promotes a legacy single-row marker to the per-space shape (id PK -> space PK, row tagged 'app')", async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;

    await driver.query(`CREATE TABLE _prisma_marker (
      id INTEGER PRIMARY KEY DEFAULT 1,
      core_hash TEXT NOT NULL,
      profile_hash TEXT NOT NULL,
      contract_json TEXT,
      canonical_version INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      app_tag TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      invariants TEXT NOT NULL DEFAULT '[]'
    )`);
    await driver.query(
      'INSERT INTO _prisma_marker (id, core_hash, profile_hash) VALUES (?, ?, ?)',
      [1, 'sha256:legacy', 'sha256:profile-legacy'],
    );

    await migrateMarkerSchemaSqlite(driver);

    const info = await fetchTableInfo(driver);
    expect(pkColumns(info)).toEqual(['space']);
    expect(columnNames(info)).toContain('space');
    expect(columnNames(info)).not.toContain('id');

    const rows = await driver.query<{
      space: string;
      core_hash: string;
      profile_hash: string;
    }>('SELECT space, core_hash, profile_hash FROM _prisma_marker');
    expect(rows.rows).toEqual([
      {
        space: 'app',
        core_hash: 'sha256:legacy',
        profile_hash: 'sha256:profile-legacy',
      },
    ]);
  });

  it('is idempotent across repeated applications (boot N+1 produces no schema or row change)', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;

    await driver.query(`CREATE TABLE _prisma_marker (
      id INTEGER PRIMARY KEY DEFAULT 1,
      core_hash TEXT NOT NULL,
      profile_hash TEXT NOT NULL,
      contract_json TEXT,
      canonical_version INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      app_tag TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      invariants TEXT NOT NULL DEFAULT '[]'
    )`);
    await driver.query(
      'INSERT INTO _prisma_marker (id, core_hash, profile_hash) VALUES (?, ?, ?)',
      [1, 'sha256:legacy', 'sha256:profile-legacy'],
    );

    await migrateMarkerSchemaSqlite(driver);
    const firstInfo = await fetchTableInfo(driver);
    const firstRows = await driver.query<{ space: string; core_hash: string }>(
      'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
    );

    await migrateMarkerSchemaSqlite(driver);
    const secondInfo = await fetchTableInfo(driver);
    const secondRows = await driver.query<{ space: string; core_hash: string }>(
      'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
    );

    expect(columnNames(secondInfo)).toEqual(columnNames(firstInfo));
    expect(pkColumns(secondInfo)).toEqual(pkColumns(firstInfo));
    expect(secondRows.rows).toEqual(firstRows.rows);
  });
});
