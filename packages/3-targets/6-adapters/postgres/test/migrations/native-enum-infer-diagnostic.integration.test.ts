import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  createDriver,
  createTestDatabase,
  familyInstance,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

/**
 * Proves that the native-enum inference diagnostic fires on the REAL introspect→infer path.
 *
 * The spec forbids `contract infer` from silently rendering a native Postgres enum column
 * as Unsupported(...). Instead, it must throw an actionable diagnostic naming the enum type.
 * This test creates a real native enum type in the database (via PGlite), calls the full
 * introspect→infer path, and asserts the diagnostic fires with the type name.
 */
describe('native enum inference diagnostic — end-to-end PGlite', { concurrent: false }, () => {
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
  }, testTimeout);

  it('throws naming the native enum type when inferring from a schema that contains one', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(`CREATE TYPE role_t AS ENUM ('admin', 'user')`);
    await driver!.query(`CREATE TABLE "User" (id text PRIMARY KEY, role role_t NOT NULL)`);

    const schemaIR = await familyInstance.introspect({ driver: driver!, contract });
    expect(() => familyInstance.inferPslContract(schemaIR)).toThrow(
      /contract infer:.*native Postgres enum type.*role_t/i,
    );
  });

  it('throws naming all native enum types when multiple are present', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(`CREATE TYPE role_t AS ENUM ('admin', 'user')`);
    await driver!.query(`CREATE TYPE status_t AS ENUM ('active', 'inactive')`);
    await driver!.query(
      `CREATE TABLE "User" (id text PRIMARY KEY, role role_t NOT NULL, status status_t NOT NULL)`,
    );

    const schemaIR = await familyInstance.introspect({ driver: driver!, contract });
    expect(() => familyInstance.inferPslContract(schemaIR)).toThrow(/role_t/);
    expect(() => familyInstance.inferPslContract(schemaIR)).toThrow(/status_t/);
  });

  it('succeeds when no native enum types are present', { timeout: testTimeout }, async () => {
    await driver!.query(
      `CREATE TABLE "User" (id text PRIMARY KEY, role text NOT NULL CHECK (role IN ('admin', 'user')))`,
    );

    const schemaIR = await familyInstance.introspect({ driver: driver!, contract });
    expect(() => familyInstance.inferPslContract(schemaIR)).not.toThrow();
  });
});
