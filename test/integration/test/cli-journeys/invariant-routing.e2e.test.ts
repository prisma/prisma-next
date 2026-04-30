/**
 * Invariant-aware ref routing — end-to-end.
 *
 * The happy path: a dataTransform declares an `invariantId`, the resulting
 * `migration.json` carries `providedInvariants`, a ref declares the same
 * id, and `migration apply --ref` routes through the data-bearing path.
 * The marker write unions the applied id, so re-applying the same ref
 * subtracts already-covered invariants from the required set and the
 * second apply is a no-op.
 *
 * Plus two failure-mode journeys covering the structured errors:
 *   - UNKNOWN_INVARIANT: a ref names an id no migration declares; both
 *     apply and status fail loudly before touching the database.
 *   - NO_INVARIANT_PATH: a ref names an id declared on a sibling branch
 *     of a divergent graph, so the structurally-shortest path doesn't
 *     cover it.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runMigrationApply,
  runMigrationEmit,
  runMigrationPlan,
  runMigrationPlanAndEmit,
  runMigrationStatus,
  setupJourney,
  sql,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const INVARIANT_ID = 'backfill-user-name';
const BACKFILLED_NAME = 'unknown';

/**
 * Writes a `migrations/refs/<name>.json` file directly. The current
 * `migration ref set` command always writes `invariants: []`, so e2e tests
 * that need ref-side invariants edit the JSON file by hand (matching the
 * spec's "edit JSON manually for v1" deferred item).
 */
function writeRefFile(
  ctx: JourneyContext,
  name: string,
  hash: string,
  invariants: readonly string[],
): void {
  const refsDir = join(ctx.testDir, 'migrations', 'refs');
  mkdirSync(refsDir, { recursive: true });
  const file = join(refsDir, `${name}.json`);
  writeFileSync(file, `${JSON.stringify({ hash, invariants }, null, 2)}\n`, 'utf-8');
}

/**
 * Patches the planner-emitted `migration.ts` for a NOT-NULL backfill to:
 *   1. inject a `db = sql({ context })` setup block
 *   2. fill in the `check` and `run` placeholders with real query-builder calls
 *   3. (optionally) add an `invariantId` to the dataTransform options
 *
 * Returns the patched file contents (already written to disk).
 */
