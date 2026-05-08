import { describe } from 'vitest';
import {
  type ApplyMigrationOptions,
  applyMigration,
  type MigrationResult,
  type TestTargetAdapter,
} from './migration-harness';

/**
 * Fan-out helper for running the same migration scenario across multiple
 * targets that share a contract type and schema-IR type (e.g., SQLite +
 * Postgres, both typed against `Contract<SqlStorage>` and `SqlSchemaIR`).
 *
 * The shape problem this solves: `applyMigration` is invariant in its
 * `TDriver` parameter, so a heterogeneous-target array typed as
 * `[sqliteTestTarget, postgresTestTarget]` widens to a union TypeScript
 * will not distribute over the call. `describeAcrossTargets` accepts a
 * map of cases, generates one `describe` block per case (with the target
 * name appended for failure attribution), and exposes a closure-typed
 * `runMigration` that hides the driver behind `unknown` — keeping shared
 * assertions portable.
 *
 * Tests that need driver-specific assertions (raw SQL, parameter
 * placeholders) should call `applyMigration(target, ...)` directly per
 * target instead. The fan-out is for schema-IR-level shared assertions.
 */

/** Options accepted by the scoped `runMigration` callback (no `seed` — that needs the concrete driver). */
export interface ScopedMigrationOptions<TContract, TPolicy> {
  readonly origin?: TContract;
  readonly destination: TContract;
  readonly policy?: TPolicy;
}

/** Result handed to scoped assertions — driver omitted. */
export type ScopedMigrationResult<TSchemaIR> = Omit<MigrationResult<TSchemaIR, unknown>, 'driver'>;

export type RunMigration<TContract, TSchemaIR, TPolicy> = (
  options: ScopedMigrationOptions<TContract, TPolicy>,
  assertions: (result: ScopedMigrationResult<TSchemaIR>) => Promise<void>,
) => Promise<void>;

export interface FanoutCase<TContract, TSchemaIR, TPolicy> {
  readonly target: TestTargetAdapter<TContract, TSchemaIR, unknown, TPolicy>;
}

export interface FanoutContext<TContract, TSchemaIR, TPolicy> {
  /** Current target name (key from the `cases` map). */
  readonly name: string;
  readonly runMigration: RunMigration<TContract, TSchemaIR, TPolicy>;
}

/**
 * Generate one `describe(`${groupName} — ${name}`)` per target case and
 * call `body` inside each, with a `runMigration` closure bound to the
 * current target. Test files use `it`/`expect` from vitest as normal
 * inside `body`.
 */
export function describeAcrossTargets<TContract, TSchemaIR, TPolicy>(
  groupName: string,
  cases: Record<string, FanoutCase<TContract, TSchemaIR, TPolicy>>,
  body: (ctx: FanoutContext<TContract, TSchemaIR, TPolicy>) => void,
): void {
  for (const [name, { target }] of Object.entries(cases)) {
    describe(`${groupName} — ${name}`, () => {
      const runMigration: RunMigration<TContract, TSchemaIR, TPolicy> = (options, assertions) => {
        const fullOptions: ApplyMigrationOptions<TContract, unknown, TPolicy> = {
          destination: options.destination,
          ...(options.origin !== undefined ? { origin: options.origin } : {}),
          ...(options.policy !== undefined ? { policy: options.policy } : {}),
        };
        return applyMigration(
          target,
          fullOptions,
          async ({ schema, operationsExecuted, plannedOperationIds }) =>
            assertions({ schema, operationsExecuted, plannedOperationIds }),
        );
      };
      body({ name, runMigration });
    });
  }
}
