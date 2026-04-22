import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Contract } from '@prisma-next/contract/types';
import type {
  MigrationPlan,
  MigrationPlanOperation,
} from '@prisma-next/framework-components/control';
import { ifDefined } from '@prisma-next/utils/defined';
import { type } from 'arktype';
import { dirname, join } from 'pathe';
import { computeMigrationId } from './attestation';
import type { MigrationManifest, MigrationOps } from './types';

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
 * `destination`. The manifest-shaped inputs come from `describe()`, which
 * every migration must implement — `migration.json` is required for a
 * migration to be valid.
 */
export abstract class Migration<TOperation extends MigrationPlanOperation = MigrationPlanOperation>
  implements MigrationPlan
{
  abstract readonly targetId: string;

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

  /**
   * Entrypoint guard for migration files. When called at module scope,
   * detects whether the file is being run directly (e.g. `node migration.ts`)
   * and if so, serializes the migration plan to `ops.json` and
   * `migration.json` in the same directory. When the file is imported by
   * another module, this is a no-op.
   *
   * Usage (at module scope, after the class definition):
   *
   *     class MyMigration extends Migration { ... }
   *     export default MyMigration;
   *     Migration.run(import.meta.url, MyMigration);
   */
  static run(importMetaUrl: string, MigrationClass: new () => Migration): void {
    if (!importMetaUrl) return;

    const metaFilename = fileURLToPath(importMetaUrl);
    const argv1 = process.argv[1];
    if (!argv1) return;

    let isEntrypoint: boolean;
    try {
      isEntrypoint = realpathSync(metaFilename) === realpathSync(argv1);
    } catch {
      return;
    }
    if (!isEntrypoint) return;

    const args = process.argv.slice(2);

    if (args.includes('--help')) {
      printHelp();
      return;
    }

    const dryRun = args.includes('--dry-run');
    const migrationDir = dirname(metaFilename);

    try {
      serializeMigration(MigrationClass, migrationDir, dryRun);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  }
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
 * Build the attested manifest written by `Migration.run()`.
 *
 * When a `migration.json` already exists in the directory (the common case:
 * the package was scaffolded by `migration plan`), preserve the contract
 * bookends, hints, labels, and `createdAt` set there — those fields are
 * owned by the CLI scaffolder, not the authored class. Only the
 * `describe()`-derived fields (`from`, `to`, `kind`) and the operations
 * change as the author iterates. When no manifest exists yet (a bare
 * `migration.ts` run from scratch), synthesize a minimal but
 * schema-conformant manifest so the resulting package can still be read,
 * verified, and applied.
 *
 * In both cases the `migrationId` is recomputed against the current
 * manifest + ops so the on-disk artifacts are always fully attested — no
 * draft (`migrationId: null`) ever leaves this function.
 */
function buildAttestedManifest(
  migrationDir: string,
  meta: MigrationMeta,
  ops: MigrationOps,
): MigrationManifest {
  const existing = readExistingManifest(join(migrationDir, 'migration.json'));

  const baseManifest: MigrationManifest = {
    migrationId: null,
    from: meta.from,
    to: meta.to,
    kind: meta.kind ?? 'regular',
    labels: meta.labels ?? existing?.labels ?? [],
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    fromContract: existing?.fromContract ?? null,
    // When no scaffolded manifest exists we synthesize a minimal contract
    // stub so the package is still readable end-to-end. The cast is
    // intentional: only the storage bookend matters for hash computation
    // (everything else is stripped by `computeMigrationId`), and a real
    // contract bookend would only be available after `migration plan`.
    toContract: existing?.toContract ?? ({ storage: { storageHash: meta.to } } as Contract),
    hints: existing?.hints ?? {
      used: [],
      applied: [],
      plannerVersion: '2.0.0',
    },
    ...ifDefined('authorship', existing?.authorship),
  };

  const migrationId = computeMigrationId(baseManifest, ops);
  return { ...baseManifest, migrationId };
}

function readExistingManifest(manifestPath: string): Partial<MigrationManifest> | null {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as Partial<MigrationManifest>;
  } catch {
    return null;
  }
}

function serializeMigration(
  MigrationClass: new () => Migration,
  migrationDir: string,
  dryRun: boolean,
): void {
  const instance = new MigrationClass();

  const ops = instance.operations;

  if (!Array.isArray(ops)) {
    throw new Error('operations must be an array');
  }

  const serializedOps = JSON.stringify(ops, null, 2);

  const rawMeta: unknown = instance.describe();
  const parsed = MigrationMetaSchema(rawMeta);
  if (parsed instanceof type.errors) {
    throw new Error(`describe() returned invalid metadata: ${parsed.summary}`);
  }

  const manifest = buildAttestedManifest(migrationDir, parsed, ops);

  if (dryRun) {
    process.stdout.write(`--- migration.json ---\n${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write('--- ops.json ---\n');
    process.stdout.write(`${serializedOps}\n`);
    return;
  }

  writeFileSync(join(migrationDir, 'ops.json'), serializedOps);
  writeFileSync(join(migrationDir, 'migration.json'), JSON.stringify(manifest, null, 2));

  process.stdout.write(`Wrote ops.json + migration.json to ${migrationDir}\n`);
}
