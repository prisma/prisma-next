/**
 * F-7 regression — `migration graph --dot` must produce DOT even when
 * stdout is non-TTY (auto-JSON).
 *
 * Before the fix in this round, the format dispatch checked `flags.json`
 * before `options.dot`. `parseGlobalFlags` auto-enables `flags.json` when
 * `!process.stdout.isTTY` (per CLI Style Guide § JSON Semantics), which
 * meant a user piping the output (`migration graph --dot | dot -Tsvg`)
 * got JSON instead of DOT. The pipe-receiver then errored.
 *
 * The fix reverses the precedence: explicit format flags (`--dot`) win
 * over the auto-JSON default. This test pins the precedence so a future
 * format flag can't quietly drift back into the shadowed shape.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runMigrationGraph,
  runMigrationPlanAndEmit,
  setupJourney,
  timeouts,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('migration graph — output format precedence', () => {
    it(
      '--dot wins over auto-JSON in non-TTY mode',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await runMigrationPlanAndEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        // Vitest runs with stdout.isTTY=false, so `parseGlobalFlags` will
        // auto-enable `flags.json`. The fix makes `--dot` take precedence
        // anyway; the assertion is that the output is DOT, not JSON.
        const graph = await runMigrationGraph(ctx, ['--dot']);
        expect(graph.exitCode, 'graph exit code').toBe(0);

        // Reproduce the F-7 scenario: pipe-style invocation (isTTY=false)
        // makes `parseGlobalFlags` auto-enable `flags.json`. Before the
        // fix this caused the JSON branch to win over `--dot`; after the
        // fix `--dot` takes precedence and the output is DOT.
        const graphDot = await runMigrationGraph(ctx, ['--dot'], { isTTY: false });
        expect(graphDot.exitCode, 'graph exit code').toBe(0);
        expect(graphDot.stdout, 'DOT preamble appears').toContain('digraph migrations {');

        // Negative: the auto-JSON payload shape must NOT appear.
        expect(graphDot.stdout, 'no JSON envelope ok-field').not.toContain('"ok": true');
        expect(graphDot.stdout, 'no JSON nodes array').not.toContain('"nodes":');

        // Sanity: bare `migration graph` in the same non-TTY mode still
        // produces JSON (auto-JSON default), proving the precedence fix is
        // specific to the explicit-flag case.
        const graphJson = await runMigrationGraph(ctx, [], { isTTY: false });
        expect(graphJson.exitCode, 'graph json exit code').toBe(0);
        expect(graphJson.stdout, 'auto-JSON ok-field').toContain('"ok": true');
        expect(graphJson.stdout, 'auto-JSON nodes array').toContain('"nodes":');
      },
      timeouts.typeScriptCompilation,
    );
  });
});
