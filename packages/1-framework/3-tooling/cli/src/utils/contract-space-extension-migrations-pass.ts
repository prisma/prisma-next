import { materialiseExtensionMigrationPackageIfMissing } from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import type { MigrationOps } from '@prisma-next/migration-tools/package';
import {
  planAllSpaces,
  type SpacePlanOutput,
  spaceMigrationDirectory,
} from '@prisma-next/migration-tools/spaces';

/**
 * In-memory authored migration package shipped by an extension descriptor.
 * Mirrors `MigrationPackageContents` from `@prisma-next/migration-tools/io`
 * (the on-disk shape minus `dirPath`); redeclared structurally here so
 * the CLI helper does not couple to the SQL family's `ExtensionMigrationPackage`
 * type — any family that ships pre-built migration packages can pass them
 * through unchanged.
 */
export interface DescriptorMigrationPackage {
  readonly dirName: string;
  readonly metadata: MigrationMetadata;
  readonly ops: MigrationOps;
}

/**
 * Minimal descriptor view consumed by the migration-materialisation pass.
 * Mirrors {@link import('./contract-space-migrate-pass').MigrateExtensionInput}
 * but adds the `migrations` field — the canonical set of pre-built
 * migration packages the extension ships.
 */
export interface ExtensionMigrationsExtensionInput {
  readonly id: string;
  readonly contractSpace?: {
    readonly contractJson: unknown;
    readonly migrations: readonly DescriptorMigrationPackage[];
    readonly headRef: { readonly hash: string; readonly invariants: readonly string[] };
  };
}

export interface ContractSpaceExtensionMigrationsPassInputs {
  readonly migrationsDir: string;
  readonly extensionPacks: ReadonlyArray<ExtensionMigrationsExtensionInput>;
}

export interface ContractSpaceExtensionMigrationsPassResult {
  readonly emitted: readonly { readonly spaceId: string; readonly dirName: string }[];
  readonly skipped: readonly { readonly spaceId: string; readonly dirName: string }[];
}

/**
 * Materialise an extension's pre-built migration packages onto disk
 * under `migrations/<spaceId>/<dirName>/` for every package that does
 * not yet exist there.
 *
 * Helper-location pattern — the per-space "planner" for extension
 * spaces is a no-op that just returns the descriptor's `migrations`
 * verbatim; the value `planAllSpaces` brings to this consumer site is
 * **deterministic ordering** (alphabetical by spaceId) and
 * **duplicate-spaceId detection**. The actual write is performed via
 * `materialiseMigrationPackage` per package.
 *
 * Idempotent: an existing `migrations/<spaceId>/<dirName>/` is left
 * untouched and reported in `result.skipped` — the helper never
 * overwrites authored migration content, ensuring re-running
 * `migrate` does not corrupt or churn extension migration packages.
 *
 * Per-space artefacts (`contract.json`, `contract.d.ts`,
 * `refs/head.json`) are emitted by
 * {@link import('./contract-space-migrate-pass').runContractSpaceMigratePass}
 * separately — they cover the head-pointer side of the ledger. This
 * helper covers the migration-graph side.
 */
export async function runContractSpaceExtensionMigrationsPass(
  inputs: ContractSpaceExtensionMigrationsPassInputs,
): Promise<ContractSpaceExtensionMigrationsPassResult> {
  const planInputs = inputs.extensionPacks
    .filter(
      (
        pack,
      ): pack is ExtensionMigrationsExtensionInput & {
        contractSpace: NonNullable<ExtensionMigrationsExtensionInput['contractSpace']>;
      } => pack.contractSpace !== undefined,
    )
    .map((pack) => ({
      spaceId: pack.id,
      priorContract: null,
      newContract: pack.contractSpace.contractJson,
      __migrations: pack.contractSpace.migrations,
    }));

  // Threading the descriptor's pre-built migrations into the
  // `planAllSpaces` callback by piggybacking on the input shape.
  // The framework helper is generic over the per-space planner output;
  // here the "planner" is a no-op that returns the descriptor's
  // `migrations` array. The benefit of routing through `planAllSpaces`
  // is duplicate-spaceId detection + alphabetical ordering — failures
  // there throw `MIGRATION.DUPLICATE_SPACE_ID` before any write.
  const planned: readonly SpacePlanOutput<DescriptorMigrationPackage>[] = planAllSpaces(
    planInputs,
    (input) =>
      (input as typeof input & { readonly __migrations: readonly DescriptorMigrationPackage[] })
        .__migrations,
  );

  const emitted: { spaceId: string; dirName: string }[] = [];
  const skipped: { spaceId: string; dirName: string }[] = [];

  for (const space of planned) {
    const spaceDir = spaceMigrationDirectory(inputs.migrationsDir, space.spaceId);
    for (const pkg of space.migrationPackages) {
      const { written } = await materialiseExtensionMigrationPackageIfMissing(spaceDir, pkg);
      if (written) {
        emitted.push({ spaceId: space.spaceId, dirName: pkg.dirName });
      } else {
        skipped.push({ spaceId: space.spaceId, dirName: pkg.dirName });
      }
    }
  }

  return { emitted, skipped };
}
