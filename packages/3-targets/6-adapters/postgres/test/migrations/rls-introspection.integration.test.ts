import {
  computeContentHash,
  normalizePredicate,
} from '@prisma-next/target-postgres/rls-canonicalize';
import { isPostgresSchemaIR, PostgresRlsPolicy } from '@prisma-next/target-postgres/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

describe.sequential('RLS introspection', () => {
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
  }, testTimeout);

  it('returns rlsPolicies with verbatim policyname and correct namespaceId', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE posts (id int PRIMARY KEY, user_id int NOT NULL)');
    await driver!.query('ALTER TABLE posts ENABLE ROW LEVEL SECURITY');

    const expectedHash = computeContentHash({
      using: normalizePredicate('user_id = 1'),
      roles: ['public'],
      operation: 'select',
      permissive: true,
    });
    const wireName = `posts_select_own_${expectedHash}`;
    await driver!.query(
      `CREATE POLICY ${wireName} ON posts
         AS PERMISSIVE FOR SELECT TO PUBLIC
         USING (user_id = 1)`,
    );

    const schema = await familyInstance.introspect({ driver: driver! });

    expect(isPostgresSchemaIR(schema)).toBe(true);
    if (!isPostgresSchemaIR(schema)) return;

    const { rlsPolicies } = schema;

    expect(rlsPolicies).toBeDefined();
    expect(Array.isArray(rlsPolicies)).toBe(true);
    expect(rlsPolicies.length).toBeGreaterThanOrEqual(1);

    const policy = rlsPolicies.find((p) => p.tableName === 'posts');
    expect(policy).toBeDefined();
    expect(policy).toBeInstanceOf(PostgresRlsPolicy);

    // Introspect reads policyname verbatim from pg_policies — no hash recompute.
    expect(policy!.name).toBe(wireName);
    expect(policy!.prefix).toBe('posts_select_own');

    // namespaceId must reflect the real schema, not UNBOUND_NAMESPACE_ID.
    expect(policy!.namespaceId).toBe('public');
    expect(policy!.operation).toBe('select');
    expect(policy!.permissive).toBe(true);
  });

  it('returns roles excluding system roles', {
    timeout: testTimeout,
  }, async () => {
    const schema = await familyInstance.introspect({ driver: driver! });

    expect(isPostgresSchemaIR(schema)).toBe(true);
    if (!isPostgresSchemaIR(schema)) return;

    const { roles } = schema;

    // roles may be empty if the only non-system role is 'postgres' (filtered out).
    expect(Array.isArray(roles)).toBe(true);

    for (const role of roles) {
      expect(role.name).not.toMatch(/^pg_/);
    }
  });
});
