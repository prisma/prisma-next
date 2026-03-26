/**
 * Run `migration status` against a studio fixture directory.
 *
 * This is a thin wrapper that creates a temporary config pointing at the
 * fixture's migrations dir, then invokes the real CLI command. This ensures
 * the fixture script always exercises the same code path as the real CLI.
 *
 * Usage:
 *   pnpm tsx scripts/render-fixture.ts <fixture-dir> [options]
 *   pnpm tsx scripts/render-fixture.ts --all [options]
 *
 * Options:
 *   --graph          Show full graph (default: relevant subgraph)
 *   --no-color       Disable ANSI colors
 *   --marker <N>     Simulate DB at the Nth migration (1-based). 0 = fresh DB (all pending)
 *   --ref <name>     Use this ref as spine target
 *   --limit <N>      Truncate to last N spine edges (expands for markers)
 *   --all-fixtures   Render all fixtures (renamed from --all to avoid clash with CLI --all)
 *   --list-nodes     Print available node hashes and refs, then exit
 *
 * Examples:
 *   pnpm tsx scripts/render-fixture.ts ../studio/fixtures/diamond --graph
 *   pnpm tsx scripts/render-fixture.ts ../studio/fixtures/linear --marker 1
 *   pnpm tsx scripts/render-fixture.ts --all-fixtures --marker 2 --graph
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { findPath, reconstructGraph } from '@prisma-next/migration-tools/dag';
import { readMigrationsDir } from '@prisma-next/migration-tools/io';
import { readRefs } from '@prisma-next/migration-tools/refs';
import { isAttested } from '@prisma-next/migration-tools/types';
import { createMigrationStatusCommand } from '../src/commands/migration-status';

function parseArgs(argv: string[]) {
  const flags = {
    graph: false,
    noColor: false,
    allFixtures: false,
    listNodes: false,
    marker: undefined as number | undefined,
    ref: undefined as string | undefined,
    limit: undefined as number | undefined,
    showAll: false,
    positional: [] as string[],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--graph') flags.graph = true;
    else if (arg === '--no-color') flags.noColor = true;
    else if (arg === '--all-fixtures') flags.allFixtures = true;
    else if (arg === '--all') flags.showAll = true;
    else if (arg === '--list-nodes') flags.listNodes = true;
    else if (arg === '--marker' && i + 1 < argv.length) {
      flags.marker = Number.parseInt(argv[++i]!, 10);
    } else if (arg === '--ref' && i + 1 < argv.length) {
      flags.ref = argv[++i]!;
    } else if (arg === '--limit' && i + 1 < argv.length) {
      flags.limit = Number.parseInt(argv[++i]!, 10);
    } else if (!arg.startsWith('--')) {
      flags.positional.push(arg);
    }
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const FIXTURES_DIR = resolve(import.meta.dirname, '../../studio/fixtures');

async function writeTempConfig(migrationsDir: string): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'pn-fixture-'));
  const configPath = resolve(dir, 'prisma-next.config.ts');

  const absDir = resolve(migrationsDir);
  await writeFile(
    configPath,
    `import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';

export default {
  family: sql,
  target: postgres,
  migrations: { dir: ${JSON.stringify(absDir)} },
};
`,
  );

  return configPath;
}

async function listNodes(fixtureDir: string, label?: string): Promise<void> {
  const allBundles = await readMigrationsDir(fixtureDir);
  const bundles = allBundles.filter(isAttested);
  const graph = reconstructGraph(bundles);

  let refs: Record<string, string> = {};
  try {
    refs = await readRefs(resolve(fixtureDir, 'refs.json'));
  } catch {
    // no refs
  }

  const refNames = Object.keys(refs);
  const activeRefHash = refNames[0] ? refs[refNames[0]] : undefined;
  const lastEdge = [...graph.forwardChain.values()].flat().pop();
  const contractHash = activeRefHash ?? lastEdge?.to ?? EMPTY_CONTRACT_HASH;

  const name = label ?? basename(fixtureDir);
  const path = findPath(graph, EMPTY_CONTRACT_HASH, contractHash);
  console.log(`${name}:`);
  if (path) {
    for (let i = 0; i < path.length; i++) {
      const short = path[i]!.to.replace('sha256:', '').slice(0, 7);
      console.log(`  ${i + 1}: ${short}  (${path[i]!.dirName})`);
    }
  }
  if (refNames.length > 0) {
    console.log(`  refs: ${refNames.join(', ')}`);
  }
  console.log(`  total nodes: ${graph.nodes.size}`);
  console.log();
}

async function renderFixture(fixtureDir: string, label?: string): Promise<void> {
  if (flags.listNodes) {
    await listNodes(fixtureDir, label);
    return;
  }

  const configPath = await writeTempConfig(fixtureDir);

  try {
    if (label) {
      const sep = '─'.repeat(Math.max(60, label.length + 4));
      console.log(`\n${sep}`);
      const parts = [label];
      if (flags.ref) parts.push(`ref=${flags.ref}`);
      if (flags.marker !== undefined) parts.push(`DB at migration ${flags.marker}`);
      console.log(`  ${parts.join('  |  ')}`);
      console.log(sep);
    }

    const cliArgs = ['node', 'migration', 'status', '--config', configPath];
    if (flags.graph) cliArgs.push('--graph');
    if (flags.noColor) cliArgs.push('--no-color');
    if (flags.ref) cliArgs.push('--ref', flags.ref);
    if (flags.limit !== undefined) cliArgs.push('--limit', String(flags.limit));
    if (flags.showAll) cliArgs.push('--all');

    const command = createMigrationStatusCommand();

    // Prevent Commander from calling process.exit on success
    command.exitOverride();

    await command.parseAsync(cliArgs);
  } catch (e: unknown) {
    // Commander throws on exitOverride — suppress zero-exit
    if (
      e &&
      typeof e === 'object' &&
      'exitCode' in e &&
      (e as { exitCode: number }).exitCode === 0
    ) {
      // normal exit
    } else {
      throw e;
    }
  } finally {
    await rm(configPath, { force: true });
    await rm(resolve(configPath, '..'), { recursive: true, force: true }).catch(() => {});
  }
}

if (flags.allFixtures) {
  const entries = await readdir(FIXTURES_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const dir of dirs) {
    await renderFixture(resolve(FIXTURES_DIR, dir.name), dir.name);
  }
} else if (flags.positional.length > 0) {
  const fixtureDir = resolve(flags.positional[0]!);
  await renderFixture(fixtureDir);
} else {
  console.error('Usage: pnpm tsx scripts/render-fixture.ts <fixture-dir> [options]');
  console.error('       pnpm tsx scripts/render-fixture.ts --all-fixtures [options]');
  console.error('');
  console.error('Options:');
  console.error('  --graph          Full graph (default: relevant subgraph)');
  console.error('  --no-color       Disable ANSI colors');
  console.error('  --marker <N>     Simulate DB at Nth migration (1-based). 0 = fresh DB');
  console.error('  --ref <name>     Use this ref as spine target');
  console.error('  --limit <N>      Truncate to last N spine edges');
  console.error('  --all            Show full history (disables truncation)');
  console.error('  --all-fixtures   Render all fixtures');
  console.error('  --list-nodes     Print node hashes and refs, then exit');
  process.exit(1);
}
