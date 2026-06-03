import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Contract } from '@prisma-next/contract/types';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { loadContractSpaceAggregate } from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeMigrationPackage } from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import { writeRef } from '@prisma-next/migration-tools/refs';
import { createSqlContract } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { formatMigrationGraphHumanOutput } from '../../src/commands/migration-graph';
import {
  listRefsByContractHash,
  migrationSpaceListEntriesFromAggregate,
  renderMigrationListHumanOutput,
  runMigrationList,
} from '../../src/commands/migration-list';
import {
  formatStatusHumanOutput,
  type MigrationStatusResult,
} from '../../src/commands/migration-status';
import { deriveStatusEdgeAnnotations } from '../../src/commands/migration-status-overlay';
import {
  indentMigrationGraphTreeBlock,
  renderMigrationGraphSpaceTree,
} from '../../src/utils/formatters/migration-graph-space-render';

const HASH_4cb4256 = `sha256:4cb4256${'0'.repeat(57)}`;
const HASH_55bada2 = `sha256:55bada2${'0'.repeat(57)}`;
const HASH_804e018 = `sha256:804e018${'0'.repeat(57)}`;
const HASH_POSTGIS = `sha256:9aabbcc${'0'.repeat(57)}`;

const ADDITIVE_OP: MigrationPlanOperation = {
  id: 'table.users',
  label: 'Create table users',
  operationClass: 'additive',
};

const TEST_APP_CONTRACT = createSqlContract({
  target: 'postgres',
  storage: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        tables: { user: { columns: { id: {} } } },
      },
    },
  },
});

const LIVE_CONTRACT_HASH = TEST_APP_CONTRACT.storage.storageHash;

const identityDeserialize = (json: unknown): Contract => json as Contract;

interface PackageSpec {
  readonly spaceId: string;
  readonly dirName: string;
  readonly from: string | null;
  readonly to: string;
}

async function writePackage(migrationsRoot: string, spec: PackageSpec): Promise<void> {
  const pkgDir = join(migrationsRoot, spec.spaceId, spec.dirName);
  const ops = [ADDITIVE_OP];
  const baseMetadata = {
    from: spec.from,
    to: spec.to,
    providedInvariants: [] as readonly string[],
    createdAt: '2026-02-25T14:30:00.000Z',
  } as Omit<MigrationMetadata, 'migrationHash'>;
  const metadata: MigrationMetadata = {
    ...baseMetadata,
    migrationHash: computeMigrationHash(baseMetadata, ops),
  };
  await writeMigrationPackage(pkgDir, metadata, ops);
}

async function writeRefFor(
  migrationsRoot: string,
  spec: { readonly spaceId: string; readonly name: string; readonly hash: string },
): Promise<void> {
  const refsDir = join(migrationsRoot, spec.spaceId, 'refs');
  await mkdir(refsDir, { recursive: true });
  await writeRef(refsDir, spec.name, { hash: spec.hash, invariants: [] });
}

const createdDirs: string[] = [];

