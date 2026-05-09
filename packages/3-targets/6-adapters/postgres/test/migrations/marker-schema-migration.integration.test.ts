import {
  ensureLedgerTableStatement,
  ensurePrismaContractSchemaStatement,
  migrateMarkerSchemaStatements,
} from '@prisma-next/target-postgres/statement-builders';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  executeStatement,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

/**
 * Validates the marker schema migration against a real Postgres (PGlite via
 * `createDevDatabase`):
 *
 * - On a fresh database created in the **new** shape (`space TEXT
 *   PRIMARY KEY`), running `migrateMarkerSchemaStatements` is a no-op
 *   and the table shape is preserved.
 * - On a **legacy** single-row marker (`id smallint primary key default
 *   1`) the same statements promote the row to `(space='app', …)` and
 *   repoint the primary key from `id` to `space`.
 * - On an already-migrated database, applying the statements a second
 *   time is a no-op (idempotency).
 */
describe.sequential('marker schema migration', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  });

  async function applyMigration(d: PostgresControlDriver): Promise<void> {
    for (const stmt of migrateMarkerSchemaStatements) {
      await executeStatement(d, stmt);
    }
  }

  async function fetchPkColumns(d: PostgresControlDriver): Promise<readonly string[]> {
    const rows = await d.query<{ column_name: string }>(
      `select kcu.column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on tc.constraint_name = kcu.constraint_name
          and tc.table_schema = kcu.table_schema
          and tc.table_name = kcu.table_name
        where tc.table_schema = 'prisma_contract'
          and tc.table_name = 'marker'
          and tc.constraint_type = 'PRIMARY KEY'
        order by kcu.ordinal_position`,
    );
    return rows.rows.map((r) => r.column_name);
  }

  async function fetchColumnNames(d: PostgresControlDriver): Promise<readonly string[]> {
    const rows = await d.query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'prisma_contract'
          and table_name = 'marker'
        order by ordinal_position`,
    );
    return rows.rows.map((r) => r.column_name);
  }

  it(
    'is a no-op on a fresh database where the marker table is already in the new shape',
    { timeout: testTimeout },
    async () => {
      const d = driver!;
      await executeStatement(d, ensurePrismaContractSchemaStatement);
      // Create the marker table in the new shape directly (matches what
      // a brand-new boot does via `ensureMarkerTableStatement`).
      await d.query(`create table prisma_contract.marker (
        space text not null primary key default 'app',
        core_hash text not null,
        profile_hash text not null,
        contract_json jsonb,
        canonical_version int,
        updated_at timestamptz not null default now(),
        app_tag text,
        meta jsonb not null default '{}',
        invariants text[] not null default '{}'
      )`);
      await executeStatement(d, ensureLedgerTableStatement);

      // Insert a marker row so we can confirm the migration leaves it alone.
      await d.query(
        `insert into prisma_contract.marker (space, core_hash, profile_hash)
         values ('app', 'sha256:dest', 'sha256:profile')`,
      );

      await expect(applyMigration(d)).resolves.toBeUndefined();

      const pk = await fetchPkColumns(d);
      expect(pk).toEqual(['space']);

      const columns = await fetchColumnNames(d);
      expect(columns).toContain('space');
      expect(columns).not.toContain('id');

      const rows = await d.query<{ space: string; core_hash: string }>(
        'select space, core_hash from prisma_contract.marker',
      );
      expect(rows.rows).toEqual([{ space: 'app', core_hash: 'sha256:dest' }]);
    },
  );

  it(
    "promotes a legacy single-row marker to the per-space shape (id PK -> space PK, row tagged 'app')",
    { timeout: testTimeout },
    async () => {
      const d = driver!;
      // Set up the legacy schema by hand, then seed a single row.
      await executeStatement(d, ensurePrismaContractSchemaStatement);
      await d.query(`create table prisma_contract.marker (
        id smallint primary key default 1,
        core_hash text not null,
        profile_hash text not null,
        contract_json jsonb,
        canonical_version int,
        updated_at timestamptz not null default now(),
        app_tag text,
        meta jsonb not null default '{}',
        invariants text[] not null default '{}'
      )`);
      await d.query(
        `insert into prisma_contract.marker (id, core_hash, profile_hash)
         values (1, 'sha256:legacy', 'sha256:profile-legacy')`,
      );
      await executeStatement(d, ensureLedgerTableStatement);

      await applyMigration(d);

      const pk = await fetchPkColumns(d);
      expect(pk).toEqual(['space']);

      const columns = await fetchColumnNames(d);
      expect(columns).toContain('space');
      expect(columns).not.toContain('id');

      const rows = await d.query<{
        space: string;
        core_hash: string;
        profile_hash: string;
      }>('select space, core_hash, profile_hash from prisma_contract.marker order by space');
      expect(rows.rows).toEqual([
        {
          space: 'app',
          core_hash: 'sha256:legacy',
          profile_hash: 'sha256:profile-legacy',
        },
      ]);
    },
  );

  it(
    'is idempotent across repeated applications (boot N+1 produces no schema or row change)',
    { timeout: testTimeout },
    async () => {
      const d = driver!;
      // Start in the legacy shape, migrate once, then migrate again.
      await executeStatement(d, ensurePrismaContractSchemaStatement);
      await d.query(`create table prisma_contract.marker (
        id smallint primary key default 1,
        core_hash text not null,
        profile_hash text not null,
        contract_json jsonb,
        canonical_version int,
        updated_at timestamptz not null default now(),
        app_tag text,
        meta jsonb not null default '{}',
        invariants text[] not null default '{}'
      )`);
      await d.query(
        `insert into prisma_contract.marker (id, core_hash, profile_hash)
         values (1, 'sha256:legacy', 'sha256:profile-legacy')`,
      );
      await executeStatement(d, ensureLedgerTableStatement);

      await applyMigration(d);
      const firstColumns = await fetchColumnNames(d);
      const firstPk = await fetchPkColumns(d);
      const firstRow = await d.query<{ space: string; core_hash: string }>(
        'select space, core_hash from prisma_contract.marker',
      );

      await applyMigration(d);
      const secondColumns = await fetchColumnNames(d);
      const secondPk = await fetchPkColumns(d);
      const secondRow = await d.query<{ space: string; core_hash: string }>(
        'select space, core_hash from prisma_contract.marker',
      );

      expect(secondColumns).toEqual(firstColumns);
      expect(secondPk).toEqual(firstPk);
      expect(secondRow.rows).toEqual(firstRow.rows);
    },
  );
});
