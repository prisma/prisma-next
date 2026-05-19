import { fileURLToPath } from 'node:url';
import {
  type CommanderResultShape,
  runTelemetry,
  type TelemetryRunOutcome,
} from '@prisma-next/cli-telemetry';
import type { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { isCI } from './is-ci';

/**
 * This CLI's own version, transmitted as the event's `version` field.
 * Kept as a module-level constant rather than reading `package.json`
 * at runtime to avoid an extra I/O hit on every CLI invocation and
 * because tsdown's bundle doesn't ship `package.json` next to
 * `dist/cli.mjs`. The version is the source of truth for what's
 * actually running; the release script should bump it alongside the
 * package's `version` field.
 */
const TELEMETRY_CLI_VERSION = '0.9.0';

/**
 * Resolve the commander command path from a leaf `Command`, walking up
 * the parent chain. Result is rooted at the program name and ends at
 * the leaf — `['prisma-next', 'migration', 'new']` for
 * `prisma-next migration new …`.
 */
function commandPathFor(actionCommand: Command): string[] {
  const path: string[] = [];
  let cursor: Command | null = actionCommand;
  while (cursor !== null) {
    path.unshift(cursor.name());
    cursor = cursor.parent;
  }
  return path;
}

/**
 * Project commander's leaf `Command` into the wire-shape snapshot the
 * telemetry sanitiser consumes. Pure projection — no env, no I/O.
 */
function commanderSnapshot(actionCommand: Command): CommanderResultShape {
  return {
    commandPath: commandPathFor(actionCommand),
    positionalArgs: actionCommand.args,
    parsedOptions: actionCommand.opts() as Record<string, unknown>,
  };
}

/**
 * Best-effort extraction of `databaseTarget` and `extensions` from the
 * project config. Loads via the same `c12`-backed loader the action
 * handlers use so we honour the same lookup rules. Every failure mode
 * (no config file, malformed config, async load reject) collapses to
 * `(null, [])` because telemetry is non-blocking and may fire for
 * commands that legitimately don't have a config (e.g. `init`).
 */
async function loadConfigForTelemetry(): Promise<{
  readonly databaseTarget: string | null;
  readonly extensions: readonly string[];
}> {
  try {
    const config = await loadConfig();
    const target = config.target as { readonly targetId?: unknown } | undefined;
    const databaseTarget =
      target !== undefined && typeof target.targetId === 'string' ? target.targetId : null;
    const extensionPacks = (config.extensionPacks ?? []) as ReadonlyArray<{
      readonly id?: unknown;
    }>;
    const extensions = extensionPacks
      .map((pack) => pack.id)
      .filter((id): id is string => typeof id === 'string');
    return { databaseTarget, extensions };
  } catch {
    return { databaseTarget: null, extensions: [] };
  }
}

/**
 * Path to the compiled sender script inside `@prisma-next/cli-telemetry`'s
 * `dist/`. Resolved off this module's `import.meta.url` via the package
 * specifier `@prisma-next/cli-telemetry/sender`, so the consumer pays
 * no attention to internal package layout.
 */
function senderPath(): string {
  return fileURLToPath(new URL(import.meta.resolve('@prisma-next/cli-telemetry/sender')));
}

/**
 * preAction-stage entry point: snapshot commander's parsed result, ask
 * the cli-telemetry layer to fire the detached sender, return the
 * outcome. The outcome is informational only — the parent never blocks
 * on it and never surfaces it to the user (debug mode aside).
 *
 * The hook awaits the best-effort config load so the `databaseTarget`
 * and `extensions` fields reflect the user's project; on a fresh
 * machine running `init` (no config yet) the load throws and both
 * fields collapse to their absence defaults.
 */
export async function fireTelemetryFromPreAction(
  actionCommand: Command,
): Promise<TelemetryRunOutcome> {
  const command = commanderSnapshot(actionCommand);
  const { databaseTarget, extensions } = await loadConfigForTelemetry();
  return runTelemetry({
    command,
    version: TELEMETRY_CLI_VERSION,
    databaseTarget,
    extensions,
    projectRoot: process.cwd(),
    senderPath: senderPath(),
    isCI: isCI(),
  });
}
