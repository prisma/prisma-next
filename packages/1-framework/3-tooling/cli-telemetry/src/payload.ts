/**
 * Wire-shape payload the parent IPC-sends to the forked child sender.
 * Mirrors the fields the parent has naturally in hand at command start
 * (installation id, sanitised command + flags, CLI version, db target,
 * extension-pack ids, project root for TS-version lookup). The child
 * fills in the rest (runtime/os/arch, package manager, ts version,
 * agent) on its side.
 *
 * Both sides version-couple on this shape because the IPC carrier is
 * structured-cloned by Node and there's no on-wire compat to maintain.
 */
export interface ParentToSenderPayload {
  readonly installationId: string;
  readonly version: string;
  readonly command: string;
  readonly flags: readonly string[];
  readonly databaseTarget: string | null;
  readonly extensions: readonly string[];
  /** Absolute path of the user's project. The child reads `<projectRoot>/package.json` for `tsVersion`. */
  readonly projectRoot: string;
  /** Resolved endpoint URL (already includes the `/events` path). */
  readonly endpoint: string;
}

/**
 * The full event the child POSTs to the backend. Shape matches the
 * backend's arktype schema (`apps/telemetry-backend/src/schema.ts`).
 */
export interface TelemetryEvent {
  readonly installationId: string;
  readonly version: string;
  readonly command: string;
  readonly flags: readonly string[];
  readonly runtimeName: string;
  readonly runtimeVersion: string;
  readonly os: string;
  readonly arch: string;
  readonly packageManager: string | null;
  readonly databaseTarget: string | null;
  readonly tsVersion: string | null;
  readonly agent: string | null;
  readonly extensions: readonly string[];
}
