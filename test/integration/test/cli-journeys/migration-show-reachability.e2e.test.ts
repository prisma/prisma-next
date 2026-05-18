/**
 * `migration show` is documented as offline and read-only in the spec, but
 * it used to be gated behind the contract-space aggregate loader. When an
 * extension was declared without its migrations directory materialised on
 * disk — common in a fresh checkout before the user has ever run
 * `migrate` — the aggregate loader threw `PN-MIG-5001` (layout violation)
 * and blocked every input shape: wrong-grammar diagnostics, hash prefixes,
 * and even valid migration directory names. The verb was effectively
 * unreachable in canonical demo state.
 *
 * The fix follows the same pattern the sibling read-only verbs already
 * use (`migration list`, `migration graph`, `migration check`): when the
 * user passes an explicit target, read the app-space migrations directory
 * directly and skip aggregate enumeration entirely. The aggregate is only
 * consulted in the no-target case, where the verb has to enumerate every
 * loaded space's latest migration and the layout-integrity check has a
 * legitimate place.
 *
 * This file pins two properties:
 *
 * 1. Wrong-grammar diagnostics on `migration show` reach the user even
 *    when an extension space hasn't been materialised yet.
 * 2. A valid migration directory name resolves and returns the migration's
 *    contents in the same state.
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * Sets up the fixture state both tests share: a config that declares
 * pgvector as an extension pack, a planned app-space migration on disk,
 * and a deliberately-absent `migrations/pgvector/` directory.
 *
 * `migration plan` materialises the pgvector space as a side effect (it
 * touches every declared space), so we remove that directory after plan
 * to reproduce a fresh checkout where the user has never run `migrate`.
 */
function setupUnmigratedExtensionsState(ctx: JourneyContext): void {
  declarePgvectorExtension(ctx);
  const pgvectorDir = join(ctx.testDir, 'migrations', 'pgvector');
  if (existsSync(pgvectorDir)) {
    rmSync(pgvectorDir, { recursive: true, force: true });
  }
}

function listAppMigrationDirs(ctx: JourneyContext): string[] {
  const appDir = join(ctx.testDir, 'migrations', 'app');
  if (!existsSync(appDir)) return [];
  return readdirSync(appDir).filter(
    (e) => !e.startsWith('.') && !e.startsWith('_') && e !== 'refs',
  );
}

withTempDir(({ createTempDir }) => {
  describe('migration show — reachability without materialised extensions', () => {
    it(
      'wrong-grammar input surfaces resolver diagnostic, not aggregate-loader',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await runMigrationPlanAndEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        setupUnmigratedExtensionsState(ctx);
        expect(
          existsSync(join(ctx.testDir, 'migrations', 'pgvector')),
          'pgvector space dir is intentionally absent',
        ).toBe(false);

        // `migration show production` — `production` is a ref name, which
        // is a contract-grammar form; passing it where a migration is
        // expected must surface the resolver's wrong-grammar diagnostic.
        const show = await runMigrationShow(ctx, ['production', '--json']);
        expect(show.exitCode, 'show exit code is non-zero').not.toBe(0);

        const json = parseJsonOutput(show);
        expect(json?.['ok'], 'response is an error envelope').toBe(false);

        // Observable property: the code is NOT `PN-MIG-5001` (the
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

    it(
      'valid app-space migration resolves and returns details',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await runMigrationPlanAndEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        setupUnmigratedExtensionsState(ctx);

        const dirs = listAppMigrationDirs(ctx);
        expect(dirs.length, 'at least one app migration was planned').toBeGreaterThan(0);
        const dirName = dirs[0]!;

        // Same unmigrated-extensions state as the wrong-grammar case; a
        // valid app-space migration must resolve and report its
        // contents instead of failing on the aggregate-loader layout
        // check. The verb's offline-by-design framing in spec FR3 only
        // holds if explicit targets bypass aggregate enumeration.
        const show = await runMigrationShow(ctx, [dirName, '--json']);
        expect(show.exitCode, 'show exits 0').toBe(0);

        const json = parseJsonOutput(show);
        expect(json?.['ok'], 'response is a success envelope').toBe(true);

        const spaces = json?.['spaces'] as readonly Record<string, unknown>[] | undefined;
        expect(spaces, 'response carries a spaces[] array').toBeTruthy();
        expect(spaces?.length, 'exactly one space is returned for an explicit target').toBe(1);
        const space = spaces?.[0];
        expect(space?.['kind'], 'returned space is "present"').toBe('present');
        expect(space?.['spaceId'], 'returned space is the app space').toBe('app');
        expect(space?.['dirName'], 'returned dirName matches the targeted migration').toBe(dirName);
      },
      timeouts.typeScriptCompilation,
    );
  });
});
