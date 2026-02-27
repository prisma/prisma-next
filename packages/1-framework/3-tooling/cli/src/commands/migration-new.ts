import { relative, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { findLeaf, reconstructGraph } from '@prisma-next/migration-tools/dag';
import {
  formatMigrationDirName,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationManifest } from '@prisma-next/migration-tools/types';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { join } from 'pathe';
import { loadConfig } from '../config-loader';
import { type CliStructuredError, errorRuntime, errorUnexpected } from '../utils/cli-errors';
import { setCommandDescriptions } from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { formatCommandHelp, formatStyledHeader } from '../utils/output';
import { handleResult } from '../utils/result-handler';

interface MigrationNewOptions {
  readonly name: string;
  readonly config?: string;
  readonly json?: string | boolean;
  readonly quiet?: boolean;
  readonly q?: boolean;
  readonly verbose?: boolean;
  readonly v?: boolean;
  readonly vv?: boolean;
  readonly trace?: boolean;
  readonly timestamps?: boolean;
  readonly color?: boolean;
  readonly 'no-color'?: boolean;
}

export interface MigrationNewResult {
  readonly ok: boolean;
  readonly dir: string;
  readonly dirName: string;
  readonly summary: string;
}

async function executeMigrationNewCommand(
  options: MigrationNewOptions,
  flags: GlobalFlags,
): Promise<Result<MigrationNewResult, CliStructuredError>> {
  const config = await loadConfig(options.config);

  const migrationsDir = resolve(
    options.config ? resolve(options.config, '..') : process.cwd(),
    config.migrations?.dir ?? 'migrations',
  );

  if (flags.json !== 'object' && !flags.quiet) {
    const configPath = options.config
      ? relative(process.cwd(), resolve(options.config))
      : 'prisma-next.config.ts';
    const header = formatStyledHeader({
      command: 'migration new',
      description: 'Scaffold a new empty migration',
      details: [
        { label: 'config', value: configPath },
        { label: 'name', value: options.name },
      ],
      flags,
    });
    console.log(header);
  }

  const timestamp = new Date();
  const dirName = formatMigrationDirName(timestamp, options.name);
  const packageDir = join(migrationsDir, dirName);

  let fromHash: string = EMPTY_CONTRACT_HASH;
  let fromContract: ContractIR | null = null;
  try {
    const packages = await readMigrationsDir(migrationsDir);
    const attested = packages.filter((p) => p.manifest.edgeId !== null);
    if (attested.length > 0) {
      const graph = reconstructGraph(attested);
      const leafHash = findLeaf(graph);
      fromHash = leafHash;
      const leafPkg = attested.find((p) => p.manifest.to === leafHash);
      if (leafPkg) {
        fromContract = leafPkg.manifest.toContract;
      }
    }
  } catch {
    // If reading migrations fails, start from empty — this is a draft scaffold
  }

  const emptyContract: ContractIR = {
    schemaVersion: '1',
    targetFamily: '',
    target: '',
    models: {},
    relations: {},
    storage: { tables: {} },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
  };

  const manifest: MigrationManifest = {
    from: fromHash,
    to: EMPTY_CONTRACT_HASH,
    edgeId: null,
    kind: 'regular',
    fromContract,
    toContract: emptyContract,
    hints: {
      used: [],
      applied: [],
      plannerVersion: '1.0.0',
      planningStrategy: 'manual',
    },
    labels: [],
    createdAt: timestamp.toISOString(),
  };

  try {
    await writeMigrationPackage(packageDir, manifest, []);

    const result: MigrationNewResult = {
      ok: true,
      dir: relative(process.cwd(), packageDir),
      dirName,
      summary: `Scaffolded draft migration: ${dirName}`,
    };
    return ok(result);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(
        errorRuntime(error.message, {
          why: error.why,
          fix: error.fix,
          meta: { code: error.code, ...(error.details ?? {}) },
        }),
      );
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to scaffold migration: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }
}

export function createMigrationNewCommand(): Command {
  const command = new Command('new');
  setCommandDescriptions(
    command,
    'Scaffold an empty migration package',
    'Creates a new migration package directory with placeholder migration.json\n' +
      'and ops.json files in Draft state (edgeId: null). Use this when you need\n' +
      'to manually define migration operations.',
  );
  command
    .configureHelp({
      formatHelp: (cmd) => {
        const defaultFlags = parseGlobalFlags({});
        return formatCommandHelp({ command: cmd, flags: defaultFlags });
      },
    })
    .requiredOption('--name <slug>', 'Name slug for the migration directory')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--json [format]', 'Output as JSON (object)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output')
    .option('-vv, --trace', 'Trace output')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: MigrationNewOptions) => {
      const flags = parseGlobalFlags(options);

      const result = await executeMigrationNewCommand(options, flags);

      const exitCode = handleResult(result, flags, (newResult) => {
        if (flags.json === 'object') {
          console.log(JSON.stringify(newResult, null, 2));
        } else if (!flags.quiet) {
          console.log(formatMigrationNewOutput(newResult, flags));
        }
      });

      process.exit(exitCode);
    });

  return command;
}

function formatMigrationNewOutput(result: MigrationNewResult, flags: GlobalFlags): string {
  const useColor = flags.color !== false;
  const green_ = useColor ? (s: string) => `\x1b[32m${s}\x1b[0m` : (s: string) => s;
  const dim_ = useColor ? (s: string) => `\x1b[2m${s}\x1b[0m` : (s: string) => s;

  const lines: string[] = [];
  lines.push(`${green_('✔')} ${result.summary}`);
  lines.push(dim_(`  dir: ${result.dir}`));
  lines.push('');
  lines.push(
    dim_('Edit migration.json and ops.json, then run `prisma-next migration verify` to attest.'),
  );
  return lines.join('\n');
}
