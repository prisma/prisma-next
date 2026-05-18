import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveTelemetryEndpoint } from './endpoint';
import { resolveGating } from './gating';
import type { ParentToSenderPayload } from './payload';
import { type CommanderResultShape, sanitizeCommanderResult } from './sanitize';
import { readUserConfig } from './user-config';

/**
 * Inputs the CLI entry point hands the telemetry layer at command
 * start. The CLI is responsible for stitching commander's result, the
 * loaded config, and the project root together; the telemetry module
 * does no I/O of its own except for the user-config read (which can be
 * skipped by passing a cached value).
 */
export interface RunTelemetryInputs {
  /** Sanitised commander snapshot — see `CommanderResultShape`. */
  readonly command: CommanderResultShape;
  /** This CLI's own version (from its `package.json`). */
  readonly version: string;
  /** Resolved `config.target.targetId`, or `null` when the config could not be loaded. */
  readonly databaseTarget: string | null;
  /** Declared extension-pack IDs, in any deterministic order. */
  readonly extensions: readonly string[];
  /** Absolute path of the project root (typically `process.cwd()`). */
  readonly projectRoot: string;
  /**
   * Path to the sender entry compiled into this package's `dist/`.
   * Resolved by the caller because the compiled sender lives at
   * `<package>/dist/sender.mjs` and only the consumer knows its own
   * `import.meta.url`.
   */
  readonly senderPath: string;
  /**
   * `isCI()` result from the consumer. Telemetry is suppressed when
   * `true` regardless of the stored consent answer — CI environments
   * never emit (matches the colour-output convention's CI suppression).
   */
  readonly isCI: boolean;
  /** Process env to read for opt-out signals. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Best-effort telemetry spawn at command start. Returns synchronously —
 * the fork runs in the background and never blocks the parent. Every
 * failure mode is swallowed; the parent's stdout/stderr is untouched in
 * normal operation, the only escape valve being
 * `PRISMA_NEXT_DEBUG=1` which routes diagnostics to stderr.
 *
 * Returns the spawn outcome so debug-mode logging and the test-harness
 * probe (which verifies test runs short-circuit the fork) can inspect
 * the decision without scraping stderr.
 */
export type TelemetryRunOutcome =
  | { readonly spawned: true }
  | { readonly spawned: false; readonly reason: 'gated-off' | 'ci' | 'fork-failed' };

export function runTelemetry(inputs: RunTelemetryInputs): TelemetryRunOutcome {
  const env = inputs.env ?? process.env;

  if (inputs.isCI) {
    return { spawned: false, reason: 'ci' };
  }

  const gating = resolveGating({ env, config: readUserConfig() });
  if (!gating.enabled) {
    return { spawned: false, reason: 'gated-off' };
  }

  const sanitised = sanitizeCommanderResult(inputs.command);
  const config = readUserConfig();
  // Gating already confirmed enableTelemetry === true, so installationId
  // must be set (writeUserConfig generates it alongside that field).
  // Defence-in-depth: if a stale config has the flag but no id, skip
  // rather than send a junk event.
  if (typeof config.installationId !== 'string' || config.installationId.length === 0) {
    return { spawned: false, reason: 'gated-off' };
  }

  const payload: ParentToSenderPayload = {
    installationId: config.installationId,
    version: inputs.version,
    command: sanitised.command,
    flags: sanitised.flags,
    databaseTarget: inputs.databaseTarget,
    extensions: inputs.extensions,
    projectRoot: inputs.projectRoot,
    endpoint: resolveTelemetryEndpoint(env),
  };

  try {
    const child = fork(inputs.senderPath, [], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
    });
    child.send(payload, (err) => {
      if (err !== null && process.env['PRISMA_NEXT_DEBUG'] === '1') {
        process.stderr.write(`[cli-telemetry] parent send error: ${String(err)}\n`);
      }
    });
    child.disconnect();
    child.unref();
    return { spawned: true };
  } catch (err) {
    if (process.env['PRISMA_NEXT_DEBUG'] === '1') {
      process.stderr.write(`[cli-telemetry] parent fork failed: ${String(err)}\n`);
    }
    return { spawned: false, reason: 'fork-failed' };
  }
}

/**
 * Resolve the path to the compiled sender entry relative to a consumer
 * that has captured its own `import.meta.url`. The CLI's
 * `tsdown`-emitted entry sits at `<package>/dist/sender.mjs`; the
 * consumer asks `senderModuleUrl()` and forwards the result to
 * `runTelemetry({ senderPath })`.
 */
export function senderModuleUrl(importMetaUrl: string): string {
  return fileURLToPath(new URL('./sender.mjs', importMetaUrl));
}
