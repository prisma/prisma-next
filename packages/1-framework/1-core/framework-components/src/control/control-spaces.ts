import type { Contract } from '@prisma-next/contract/types';
import type { MigrationMetadata, MigrationPlanOperation } from './control-migration-types';

/**
 * Canonical control-plane identifiers for contract spaces.
 *
 * A contract space is the disjoint `(contract.json, migration-graph)` unit
 * the per-space planner / runner / verifier (project: extension contract
 * spaces, TML-2397) operates on. The application owns one well-known
 * space — the value below — and each loaded extension that contributes
 * schema owns a uniquely-named space.
 *
 * Lives in `framework-components/control` so every layer that has to
 * reason about space identity (the migration tooling, the SQL runtime's
 * marker reader, target-side statement builders, target-side adapters)
 * can import a single value rather than duplicating the literal. Raw
 * `'app'` string literals in framework / target / runtime / adapter
 * source code are forbidden and policed by
 * `scripts/lint-app-space-id.mjs` (wired into `pnpm lint:deps`).
 *
 * @see specs/framework-mechanism.spec.md § 3 — Layout convention (γ).
 */
export const APP_SPACE_ID = 'app' as const;

/**
 * Pinned head ref for a contract space — the `(hash, invariants)` tuple
 * a runner targets when applying that space's migration graph. Identical
 * in shape to the on-disk `migrations/<space-id>/refs/head.json` the
 * framework writes per loaded extension, and to the app-space
 * `<projectRoot>/refs/head.json`. Family-agnostic: SQL, Mongo, and any
 * future family share the same head-ref shape.
 *
 * @see specs/framework-mechanism.spec.md § 1.
 */
export interface ContractSpaceHeadRef {
  readonly hash: string;
  readonly invariants: readonly string[];
}

/**
 * In-memory authored migration package as published by an extension's
 * descriptor module (or by the app-space planner before emission).
 * Mirrors the on-disk
 * {@link import('@prisma-next/migration-tools/package').MigrationPackage}
 * shape minus `dirPath` — at descriptor / planner construction time the
 * package has not yet been materialised to the user's repo, so there is
 * no path to record.
 *
 * The framework's pinned-artefact emission step
 * (`writeAuthoredMigrationPackage` in `@prisma-next/migration-tools/io`)
 * materialises each package into `migrations/<space-id>/<dirName>/`.
 *
 * @see specs/framework-mechanism.spec.md § 1, § 3.
 */
export interface AuthoredMigrationPackage {
  readonly dirName: string;
  readonly metadata: MigrationMetadata;
  readonly ops: readonly MigrationPlanOperation[];
}

/**
 * In-memory contract-space view a schema-contributing extension
 * publishes through its descriptor module: the canonical contract value,
 * the migration graph authored against it, and the pinned head ref. The
 * framework reads this value only at authoring time (during `migrate`);
 * apply / verify paths read the user's repo
 * (`migrations/<space-id>/...`) instead.
 *
 * Generic over the storage block so SQL extensions can specialise
 * `AuthoredContractSpace<SqlStorage>` while the framework type stays
 * family-agnostic.
 *
 * @see specs/framework-mechanism.spec.md § 1.
 */
export interface AuthoredContractSpace<TContract extends Contract = Contract> {
  readonly contractJson: TContract;
  readonly migrations: readonly AuthoredMigrationPackage[];
  readonly headRef: ContractSpaceHeadRef;
}
