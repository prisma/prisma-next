import type { ContractIR } from '@prisma-next/contract/ir';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';

export interface MigrationHints {
  readonly used: readonly string[];
  readonly applied: readonly string[];
  readonly plannerVersion: string;
  readonly planningStrategy: string;
}

/**
 * Shared fields for all migration manifests (draft and attested).
 */
interface MigrationManifestBase {
  readonly from: string;
  readonly to: string;
  readonly kind: 'regular' | 'baseline';
  readonly fromContract: ContractIR | null;
  readonly toContract: ContractIR;
  readonly hints: MigrationHints;
  readonly labels: readonly string[];
  readonly authorship?: { readonly author?: string; readonly email?: string };
  readonly signature?: { readonly keyId: string; readonly value: string } | null;
  readonly createdAt: string;
}

/**
 * A draft migration that has been planned but not yet attested.
 * Draft migrations have `migrationId: null` and are excluded from
 * graph reconstruction and apply.
 */
export interface DraftMigrationManifest extends MigrationManifestBase {
  readonly migrationId: null;
}

/**
 * An attested migration with a content-addressed migrationId.
 * Only attested migrations participate in the migration graph.
 */
export interface AttestedMigrationManifest extends MigrationManifestBase {
  readonly migrationId: string;
}

/**
 * Union of draft and attested manifests. This is what the on-disk
 * format represents — `migrationId` is `null` for drafts, a string
 * for attested migrations.
 */
export type MigrationManifest = DraftMigrationManifest | AttestedMigrationManifest;

export type MigrationOps = readonly MigrationPlanOperation[];

/**
 * An on-disk migration directory containing a manifest and operations.
 * The manifest may be draft or attested.
 */
export interface MigrationBundle {
  readonly dirName: string;
  readonly dirPath: string;
  readonly manifest: MigrationManifest;
  readonly ops: MigrationOps;
}

/**
 * A bundle known to be attested (migrationId is a string).
 * Use this after filtering bundles to attested-only.
 */
export interface AttestedMigrationBundle extends MigrationBundle {
  readonly manifest: AttestedMigrationManifest;
}

/**
 * An entry in the migration graph. Only attested migrations appear in the
 * graph, so `migrationId` is always a string.
 */
export interface MigrationChainEntry {
  readonly from: string;
  readonly to: string;
  readonly migrationId: string;
  readonly dirName: string;
  readonly createdAt: string;
  readonly labels: readonly string[];
}

export interface MigrationGraph {
  readonly nodes: ReadonlySet<string>;
  readonly forwardChain: ReadonlyMap<string, readonly MigrationChainEntry[]>;
  readonly reverseChain: ReadonlyMap<string, readonly MigrationChainEntry[]>;
  readonly migrationById: ReadonlyMap<string, MigrationChainEntry>;
}

/**
 * Type guard that narrows a MigrationBundle to an AttestedMigrationBundle.
 * Use with `.filter(isAttested)` to get a typed array of attested bundles.
 */
export function isAttested(bundle: MigrationBundle): bundle is AttestedMigrationBundle {
  return typeof bundle.manifest.migrationId === 'string';
}
