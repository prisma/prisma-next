/**
 * `migration graph --dot` must produce DOT even when stdout is non-TTY.
 *
 * `parseGlobalFlags` auto-enables `flags.json` when `!process.stdout.isTTY`
 * (per CLI Style Guide § JSON Semantics). The format dispatch in
 * `migration graph` used to check `flags.json` before `options.dot`, which
 * meant a user piping the output (`migration graph --dot | dot -Tsvg`) got
 * the auto-JSON envelope instead of DOT and the pipe-receiver errored.
 *
 * Explicit format flags (`--dot`) win over the auto-JSON default. This
 * test pins the precedence so a future format flag can't quietly drift
 * back into the shadowed shape.
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

        // Reproduce the non-TTY DOT regression scenario: pipe-style
        // invocation (`migration graph --dot | dot -Tsvg`) makes
        // `parseGlobalFlags` auto-enable `flags.json`. The format
        // dispatch must honour the explicit `--dot` flag over the
        // auto-JSON default, otherwise the pipe-receiver gets JSON it
        // can't parse.
        const graphDot = await runMigrationGraph(ctx, ['--dot'], { isTTY: false });
        expect(graphDot.exitCode, 'graph exit code').toBe(0);
        expect(graphDot.stdout, 'DOT preamble appears').toContain('digraph migrations {');

        // Negative: the auto-JSON payload shape must NOT appear.
        expect(graphDot.stdout, 'no JSON envelope ok-field').not.toContain('"ok": true');
        expect(graphDot.stdout, 'no JSON spaces array').not.toContain('"spaces":');

        // Sanity: bare `migration graph` in the same non-TTY mode still
        // produces JSON (auto-JSON default), proving the precedence fix is
        // specific to the explicit-flag case.
        const graphJson = await runMigrationGraph(ctx, [], { isTTY: false });
        expect(graphJson.exitCode, 'graph json exit code').toBe(0);
        expect(graphJson.stdout, 'auto-JSON ok-field').toContain('"ok": true');
        expect(graphJson.stdout, 'auto-JSON spaces array').toContain('"spaces":');
      },
      timeouts.typeScriptCompilation,
    );
  });
});
