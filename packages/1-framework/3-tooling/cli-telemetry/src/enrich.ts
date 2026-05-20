import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import { detectAgent } from './detect-agent';
import type { ParentToSenderPayload, TelemetryEvent } from './payload';

/**
 * Versions surface the enrichment cares about. Modelled as a structural
 * record with a required `node` field so tests can pass a literal object
 * without faking every field of `NodeJS.ProcessVersions` (which adds
 * properties between Node versions and includes a long tail the
 * enrichment never touches). Both `bun` and `deno` are read on the
 * runtime-resolution path; everything else is ignored.
 */
export interface VersionsSnapshot {
  readonly node: string;
  readonly bun?: string;
  readonly deno?: string;
}

/**
 * Snapshot of process-level inputs the enrichment reads. Tests pass an
 * explicit snapshot so the enrichment is deterministic per case; the
 * sender entry point passes a fresh snapshot from `process`.
 */
export interface EnrichEnvironment {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly versions: VersionsSnapshot;
  /**
   * Included because package-manager and agent detection intentionally read
   * environment variables from the same process snapshot as platform/versions.
   */
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * Best-effort reader for the project's `package.json`, used only to derive
   * the optional `tsVersion` telemetry field. Returning `null` means unknown.
   */
  readonly readProjectPackageJson: () => string | null;
}

/**
 * Identify the runtime the sender is running in. Same-runtime as the
 * parent is a correctness requirement: the parent forked us via
 * `child_process.fork`, which inherits the parent's runtime. Detection
 * keys on the runtime-specific version field rather than env vars so a
 * spoofed env can't lie about the actual interpreter.
 */
function resolveRuntime(versions: VersionsSnapshot): {
  readonly name: 'node' | 'bun' | 'deno';
  readonly version: string;
} {
  if (versions.bun !== undefined) {
    return { name: 'bun', version: versions.bun };
  }
  if (versions.deno !== undefined) {
    return { name: 'deno', version: versions.deno };
  }
  return { name: 'node', version: versions.node };
}

/**
 * Parse `npm_config_user_agent` into a `<pm>/<version>` token. The
 * value, when present, looks like
 * `"pnpm/10.27.0 npm/? node/v24.13.0 darwin arm64"` — we take the first
 * whitespace-separated token. Any failure → `null`.
 */
export function parsePackageManager(userAgent: string | undefined): string | null {
  if (userAgent === undefined) return null;
  const first = userAgent.split(/\s+/)[0];
  if (first === undefined || first.length === 0) return null;
  if (!first.includes('/')) return null;
  return first;
}

/**
 * Read the user's project `package.json` and resolve a TypeScript
 * version from `devDependencies.typescript` (preferred) or
 * `dependencies.typescript`. Strips a leading `^` or `~` semver
 * prefix. Returns `null` on any failure mode — file missing,
 * unreadable, malformed JSON, key absent, not a string.
 */
export function readTsVersionFromPackageJson(raw: string | null): string | null {
  if (raw === null) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const candidate =
    pickStringDep(parsed['devDependencies']) ?? pickStringDep(parsed['dependencies']);
  if (candidate === null) return null;
  return candidate.replace(/^[\^~]/, '');
}

function pickStringDep(deps: unknown): string | null {
  if (deps === null || typeof deps !== 'object' || Array.isArray(deps)) return null;
  const value = (deps as Record<string, unknown>)['typescript'];
  return typeof value === 'string' ? value : null;
}

/**
 * Build the full backend event from the parent's payload and the
 * child's per-process snapshot. Pure given an `EnrichEnvironment`.
 */
export function buildTelemetryEvent(
  payload: ParentToSenderPayload,
  env: EnrichEnvironment,
): TelemetryEvent {
  const runtime = resolveRuntime(env.versions);
  return {
    installationId: payload.installationId,
    version: payload.version,
    command: payload.command,
    flags: payload.flags,
    runtimeName: runtime.name,
    runtimeVersion: runtime.version,
    os: env.platform,
    arch: env.arch,
    packageManager: parsePackageManager(env.env['npm_config_user_agent']),
    databaseTarget: payload.databaseTarget,
    tsVersion: readTsVersionFromPackageJson(env.readProjectPackageJson()),
    agent: detectAgent(env.env),
    extensions: payload.extensions,
  };
}

/**
 * Convenience for the sender entry: build the event from the live
 * `process` plus a real project-package.json reader, swallowing any
 * I/O errors in the file read.
 */
export function buildTelemetryEventFromProcess(payload: ParentToSenderPayload): TelemetryEvent {
  return buildTelemetryEvent(payload, {
    platform: process.platform,
    arch: process.arch,
    versions: process.versions,
    env: process.env,
    readProjectPackageJson: () => {
      try {
        return readFileSync(join(payload.projectRoot, 'package.json'), 'utf-8');
      } catch {
        return null;
      }
    },
  });
}
