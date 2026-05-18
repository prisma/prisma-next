/**
 * F-1 regression — `migration show` must remain reachable for wrong-grammar
 * inputs even when an extension is declared but its contract space has not
 * been materialised on disk.
 *
 * Before the fix in this round, `executeMigrationShowCommand` called
 * `buildContractSpaceAggregate` (which enforces a layout-integrity check —
 * `PN-MIG-5001`) BEFORE `parseMigrationRef`. Any input — wrong-grammar OR
 * a valid migration directory name — was gated behind the aggregate
 * layout check. A user with a declared-but-unmigrated extension never
 * reached the wrong-grammar diagnostic that AC6 promised.
 *
 * The fix reorders execution: resolve the app-space target through
 * `parseMigrationRef` first, then build the aggregate (so extension-space
 * enumeration can still flag layout violations on the no-target path).
 *
 * This test reproduces the canonical demo state — pgvector declared in
 * `extensionPacks` with no `migrations/pgvector/` directory — and asserts
 * that `migration show production` (a ref name, wrong grammar) surfaces
 * the resolver's wrong-grammar diagnostic rather than the aggregate
 * loader's layout violation.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runMigrationPlanAndEmit,
  runMigrationShow,
  setupJourney,
  timeouts,
} from '../utils/journey-test-helpers';

/**
 * Rewrite the journey's config to declare pgvector as an extension pack.
 * The contract itself does not need to reference pgvector — the aggregate
 * loader's layout check fires on the declaration alone.
 */
function declarePgvectorExtension(ctx: JourneyContext): void {
  const config = readFileSync(ctx.configPath, 'utf-8');
  const next = config
    .replace(
      "import sql from '@prisma-next/family-sql/control';",
      "import sql from '@prisma-next/family-sql/control';\nimport pgvector from '@prisma-next/extension-pgvector/control';",
    )
    .replace('extensionPacks: []', 'extensionPacks: [pgvector]');
  writeFileSync(ctx.configPath, next);
}

withTempDir(({ createTempDir }) => {
  describe('migration show — reachability without materialised extensions', () => {
    it(
      'wrong-grammar ref-name input surfaces resolver diagnostic, not aggregate-loader',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });
        declarePgvectorExtension(ctx);

        // App-space migrations need to exist so the app-space resolver
        // has something to compare against. `migration plan` does
        // materialise the pgvector space as a side effect (it touches
        // every declared space), so we remove that directory after plan
        // to reproduce the canonical demo's declared-but-unmigrated
        // state. This mirrors what would happen if the user opened a
        // demo from version control on a machine that has never run
        // `migrate` against a database.
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await runMigrationPlanAndEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        const pgvectorDir = join(ctx.testDir, 'migrations', 'pgvector');
        if (existsSync(pgvectorDir)) {
          rmSync(pgvectorDir, { recursive: true, force: true });
        }
        expect(existsSync(pgvectorDir), 'pgvector space dir is intentionally absent').toBe(false);

        // The QA-reproducible failure: `migration show production` (a ref
        // name passed where a migration is expected) must surface the
        // resolver's wrong-grammar diagnostic.
        const show = await runMigrationShow(ctx, ['production', '--json']);
        expect(show.exitCode, 'show exit code is non-zero').not.toBe(0);

        const json = parseJsonOutput(show);
        expect(json?.['ok'], 'response is an error envelope').toBe(false);

        // The fix is observable as: the code is NOT `PN-MIG-5001` (the
        // aggregate-loader layout violation). The resolver's
        // wrong-grammar path maps through `errorRuntime` which produces
        // `PN-RUN-3000`; the structured envelope carries grammar metadata.
        const code = json?.['code'];
        expect(code, 'must not be the aggregate-loader code').not.toBe('PN-MIG-5001');

        // Confirm the resolver-level path actually ran by inspecting the
        // input/grammar metadata it forwards.
        const meta = json?.['meta'] as Record<string, unknown> | undefined;
        expect(meta?.['input'], 'meta echoes the user input verbatim').toBe('production');
      },
      timeouts.typeScriptCompilation,
    );
  });
});
