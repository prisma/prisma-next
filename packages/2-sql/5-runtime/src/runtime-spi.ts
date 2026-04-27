import type { ExecutionPlan } from '@prisma-next/framework-components/runtime';
import type { MarkerStatement } from '@prisma-next/sql-relational-core/ast';

/**
 * Reader of the SQL contract marker. SQL runtimes verify the database's
 * `prisma_contract.marker` row against the runtime's contract by issuing
 * this statement before executing user queries (when `verify` is enabled).
 *
 * Structurally satisfied by `AdapterProfile`, which already exposes
 * `readMarkerStatement(): MarkerStatement` for adapter-level introspection.
 */
export interface MarkerReader {
  readMarkerStatement(): MarkerStatement;
}

/**
 * SQL family adapter SPI consumed by `SqlRuntime`. Encapsulates the
 * runtime contract, marker reader, and plan validation logic so the
 * runtime can be unit-tested without a concrete SQL adapter profile.
 *
 * Implemented by `SqlFamilyAdapter` for production and by mock classes
 * in tests.
 */
export interface RuntimeFamilyAdapter<TContract = unknown> {
  readonly contract: TContract;
  readonly markerReader: MarkerReader;
  validatePlan(plan: ExecutionPlan, contract: TContract): void;
}

export interface RuntimeVerifyOptions {
  readonly mode: 'onFirstUse' | 'startup' | 'always';
  readonly requireMarker: boolean;
}

export type TelemetryOutcome = 'success' | 'runtime-error';

export interface RuntimeTelemetryEvent {
  readonly lane: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly outcome: TelemetryOutcome;
  readonly durationMs?: number;
}
