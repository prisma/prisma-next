/**
 * Single descriptor-import boundary for CLI consumers of `Config.extensionPacks`.
 *
 * Every CLI command / utility that reads an extension descriptor's
 * `contractSpace` projection (loader, migrate-pass, extension-migrations
 * pass, migration commands) goes through {@link toExtensionInputs}. The
 * structural cast `pack as { contractSpace?: ... }` lives **only** here —
 * downstream code consumes the canonical shape and maps it to its own
 * narrower shape via the per-consumer adapters below.
 *
 * This is the AC11 helper for the M6 (extension-contract-spaces) milestone.
 *
 * The CLI receives extension descriptors typed against the SQL family
 * (or any other family in the future); this helper only depends on the
 * structural shape of `contractSpace`. SQL-family callers pass the same
 * `contractJson` / `headRef.hash` value through unchanged.
 */
import type { DeclaredExtensionEntry } from '@prisma-next/migration-tools/aggregate';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import type { MigrationOps } from '@prisma-next/migration-tools/package';
import type { ExtensionMigrationsExtensionInput } from './contract-space-extension-migrations-pass';
import type { MigrateExtensionInput } from './contract-space-migrate-pass';

/**
 * In-memory authored migration package shipped by an extension descriptor.
 * Mirrors the `MigrationPackage` shape from
 * `@prisma-next/framework-components/control` minus `dirPath`; redeclared
 * structurally here so the helper does not couple to the SQL family's
 * `ExtensionMigrationPackage` type.
 */
export interface DescriptorMigrationPackage {
  readonly dirName: string;
  readonly metadata: MigrationMetadata;
  readonly ops: MigrationOps;
}

/**
 * The most-general projection of a single declared extension pack
 * needed by the CLI's descriptor-import boundary.
 *
 * - `id` / `targetId` are always present.
 * - `contractSpace` is present only when the extension declares one.
 *   When present, it carries the canonical inputs every downstream
 *   consumer needs — `contractJson`, `headRef`, and the descriptor's
 *   pre-built migration packages.
 */
export interface ExtensionPackInput {
  readonly id: string;
  readonly targetId: string;
  readonly contractSpace?: {
    readonly contractJson: unknown;
    readonly headRef: {
      readonly hash: string;
      readonly invariants: readonly string[];
    };
    readonly migrations: readonly DescriptorMigrationPackage[];
  };
}

/**
 * Structural shape we read off each `Config.extensionPacks` entry.
 *
 * The CLI is the descriptor-import boundary; `extensionPacks` is the only
 * surface where the SQL-family-typed `ControlExtensionDescriptor` flows
 * into framework-neutral helpers. The structural cast lives here, and
 * here alone (AC11).
 */
type ExtensionPackLike = {
  readonly id: string;
  readonly targetId: string;
  readonly contractSpace?: {
    readonly contractJson: unknown;
    readonly headRef: {
      readonly hash: string;
      readonly invariants: readonly string[];
    };
    readonly migrations?: readonly DescriptorMigrationPackage[];
  };
};

/**
 * Project the CLI's `Config.extensionPacks` array into the canonical
 * {@link ExtensionPackInput} shape. The single `as ExtensionPackLike`
 * structural cast in the CLI lives inside this function.
 */
export function toExtensionInputs(
  extensionPacks: ReadonlyArray<unknown>,
): readonly ExtensionPackInput[] {
  return extensionPacks.map((raw) => {
    const pack = raw as ExtensionPackLike;
    if (pack.contractSpace === undefined) {
      return { id: pack.id, targetId: pack.targetId };
    }
    return {
      id: pack.id,
      targetId: pack.targetId,
      contractSpace: {
        contractJson: pack.contractSpace.contractJson,
        headRef: pack.contractSpace.headRef,
        migrations: pack.contractSpace.migrations ?? [],
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Per-consumer adapters: take the canonical `ExtensionPackInput[]` and
// project to whatever narrower shape the downstream primitive needs.
// ---------------------------------------------------------------------------

/**
 * Aggregate-loader projection: surfaces `targetId` + `contractSpace.contractJson`
 * to {@link import('./contract-space-aggregate-loader').buildContractSpaceAggregate}
 * and a `hashByContractJson` map keyed by the same `contractJson` reference
 * the loader hands to its hash callback.
 */
export function toDeclaredExtensions(inputs: ReadonlyArray<ExtensionPackInput>): {
  readonly entries: ReadonlyArray<DeclaredExtensionEntry>;
  readonly hashByContractJson: Map<unknown, string>;
} {
  const entries: DeclaredExtensionEntry[] = [];
  const hashByContractJson = new Map<unknown, string>();
  for (const pack of inputs) {
    if (pack.contractSpace) {
      entries.push({
        id: pack.id,
        targetId: pack.targetId,
        contractSpace: { contractJson: pack.contractSpace.contractJson },
      });
      hashByContractJson.set(pack.contractSpace.contractJson, pack.contractSpace.headRef.hash);
    } else {
      entries.push({ id: pack.id, targetId: pack.targetId });
    }
  }
  return { entries, hashByContractJson };
}

/** Migrate-time per-space pass projection. */
export function toMigratePassInputs(
  inputs: ReadonlyArray<ExtensionPackInput>,
): readonly MigrateExtensionInput[] {
  return inputs.map((pack) =>
    pack.contractSpace
      ? {
          id: pack.id,
          contractSpace: {
            contractJson: pack.contractSpace.contractJson,
            headRef: pack.contractSpace.headRef,
          },
        }
      : { id: pack.id },
  );
}

/** Extension-migrations materialisation pass projection. */
export function toExtensionMigrationsInputs(
  inputs: ReadonlyArray<ExtensionPackInput>,
): readonly ExtensionMigrationsExtensionInput[] {
  return inputs.map((pack) =>
    pack.contractSpace
      ? {
          id: pack.id,
          contractSpace: {
            contractJson: pack.contractSpace.contractJson,
            headRef: pack.contractSpace.headRef,
            migrations: pack.contractSpace.migrations,
          },
        }
      : { id: pack.id },
  );
}
