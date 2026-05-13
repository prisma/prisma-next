/**
 * Postgres index introspection populates `SqlIndexIR.type` and
 * `SqlIndexIR.options` from `pg_am.amname` and `pg_class.reloptions`.
 *
 * Without these fields the migration planner would treat any contract
 * index whose `type` is set as different from any introspected index on
 * the same columns — forcing a spurious DROP+CREATE on every plan even
 * when the live index already matches the contract.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

describe.sequential('Postgres index introspection — type and options', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
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

  it('leaves type and options unset on a default btree index', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE doc (id int PRIMARY KEY, body text NOT NULL)');
    await driver!.query('CREATE INDEX doc_body_idx ON doc (body)');

    const schema = await familyInstance.introspect({ driver: driver! });
    const indexes = schema.tables['doc']?.indexes ?? [];
    const idx = indexes.find((i) => i.name === 'doc_body_idx');
    expect(idx).toBeDefined();
    expect(idx?.type).toBeUndefined();
    expect(idx?.options).toBeUndefined();
  });

  it('populates type for non-default index methods (gin)', { timeout: testTimeout }, async () => {
    await driver!.query('CREATE TABLE doc (id int PRIMARY KEY, tags jsonb NOT NULL)');
    await driver!.query('CREATE INDEX doc_tags_gin_idx ON doc USING gin (tags)');

    const schema = await familyInstance.introspect({ driver: driver! });
    const idx = schema.tables['doc']?.indexes.find((i) => i.name === 'doc_tags_gin_idx');
    expect(idx).toBeDefined();
    expect(idx?.type).toBe('gin');
    expect(idx?.options).toBeUndefined();
  });

  it('populates options from reloptions when WITH parameters are set', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE doc (id int PRIMARY KEY, body text NOT NULL)');
    await driver!.query('CREATE INDEX doc_body_idx ON doc (body) WITH (fillfactor = 70)');

    const schema = await familyInstance.introspect({ driver: driver! });
    const idx = schema.tables['doc']?.indexes.find((i) => i.name === 'doc_body_idx');
    expect(idx).toBeDefined();
    // btree is the Postgres default → type is dropped to undefined
    expect(idx?.type).toBeUndefined();
    // reloptions are returned as raw text; the family verifier compares
    // contract values to introspected strings via String() coercion.
    expect(idx?.options).toEqual({ fillfactor: '70' });
  });

  it('populates both type and options together (gin with fastupdate)', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE doc (id int PRIMARY KEY, tags jsonb NOT NULL)');
    await driver!.query(
      'CREATE INDEX doc_tags_gin_idx ON doc USING gin (tags) WITH (fastupdate = false)',
    );

    const schema = await familyInstance.introspect({ driver: driver! });
    const idx = schema.tables['doc']?.indexes.find((i) => i.name === 'doc_tags_gin_idx');
    expect(idx).toBeDefined();
    expect(idx?.type).toBe('gin');
    expect(idx?.options).toEqual({ fastupdate: 'false' });
  });
});
