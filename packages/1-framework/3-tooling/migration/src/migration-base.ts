import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Contract } from '@prisma-next/contract/types';
import type {
  ControlStack,
  MigrationPlan,
  MigrationPlanOperation,
} from '@prisma-next/framework-components/control';
import { ifDefined } from '@prisma-next/utils/defined';
import { type } from 'arktype';
import { computeMigrationHash } from './hash';
import { type MigrationHints, type MigrationMetadata, metadataToWire } from './metadata';
import type { MigrationOps } from './package';

export interface MigrationMeta {
  readonly from: string;
  readonly to: string;
  readonly kind?: 'regular' | 'baseline';
  readonly labels?: readonly string[];
}

const MigrationMetaSchema = type({
  from: 'string',
  to: 'string',
  'kind?': "'regular' | 'baseline'",
  'labels?': type('string').array(),
});

/**
 * Base class for migrations.
 *
 * A `Migration` subclass is itself a `MigrationPlan`: CLI commands and the
 * runner can consume it directly via `targetId`, `operations`, `origin`, and
 * `destination`. The metadata-shaped inputs come from `describe()`, which
 * every migration must implement — `migration.json` is required for a
 * migration to be valid.
 */
export abstract class Migration<
  TOperation extends MigrationPlanOperation = MigrationPlanOperation,
  TFamilyId extends string = string,
  TTargetId extends string = string,
> implements MigrationPlan
{
  abstract readonly targetId: string;

  /**
   * Assembled `ControlStack` injected by the orchestrator (`runMigration`).
   *
   * Subclasses (e.g. `PostgresMigration`) read the stack to materialize their
   * adapter once per instance. Optional at the abstract level so unit tests can
   * construct `Migration` instances purely for `operations` / `describe`
   * assertions without needing a real stack; concrete subclasses that need the
   * stack at runtime should narrow the parameter to required.
   */
  protected readonly stack: ControlStack<TFamilyId, TTargetId> | undefined;

  constructor(stack?: ControlStack<TFamilyId, TTargetId>) {
    this.stack = stack;
  }

  /**
   * Ordered list of operations this migration performs.
   *
   * Implemented as a getter so that subclasses can either precompute the list
   * in their constructor or build it lazily per access.
   */
  abstract get operations(): readonly TOperation[];

  /**
   * Metadata inputs used to build `migration.json` and to derive the plan's
   * origin/destination identities. Every migration must provide this —
   * omitting it would produce an invalid on-disk migration package.
   */
  abstract describe(): MigrationMeta;

  get origin(): { readonly storageHash: string } | null {
    const from = this.describe().from;
    // An empty `from` represents a migration with no prior origin (e.g.
    // initial baseline, or an in-process plan that was never persisted).
    // Surface that as a null origin so runners treat the plan as
    // origin-less rather than matching against an empty storage hash.
    return from === '' ? null : { storageHash: from };
  }

  get destination(): { readonly storageHash: string } {
    return { storageHash: this.describe().to };
  }
}

/**
 * Returns true when `import.meta.url` resolves to the same file that was
 * invoked as the node entrypoint (`process.argv[1]`). Used by
 * `MigrationCLI.run` (in `@prisma-next/cli/migration-cli`) to no-op when
 * the migration module is being imported (e.g. by another script) rather
 * than executed directly.
 */
export function isDirectEntrypoint(importMetaUrl: string): boolean {
  const metaFilename = fileURLToPath(importMetaUrl);
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(metaFilename) === realpathSync(argv1);
  } catch {
    return false;
  }
}

export function printMigrationHelp(): void {
  printHelp();
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: node <migration-file> [options]',
      '',
      'Options:',
      '  --dry-run  Print operations to stdout without writing files',
      '  --help     Show this help message',
      '',
    ].join('\n'),
  );
}

/**
 * In-memory artifacts produced from a `Migration` instance: the
 * serialized `ops.json` body, the `migration.json` metadata object, and
 * its serialized form. Returned by `buildMigrationArtifacts` so callers
 * (today: `MigrationCLI.run` in `@prisma-next/cli/migration-cli`) can
 * decide how to persist them — write to disk, print in dry-run, ship
 * over the wire — without coupling artifact construction to file I/O.
 *
 * `metadataJson` is the on-disk wire form (see `metadataToWire` in
 * `./metadata`): it carries the `migrationId` field name that the
 * arktype loader-schema validates against. The Phase-4 type rename
 * (`migrationId` → `migrationHash` in TS) is decoupled from the Phase-5
 * codemod that renames the on-disk field; until Phase 5 lands, callers
 * persisting `metadataJson` write the wire shape and the in-memory
 * `metadata` carries `migrationHash`.
 */
