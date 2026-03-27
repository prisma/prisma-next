/**
 * Migration Status Diagnostics
 *
 * Tests the summary line, diagnostic messages, and hints produced by
 * `migration status` across distinct user scenarios. Each test sets up
 * real state (contract, migrations on disk, DB marker) and asserts on
 * the textual output — not implementation internals.
 *
 * Why journey tests? `migration status` synthesizes information from three
 * independent sources (contract on disk, migration graph on disk, DB marker)
 * and must produce actionable guidance for each combination. Unit tests
 * cover the individual functions; these tests verify the *user-visible*
 * output for realistic scenarios end-to-end.
 */

import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbUpdate,
  runMigrationApply,
  runMigrationPlan,
  runMigrationRef,
  runMigrationStatus,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('migration status diagnostics', () => {
    // -----------------------------------------------------------------------
    // Offline scenarios (no database)
    // -----------------------------------------------------------------------

    /**
     * Scenario: brand-new project, nothing set up yet.
     *
     * The user hasn't emitted a contract or planned any migrations.
     * Status should report the empty state without errors — this is the
     * starting point, not an error condition.
     */
    it('no migrations, no contract — reports empty', async () => {
      const ctx: JourneyContext = setupJourney({ createTempDir });

      const status = await runMigrationStatus(ctx);
      const out = stripAnsi(status.stdout);

      expect(status.exitCode).toBe(0);
      expect(out).toContain('No migrations found');
    });

    /**
     * Scenario: user emitted a contract but hasn't run `migration plan` yet.
     *
     * The contract exists on disk so we know what the schema *should* look
     * like, but no migration has been planned. The user needs to be told
     * to run `migration plan` — this is the most common next step after
     * initial contract authoring.
     */
    it('no migrations, contract exists — nudges toward migration plan', async () => {
      const ctx: JourneyContext = setupJourney({ createTempDir });

      const emit = await runContractEmit(ctx);
      expect(emit.exitCode, 'emit succeeds').toBe(0);

      const status = await runMigrationStatus(ctx);
      const out = stripAnsi(status.stdout);

      expect(status.exitCode).toBe(0);
      expect(out).toContain('No migrations found');
      expect(out).toContain('No migration exists for the current contract');
      expect(out).toContain('migration plan');
    });

    /**
     * Scenario: migrations have been planned but there's no database
     * connection (offline mode, e.g. CI without DB access).
     *
     * The user should still see the migration graph and a count of
     * migrations on disk. No applied/pending/unreachable statuses are
     * possible without a DB, so the output is purely informational —
     * "here's what exists."
     */
    it('offline with migrations — reports count on disk', async () => {
      const ctx: JourneyContext = setupJourney({ createTempDir });

      const emit = await runContractEmit(ctx);
      expect(emit.exitCode, 'emit').toBe(0);
      const plan = await runMigrationPlan(ctx, ['--name', 'init']);
      expect(plan.exitCode, 'plan').toBe(0);

      const status = await runMigrationStatus(ctx);
      const out = stripAnsi(status.stdout);

      expect(status.exitCode).toBe(0);
      expect(out).toContain('1 migration(s) on disk');
      // No status legend — offline mode can't determine applied/pending/unreachable
      expect(out).not.toMatch(/[✓⧗✗] (applied|pending|unreachable)/);
    });

    // -----------------------------------------------------------------------
    // Online scenarios — each gets its own database to avoid cross-test
    // contamination (schema/marker from one test leaking into the next).
    // -----------------------------------------------------------------------

    /**
     * Scenario: migrations exist on disk but the database has never been
     * initialized (no marker row in prisma_contract.marker).
     *
     * This happens when a developer clones a repo with existing migrations
     * and connects to a fresh database. The key signal is the missing
     * marker — the user needs to run `migration apply` to bring the DB
     * up to date.
     */
    describe('fresh DB, migrations exist — MIGRATION.NO_MARKER', () => {
      const db = useDevDatabase();

      it(
        'emit → plan (no apply) → status warns about missing marker',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit = await runContractEmit(ctx);
          expect(emit.exitCode, 'emit').toBe(0);
          const plan = await runMigrationPlan(ctx, ['--name', 'init']);
          expect(plan.exitCode, 'plan').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stdout);

          expect(status.exitCode).toBe(0);
          expect(out).toContain('Database has not been initialized');
          expect(out).toContain('migration apply');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: the happy path — all planned migrations have been applied.
     *
     * The DB marker matches the graph's target node. There is nothing to do.
     * Status should confirm this clearly so the user knows they're safe.
     */
    describe('all applied — up to date', () => {
      const db = useDevDatabase();

      it(
        'emit → plan → apply → status reports up to date',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit = await runContractEmit(ctx);
          expect(emit.exitCode, 'emit').toBe(0);
          const plan = await runMigrationPlan(ctx, ['--name', 'init']);
          expect(plan.exitCode, 'plan').toBe(0);
          const apply = await runMigrationApply(ctx);
          expect(apply.exitCode, 'apply').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stdout);

          expect(status.exitCode).toBe(0);
          expect(out).toContain('up to date');
          expect(out).toMatch(/1 migration.* applied/);
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: the DB is behind — some migrations haven't been applied yet.
     *
     * This is the standard deployment scenario: a new migration was planned
     * (e.g. by a teammate) but hasn't been applied to this database. The
     * user needs to know how many migrations are pending and be told to
     * run `migration apply`.
     */
    describe('some pending — DATABASE_BEHIND', () => {
      const db = useDevDatabase();

      it(
        'emit → plan → apply → swap → emit → plan → status shows pending',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit base').toBe(0);
          const plan0 = await runMigrationPlan(ctx, ['--name', 'init']);
          expect(plan0.exitCode, 'plan init').toBe(0);
          const apply0 = await runMigrationApply(ctx);
          expect(apply0.exitCode, 'apply init').toBe(0);

          swapContract(ctx, 'contract-additive');
          const emit1 = await runContractEmit(ctx);
          expect(emit1.exitCode, 'emit v2').toBe(0);
          const plan1 = await runMigrationPlan(ctx, ['--name', 'add-field']);
          expect(plan1.exitCode, 'plan v2').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stdout);

          expect(status.exitCode).toBe(0);
          expect(out).toMatch(/1 pending migration/);
          expect(out).toContain('migration apply');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: the contract has been changed since the last migration was
     * planned — the contract hash doesn't appear anywhere in the graph.
     *
     * This typically means the developer edited their schema but forgot to
     * run `migration plan`. The DB is fully up to date with existing
     * migrations, but a new migration is needed for the latest contract.
     * The diagnostic should point toward `migration plan`, not `apply`.
     */
    describe('contract changed since last plan — CONTRACT.AHEAD', () => {
      const db = useDevDatabase();

      it(
        'emit → plan → apply → swap → emit (no plan) → status warns',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit').toBe(0);
          const plan0 = await runMigrationPlan(ctx, ['--name', 'init']);
          expect(plan0.exitCode, 'plan').toBe(0);
          const apply0 = await runMigrationApply(ctx);
          expect(apply0.exitCode, 'apply').toBe(0);

          swapContract(ctx, 'contract-additive');
          const emit1 = await runContractEmit(ctx);
          expect(emit1.exitCode, 'emit v2').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stdout);

          expect(status.exitCode).toBe(0);
          expect(out).toContain('Contract has changed since the last migration was planned');
          expect(out).toContain('migration plan');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: the database was updated directly via `db update` instead
     * of through the migration system.
     *
     * The DB marker now matches the current contract hash, but that hash
     * doesn't correspond to any node in the migration graph — the marker
     * was moved forward without a migration being applied. The user needs
     * to either plan a migration to formalize this state, or accept that
     * their migration history has a gap.
     */
    describe('DB updated directly — MARKER_NOT_IN_GRAPH', () => {
      const db = useDevDatabase();

      it(
        'emit → plan → apply → swap → emit → db update → status warns',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit').toBe(0);
          const plan0 = await runMigrationPlan(ctx, ['--name', 'init']);
          expect(plan0.exitCode, 'plan').toBe(0);
          const apply0 = await runMigrationApply(ctx);
          expect(apply0.exitCode, 'apply').toBe(0);

          swapContract(ctx, 'contract-additive');
          const emit1 = await runContractEmit(ctx);
          expect(emit1.exitCode, 'emit v2').toBe(0);
          const update = await runDbUpdate(ctx);
          expect(update.exitCode, 'db update').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stdout);

          expect(status.exitCode).toBe(0);
          expect(out).toContain('updated directly');
          expect(out).toContain('migration plan');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: the DB marker doesn't match any node in the migration
     * graph AND doesn't match the current contract. The database is at
     * an unknown state relative to both the migrations and the contract.
     *
     * This happens when someone ran `db update` or `db sign` to a
     * contract state, then changed the contract again (so marker ≠
     * contract) and there's no migration matching the marker either.
     * The command can't render meaningful applied/pending statuses, so
     * it bails out early with recovery hints: sign, update, infer, or
     * verify. This is the most disoriented state a user can be in.
     */
    describe('marker off-graph, mismatches contract — bail-out with recovery hints', () => {
      const db = useDevDatabase();

      it(
        'emit → plan → apply → swap → db update → swap again → emit → status bails out',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          // Base: emit → plan → apply
          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit').toBe(0);
          const plan0 = await runMigrationPlan(ctx, ['--name', 'init']);
          expect(plan0.exitCode, 'plan').toBe(0);
          const apply0 = await runMigrationApply(ctx);
          expect(apply0.exitCode, 'apply').toBe(0);

          // Push marker off-graph via db update to contract-additive
          swapContract(ctx, 'contract-additive');
          const emit1 = await runContractEmit(ctx);
          expect(emit1.exitCode, 'emit v2').toBe(0);
          const update = await runDbUpdate(ctx);
          expect(update.exitCode, 'db update').toBe(0);

          // Now swap to a *third* contract so marker ≠ contract
          swapContract(ctx, 'contract-phone');
          const emit2 = await runContractEmit(ctx);
          expect(emit2.exitCode, 'emit v3').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stdout);

          expect(status.exitCode).toBe(0);
          expect(out).toContain('updated outside the migration system');
          expect(out).toContain('db update');
          expect(out).toContain('contract infer');
          expect(out).toContain('db verify');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: happy path, verified through `--json` output.
     *
     * The JSON envelope is the primary interface for agents and
     * programmatic consumers. Internal fields (graph, bundles,
     * edgeStatuses, activeRefHash, activeRefName, diverged) must be
     * stripped — they're implementation details that would create a
     * brittle public API. The JSON should contain only the fields a
     * consumer needs to decide what to do next.
     */
    describe('JSON output shape — strips internal fields', () => {
      const db = useDevDatabase();

      it(
        'emit → plan → apply → status --json contains public fields only',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit = await runContractEmit(ctx);
          expect(emit.exitCode, 'emit').toBe(0);
          const plan = await runMigrationPlan(ctx, ['--name', 'init']);
          expect(plan.exitCode, 'plan').toBe(0);
          const apply = await runMigrationApply(ctx);
          expect(apply.exitCode, 'apply').toBe(0);

          const status = await runMigrationStatus(ctx, ['--json']);
          expect(status.exitCode).toBe(0);
          const json = parseJsonOutput<Record<string, unknown>>(status);

          // Public fields present
          expect(json).toHaveProperty('ok', true);
          expect(json).toHaveProperty('mode', 'online');
          expect(json).toHaveProperty('migrations');
          expect(json).toHaveProperty('targetHash');
          expect(json).toHaveProperty('contractHash');
          expect(json).toHaveProperty('summary');
          expect(json).toHaveProperty('diagnostics');
          expect(json).toHaveProperty('markerHash');

          // Internal fields stripped
          expect(json).not.toHaveProperty('graph');
          expect(json).not.toHaveProperty('bundles');
          expect(json).not.toHaveProperty('edgeStatuses');
          expect(json).not.toHaveProperty('activeRefHash');
          expect(json).not.toHaveProperty('activeRefName');
          expect(json).not.toHaveProperty('diverged');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: two teammates branched migrations from the same point,
     * creating a diamond/fork in the graph, and no ref has been set.
     *
     * The migration graph has two reachable leaves from the marker but
     * the current contract doesn't match either leaf (we swap to a third
     * contract variant to ensure this). Without a ref to disambiguate,
     * the system can't decide which path to apply. The user must set a
     * ref or choose a target explicitly.
     */
    describe('divergent graph without ref — MIGRATION.DIVERGED', () => {
      const db = useDevDatabase();

      it(
        'two branches from same base → status warns about multiple paths',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit base').toBe(0);
          const plan0 = await runMigrationPlan(ctx, ['--name', 'init', '--json']);
          expect(plan0.exitCode, 'plan init').toBe(0);
          const baseHash = parseJsonOutput<{ to: string }>(plan0).to;
          const apply0 = await runMigrationApply(ctx);
          expect(apply0.exitCode, 'apply init').toBe(0);

          swapContract(ctx, 'contract-phone');
          const emitA = await runContractEmit(ctx);
          expect(emitA.exitCode, 'emit branch A').toBe(0);
          const planA = await runMigrationPlan(ctx, ['--name', 'add-phone', '--from', baseHash]);
          expect(planA.exitCode, 'plan branch A').toBe(0);

          swapContract(ctx, 'contract-bio');
          const emitB = await runContractEmit(ctx);
          expect(emitB.exitCode, 'emit branch B').toBe(0);
          const planB = await runMigrationPlan(ctx, ['--name', 'add-bio', '--from', baseHash]);
          expect(planB.exitCode, 'plan branch B').toBe(0);

          // Swap to a contract that doesn't match either leaf so the
          // status command can't auto-resolve to one branch.
          swapContract(ctx, 'contract-additive');
          const emitC = await runContractEmit(ctx);
          expect(emitC.exitCode, 'emit neutral').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stdout);

          expect(status.exitCode).toBe(0);
          expect(out).toContain('multiple valid migration paths');
          expect(out).toContain('--ref');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: DB marker is on branch A, but the ref points at branch B.
     * There is no path between them — the DB went down a different fork
     * than the one the ref targets.
     *
     * This happens when a developer applied one teammate's migration
     * locally but the team's ref points at a different branch. The user
     * needs to know that their DB and the ref have diverged — there's no
     * sequence of applies that will get them from where they are to where
     * the ref says they should be.
     */
    describe('marker on wrong branch — no path to ref', () => {
      const db = useDevDatabase();

      it(
        'apply branch A, ref points at branch B → no path between marker and ref',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit base').toBe(0);
          const plan0 = await runMigrationPlan(ctx, ['--name', 'init', '--json']);
          expect(plan0.exitCode, 'plan init').toBe(0);
          const baseHash = parseJsonOutput<{ to: string }>(plan0).to;
          const apply0 = await runMigrationApply(ctx);
          expect(apply0.exitCode, 'apply init').toBe(0);

          // Branch A: plan + apply
          swapContract(ctx, 'contract-phone');
          const emitA = await runContractEmit(ctx);
          expect(emitA.exitCode, 'emit A').toBe(0);
          const planA = await runMigrationPlan(ctx, ['--name', 'add-phone', '--from', baseHash]);
          expect(planA.exitCode, 'plan A').toBe(0);
          const applyA = await runMigrationApply(ctx);
          expect(applyA.exitCode, 'apply A').toBe(0);

          // Branch B: plan (don't apply) + set ref to B's target
          swapContract(ctx, 'contract-bio');
          const emitB = await runContractEmit(ctx);
          expect(emitB.exitCode, 'emit B').toBe(0);
          const planB = await runMigrationPlan(ctx, [
            '--name',
            'add-bio',
            '--from',
            baseHash,
            '--json',
          ]);
          expect(planB.exitCode, 'plan B').toBe(0);
          const hashB = parseJsonOutput<{ to: string }>(planB).to;

          const setRef = await runMigrationRef(ctx, ['set', 'production', hashB]);
          expect(setRef.exitCode, 'ref set').toBe(0);

          const status = await runMigrationStatus(ctx, ['--ref', 'production']);
          const out = stripAnsi(status.stdout);

          expect(status.exitCode).toBe(0);
          expect(out).toContain('No path between database marker and ref');
          expect(out).toContain('unreachable');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: same divergent graph as above, but the user has set a ref
     * pointing at one of the branches.
     *
     * With a ref, the system knows which path to follow. The divergence
     * warning should disappear and status should report normally — either
     * up to date or pending depending on what's been applied. This
     * validates that --ref is the correct escape hatch for ambiguous graphs.
     */
    describe('divergent graph with ref — resolves target', () => {
      const db = useDevDatabase();

      it(
        'two branches + ref set → status resolves via ref',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit base').toBe(0);
          const plan0 = await runMigrationPlan(ctx, ['--name', 'init', '--json']);
          expect(plan0.exitCode, 'plan init').toBe(0);
          const baseHash = parseJsonOutput<{ to: string }>(plan0).to;
          const apply0 = await runMigrationApply(ctx);
          expect(apply0.exitCode, 'apply init').toBe(0);

          swapContract(ctx, 'contract-phone');
          const emitA = await runContractEmit(ctx);
          expect(emitA.exitCode, 'emit A').toBe(0);
          const planA = await runMigrationPlan(ctx, [
            '--name',
            'add-phone',
            '--from',
            baseHash,
            '--json',
          ]);
          expect(planA.exitCode, 'plan A').toBe(0);
          const hashA = parseJsonOutput<{ to: string }>(planA).to;

          swapContract(ctx, 'contract-bio');
          const emitB = await runContractEmit(ctx);
          expect(emitB.exitCode, 'emit B').toBe(0);
          const planB = await runMigrationPlan(ctx, ['--name', 'add-bio', '--from', baseHash]);
          expect(planB.exitCode, 'plan B').toBe(0);

          const setRef = await runMigrationRef(ctx, ['set', 'production', hashA]);
          expect(setRef.exitCode, 'ref set').toBe(0);

          const status = await runMigrationStatus(ctx, ['--ref', 'production']);
          const out = stripAnsi(status.stdout);

          expect(status.exitCode).toBe(0);
          expect(out).not.toContain('multiple valid migration paths');
          expect(out).toContain('1 migration(s) behind ref "production"');
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
