import type { Contract } from '@prisma-next/contract/types';

export interface MigrationHints {
  readonly used: readonly string[];
  readonly applied: readonly string[];
  readonly plannerVersion: string;
}

/**
 * In-memory migration metadata envelope. Every migration is content-addressed:
 * the `migrationHash` is a hash over the metadata envelope plus the operations
 * list, computed at write time. There is no draft state — a migration
 * directory either exists with fully attested metadata or it does not.
 *
 * When the planner cannot lower an operation because of an unfilled
 * `placeholder(...)` slot, the migration is still written with `migrationHash`
 * hashed over `ops: []`. Re-running self-emit after the user fills the
 * placeholder produces a *different* `migrationHash` (committed to the real
 * ops); this is intentional.
 *
 * This is the in-memory shape. The on-disk JSON wire format in `migration.json`
 * still uses the field name `migrationId`; the rename to `migrationHash` on
 * disk happens in Phase 5 of the `migrationHash` integrity work (TML-2264).
 * Until then, use {@link metadataFromWire} and {@link metadataToWire} at the
 * JSON read/write boundary.
 */
export interface MigrationMetadata {
  readonly migrationHash: string;
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

/**
 * On-disk JSON shape of `migration.json`. Differs from {@link MigrationMetadata}
 * by exactly one field name: `migrationId` (wire) vs. `migrationHash`
 * (in-memory). The wire-format codemod is Phase 5 of the `migrationHash`
 * integrity work (TML-2264); once it lands, this type and the translator
 * helpers below collapse into {@link MigrationMetadata} and disappear.
 */
export interface MigrationMetadataWire extends Omit<MigrationMetadata, 'migrationHash'> {
  readonly migrationId: string;
}

/**
 * Translate a parsed-from-JSON metadata record into the in-memory shape.
 *
 * Transitional helper for Phase 4 of TML-2264 — the in-memory type uses
 * `migrationHash` while `migration.json` still serializes `migrationId`.
 * Phase 5's wire-format codemod renames the JSON field, after which this
 * helper can be deleted.
 */
export function metadataFromWire(wire: MigrationMetadataWire): MigrationMetadata {
  const { migrationId, ...rest } = wire;
  return { ...rest, migrationHash: migrationId };
}

/**
 * Translate an in-memory metadata record to the on-disk wire shape.
 *
 * Transitional helper for Phase 4 of TML-2264 — see {@link metadataFromWire}.
 */
export function metadataToWire(metadata: MigrationMetadata): MigrationMetadataWire {
  const { migrationHash, ...rest } = metadata;
  return { ...rest, migrationId: migrationHash };
}
