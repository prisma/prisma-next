import { fileURLToPath } from 'node:url';
import {
  type CommanderOptionShape,
  type CommanderResultShape,
  ensureInstallationId,
  readUserConfig,
  resolveGating,
  runTelemetry,
  type TelemetryRunOutcome,
  type UserConfig,
  userConfigPath,
} from '@prisma-next/cli-telemetry';
import { ifDefined } from '@prisma-next/utils/defined';
import type { Command } from 'commander';
import { version as CLI_VERSION } from '../../package.json' with { type: 'json' };
import { type CommonCommandOptions, deriveCanPrompt, parseGlobalFlags } from './global-flags';
import { isCI } from './is-ci';

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
 * Path to the compiled sender script inside `@prisma-next/cli-telemetry`'s
 * `dist/`. Resolved off this module's `import.meta.url` via the package
 * specifier `@prisma-next/cli-telemetry/sender`, so the consumer pays
 * no attention to internal package layout.
 */
function senderPath(): string {
  return fileURLToPath(new URL(import.meta.resolve('@prisma-next/cli-telemetry/sender')));
}

function fireTelemetry(
  actionCommand: Command,
  userConfig: UserConfig,
  overrides: { readonly databaseTarget?: string } = {},
): TelemetryRunOutcome {
  return runTelemetry({
    command: commanderSnapshotForTelemetry(actionCommand),
    version: CLI_VERSION,
    projectRoot: process.cwd(),
    senderPath: senderPath(),
    isCI: isCI(),
    env: process.env,
    userConfig,
    ...ifDefined('databaseTarget', overrides.databaseTarget),
  });
}

/**
 * preAction-stage entry point. Synchronous by construction: resolve
 * env/CI/user-consent gates (cheap, all in-memory and a single tiny
 * user-config read), then — only when enabled — `fork()` the detached
 * sender script. The forked child loads `prisma-next.config.*` via
 * c12 on its own (see `loadProjectConfig` in cli-telemetry); the
 * parent does no project-config I/O on the command's hot path.
 *
 * Privacy invariant: gate resolution always happens before any project
 * config touches disk. The child loading user TS code is acceptable
 * only because it's gated behind the same resolved-enabled signal.
 */
/**
 * Builds the one-time first-run disclosure. The resolved absolute path to
 * the user-level config file is substituted in so the user can see exactly
 * which file to edit (it must not be confused with `prisma-next.config.ts`).
 * The docs link mirrors the in-repo reference style of the `init` consent
 * prompt (`TELEMETRY_CONSENT_MESSAGE`).
 */
function firstRunNotice(configPath: string): string {
  return [
    'Prisma Next collects anonymous CLI usage data, enabled by default.',
    "What's collected and why: docs/Telemetry.md.",
    'Opt out anytime: DO_NOT_TRACK=1, PRISMA_NEXT_DISABLE_TELEMETRY=1, or set',
    `"enableTelemetry": false in ${configPath}.`,
  ].join(' ');
}

/**
 * Best-effort first-run disclosure + installationId mint. Runs only on the
 * gating-enabled path. Prints the notice to stderr (never stdout) and mints
 * a persistent id without touching `enableTelemetry`, so the interactive
 * `init` consent prompt stays live and no unasked-for consent is recorded.
 *
 * Every step is wrapped so an un-writable config dir (or any other failure)
 * never throws and never blocks the command. On mint failure the id stays
 * undefined: the notice may reprint next run, and `runTelemetry` no-ops on
 * the missing id.
 */
function discloseAndMintOnFirstRun(): void {
  try {
    process.stderr.write(`${firstRunNotice(userConfigPath())}\n`);
  } catch {}
  try {
    ensureInstallationId();
  } catch {}
}

/**
 * True when this run is the interactive `init` first-run that will show
 * the consent prompt — in which case the preAction notice/mint/send must
 * stand down so disclosure happens via the prompt only (and the affirmative
 * send happens via `fireTelemetryAfterInitConsent`).
 *
 * Callers reach this only on the gate-enabled + `installationId === undefined`
 * path, which already guarantees not-CI, no env opt-out, and
 * `enableTelemetry !== false`. The remaining predicate mirrors the prompt's
 * own gate in `init/inputs.ts::resolveTelemetryConsent` exactly:
 *
 * - leaf command is `init`,
 * - the run is prompt-eligible per the shared `deriveCanPrompt` (so it
 *   cannot drift from the value the `init` action handler computes),
 * - `--yes` was not passed (auto-accept skips the prompt),
 * - `enableTelemetry` is still `undefined`.
 *
 * `enableTelemetry` is re-checked here even though `installationId === undefined`
 * usually implies it: keeping the predicate complete pins parity with the
 * prompt's gate rather than relying on the mint/consent coupling.
 */
function interactiveInitPromptWillFire(actionCommand: Command, userConfig: UserConfig): boolean {
  if (commandPathFor(actionCommand).at(-1) !== 'init') {
    return false;
  }
  if (userConfig.enableTelemetry !== undefined) {
    return false;
  }
  const options = actionCommand.optsWithGlobals<CommonCommandOptions>();
  const flags = parseGlobalFlags(options);
  if (flags.yes === true) {
    return false;
  }
  return deriveCanPrompt({
    flagsInteractive: flags.interactive,
    optionInteractive: options.interactive,
    stdinIsTTY: Boolean(process.stdin.isTTY),
  });
}

export function fireTelemetryFromPreAction(actionCommand: Command): TelemetryRunOutcome {
  const gate = resolveTelemetryGate();
  if (!gate.enabled) {
    return gate.outcome;
  }
  if (gate.userConfig.installationId === undefined) {
    if (interactiveInitPromptWillFire(actionCommand, gate.userConfig)) {
      return { spawned: false, reason: 'gated-off' };
    }
    discloseAndMintOnFirstRun();
    return fireTelemetry(actionCommand, readUserConfig());
  }
  return fireTelemetry(actionCommand, gate.userConfig);
}

/**
 * Manual one-shot telemetry path for the first `init` run where the user
 * explicitly answers Yes to the consent prompt. The preAction hook for
 * that same run has already resolved before consent existed, so it is
 * default-off. After consent is persisted, `runInit` calls this helper
 * exactly for that first affirmative answer; subsequent init runs skip
 * it because the prompt is not shown again.
 *
 * The child's c12 load would return `databaseTarget: null` for this
 * specific invocation because `prisma-next.config.*` is not yet on
 * disk (init writes it later in the same run). To preserve the
 * prompt-chosen target in the first-init telemetry event, this
 * helper forwards the value as a parent-side IPC override on
 * `ParentToSenderPayload.databaseTarget` — the child consults the
 * override first and falls back to its c12 result when absent.
 */
export function fireTelemetryAfterInitConsent(
  actionCommand: Command,
  inputs: { readonly databaseTarget: string },
): TelemetryRunOutcome {
  return fireTelemetry(actionCommand, readUserConfig(), {
    databaseTarget: inputs.databaseTarget,
  });
}
