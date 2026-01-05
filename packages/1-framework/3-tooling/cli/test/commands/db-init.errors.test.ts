import { describe, expect, it } from 'vitest';
import { errorRuntime } from '../../src/utils/cli-errors';
import { formatErrorOutput } from '../../src/utils/output';

/**
 * Tests for db-init error message formatting.
 *
 * These tests verify that error messages include helpful debugging information,
 * particularly the SQL statement when a migration operation fails during execution.
 */
describe('db-init error formatting', () => {
  describe('RUNNER_FAILED with SQL metadata', () => {
    it('includes SQL statement in error message when available', () => {
      // Simulate the error structure that mapDbInitFailure creates for RUNNER_FAILED
      const sql = 'CREATE TABLE "public"."user" ("role" "Role" NOT NULL)';
      const error = errorRuntime(
        'Operation table.user failed during execution: create table "user"',
        {
          why: `type "role" does not exist\n  SQL: ${sql}`,
          fix: 'Fix the schema mismatch (db init is additive-only), or drop/reset the database and re-run `prisma-next db init`',
          meta: {
            code: 'RUNNER_FAILED',
            operationId: 'table.user',
            stepDescription: 'create table "user"',
            sql,
          },
        },
      );

      const envelope = error.toEnvelope();
      const formatted = formatErrorOutput(envelope, { color: false });

      // Verify the error message contains the SQL
      expect(formatted).toContain('SQL:');
      expect(formatted).toContain('CREATE TABLE');
    });

    it('formats error message correctly without SQL when not available', () => {
      const error = errorRuntime(
        'Operation table.user failed during execution: create table "user"',
        {
          why: 'Connection timeout',
          fix: 'Check database connectivity and retry',
          meta: {
            code: 'RUNNER_FAILED',
            operationId: 'table.user',
          },
        },
      );

      const envelope = error.toEnvelope();
      const formatted = formatErrorOutput(envelope, { color: false });

      expect(formatted).toContain('Connection timeout');
      expect(formatted).not.toContain('SQL:');
    });
  });
});