function patchBackfillMigrationTs(
  migrationDir: string,
  opts: { addInvariantId: boolean; invariantId?: string },
): string {
  const migrationTsPath = join(migrationDir, 'migration.ts');
  const scaffold = readFileSync(migrationTsPath, 'utf-8');

  const dbSetupBlock = [
    `import postgresAdapter from '@prisma-next/adapter-postgres/runtime';`,
    `import { sql } from '@prisma-next/sql-builder/runtime';`,
    `import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';`,
    `import postgresTarget from '@prisma-next/target-postgres/runtime';`,
    '',
    'const db = sql({',
    '  context: createExecutionContext({',
    '    contract: endContract,',
    '    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),',
    '  }),',
    '});',
    '',
    'export default class M extends Migration {',
  ].join('\n');

  let filled = scaffold
    .replace('export default class M extends Migration {', dbSetupBlock)
    .replace(
      `() => placeholder('${INVARIANT_ID}:check')`,
      "() => db.user.select('id').where((f, fns) => fns.eq(f.name, null)).limit(1)",
    )
    .replace(
      `() => placeholder('${INVARIANT_ID}:run')`,
      `() => db.user.update({ name: '${BACKFILLED_NAME}' }).where((f, fns) => fns.eq(f.name, null))`,
    );

  if (opts.addInvariantId) {
    const id = opts.invariantId ?? INVARIANT_ID;
    // Inject `invariantId` as the first key in the dataTransform options
    // object. The scaffold always starts the options with `check:`.
    filled = filled.replace(
      /(this\.dataTransform\(endContract,\s*['"][\w-]+['"]\s*,\s*\{\s*)check:/,
      `$1invariantId: '${id}',\n  check:`,
    );
  }

  writeFileSync(migrationTsPath, filled);
  return filled;
}

withTempDir(({ createTempDir }) => {
  describe('Journey O: invariant-aware ref routing — happy path with marker accumulation', () => {
    const db = useDevDatabase();

    it(
      'invariantId on dataTransform → ref requires it → apply backfills + accumulates marker → re-apply is noop',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // O.01: emit base contract (C1) → plan + apply init (creates user table)
        expect((await runContractEmit(ctx)).exitCode, 'O.01: emit C1').toBe(0);
        const plan0 = await runMigrationPlanAndEmit(ctx, ['--name', 'init', '--json']);
        expect(plan0.exitCode, 'O.01: plan init').toBe(0);
        expect((await runMigrationApply(ctx)).exitCode, 'O.01: apply init').toBe(0);

        // O.02: seed two rows that will need backfilling on the next migration
        await sql(
          db.connectionString,
          `INSERT INTO "public"."user" (id, email) VALUES (1, 'alice@example.com'), (2, 'bob@test.org')`,
        );

        // O.03: swap to the contract that adds a NOT NULL `name` column;
        // the planner emits a placeholder dataTransform.
        swapContract(ctx, 'contract-additive-required-name');
        expect((await runContractEmit(ctx)).exitCode, 'O.03: emit C2').toBe(0);
        const planResult = await runMigrationPlan(ctx, ['--name', 'add-required-name']);
        expect(planResult.exitCode, 'O.03: plan add-required-name').toBe(0);

        const migrationsDir = join(ctx.testDir, 'migrations');
        const migrationDirName = readdirSync(migrationsDir)
          .filter((d) => d.includes('add_required_name'))
          .sort()
          .at(-1)!;
        const migrationDir = join(migrationsDir, migrationDirName);

        // O.04: patch placeholders + add invariantId to the dataTransform.
        const filled = patchBackfillMigrationTs(migrationDir, { addInvariantId: true });
        expect(filled).toContain(`invariantId: '${INVARIANT_ID}'`);

        // O.05: re-emit and confirm the manifest carries `providedInvariants`.
        expect(
          (await runMigrationEmit(ctx, ['--dir', migrationDir])).exitCode,
          'O.05: re-emit',
        ).toBe(0);
        const manifestAfter = JSON.parse(
          readFileSync(join(migrationDir, 'migration.json'), 'utf-8'),
        );
        expect(
          manifestAfter.providedInvariants,
          'O.05: manifest carries providedInvariants',
        ).toEqual([INVARIANT_ID]);
        const c2Hash = manifestAfter.to as string;

        // O.06: declare a ref `prod` that points at C2 and requires the invariant.
        writeRefFile(ctx, 'prod', c2Hash, [INVARIANT_ID]);

        // O.07: apply --ref prod — routes through the invariant-bearing path,
        // backfills the data, advances the marker.
        const applyRef = await runMigrationApply(ctx, ['--ref', 'prod', '--json']);
        expect(applyRef.exitCode, 'O.07: apply --ref prod').toBe(0);
        const applyResult = parseJsonOutput<{
          ok: boolean;
          markerHash: string;
          pathDecision?: {
            requiredInvariants: readonly string[];
            satisfiedInvariants: readonly string[];
            selectedPath: readonly { dirName: string; invariants: readonly string[] }[];
          };
        }>(applyRef);
        expect(applyResult.ok, 'O.07: ok').toBe(true);
        expect(applyResult.markerHash, 'O.07: marker advanced to C2').toBe(c2Hash);
        expect(applyResult.pathDecision?.requiredInvariants, 'O.07: required reflects ref').toEqual(
          [INVARIANT_ID],
        );
        expect(
          applyResult.pathDecision?.satisfiedInvariants,
          'O.07: satisfied = required (path covers it)',
        ).toEqual([INVARIANT_ID]);
        expect(
          applyResult.pathDecision?.selectedPath.at(-1)?.invariants,
          'O.07: selectedPath edge carries the invariant',
        ).toEqual([INVARIANT_ID]);

        // O.08: assert the data was actually backfilled.
        const rows = await sql(
          db.connectionString,
          `SELECT id, email, "name" FROM "public"."user" ORDER BY id`,
        );
        expect(rows.rows, 'O.08: data backfilled').toEqual([
          { id: 1, email: 'alice@example.com', name: BACKFILLED_NAME },
          { id: 2, email: 'bob@test.org', name: BACKFILLED_NAME },
        ]);

        // O.09: status --ref prod surfaces the three invariant sets and the per-edge
        // invariants on the selected path.
        const statusRef = await runMigrationStatus(ctx, ['--ref', 'prod', '--json']);
        expect(statusRef.exitCode, 'O.09: status --ref prod').toBe(0);
        const statusResult = parseJsonOutput<{
          requiredInvariants?: readonly string[];
          appliedInvariants?: readonly string[];
          missingInvariants?: readonly string[];
          pathDecision?: {
            requiredInvariants: readonly string[];
            satisfiedInvariants: readonly string[];
            selectedPath: readonly { dirName: string; invariants: readonly string[] }[];
          };
        }>(statusRef);
        expect(statusResult.requiredInvariants, 'O.09: status required').toEqual([INVARIANT_ID]);
        expect(
          statusResult.appliedInvariants,
          'O.09: status applied (marker accumulated the id)',
        ).toEqual([INVARIANT_ID]);
        expect(statusResult.missingInvariants, 'O.09: status missing is empty').toEqual([]);

        // O.10: re-apply --ref prod is a no-op. The marker subtraction in
        // the apply command (`effectiveRequired = ref.invariants − marker.invariants`)
        // empties the required set, so routing falls through to the trivial
        // marker===target case (no path selected).
        const reapply = await runMigrationApply(ctx, ['--ref', 'prod', '--json']);
        expect(reapply.exitCode, 'O.10: re-apply --ref prod').toBe(0);
        const reapplyResult = parseJsonOutput<{
          ok: boolean;
          markerHash: string;
          summary: string;
        }>(reapply);
        expect(reapplyResult.ok, 'O.10: ok').toBe(true);
        expect(reapplyResult.markerHash, 'O.10: marker unchanged').toBe(c2Hash);
        expect(reapplyResult.summary, 'O.10: noop summary').toMatch(/up to date/i);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey P: UNKNOWN_INVARIANT pre-check — ref declares an undeclared id', () => {
    const db = useDevDatabase();

    it(
      'apply and status both exit 1 with MIGRATION.UNKNOWN_INVARIANT before any DB activity',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // P.01: emit base + plan + apply a single migration that declares a real invariant.
        expect((await runContractEmit(ctx)).exitCode, 'P.01: emit C1').toBe(0);
        const plan0 = await runMigrationPlanAndEmit(ctx, ['--name', 'init', '--json']);
        expect(plan0.exitCode, 'P.01: plan init').toBe(0);
        expect((await runMigrationApply(ctx)).exitCode, 'P.01: apply init').toBe(0);

        await sql(
          db.connectionString,
          `INSERT INTO "public"."user" (id, email) VALUES (1, 'alice@example.com')`,
        );

        swapContract(ctx, 'contract-additive-required-name');
        expect((await runContractEmit(ctx)).exitCode, 'P.02: emit C2').toBe(0);
        expect(
          (await runMigrationPlan(ctx, ['--name', 'add-required-name'])).exitCode,
          'P.02: plan',
        ).toBe(0);

        const migrationsDir = join(ctx.testDir, 'migrations');
        const migrationDir = join(
          migrationsDir,
          readdirSync(migrationsDir)
            .filter((d) => d.includes('add_required_name'))
            .sort()
            .at(-1)!,
        );
        patchBackfillMigrationTs(migrationDir, { addInvariantId: true });
        expect(
          (await runMigrationEmit(ctx, ['--dir', migrationDir])).exitCode,
          'P.02: re-emit',
        ).toBe(0);

        const manifest = JSON.parse(readFileSync(join(migrationDir, 'migration.json'), 'utf-8'));
        const c2Hash = manifest.to as string;

        // P.03: declare a ref requiring an id no migration provides.
        writeRefFile(ctx, 'prod', c2Hash, ['typo-no-migration-declares-this']);

        // P.04: apply --ref prod fails fast with UNKNOWN_INVARIANT, marker untouched.
        const applyFail = await runMigrationApply(ctx, ['--ref', 'prod', '--json']);
        expect(applyFail.exitCode, 'P.04: apply exits 1').toBe(1);
        const applyEnvelope = parseJsonOutput<{
          meta?: { code?: string; unknown?: readonly string[]; declared?: readonly string[] };
        }>(applyFail);
        expect(applyEnvelope.meta?.code, 'P.04: apply error code').toBe(
          'MIGRATION.UNKNOWN_INVARIANT',
        );
        expect(applyEnvelope.meta?.unknown, 'P.04: apply error names the typo').toEqual([
          'typo-no-migration-declares-this',
        ]);
        expect(applyEnvelope.meta?.declared, 'P.04: apply error lists declared ids').toEqual([
          INVARIANT_ID,
        ]);

        // P.05: marker still at C1 — UNKNOWN_INVARIANT fired before any DB write.
        // Querying via the CLI status path (without --ref so the pre-check doesn't
        // fire) is the cleanest cross-DB-family way to read the marker.
        const statusOffline = await runMigrationStatus(ctx, ['--json']);
        expect(statusOffline.exitCode, 'P.05: status exit').toBe(0);
        const offlineState = parseJsonOutput<{ markerHash?: string }>(statusOffline);
        expect(offlineState.markerHash, 'P.05: marker did not advance to C2').not.toBe(c2Hash);

        // P.06: status --ref prod is fatal too (parity with apply).
        const statusFail = await runMigrationStatus(ctx, ['--ref', 'prod', '--json']);
        expect(statusFail.exitCode, 'P.06: status exits 1').toBe(1);
        const statusEnvelope = parseJsonOutput<{ meta?: { code?: string } }>(statusFail);
        expect(statusEnvelope.meta?.code, 'P.06: status error code').toBe(
          'MIGRATION.UNKNOWN_INVARIANT',
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey Q: NO_INVARIANT_PATH — ref demands an invariant only declared on a sibling branch', () => {
    const db = useDevDatabase();

    it(
      'divergent graph: ref points at the no-invariant branch, apply fails with structuralPath populated',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Q.01: emit base (C1), plan + apply init (no invariants on this edge).
        expect((await runContractEmit(ctx)).exitCode, 'Q.01: emit C1').toBe(0);
        const plan0 = await runMigrationPlanAndEmit(ctx, ['--name', 'init', '--json']);
        expect(plan0.exitCode, 'Q.01: plan init').toBe(0);
        const c1Hash = parseJsonOutput<{ to: string }>(plan0).to;
        expect((await runMigrationApply(ctx)).exitCode, 'Q.01: apply init').toBe(0);

        await sql(
          db.connectionString,
          `INSERT INTO "public"."user" (id, email) VALUES (1, 'alice@example.com')`,
        );

        // Q.02: branch A — swap to required-name, plan + emit with invariantId.
        // This edge declares invariantId=INVARIANT_ID and goes C1 → CA.
        swapContract(ctx, 'contract-additive-required-name');
        expect((await runContractEmit(ctx)).exitCode, 'Q.02: emit CA').toBe(0);
        const planA = await runMigrationPlan(ctx, ['--name', 'branch-a-with-invariant']);
        expect(planA.exitCode, 'Q.02: plan branch A').toBe(0);
        const migrationsDir = join(ctx.testDir, 'migrations');
        const branchADir = join(
          migrationsDir,
          readdirSync(migrationsDir)
            .filter((d) => d.includes('branch_a_with_invariant'))
            .sort()
            .at(-1)!,
        );
        patchBackfillMigrationTs(branchADir, { addInvariantId: true });
        expect(
          (await runMigrationEmit(ctx, ['--dir', branchADir])).exitCode,
          'Q.02: re-emit branch A',
        ).toBe(0);

        // Q.03: branch B — swap to a different additive contract (no backfill needed),
        // plan with --from C1 to create a divergent edge C1 → CB. No invariants.
        swapContract(ctx, 'contract-phone');
        expect((await runContractEmit(ctx)).exitCode, 'Q.03: emit CB').toBe(0);
        const planB = await runMigrationPlanAndEmit(ctx, [
          '--name',
          'branch-b-no-invariant',
          '--from',
          c1Hash,
          '--json',
        ]);
        expect(planB.exitCode, 'Q.03: plan branch B').toBe(0);
        const cbHash = parseJsonOutput<{ to: string }>(planB).to;

        // Q.04: declare a ref pointing at CB (the no-invariant branch) but
        // requiring INVARIANT_ID — which is declared, but only on the A branch.
        // The structural path C1 → CB exists; it just doesn't cover the required id.
        writeRefFile(ctx, 'prod', cbHash, [INVARIANT_ID]);

        // Q.05: apply --ref prod fails with NO_INVARIANT_PATH (not UNKNOWN_INVARIANT,
        // because the id IS declared somewhere in the graph). The structural path
        // points at the CB-branch edge that doesn't cover it.
        const applyFail = await runMigrationApply(ctx, ['--ref', 'prod', '--json']);
        expect(applyFail.exitCode, 'Q.05: apply exits 1').toBe(1);
        const envelope = parseJsonOutput<{
          meta?: {
            code?: string;
            required?: readonly string[];
            missing?: readonly string[];
            structuralPath?: readonly { dirName: string; invariants: readonly string[] }[];
          };
        }>(applyFail);
        expect(envelope.meta?.code, 'Q.05: error code').toBe('MIGRATION.NO_INVARIANT_PATH');
        expect(envelope.meta?.required, 'Q.05: required reflects ref').toEqual([INVARIANT_ID]);
        expect(
          envelope.meta?.missing,
          'Q.05: missing equals required (CB path covers nothing)',
        ).toEqual([INVARIANT_ID]);
        expect(envelope.meta?.structuralPath, 'Q.05: structuralPath populated').toBeDefined();
        expect(
          envelope.meta?.structuralPath?.at(-1)?.invariants,
          'Q.05: CB-branch edge has no invariants',
        ).toEqual([]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey R: A→B→A→B — marker.invariants stays monotonic across rollback + re-apply', () => {
    const db = useDevDatabase();

    // The pinned behavior: `marker.invariants` is set-semantic. Once an
    // invariant id has been written by a successful apply, it stays in the
    // set forever — no rollback path removes it. A second forward apply via
    // `--ref` after an out-of-band marker reset routes through the same
    // edge, the data transform is re-evaluated, and the set is unchanged
    // (already-present id is a no-op union).
    //
    // Important: whether the data transform's *body* re-runs depends on
    // its `check`, which is authored per-migration. The NOT-NULL backfill
    // here checks `name IS NULL`; after the first apply the column is
    // NOT NULL so no row can satisfy that check anymore. The check fires
    // (no violations), `run` is skipped, marker advances. That is the
    // honest outcome — the test does not pretend the data transform's
    // body re-fires when it doesn't.
    it(
      'rollback marker.storageHash to A → re-apply via --ref selects M1 → marker advances back to B with invariants unchanged',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        expect((await runContractEmit(ctx)).exitCode, 'R.01: emit C1').toBe(0);
        const plan0 = await runMigrationPlanAndEmit(ctx, ['--name', 'init', '--json']);
        expect(plan0.exitCode, 'R.01: plan init').toBe(0);
        const c1Hash = parseJsonOutput<{ to: string }>(plan0).to;
        expect((await runMigrationApply(ctx)).exitCode, 'R.01: apply init').toBe(0);

        await sql(
          db.connectionString,
          `INSERT INTO "public"."user" (id, email) VALUES (1, 'alice@example.com')`,
        );

        swapContract(ctx, 'contract-additive-required-name');
        expect((await runContractEmit(ctx)).exitCode, 'R.02: emit C2').toBe(0);
        expect(
          (await runMigrationPlan(ctx, ['--name', 'add-required-name'])).exitCode,
          'R.02: plan',
        ).toBe(0);

        const migrationsDir = join(ctx.testDir, 'migrations');
        const migrationDir = join(
          migrationsDir,
          readdirSync(migrationsDir)
            .filter((d) => d.includes('add_required_name'))
            .sort()
            .at(-1)!,
        );
        patchBackfillMigrationTs(migrationDir, { addInvariantId: true });
        expect((await runMigrationEmit(ctx, ['--dir', migrationDir])).exitCode, 'R.02: emit').toBe(
          0,
        );

        const manifest = JSON.parse(readFileSync(join(migrationDir, 'migration.json'), 'utf-8'));
        const c2Hash = manifest.to as string;

        writeRefFile(ctx, 'prod', c2Hash, [INVARIANT_ID]);

        const apply1 = await runMigrationApply(ctx, ['--ref', 'prod', '--json']);
        expect(apply1.exitCode, 'R.02: apply --ref prod').toBe(0);
        expect(
          parseJsonOutput<{ markerHash: string }>(apply1).markerHash,
          'R.02: marker at C2',
        ).toBe(c2Hash);

        // Out-of-band rollback: reset only the storage hash. marker.invariants
        // is intentionally left untouched to model the "applied-at-least-once"
        // semantic — the set never shrinks, even when a structural rollback
        // moves the storage hash backward.
        await sql(
          db.connectionString,
          `UPDATE "prisma_contract"."marker" SET core_hash = $1 WHERE id = 1`,
          [c1Hash],
        );
        const markerAfterReset = await sql(
          db.connectionString,
          `SELECT core_hash, invariants FROM "prisma_contract"."marker" WHERE id = 1`,
        );
        expect(markerAfterReset.rows[0]?.['core_hash'], 'R.03: storage hash rolled back').toBe(
          c1Hash,
        );
        expect(
          markerAfterReset.rows[0]?.['invariants'],
          'R.03: invariants survive the rollback',
        ).toEqual([INVARIANT_ID]);

        const apply2 = await runMigrationApply(ctx, ['--ref', 'prod', '--json']);
        expect(apply2.exitCode, 'R.04: re-apply --ref prod').toBe(0);
        const apply2Result = parseJsonOutput<{
          markerHash: string;
          pathDecision?: {
            requiredInvariants: readonly string[];
            satisfiedInvariants: readonly string[];
          };
        }>(apply2);
        expect(apply2Result.markerHash, 'R.04: marker advanced back to C2').toBe(c2Hash);
        // effectiveRequired empties out: the marker still has the id, so the
        // CLI's marker-subtraction strips it from the required set before
        // routing. requiredInvariants in pathDecision reflects the EFFECTIVE
        // required set (post-subtraction), not the ref's raw declaration.
        expect(
          apply2Result.pathDecision?.requiredInvariants,
          'R.04: effectiveRequired empty after marker subtraction',
        ).toEqual([]);

        const markerAfterReapply = await sql(
          db.connectionString,
          `SELECT core_hash, invariants FROM "prisma_contract"."marker" WHERE id = 1`,
        );
        expect(markerAfterReapply.rows[0]?.['core_hash'], 'R.05: marker at C2').toBe(c2Hash);
        expect(
          markerAfterReapply.rows[0]?.['invariants'],
          'R.05: invariants unchanged after re-apply (set union with already-present id is a no-op)',
        ).toEqual([INVARIANT_ID]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
