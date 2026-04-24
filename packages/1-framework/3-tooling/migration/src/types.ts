import type { Contract } from '@prisma-next/contract/types';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';

export interface MigrationHints {
  readonly used: readonly string[];
  readonly applied: readonly string[];
  readonly plannerVersion: string;
}

/**
 * On-disk migration manifest. Every migration is content-addressed: the
 * `migrationId` is a hash over the manifest envelope plus the operations
 * list, computed at write time. There is no draft state — a migration
 * directory either exists with a fully attested manifest or it does not.
 *
 * When the planner cannot lower an operation because of an unfilled
 * `placeholder(...)` slot, the migration is still written with
 * `migrationId` hashed over `ops: []`. Re-running self-emit after the
 * user fills the placeholder produces a *different* `migrationId`
 * (committed to the real ops); this is intentional.
 */
export interface MigrationManifest {
  readonly migrationId: string;
  readonly from: string;
  readonly to: string;
  readonly kind: 'regular' | 'baseline';
  readonly fromContract: Contract | null;
  readonly toContract: Contract;
  readonly hints: MigrationHints;
  readonly labels: readonly string[];
  readonly authorship?: { readonly author?: string; readonly email?: string };
  readonly signature?: { readonly keyId: string; readonly value: string } | null;
  readonly createdAt: string;
}

export type MigrationOps = readonly MigrationPlanOperation[];

/**
 * An on-disk migration directory containing a manifest and operations.
 */
export interface MigrationBundle {
  readonly dirName: string;
  readonly dirPath: string;
  readonly manifest: MigrationManifest;
  readonly ops: MigrationOps;
}

/**
 * A directed edge in the migration graph. All on-disk migrations are
 * attested, so `migrationId` is always a string.
 */
export interface MigrationEdge {
  readonly from: string;
  readonly to: string;
  readonly migrationId: string;
  readonly dirName: string;
  readonly createdAt: string;
  readonly labels: readonly string[];
}

export interface MigrationGraph {
  readonly nodes: ReadonlySet<string>;
  readonly forwardChain: ReadonlyMap<string, readonly MigrationEdge[]>;
  readonly reverseChain: ReadonlyMap<string, readonly MigrationEdge[]>;
  readonly migrationById: ReadonlyMap<string, MigrationEdge>;
}
