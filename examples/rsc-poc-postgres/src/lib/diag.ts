/**
 * In-process diagnostic counters for the RSC concurrency PoC.
 *
 * These counters are populated by instrumented wrappers around `pg.Pool` (see
 * `pool.ts`) and surfaced in the dev-only `<DiagPanel />` at page bottom. They
 * also back the H3 integration test.
 *
 * Counters are pinned to `globalThis` for the same reason the db singleton is:
 * Next.js HMR re-evaluates this module on every edit, and we need counts to
 * survive re-evaluation during a single dev session so the panel doesn't lie
 * after a hot reload.
 *
 * Each counter is keyed by `verifyMode` so `/` (onFirstUse) and
 * `/stress/always` (always) report independently — they're testing different
 * things.
 */

import type { VerifyMode } from './db';

export interface DiagCounters {
  /** Number of times `prisma_contract.marker` has been read since process start. */
  markerReads: number;
  /** Number of times a pg pool connection has been acquired since process start. */
  connectionAcquires: number;
  /** Number of times a pg pool connection has been released since process start. */
  connectionReleases: number;
}

export interface DiagSnapshot extends DiagCounters {
  readonly verifyMode: VerifyMode;
  readonly timestampMs: number;
}

type DiagRegistry = Map<VerifyMode, DiagCounters>;

const REGISTRY_KEY = Symbol.for('prisma-next.rsc-poc-postgres.diag');

interface GlobalWithDiag {
  [REGISTRY_KEY]?: DiagRegistry;
}

function getRegistry(): DiagRegistry {
  const g = globalThis as unknown as GlobalWithDiag;
  let registry = g[REGISTRY_KEY];
  if (!registry) {
    registry = new Map();
    g[REGISTRY_KEY] = registry;
  }
  return registry;
}

function getOrCreate(verifyMode: VerifyMode): DiagCounters {
  const registry = getRegistry();
  let counters = registry.get(verifyMode);
  if (!counters) {
    counters = {
      markerReads: 0,
      connectionAcquires: 0,
      connectionReleases: 0,
    };
    registry.set(verifyMode, counters);
  }
  return counters;
}

/**
 * SQL fragment that identifies a contract marker read. The runtime's
 * `verifyPlanIfNeeded()` goes through `driver.query(sql, params)` with a
 * stable SQL template from `PostgresAdapterImpl`; we match on the marker
 * table reference to detect it regardless of exact whitespace.
 */
const MARKER_SQL_FRAGMENT = 'prisma_contract.marker';

export function isMarkerReadSql(sql: string): boolean {
  return sql.includes(MARKER_SQL_FRAGMENT);
}

export function recordMarkerRead(verifyMode: VerifyMode): void {
  const counters = getOrCreate(verifyMode);
  counters.markerReads += 1;
}

export function recordConnectionAcquire(verifyMode: VerifyMode): void {
  const counters = getOrCreate(verifyMode);
  counters.connectionAcquires += 1;
}

export function recordConnectionRelease(verifyMode: VerifyMode): void {
  const counters = getOrCreate(verifyMode);
  counters.connectionReleases += 1;
}

export function snapshot(verifyMode: VerifyMode): DiagSnapshot {
  const counters = getOrCreate(verifyMode);
  return {
    verifyMode,
    timestampMs: Date.now(),
    markerReads: counters.markerReads,
    connectionAcquires: counters.connectionAcquires,
    connectionReleases: counters.connectionReleases,
  };
}

export function snapshotAll(): readonly DiagSnapshot[] {
  const registry = getRegistry();
  return [...registry.keys()].map((mode) => snapshot(mode));
}

export function reset(verifyMode?: VerifyMode): void {
  const registry = getRegistry();
  if (verifyMode === undefined) {
    registry.clear();
    return;
  }
  registry.delete(verifyMode);
}