afterEach(async () => {
  const dirs = createdDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function stripCommandFooter(output: string): string {
  const lines = output.trimEnd().split('\n');
  while (lines.length > 0) {
    const line = lines.at(-1) ?? '';
    if (
      /^\d+ migration\(s\)/.test(line) ||
      /^\d+ node\(s\), \d+ edge\(s\)/.test(line) ||
      line === 'up to date' ||
      /^\d+ pending/.test(line)
    ) {
      lines.pop();
      while (lines.at(-1) === '') {
        lines.pop();
      }
      continue;
    }
    break;
  }
  return lines.join('\n');
}

function stripStatusOverlayColumn(output: string): string {
  return output
    .split('\n')
    .map((line) => line.replace(/\s{2,}(✓ applied|⧗ pending|\+ applied|> pending)\s*$/, ''))
    .join('\n');
}

async function buildMultiSpaceFixture(): Promise<{
  readonly migrationsDir: string;
  readonly aggregate: Awaited<ReturnType<typeof loadContractSpaceAggregate>>;
}> {
  const cwd = await mkdtemp(join(tmpdir(), 'migration-read-parity-'));
  createdDirs.push(cwd);
  const migrationsDir = join(cwd, 'migrations');
  await mkdir(join(migrationsDir, 'app'), { recursive: true });
  await mkdir(join(migrationsDir, 'postgis'), { recursive: true });

  await writePackage(migrationsDir, {
    spaceId: 'app',
    dirName: '20260422T0720_initial',
    from: null,
    to: HASH_4cb4256,
  });
  await writePackage(migrationsDir, {
    spaceId: 'app',
    dirName: '20260422T0742_migration',
    from: HASH_4cb4256,
    to: HASH_55bada2,
  });
  await writePackage(migrationsDir, {
    spaceId: 'app',
    dirName: '20260518T1701_namespaces_bookend',
    from: HASH_55bada2,
    to: HASH_804e018,
  });
  await writePackage(migrationsDir, {
    spaceId: 'postgis',
    dirName: '20260601T0000_install_postgis_extension',
    from: null,
    to: HASH_POSTGIS,
  });
  await writeRefFor(migrationsDir, {
    spaceId: 'app',
    name: 'production',
    hash: HASH_55bada2,
  });
  await writeRefFor(migrationsDir, { spaceId: 'app', name: 'db', hash: HASH_804e018 });
  await writeRefFor(migrationsDir, { spaceId: 'postgis', name: 'db', hash: HASH_POSTGIS });

  const aggregate = await loadContractSpaceAggregate({
    migrationsDir,
    appContract: TEST_APP_CONTRACT,
    deserializeContract: identityDeserialize,
  });

  return { migrationsDir, aggregate };
}

describe('migration read commands pretty parity', () => {
  it('renders byte-identical per-space sections for list and graph', async () => {
    const { migrationsDir, aggregate } = await buildMultiSpaceFixture();
    const spaces = await migrationSpaceListEntriesFromAggregate(aggregate, migrationsDir);
    const listResult = runMigrationList({ spaces });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;

    const graphForSpace = (spaceId: string) => aggregate.space(spaceId)?.graph();
    const listHuman = stripCommandFooter(
      renderMigrationListHumanOutput(listResult.value, {
        glyphMode: 'unicode',
        useColor: false,
        liveContractHash: LIVE_CONTRACT_HASH,
        graphForSpace,
      }),
    );

    const showSpaceHeadings = listResult.value.spaces.length > 1;

    const graphHuman = stripCommandFooter(
      formatMigrationGraphHumanOutput({
        ok: true,
        graph: aggregate.app.graph(),
        treeSections: listResult.value.spaces.map((spaceEntry) => {
          const member = aggregate.space(spaceEntry.spaceId)!;
          const tree =
            spaceEntry.migrations.length === 0
              ? ''
              : renderMigrationGraphSpaceTree({
                  graph: member.graph(),
                  migrations: spaceEntry.migrations,
                  liveContractHash: LIVE_CONTRACT_HASH,
                  glyphMode: 'unicode',
                  colorize: false,
                  refsByHash: listRefsByContractHash(member),
                });
          return {
            spaceId: spaceEntry.spaceId,
            tree:
              showSpaceHeadings && tree.length > 0
                ? indentMigrationGraphTreeBlock(tree, '  ')
                : tree,
            showHeading: showSpaceHeadings,
          };
        }),
        summary: `${aggregate.app.graph().nodes.size} node(s), ${aggregate.app.graph().migrationByHash.size} edge(s)`,
      }),
    );

    expect(graphHuman).toBe(listHuman);
    expect(graphHuman).toContain('postgis:');
    expect(graphHuman).toContain('20260601T0000_install_postgis_extension');
  });

  it('matches list per-space sections when status overlay column is stripped', async () => {
    const { migrationsDir, aggregate } = await buildMultiSpaceFixture();
    const spaces = await migrationSpaceListEntriesFromAggregate(aggregate, migrationsDir);
    const listResult = runMigrationList({ spaces });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;

    const graphForSpace = (spaceId: string) => aggregate.space(spaceId)?.graph();
    const listHuman = stripCommandFooter(
      renderMigrationListHumanOutput(listResult.value, {
        glyphMode: 'unicode',
        useColor: false,
        liveContractHash: LIVE_CONTRACT_HASH,
        graphForSpace,
      }),
    );

    const showSpaceHeadings = listResult.value.spaces.length > 1;
    const treeSections = listResult.value.spaces.map((spaceEntry) => {
      const member = aggregate.space(spaceEntry.spaceId)!;
      const graph = member.graph();
      const targetHash = HASH_804e018;
      const statusOverlay = deriveStatusEdgeAnnotations({
        graph,
        targetHash,
        originHash: EMPTY_CONTRACT_HASH,
        appliedMigrationHashes: new Set(),
        showAppliedOverlay: true,
      });
      const tree =
        spaceEntry.migrations.length === 0
          ? ''
          : renderMigrationGraphSpaceTree({
              graph,
              migrations: spaceEntry.migrations,
              liveContractHash: LIVE_CONTRACT_HASH,
              glyphMode: 'unicode',
              colorize: false,
              refsByHash: listRefsByContractHash(member),
              statusOverlayByHash: statusOverlay,
            });
      return {
        spaceId: spaceEntry.spaceId,
        tree:
          showSpaceHeadings && tree.length > 0 ? indentMigrationGraphTreeBlock(tree, '  ') : tree,
        showHeading: showSpaceHeadings,
      };
    });

    const statusResult: MigrationStatusResult = {
      ok: true,
      spaces: [],
      summary: '3 pending — run `prisma-next migrate --to 804e018`',
      diagnostics: [],
      treeSections,
    };

    const statusHuman = stripCommandFooter(
      stripStatusOverlayColumn(formatStatusHumanOutput(statusResult, false)),
    );

    expect(statusHuman).toBe(listHuman);
  });
});
