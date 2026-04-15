import { realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';

export abstract class Migration<TOperation = unknown> {
  abstract plan(): TOperation[];

  /**
   * Makes the migration file self-executing. Call at module scope:
   *
   *     Migration.run(import.meta.url)
   *
   * When the file is the entrypoint, calls plan(), serializes, and writes ops.json.
   * When imported by another module, this is a no-op.
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
    const outputPath = join(migrationDir, 'ops.json');

    executeMigration(importMetaUrl, outputPath, dryRun).catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
  }
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: node <migration-file> [options]',
      '',
      'Options:',
      '  --dry-run  Print operations to stdout without writing ops.json',
      '  --help     Show this help message',
      '',
    ].join('\n'),
  );
}

async function executeMigration(
  fileUrl: string,
  outputPath: string,
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

  const serialized = JSON.stringify(ops, null, 2);

  if (dryRun) {
    process.stdout.write(`${serialized}\n`);
    return;
  }

  writeFileSync(outputPath, serialized);
}
