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
import { ifDefined } from '@prisma-next/utils/defined';
import type { Command } from 'commander';
import { version as CLI_VERSION } from '../../package.json' with { type: 'json' };
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
export function fireTelemetryFromPreAction(actionCommand: Command): TelemetryRunOutcome {
  const gate = resolveTelemetryGate();
  if (!gate.enabled) {
    return gate.outcome;
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
