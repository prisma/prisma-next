import { fileURLToPath } from 'node:url';
import {
  type CommanderOptionShape,
  type CommanderResultShape,
  readUserConfig,
  resolveGating,
  runTelemetry,
  type TelemetryRunOutcome,
  type UserConfig,
} from '@prisma-next/cli-telemetry';
import type { Command } from 'commander';
import { version as CLI_VERSION } from '../../package.json' with { type: 'json' };
import { loadConfig } from '../config-loader';
import { isCI } from './is-ci';

interface TelemetryFields {
  readonly databaseTarget: string | null;
  readonly extensions: readonly string[];
}

type TelemetryGate =
  | { readonly enabled: true; readonly userConfig: UserConfig }
  | { readonly enabled: false; readonly outcome: TelemetryRunOutcome };

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

function commanderOptionSnapshots(actionCommand: Command): CommanderOptionShape[] {
  return actionCommand.options.map((option) => {
    const attributeName = option.attributeName();
    return {
      attributeName,
      longName: option.long ?? null,
      source: actionCommand.getOptionValueSource(attributeName) ?? null,
    };
  });
}

/**
 * Project commander's leaf `Command` into the wire-shape snapshot the
 * telemetry sanitiser consumes. Pure projection — no env, no I/O.
 */
export function commanderSnapshotForTelemetry(actionCommand: Command): CommanderResultShape {
  return {
    commandPath: commandPathFor(actionCommand),
    positionalArgs: actionCommand.args,
    options: commanderOptionSnapshots(actionCommand),
  };
}

function resolveTelemetryGate(): TelemetryGate {
  if (isCI()) {
    return { enabled: false, outcome: { spawned: false, reason: 'ci' } };
  }
  const userConfig = readUserConfig();
  const gating = resolveGating({ env: process.env, config: userConfig });
  if (!gating.enabled) {
    return { enabled: false, outcome: { spawned: false, reason: 'gated-off' } };
  }
  return { enabled: true, userConfig };
}

/**
 * Best-effort extraction of `databaseTarget` and `extensions` from the
 * project config. Loads via the same `c12`-backed loader the action
 * handlers use so we honour the same lookup rules. Every failure mode
 * (no config file, malformed config, async load reject) collapses to
 * `(null, [])` because telemetry is non-blocking and may fire for
 * commands that legitimately don't have a config (e.g. `init`).
 */
async function loadConfigForTelemetry(): Promise<TelemetryFields> {
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

function fireTelemetryWithFields(
  actionCommand: Command,
  fields: TelemetryFields,
  userConfig: UserConfig,
): TelemetryRunOutcome {
  return runTelemetry({
    command: commanderSnapshotForTelemetry(actionCommand),
    version: CLI_VERSION,
    databaseTarget: fields.databaseTarget,
    extensions: fields.extensions,
    projectRoot: process.cwd(),
    senderPath: senderPath(),
    isCI: isCI(),
    env: process.env,
    userConfig,
  });
}

/**
 * preAction-stage entry point: resolve env/CI/user-consent gates first,
 * then (only when enabled) load project config for database target and
 * extension metadata, then fork the detached sender. The early gate is
 * privacy- and UX-critical: config loading can execute user code and
 * must never happen before opt-out/default-off checks have resolved.
 */
export async function fireTelemetryFromPreAction(
  actionCommand: Command,
): Promise<TelemetryRunOutcome> {
  const gate = resolveTelemetryGate();
  if (!gate.enabled) {
    return gate.outcome;
  }
  const fields = await loadConfigForTelemetry();
  return fireTelemetryWithFields(actionCommand, fields, gate.userConfig);
}

/**
 * Manual one-shot telemetry path for the first `init` run where the user
 * explicitly answers Yes to the consent prompt. The preAction hook for
 * that same run has already resolved before consent existed, so it is
 * default-off. After consent is persisted, `runInit` calls this helper
 * exactly for that first affirmative answer; subsequent init runs skip
 * it because the prompt is not shown again.
 */
export function fireTelemetryAfterInitConsent(
  actionCommand: Command,
  inputs: { readonly databaseTarget: string },
): TelemetryRunOutcome {
  const userConfig = readUserConfig();
  return fireTelemetryWithFields(
    actionCommand,
    { databaseTarget: inputs.databaseTarget, extensions: [] },
    userConfig,
  );
}
