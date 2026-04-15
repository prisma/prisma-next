import { realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type } from 'arktype';
import { dirname, join } from 'pathe';

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
  'labels?': 'string[]',
});

export abstract class Migration<TOperation = unknown> {
  abstract plan(): TOperation[];

  describe(): MigrationMeta | undefined {
    return undefined;
  }

  /**
   * Entrypoint guard for migration files. When called at module scope,
   * detects whether the file is being run directly (e.g. `tsx migration.ts`)
   * and if so, serializes the migration plan to `ops.json` (and optionally
   * `migration.json`) in the same directory. When the file is imported by
   * another module, this is a no-op.
   *
   * Usage (at module scope, after the class definition):
   *
   *     Migration.run(import.meta.url)
   */
  static run(importMetaUrl: string): void {
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

    serializeMigration(importMetaUrl, migrationDir, dryRun).catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
  }
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: tsx <migration-file> [options]',
      '',
      'Options:',
      '  --dry-run  Print operations to stdout without writing files',
      '  --help     Show this help message',
      '',
    ].join('\n'),
  );
}

function buildManifest(meta: MigrationMeta): Record<string, unknown> {
  return {
    migrationId: null,
    from: meta.from,
    to: meta.to,
    kind: meta.kind ?? 'regular',
    labels: meta.labels ?? [],
    createdAt: new Date().toISOString(),
  };
}

async function serializeMigration(
  fileUrl: string,
  migrationDir: string,
  dryRun: boolean,
): Promise<void> {
  const mod = await import(fileUrl);
  const MigrationClass = mod.default;

  if (!MigrationClass || typeof MigrationClass !== 'function') {
    throw new Error('Migration file must have a default export class');
  }

  const instance = new MigrationClass();

  if (typeof instance.plan !== 'function') {
    throw new Error('Migration class must implement plan()');
  }

  const ops = instance.plan();

  if (!Array.isArray(ops)) {
    throw new Error('plan() must return an array of operations');
  }

  const serializedOps = JSON.stringify(ops, null, 2);

  let manifest: Record<string, unknown> | undefined;
  if (typeof instance.describe === 'function') {
    const rawMeta: unknown = instance.describe();
    if (rawMeta !== undefined) {
      const parsed = MigrationMetaSchema(rawMeta);
      if (parsed instanceof type.errors) {
        throw new Error(`describe() returned invalid metadata: ${parsed.summary}`);
      }
      manifest = buildManifest(parsed);
    }
  }

  if (dryRun) {
    if (manifest) {
      process.stdout.write(`--- migration.json ---\n${JSON.stringify(manifest, null, 2)}\n`);
      process.stdout.write('--- ops.json ---\n');
    }
    process.stdout.write(`${serializedOps}\n`);
    return;
  }

  writeFileSync(join(migrationDir, 'ops.json'), serializedOps);
  if (manifest) {
    writeFileSync(join(migrationDir, 'migration.json'), JSON.stringify(manifest, null, 2));
  }

  const files = manifest ? 'ops.json + migration.json' : 'ops.json';
  process.stdout.write(`Wrote ${files} to ${migrationDir}\n`);
}