export interface MigrationArtifacts {
  readonly opsJson: string;
  readonly metadata: MigrationMetadata;
  readonly metadataJson: string;
}

/**
 * Build the attested metadata from `describe()`-derived metadata, the
 * operations list, and the previously-scaffolded metadata (if any).
 *
 * When a `migration.json` already exists for this package (the common
 * case: it was scaffolded by `migration plan`), preserve the contract
 * bookends, hints, labels, and `createdAt` set there — those fields are
 * owned by the CLI scaffolder, not the authored class. Only the
 * `describe()`-derived fields (`from`, `to`, `kind`) and the operations
 * change as the author iterates. When no metadata exists yet (a bare
 * `migration.ts` run from scratch), synthesize a minimal but
 * schema-conformant record so the resulting package can still be read,
 * verified, and applied.
 *
 * The `migrationHash` is recomputed against the current metadata + ops so
 * the on-disk artifacts are always fully attested.
 */
function buildAttestedMetadata(
  meta: MigrationMeta,
  ops: MigrationOps,
  existing: Partial<MigrationMetadata> | null,
): MigrationMetadata {
  const baseMetadata: Omit<MigrationMetadata, 'migrationHash'> = {
    from: meta.from,
    to: meta.to,
    kind: meta.kind ?? 'regular',
    labels: meta.labels ?? existing?.labels ?? [],
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    fromContract: existing?.fromContract ?? null,
    // When no scaffolded metadata exists we synthesize a minimal contract
    // stub so the package is still readable end-to-end. The cast is
    // intentional: only the storage bookend matters for hash computation
    // (everything else is stripped by `computeMigrationHash`), and a real
    // contract bookend would only be available after `migration plan`.
    toContract: existing?.toContract ?? ({ storage: { storageHash: meta.to } } as Contract),
    hints: normalizeHints(existing?.hints),
    ...ifDefined('authorship', existing?.authorship),
  };

  const migrationHash = computeMigrationHash(baseMetadata, ops);
  return { ...baseMetadata, migrationHash };
}

/**
 * Project `existing.hints` down to the known `MigrationHints` shape, dropping
 * any legacy keys that may linger in metadata scaffolded by older CLI
 * versions (e.g. `planningStrategy`). Picking fields explicitly instead of
 * spreading keeps refreshed `migration.json` files schema-clean regardless
 * of what was on disk before.
 */
function normalizeHints(existing: MigrationHints | undefined): MigrationHints {
  return {
    used: existing?.used ?? [],
    applied: existing?.applied ?? [],
    plannerVersion: existing?.plannerVersion ?? '2.0.0',
  };
}

/**
 * Pure conversion from a `Migration` instance (plus the previously
 * scaffolded metadata, when one exists on disk) to the in-memory
 * artifacts that downstream tooling persists. Owns metadata validation,
 * metadata synthesis/preservation, hint normalization, and the
 * content-addressed `migrationHash` computation, but performs no file I/O
 * — callers handle reads (to source `existing`) and writes (to persist
 * `opsJson` / `metadataJson`).
 */
export function buildMigrationArtifacts(
  instance: Migration,
  existing: Partial<MigrationMetadata> | null,
): MigrationArtifacts {
  const ops = instance.operations;
  if (!Array.isArray(ops)) {
    throw new Error('operations must be an array');
  }

  const rawMeta: unknown = instance.describe();
  const parsed = MigrationMetaSchema(rawMeta);
  if (parsed instanceof type.errors) {
    throw new Error(`describe() returned invalid metadata: ${parsed.summary}`);
  }

  const metadata = buildAttestedMetadata(parsed, ops, existing);

  return {
    opsJson: JSON.stringify(ops, null, 2),
    metadata,
    metadataJson: JSON.stringify(metadataToWire(metadata), null, 2),
  };
}
