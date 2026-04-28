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
 * The on-disk JSON shape in `migration.json` matches this type field-for-field
 * — `JSON.stringify(metadata, null, 2)` is the canonical writer output.
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
