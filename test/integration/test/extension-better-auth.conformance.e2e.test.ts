/**
 * BetterAuth's official adapter conformance suites against
 * `prismaNextAdapter` over PGlite: the normal CRUD suite, the joins suite
 * (native join path — `experimental.joins`), the auth-flow suite (real
 * `betterAuth()` sign-up / sign-in / session / reset flows), and the
 * transactions suite. `runMigrations` uses the framework CLI path (emit →
 * plan → db init; idempotent at head) — no manual SQL, no ORM-side DDL.
 *
 * Disabled tests fall into exactly four documented categories, each
 * through the harness's own `disableTests` mechanism with per-test
 * reasons below:
 *
 * 1. Non-goal surfaces — plugin tables, `additionalFields`, renamed
 *    models/fields: mutating the managed contract space's schema is a
 *    project non-goal; the adapter rejects those surfaces with typed
 *    errors instead.
 * 2. Harness `generateId` leak — upstream harness bug precedent (the
 *    shipped joins suite omits the test for the same reason).
 * 3. Decode-dependent joins (TML-3015) — to-many include payloads
 *    currently bypass the codec decode boundary in `sql-orm-client`, so
 *    joined rows carry raw JSON strings for timestamptz cells. These
 *    re-enable once the TML-3015 fix lands on main.
 * 4. Upstream transaction-wrapper bug — the harness's suite wrapper
 *    nulls `adapter.transaction` after its first wrap and re-wraps per
 *    property access, dropping a provided transaction implementation
 *    (reference adapters skip via `transaction: false`; our own
 *    rollback coverage lives in the extension package's tests).
 */
import {
  authFlowTestSuite,
  joinsTestSuite,
  normalTestSuite,
  testAdapter,
  transactionsTestSuite,
} from '@better-auth/test-utils/adapter';
import { prismaNextAdapter } from '@prisma-next/extension-better-auth/adapter';
import { setupBetterAuthTestApp } from './extension-better-auth.harness.helpers';

const app = await setupBetterAuthTestApp();

/**
 * Non-goal surfaces (per the extension's contract): plugin tables
 * (`testModel`, `oneToOneTable`), `additionalFields`, and renamed
 * models/fields require mutating the managed contract space's schema,
 * which this extension deliberately does not support — the adapter
 * rejects unknown models/fields with typed errors instead.
 */
const NON_GOAL_TESTS = {
  // Leaks `generateId: () => 'MOCK-ID'` into subsequent tests' options
  // (never restored), which collides on the primary key — the shipped
  // joins suite omits this test for the same reason.
  'create - should use generateId if provided': true,
  // plugin table (testModel / oneToOneTable)
  'create - should return null for nullable foreign keys': true,
  'findOne - should select fields with one-to-one join': true,
  'findOne - should return an object for one-to-one joins': true,
  'findOne - should work with both one-to-one and one-to-many joins': true,
  'findOne - should return null for failed base model lookup that has joins': true,
  'findOne - should join a model with modified field name': true,
  'findOne - multiple joins should return result even when some joined tables have no matching rows': true,
  "findOne - should return null for one-to-one join when joined record doesn't exist": true,
  'findMany - should select fields with one-to-one join': true,
  'findMany - should find many with one-to-one join': true,
  'findMany - should find many with both one-to-one and one-to-many joins': true,
  "findMany - should return empty array when base records don't exist with joins": true,
  "findMany - should return null for one-to-one join when joined records don't exist": true,
  'findMany - should handle mixed joins correctly when some are missing': true,
  'create - should support arrays': true,
  'create - should support json': true,
  // additionalFields on user/session
  'create - should apply default values to fields': true,
  'findOne - should not apply defaultValue if value not found': true,
  'findOne - should find a model with additional fields': true,
  'findMany - should find many with join and sortBy': true,
  'findMany - should find many models with sortBy': true,
  'findMany - should find many models with sortBy and offset': true,
  'findMany - should find many models with sortBy and limit': true,
  'findMany - should find many models with sortBy and limit and offset': true,
  'findMany - should find many models with sortBy and limit and offset and where': true,
  'deleteMany - should delete many models with numeric values': true,
  // renamed models / fields
  'findOne - should find a model with modified model name': true,
  'findOne - should find a model with modified field name': true,
  'findOne - backwards join with modified field name (session base, users-table join)': true,
} as const;

const AUTH_FLOW_NON_GOAL_TESTS = {
  'should sign up with additional fields': true,
} as const;

/**
 * Decode-dependent joins (TML-3015): to-many include payloads bypass the
 * codec decode boundary, so the native join path surfaces timestamptz
 * cells as raw JSON strings (`2026-…+00:00`) where BetterAuth expects
 * `Date`s. Applied to the joins suite only — the same-named tests in the
 * normal suite run the fallback join path, which decodes at top level and
 * passes. Re-enable when the TML-3015 fix merges.
 */
const DECODE_DEPENDENT_JOIN_TESTS = {
  'findOne - should find a model with join': true,
  'findOne - should select fields with one-to-many join': true,
  'findOne - should select fields with multiple joins': true,
  'findOne - should perform backwards joins': true,
  'findOne - should return an array for one-to-many joins': true,
  'findMany - should find many models with join': true,
  'findMany - should select fields with one-to-many join': true,
  'findMany - should select fields with multiple joins': true,
} as const;

/**
 * Upstream @better-auth/test-utils bug: the suite wrapper nulls
 * `adapter.transaction` after its first wrap and re-wraps per property
 * access, dropping the provided transaction implementation — the handler
 * is never invoked, so rollback cannot be observed. Reference adapters
 * skip this suite via `transaction: false`; our own rollback proof lives
 * in `packages/3-extensions/better-auth/test/adapter-advanced.test.ts`.
 */
const UPSTREAM_TRANSACTION_WRAPPER_TESTS = {
  'transaction - should rollback failing transaction': true,
} as const;

const { execute } = await testAdapter({
  adapter: () => prismaNextAdapter(app.client),
  runMigrations: async () => {
    await app.runMigrations();
  },
  tests: [
    normalTestSuite({ disableTests: NON_GOAL_TESTS }),
    joinsTestSuite({ disableTests: { ...NON_GOAL_TESTS, ...DECODE_DEPENDENT_JOIN_TESTS } }),
    authFlowTestSuite({ disableTests: AUTH_FLOW_NON_GOAL_TESTS }),
    transactionsTestSuite({ disableTests: UPSTREAM_TRANSACTION_WRAPPER_TESTS }),
  ],
  async onFinish() {
    await app.teardown();
  },
});

execute();
