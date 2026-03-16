/**
 * Database Update Workflows (Journeys D + E + O)
 *
 * D — Direct update without migrations: swap to an additive contract, dry-run
 *     to preview changes, apply, confirm noop on re-run, then verify.
 *
 * E — Destructive update with confirmation: swap to a contract that drops a
 *     column, test that --no-interactive blocks destructive changes, --json
 *     returns an error envelope, and --json -y auto-accepts and succeeds.
 *
 * O — Re-init conflict: after initializing with one contract, swap to another
 *     and observe that db init fails (marker hash mismatch). Recovery via
 *     db update.
 */

import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbInit,
  runDbUpdate,
  runDbVerify,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  // -------------------------------------------------------------------------
  // Journey D: Direct Update (No Migrations)
  // -------------------------------------------------------------------------
  describe('Journey D: Direct Update', () => {
    const db = useDevDatabase();

    it(
      'emit → init → swap → update dry-run → update → update noop → verify',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'D.pre: emit').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'D.pre: init').toBe(0);

        // D.01: Swap to contract-additive, contract emit
        swapContract(ctx, 'contract-additive');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'D.01: contract emit v2').toBe(0);

        // D.02: db update --dry-run
        const dryRun = await runDbUpdate(ctx, ['--dry-run']);
        expect(dryRun.exitCode, 'D.02: db update dry-run').toBe(0);
        expect(stripAnsi(dryRun.stdout), 'D.02: shows planned ops').toContain('Planned');

        // D.03: db update
        const update = await runDbUpdate(ctx);
        expect(update.exitCode, 'D.03: db update apply').toBe(0);

        // D.04: db update (noop)
        const updateNoop = await runDbUpdate(ctx);
        expect(updateNoop.exitCode, 'D.04: db update noop').toBe(0);

        // D.05: db verify
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'D.05: db verify').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey E: Destructive Update with Confirmation
  // -------------------------------------------------------------------------
  describe('Journey E: Destructive Update', () => {
    const db = useDevDatabase();

    it(
      'emit → init → destructive update scenarios',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'E.pre: emit').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'E.pre: init').toBe(0);

        // E.01: Swap to contract-destructive, contract emit
        swapContract(ctx, 'contract-destructive');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'E.01: contract emit destructive').toBe(0);

        // E.02: db update --dry-run
        const dryRun = await runDbUpdate(ctx, ['--dry-run']);
        expect(dryRun.exitCode, 'E.02: db update dry-run').toBe(0);

        // E.05: db update --no-interactive (without -y) — fails with destructive changes
        const noInteractive = await runDbUpdate(ctx, ['--no-interactive']);
        expect(noInteractive.exitCode, 'E.05: non-interactive destructive fails').toBe(1);

        // E.06: db update --json — destructive changes, no prompt, returns error
        const jsonDestructive = await runDbUpdate(ctx, ['--json']);
        expect(jsonDestructive.exitCode, 'E.06: json destructive error').toBe(1);
        const jsonError = parseJsonOutput(jsonDestructive);
        expect(jsonError, 'E.06: error envelope').toMatchObject({ ok: false });

        // E.07: db update --json -y — auto-accept, returns success
        const jsonAccept = await runDbUpdate(ctx, ['--json', '-y']);
        expect(jsonAccept.exitCode, 'E.07: json accept').toBe(0);
        const jsonSuccess = parseJsonOutput(jsonAccept);
        expect(jsonSuccess, 'E.07: success envelope').toMatchObject({ ok: true });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey O: db init on Already-Initialized DB (Different Contract)
  // -------------------------------------------------------------------------
  describe('Journey O: Re-init Conflict', () => {
    const db = useDevDatabase();

    it(
      'init → swap → init fails → db update recovers',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition: init with base contract
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'O.pre: emit').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'O.pre: init').toBe(0);

        // Swap to additive contract
        swapContract(ctx, 'contract-additive');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'O.pre: emit v2').toBe(0);

        // O.01: db init (fails — marker exists with different hash)
        const initFail = await runDbInit(ctx);
        expect(initFail.exitCode, 'O.01: db init fails').toBe(1);

        // O.02: db init --dry-run (also fails)
        const dryRunFail = await runDbInit(ctx, ['--dry-run']);
        expect(dryRunFail.exitCode, 'O.02: db init dry-run fails').toBe(1);

        // O.03: db update (recovery)
        const update = await runDbUpdate(ctx);
        expect(update.exitCode, 'O.03: db update recovery').toBe(0);

        // O.04: db verify
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'O.04: db verify').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
