import { type } from 'arktype';

/**
 * Wire-shape payload the parent IPC-sends to the forked child sender.
 * Mirrors only the fields the parent has naturally in hand at command
 * start: installation id, sanitised command + flags, CLI version, and
 * the project root the child uses to discover everything else. The
 * child probes its own process (runtime/os/arch, package manager, ts
 * version, agent) and reads the user's `prisma-next.config.*` via
 * c12 to derive `databaseTarget` and `extensions` — keeping those
 * fields off the wire eliminates the original c12-await-in-preAction
 * race against synchronous parent crashes (see PR #556's design
 * dialogue) at the cost of the child evaluating user TS config code.
 *
 * Both sides version-couple on this shape because the IPC carrier is
 * structured-cloned by Node and there's no on-wire compat to maintain.
 */
export interface ParentToSenderPayload {
  readonly installationId: string;
  readonly version: string;
  readonly command: string;
  readonly flags: readonly string[];
  /**
   * Absolute path of the user's project. The child reads
   * `<projectRoot>/package.json` for `tsVersion` and loads
   * `<projectRoot>/prisma-next.config.*` via c12 for `databaseTarget`
   * + `extensions`.
   */
  readonly projectRoot: string;
  /** Resolved endpoint URL (already includes the `/events` path). */
  readonly endpoint: string;
}

/**
 * Runtime validator for {@link ParentToSenderPayload}. The child sender
 * uses this to gate `postEvent` so a payload missing a required field
 * cannot silently produce a degraded telemetry event downstream.
 *
 * Mirrors the backend's own arktype schema in spirit: required scalars
 * must be non-empty strings; `databaseTarget` is `string | null`; the
 * two string arrays are validated element-by-element. Size caps are
 * enforced by the backend, not here — IPC is structured-cloned and
 * the parent/child agree on the schema by version-coupling.
 */
const requiredString = type.string.moreThanLength(0);
const stringArray = type.string.array();

export const parentToSenderPayloadSchema = type({
  installationId: requiredString,
  version: requiredString,
  command: requiredString,
  flags: stringArray,
  projectRoot: requiredString,
  endpoint: requiredString,
});

export function isParentToSenderPayload(value: unknown): value is ParentToSenderPayload {
  return !(parentToSenderPayloadSchema(value) instanceof type.errors);
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
