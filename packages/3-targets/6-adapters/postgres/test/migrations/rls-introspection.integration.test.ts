import {
  computeContentHash,
  normalizePredicate,
} from '@prisma-next/target-postgres/rls-canonicalize';
import { PostgresRlsPolicy } from '@prisma-next/target-postgres/types';
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

  it('returns rlsPolicies with recomputed wire name and correct namespaceId', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE posts (id int PRIMARY KEY, user_id int NOT NULL)');
    await driver!.query('ALTER TABLE posts ENABLE ROW LEVEL SECURITY');

    // Compute the expected hash first so we can create a policy with the correct
    // content-addressed name — this is the happy-path case where the DB policy
    // was created by the framework and has the correct suffix already.
    const expectedHash = computeContentHash({
      using: normalizePredicate('user_id = 1'),
      roles: ['public'],
      operation: 'select',
      permissive: true,
    });
    await driver!.query(
      `CREATE POLICY posts_select_own_${expectedHash} ON posts
         AS PERMISSIVE FOR SELECT TO PUBLIC
         USING (user_id = 1)`,
    );

    const schema = await familyInstance.introspect({ driver: driver! });

    const pg = schema.annotations?.['pg'] as Record<string, unknown> | undefined;
    const rlsPolicies = pg?.['rlsPolicies'] as PostgresRlsPolicy[] | undefined;

    expect(rlsPolicies).toBeDefined();
    expect(Array.isArray(rlsPolicies)).toBe(true);
    expect(rlsPolicies!.length).toBeGreaterThanOrEqual(1);

    const policy = rlsPolicies!.find((p) => p.tableName === 'posts');
    expect(policy).toBeDefined();
    expect(policy).toBeInstanceOf(PostgresRlsPolicy);

    // The introspector recognises the suffix and recomputes the wire name from
    // the catalog body — the result matches what the framework would produce.
    expect(policy!.name).toBe(`posts_select_own_${expectedHash}`);
    expect(policy!.prefix).toBe('posts_select_own');

    // namespaceId must reflect the real schema, not UNBOUND_NAMESPACE_ID.
    expect(policy!.namespaceId).toBe('public');
    expect(policy!.operation).toBe('select');
    expect(policy!.permissive).toBe(true);
  });

  it('returns rlsEnabledByTable map with per-table RLS state', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE rls_on (id int PRIMARY KEY)');
    await driver!.query('CREATE TABLE rls_off (id int PRIMARY KEY)');
    await driver!.query('ALTER TABLE rls_on ENABLE ROW LEVEL SECURITY');

    const schema = await familyInstance.introspect({ driver: driver! });

    const pg = schema.annotations?.['pg'] as Record<string, unknown> | undefined;
    const rlsEnabledByTable = pg?.['rlsEnabledByTable'] as Record<string, boolean> | undefined;

    expect(rlsEnabledByTable).toBeDefined();
    expect(rlsEnabledByTable!['rls_on']).toBe(true);
    expect(rlsEnabledByTable!['rls_off']).toBe(false);
  });

  it('returns roles excluding system roles', {
    timeout: testTimeout,
  }, async () => {
    const schema = await familyInstance.introspect({ driver: driver! });

    const pg = schema.annotations?.['pg'] as Record<string, unknown> | undefined;
    const roles = (pg?.['roles'] ?? []) as Array<{ name: string }>;

    // roles may be empty if the only non-system role is 'postgres' (filtered out).
    expect(Array.isArray(roles)).toBe(true);

    for (const role of roles) {
      expect(role.name).not.toMatch(/^pg_/);
    }
  });
});
