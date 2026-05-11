import type { ExecutionPlan } from '@prisma-next/framework-components/runtime';
import type { MarkerReadResult, SqlQueryable } from '@prisma-next/sql-relational-core/ast';

/**
 * Reader of the SQL contract marker. SQL runtimes call `readMarker` before executing user queries (when `verify` is enabled). The adapter owns the full marker-read flow — probing for storage, issuing the read, decoding the row — and returns a tagged result so callers can distinguish "marker storage missing", "no row for this space", and "present".
 */
export interface MarkerReader {
  readMarker(queryable: SqlQueryable): Promise<MarkerReadResult>;
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
