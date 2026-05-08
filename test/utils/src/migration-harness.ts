/**
 * Spike — multi-target migration test harness.
 *
 * The shape of a migration test is target-agnostic: provision a fresh
 * database, optionally seed it from an origin contract, plan + run a
 * destination contract on top of the live schema, introspect, verify,
 * and hand the result to the test's assertion callback. Everything that
 * differs between targets (contract types, schema-IR types, drivers,
 * planner/runner/verify wiring) is hidden behind `TestTargetAdapter`.
 *
 * This sits in `@prisma-next/test-utils` so it can be reused across
 * families. Concrete adapters live next to their target packages.
 *
 * The harness deliberately avoids importing types from
 * `@prisma-next/framework-components` to keep test-utils dependency-free
 * (otherwise we'd introduce a build-graph cycle via `@prisma-next/contract`,
 * which devDepends on test-utils). Policy is carried as a generic
 * `TPolicy` so the adapter's real `MigrationOperationPolicy` flows in
 * unchanged. Verify results are described by a structural supertype
 * (`VerifyDatabaseSchemaResultLike`) since the harness reads `ok` and
 * `schema.issues`.
 */

/**
 * Structural supertype of `@prisma-next/framework-components`'s
 * `VerifyDatabaseSchemaResult`. Real values are assignable to this.
 */
export interface VerifyDatabaseSchemaResultLike {
  readonly ok: boolean;
  readonly schema: {
    readonly issues: readonly { readonly kind: string; readonly message: string }[];
  };
}

export interface TestTargetAdapter<TContract, TSchemaIR, TDriver, TPolicy> {
  readonly name: string;

  /**
   * Provision a fresh, empty database. The returned `cleanup` is invoked
   * unconditionally by the harness in a finally block.
   */
  setup(): Promise<{ driver: TDriver; cleanup: () => Promise<void> }>;

  /** Schema-IR value representing "no schema yet". */
  readonly emptySchema: TSchemaIR;

  /**
   * Plan + run a contract against `currentSchema`. Encapsulates the family-
   * specific planner/runner wiring so the harness never sees descriptors
   * directly. Throws on plan or run failure.
   */
  applyContract(input: {
    driver: TDriver;
    currentSchema: TSchemaIR;
    contract: TContract;
    fromContract: TContract | null;
    /**
     * Policy for this step. The harness passes `undefined` for the origin
     * step and the user's policy (if any) for the destination step; the
     * adapter substitutes its own permissive default for `undefined`.
     */
    policy: TPolicy | undefined;
    /** True for the origin pass; lets the adapter choose an init policy. */
    isInitial: boolean;
  }): Promise<{
    readonly plannedOperationIds: readonly string[];
    readonly operationsExecuted: number;
  }>;

  introspect(driver: TDriver): Promise<TSchemaIR>;

  verify(input: {
    contract: TContract;
    schema: TSchemaIR;
    strict?: boolean;
  }): VerifyDatabaseSchemaResultLike;

  /**
   * Strip control tables/collections (e.g. `_prisma_marker`,
   * `_prisma_migrations`) from the schema before the assertion callback
   * sees it, so tests can assert on user shape without filtering.
   */
  filterUserSchema(schema: TSchemaIR): TSchemaIR;
}

export interface MigrationResult<TSchemaIR, TDriver> {
  readonly driver: TDriver;
  readonly schema: TSchemaIR;
  readonly operationsExecuted: number;
  readonly plannedOperationIds: readonly string[];
}

export interface ApplyMigrationOptions<TContract, TDriver, TPolicy> {
  readonly origin?: TContract;
  readonly destination: TContract;
  readonly policy?: TPolicy;
  readonly seed?: (driver: TDriver) => Promise<void>;
}

/**
 * Run a migration end-to-end against a target and invoke the supplied
 * assertion callback with the introspected user schema and the driver.
 *
 * Type parameters are inferred from `target`, so callers write
 * `applyMigration(sqliteTestTarget, opts, cb)` and the contract / IR /
 * driver / policy types flow through.
 */
export async function applyMigration<TContract, TSchemaIR, TDriver, TPolicy>(
  target: TestTargetAdapter<TContract, TSchemaIR, TDriver, TPolicy>,
  options: ApplyMigrationOptions<TContract, TDriver, TPolicy>,
  runAssertions: (result: MigrationResult<TSchemaIR, TDriver>) => Promise<void>,
): Promise<void> {
  const { driver, cleanup } = await target.setup();
  try {
    let currentSchema = target.emptySchema;
    if (options.origin !== undefined) {
      await target.applyContract({
        driver,
        currentSchema,
        contract: options.origin,
        fromContract: null,
        policy: undefined,
        isInitial: true,
      });
      currentSchema = await target.introspect(driver);
    }

    if (options.seed !== undefined) {
      await options.seed(driver);
    }

    const { plannedOperationIds, operationsExecuted } = await target.applyContract({
      driver,
      currentSchema,
      contract: options.destination,
      fromContract: options.origin ?? null,
      policy: options.policy,
      isInitial: false,
    });

    const fresh = await target.introspect(driver);
    const verify = target.verify({ contract: options.destination, schema: fresh });
    if (!verify.ok) {
      const issues = verify.schema.issues.map((i) => `  - [${i.kind}] ${i.message}`).join('\n');
      throw new Error(`Schema verification failed:\n${issues}`);
    }

    await runAssertions({
      driver,
      schema: target.filterUserSchema(fresh),
      operationsExecuted,
      plannedOperationIds,
    });
  } finally {
    await cleanup();
  }
}
