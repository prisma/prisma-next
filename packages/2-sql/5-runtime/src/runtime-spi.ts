import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type { ExecutionPlan } from '@prisma-next/framework-components/runtime';
import type { MarkerStatement } from '@prisma-next/sql-relational-core/ast';

/**
 * Reader of the SQL contract marker. SQL runtimes verify the database's
 * `prisma_contract.marker` row against the runtime's contract by issuing
 * this statement before executing user queries (when `verify` is enabled).
 *
 * Structurally satisfied by `AdapterProfile`, which exposes both
 * `readMarkerStatement(): MarkerStatement` and the row parser. Each adapter
 * is responsible for target-specific row decoding (Postgres returns native
 * arrays; SQLite returns JSON-encoded TEXT for `invariants`) before
 * delegating to the shared row schema.
 */
export interface MarkerReader {
  readMarkerStatement(): MarkerStatement;
  parseMarkerRow(row: unknown): ContractMarkerRecord;
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
