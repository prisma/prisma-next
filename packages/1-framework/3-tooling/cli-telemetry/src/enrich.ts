import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import { detectAgent } from './detect-agent';
import type { ParentToSenderPayload, TelemetryEvent } from './payload';

/**
 * Subset of the user's `prisma-next.config.*` the telemetry event
 * surfaces. Loaded inside the detached child via {@link loadProjectConfig}
 * — see the design rationale on {@link ParentToSenderPayload} for why
 * this side runs c12 instead of the parent CLI.
 */
export interface ProjectConfigFields {
  readonly databaseTarget: string | null;
  readonly extensions: readonly string[];
}

const EMPTY_PROJECT_CONFIG: ProjectConfigFields = {
  databaseTarget: null,
  extensions: [],
};

/**
 * Best-effort load of `prisma-next.config.*` from `projectRoot` via
 * c12. Returns `{ databaseTarget: null, extensions: [] }` on any
 * failure mode — missing config file (e.g. before `prisma-next init`),
 * malformed shape, c12 throws on user-code evaluation, etc. Telemetry
 * is non-blocking and best-effort; an empty result is the only
 * downside of an unloadable config.
 *
 * `c12` is imported lazily so the detached sender's cold-start cost is
 * paid only when telemetry actually fires, not on every fork even when
 * gates short-circuit before reaching this code path.
 */
export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfigFields> {
  try {
    const { loadConfig } = await import('c12');
    const result = await loadConfig<Record<string, unknown>>({
      name: 'prisma-next',
      cwd: projectRoot,
      dotenv: false,
      rcFile: false,
      globalRc: false,
    });
    const record: Record<string, unknown> | null = result.config ?? null;
    if (record === null) {
      return EMPTY_PROJECT_CONFIG;
    }
    const target = record['target'];
    const databaseTarget =
      target !== null &&
      typeof target === 'object' &&
      'targetId' in target &&
      typeof (target as { targetId: unknown }).targetId === 'string'
        ? (target as { targetId: string }).targetId
        : null;
    const packs = record['extensionPacks'];
    const extensions = Array.isArray(packs)
      ? packs
          .map((pack: unknown) =>
            pack !== null &&
            typeof pack === 'object' &&
            'id' in pack &&
            typeof (pack as { id: unknown }).id === 'string'
              ? (pack as { id: string }).id
              : null,
          )
          .filter((id): id is string => id !== null)
      : [];
    return { databaseTarget, extensions };
  } catch {
    return EMPTY_PROJECT_CONFIG;
  }
}

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
 * Build the full backend event from the parent's payload, the
 * c12-loaded project-config slice, and the child's per-process
 * snapshot. Pure given a `projectConfig` + `EnrichEnvironment`.
 */
export function buildTelemetryEvent(
  payload: ParentToSenderPayload,
  projectConfig: ProjectConfigFields,
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
    databaseTarget: projectConfig.databaseTarget,
    tsVersion: readTsVersionFromPackageJson(env.readProjectPackageJson()),
    agent: detectAgent(env.env),
    extensions: projectConfig.extensions,
  };
}

/**
 * Convenience for the sender entry: build the event from the live
 * `process` plus a c12 load of `prisma-next.config.*` from
 * `payload.projectRoot` plus a real project-package.json reader,
 * swallowing any I/O errors in the file read.
 */
export async function buildTelemetryEventFromProcess(
  payload: ParentToSenderPayload,
): Promise<TelemetryEvent> {
  const projectConfig = await loadProjectConfig(payload.projectRoot);
  return buildTelemetryEvent(payload, projectConfig, {
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
