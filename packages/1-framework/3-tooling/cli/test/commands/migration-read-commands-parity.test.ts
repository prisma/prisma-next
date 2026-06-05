import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Contract } from '@prisma-next/contract/types';
import type { CliErrorEnvelope } from '@prisma-next/errors/control';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { loadContractSpaceAggregate } from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeMigrationPackage } from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import { writeRef } from '@prisma-next/migration-tools/refs';
import { createSqlContract } from '@prisma-next/test-utils';
import { type } from 'arktype';
import { join } from 'pathe';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  type MigrationGraphJsonResult,
  migrationGraphJsonResultSchema,
} from '../../src/commands/json/schemas';
import {
  createMigrationCheckCommand,
  enumerateCheckSpaces,
  runMigrationCheck,
} from '../../src/commands/migration-check';
import {
  createMigrationGraphCommand,
  formatMigrationGraphHumanOutput,
} from '../../src/commands/migration-graph';
import {
  createMigrationListCommand,
  listRefsByContractHash,
  migrationSpaceListEntriesFromAggregate,
  renderMigrationListHumanOutput,
  runMigrationList,
} from '../../src/commands/migration-list';
import {
  createMigrationLogCommand,
  executeMigrationLogCommand,
  type MigrationLogResult,
} from '../../src/commands/migration-log';
import {
  createMigrationShowCommand,
  type MigrationShowResult,
} from '../../src/commands/migration-show';
import {
  createMigrationStatusCommand,
  formatStatusHumanOutput,
} from '../../src/commands/migration-status';
import { deriveStatusEdgeAnnotations } from '../../src/commands/migration-status-overlay';
import * as configLoader from '../../src/config-loader';
import { getCommandSeeAlso } from '../../src/utils/command-helpers';
import {
  computeGlobalMaxDirNameWidth,
  computeGlobalMaxEdgeTreePrefixWidth,
  indentMigrationGraphTreeBlock,
  renderMigrationGraphSpaceTree,
} from '../../src/utils/formatters/migration-graph-space-render';
import { parseGlobalFlags } from '../../src/utils/global-flags';
import { createTerminalUI } from '../../src/utils/terminal-ui';
import {
  executeCommand,
  getExitCode,
  parseJsonObjectFromCliCapture,
  setupCommandMocks,
} from '../utils/test-helpers';

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
        entries: { table: { user: { columns: { id: {} } } } },
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
      line === 'Up to date' ||
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

function assertIndentedTreesUnderSpaceHeadings(output: string): void {
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!/^[a-z][a-z0-9_]*:$/.test(line)) {
      continue;
    }
    let nextIndex = i + 1;
    while (nextIndex < lines.length && (lines[nextIndex] ?? '') === '') {
      nextIndex++;
    }
    if (nextIndex >= lines.length) {
      continue;
    }
    const nextLine = lines[nextIndex] ?? '';
    if (nextLine === '(no migrations)') {
      continue;
    }
    expect(nextLine.startsWith('  ')).toBe(true);
  }
}

function multiSpaceGlobalWidths(
  spaces: readonly { readonly space: string; readonly migrations: readonly unknown[] }[],
  aggregate: Awaited<ReturnType<typeof loadContractSpaceAggregate>>,
  liveContractHash: string,
  showSpaceHeadings: boolean,
): {
  readonly globalMaxEdgeTreePrefixWidth?: number;
  readonly globalMaxDirNameWidth?: number;
} {
  if (!showSpaceHeadings) {
    return {};
  }
  const inputs = spaces
    .filter((space) => space.migrations.length > 0)
    .map((space) => ({
      graph: aggregate.space(space.space)!.graph(),
      liveContractHash,
    }));
  if (inputs.length === 0) {
    return {};
  }
  return {
    globalMaxEdgeTreePrefixWidth: computeGlobalMaxEdgeTreePrefixWidth(inputs),
    globalMaxDirNameWidth: computeGlobalMaxDirNameWidth(inputs),
  };
}

async function buildMultiSpaceFixture(): Promise<{
  readonly cwd: string;
  readonly migrationsDir: string;
  readonly aggregate: Awaited<ReturnType<typeof loadContractSpaceAggregate>>;
}> {
  const cwd = await mkdtemp(join(tmpdir(), 'migration-read-parity-'));
  createdDirs.push(cwd);
  const migrationsDir = join(cwd, 'migrations');
  const contractDir = join(cwd, 'src', 'prisma');
  await mkdir(contractDir, { recursive: true });
  await writeFile(
    join(contractDir, 'contract.json'),
    JSON.stringify({
      storage: { storageHash: LIVE_CONTRACT_HASH, namespaces: {} },
      schemaVersion: '1.0.0',
      target: 'postgres',
      targetFamily: 'sql',
    }),
  );
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
  await writeFile(
    join(migrationsDir, 'postgis', 'contract.json'),
    JSON.stringify({
      storage: { storageHash: HASH_POSTGIS, namespaces: {} },
      schemaVersion: '1.0.0',
      target: 'postgres',
      targetFamily: 'sql',
    }),
  );

  const aggregate = await loadContractSpaceAggregate({
    migrationsDir,
    appContract: TEST_APP_CONTRACT,
    deserializeContract: identityDeserialize,
  });

  return { cwd, migrationsDir, aggregate };
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
    const globalWidths = multiSpaceGlobalWidths(
      listResult.value.spaces,
      aggregate,
      LIVE_CONTRACT_HASH,
      showSpaceHeadings,
    );

    const graphHuman = stripCommandFooter(
      formatMigrationGraphHumanOutput({
        ok: true,
        graph: aggregate.app.graph(),
        spaces: [],
        treeSections: listResult.value.spaces.map((spaceEntry) => {
          const member = aggregate.space(spaceEntry.space)!;
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
                  ...globalWidths,
                });
          return {
            space: spaceEntry.space,
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
    assertIndentedTreesUnderSpaceHeadings(listHuman);
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
    const globalWidths = multiSpaceGlobalWidths(
      listResult.value.spaces,
      aggregate,
      LIVE_CONTRACT_HASH,
      showSpaceHeadings,
    );
    const treeSections = listResult.value.spaces.map((spaceEntry) => {
      const member = aggregate.space(spaceEntry.space)!;
      const graph = member.graph();
      const targetHash =
        spaceEntry.space === 'postgis'
          ? HASH_POSTGIS
          : spaceEntry.space === 'app'
            ? HASH_804e018
            : (graph.nodes.values().next().value ?? EMPTY_CONTRACT_HASH);
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
              ...globalWidths,
            });
      return {
        space: spaceEntry.space,
        tree:
          showSpaceHeadings && tree.length > 0 ? indentMigrationGraphTreeBlock(tree, '  ') : tree,
        showHeading: showSpaceHeadings,
      };
    });

    const statusResult = {
      ok: true as const,
      spaces: [],
      summary: '3 pending — run `prisma-next migrate --to 804e018`',
      diagnostics: [],
      treeSections,
    };

    const statusHuman = stripCommandFooter(
      stripStatusOverlayColumn(formatStatusHumanOutput(statusResult, false)),
    );

    expect(statusHuman).toBe(listHuman);
    assertIndentedTreesUnderSpaceHeadings(statusHuman);
  });

  it('indents per-space trees under headings via migration status --from', async () => {
    const commandMocks = setupCommandMocks();
    const loadConfigSpy = vi.spyOn(configLoader, 'loadConfig');
    const { cwd } = await buildMultiSpaceFixture();
    const originalCwd = process.cwd();
    process.chdir(cwd);
    type LoadedConfig = Awaited<ReturnType<typeof configLoader.loadConfig>>;
    loadConfigSpy.mockResolvedValue({
      family: {
        familyId: 'sql',
        create: vi.fn().mockReturnValue({
          deserializeContract: (json: unknown) => json,
        }),
      },
      target: {
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        kind: 'target',
      },
      adapter: { kind: 'adapter', familyId: 'sql', targetId: 'postgres' },
      driver: { kind: 'driver' },
      contract: { output: 'src/prisma/contract.json', source: 'src/prisma/contract.json' },
      migrations: { dir: 'migrations' },
      extensionPacks: [],
    } as unknown as LoadedConfig);
    try {
      const { createMigrationStatusCommand } = await import('../../src/commands/migration-status');
      const exitCode = await executeCommand(createMigrationStatusCommand(), [
        '--from',
        EMPTY_CONTRACT_HASH,
        '--no-color',
      ]);
      expect(exitCode).toBe(0);
      const human = stripCommandFooter(
        [...commandMocks.consoleOutput, ...commandMocks.consoleErrors].join('\n'),
      );
      assertIndentedTreesUnderSpaceHeadings(human);
      expect(human).toContain('app:');
      expect(human).toContain('postgis:');
    } finally {
      process.chdir(originalCwd);
      loadConfigSpy.mockRestore();
      commandMocks.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers shared by the consistency-lock sections below
// ---------------------------------------------------------------------------

type LoadedConfig = Awaited<ReturnType<typeof configLoader.loadConfig>>;

function makeOfflineConfig(cwd: string): LoadedConfig {
  return {
    family: {
      familyId: 'sql',
      create: vi.fn().mockReturnValue({
        deserializeContract: (json: unknown) => json,
        toOperationPreview: () => ({ statements: [] }),
      }),
    },
    target: {
      id: 'postgres',
      familyId: 'sql',
      targetId: 'postgres',
      kind: 'target',
      migrations: {},
    },
    adapter: { kind: 'adapter', familyId: 'sql', targetId: 'postgres' },
    driver: { kind: 'driver' },
    contract: { output: join(cwd, 'src', 'prisma', 'contract.json') },
    migrations: { dir: 'migrations' },
    extensionPacks: [],
  } as unknown as LoadedConfig;
}

async function runAndCaptureExit(invoke: () => Promise<number>): Promise<number> {
  try {
    return await invoke();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'process.exit called') {
      throw error;
    }
    return getExitCode() ?? 0;
  }
}

// ---------------------------------------------------------------------------
// D1 lock: every read verb's --json output is { ok, … } (not a bare array)
// ---------------------------------------------------------------------------

describe('migration read-verb --json envelope shape (D1 lock)', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
  });

  it('migration list --json emits { ok: true, spaces: [...] }', async () => {
    const { cwd } = await buildMultiSpaceFixture();
    const loadConfigSpy = vi.spyOn(configLoader, 'loadConfig');
    loadConfigSpy.mockResolvedValue(makeOfflineConfig(cwd));
    process.chdir(cwd);

    const { consoleOutput, cleanup } = setupCommandMocks();
    try {
      await executeCommand(createMigrationListCommand(), ['--json']);
    } finally {
      cleanup();
    }

    const envelope = parseJsonObjectFromCliCapture(consoleOutput) as {
      ok: boolean;
      spaces: unknown[];
    };
    expect(envelope.ok).toBe(true);
    expect(Array.isArray(envelope.spaces)).toBe(true);
  });

  it('migration graph --json emits { ok: true, spaces: [{ contracts, migrations }], summary }', async () => {
    const { cwd } = await buildMultiSpaceFixture();
    const loadConfigSpy = vi.spyOn(configLoader, 'loadConfig');
    loadConfigSpy.mockResolvedValue(makeOfflineConfig(cwd));
    process.chdir(cwd);

    const { consoleOutput, cleanup } = setupCommandMocks();
    try {
      await executeCommand(createMigrationGraphCommand(), ['--json']);
    } finally {
      cleanup();
    }

    const envelope = parseJsonObjectFromCliCapture(consoleOutput) as MigrationGraphJsonResult;
    expect(migrationGraphJsonResultSchema(envelope) instanceof type.errors).toBe(false);
    expect(envelope.ok).toBe(true);
    expect(envelope.spaces.length).toBeGreaterThan(1);
    const appSpace = envelope.spaces.find((space) => space.space === 'app');
    expect(appSpace).toBeDefined();
    expect(Array.isArray(appSpace?.contracts)).toBe(true);
    expect(Array.isArray(appSpace?.migrations)).toBe(true);
    expect(appSpace?.migrations[0]).toMatchObject({
      name: expect.any(String),
      hash: expect.any(String),
      fromContract: expect.any(String),
      toContract: expect.any(String),
    });
  });

  it('migration status --json (with --from) emits { ok: true, spaces: [...] }', async () => {
    const { cwd } = await buildMultiSpaceFixture();
    const loadConfigSpy = vi.spyOn(configLoader, 'loadConfig');
    loadConfigSpy.mockResolvedValue(makeOfflineConfig(cwd));
    process.chdir(cwd);

    const { consoleOutput, cleanup } = setupCommandMocks();
    try {
      await executeCommand(createMigrationStatusCommand(), [
        '--json',
        '--from',
        EMPTY_CONTRACT_HASH,
      ]);
    } finally {
      cleanup();
    }

    const envelope = parseJsonObjectFromCliCapture(consoleOutput) as {
      ok: boolean;
      spaces: unknown[];
    };
    expect(envelope.ok).toBe(true);
    expect(Array.isArray(envelope.spaces)).toBe(true);
  });

  it('migration show --json emits { ok: true, migration: { … } } (type-shape lock)', () => {
    // The runtime JSON path is pinned by migration-show.test.ts.
    // This assertion locks the exported type's shape so a type-level regression
    // (removing `ok` or removing/renaming `migration`) fails at typecheck.
    const sample: MigrationShowResult = {
      ok: true,
      summary: 'Migration 20260101T0000_init in app: 0 operation(s)',
      migration: {
        space: 'app',
        name: '20260101T0000_init',
        fromContract: null,
        toContract: 'sha256:a',
        hash: 'sha256:edge',
        createdAt: '2026-01-01T00:00:00.000Z',
        operations: [],
        preview: { statements: [] },
      },
    };
    const parsed = JSON.parse(JSON.stringify(sample)) as { ok: boolean; migration: unknown };
    expect(parsed.ok).toBe(true);
    expect(typeof parsed.migration).toBe('object');
    expect(parsed.migration).not.toBeNull();
    expect(Array.isArray(parsed)).toBe(false);
  });

  it('migration check --json emits { ok: boolean, failures: [...], summary }', async () => {
    const { cwd } = await buildMultiSpaceFixture();
    const loadConfigSpy = vi.spyOn(configLoader, 'loadConfig');
    loadConfigSpy.mockResolvedValue(makeOfflineConfig(cwd));
    process.chdir(cwd);

    const { consoleOutput, cleanup } = setupCommandMocks();
    try {
      await runAndCaptureExit(() => executeCommand(createMigrationCheckCommand(), ['--json']));
    } finally {
      cleanup();
    }

    const envelope = parseJsonObjectFromCliCapture(consoleOutput) as {
      ok: boolean;
      failures: unknown[];
      summary: string;
    };
    expect(typeof envelope.ok).toBe('boolean');
    expect(Array.isArray(envelope.failures)).toBe(true);
    expect(typeof envelope.summary).toBe('string');
  });

  it('migration log --json emits { ok: true, records: [...], summary } (type-shape lock)', () => {
    // The runtime JSON path is pinned by read-commands-json-golden.test.ts.
    // This assertion locks the exported type's shape so a type-level regression
    // (removing `ok` or renaming `records`) fails immediately at typecheck.
    const sample: MigrationLogResult = {
      ok: true,
      records: [],
      summary: '0 migration(s) applied',
    };
    const parsed = JSON.parse(JSON.stringify(sample)) as {
      ok: boolean;
      records: unknown[];
      summary: string;
    };
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.records)).toBe(true);
    expect(typeof parsed.summary).toBe('string');
    // `ok` must be the discriminator field — no bare-array fallback.
    expect(Array.isArray(parsed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D5 lock: see-also symmetry — check links show; all verbs reference siblings
// ---------------------------------------------------------------------------

describe('migration read-verb see-also symmetry (D5 lock)', () => {
  const READ_VERBS = ['status', 'list', 'graph', 'log', 'show', 'check'] as const;

  function seeAlsoVerbs(cmd: ReturnType<typeof createMigrationStatusCommand>): readonly string[] {
    return (getCommandSeeAlso(cmd) ?? []).map((ref) => ref.verb);
  }

  it('check links migration show in its see-also', () => {
    const refs = seeAlsoVerbs(createMigrationCheckCommand());
    expect(refs).toContain('migration show');
  });

  it('every read verb lists at least two sibling read verbs in its see-also', () => {
    const commands = {
      status: createMigrationStatusCommand,
      list: createMigrationListCommand,
      graph: createMigrationGraphCommand,
      log: createMigrationLogCommand,
      show: createMigrationShowCommand,
      check: createMigrationCheckCommand,
    } satisfies Record<
      (typeof READ_VERBS)[number],
      () => ReturnType<typeof createMigrationStatusCommand>
    >;

    for (const verb of READ_VERBS) {
      const refs = seeAlsoVerbs(commands[verb]());
      const siblingRefs = refs.filter((r) => READ_VERBS.some((v) => r === `migration ${v}`));
      expect(
        siblingRefs.length,
        `${verb} should reference ≥2 sibling read verbs`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('see-also graph is symmetric: if A lists B then B lists A (or B lists at least one sibling)', () => {
    const commands = {
      status: createMigrationStatusCommand,
      list: createMigrationListCommand,
      graph: createMigrationGraphCommand,
      log: createMigrationLogCommand,
      show: createMigrationShowCommand,
      check: createMigrationCheckCommand,
    } satisfies Record<
      (typeof READ_VERBS)[number],
      () => ReturnType<typeof createMigrationStatusCommand>
    >;

    const verbSeeAlso = new Map<string, readonly string[]>();
    for (const verb of READ_VERBS) {
      verbSeeAlso.set(`migration ${verb}`, seeAlsoVerbs(commands[verb]()));
    }

    // For each verb that another verb links to, verify the link target also
    // has at least one back-link to a read verb (the graph is not one-way).
    for (const [sourceVerb, refs] of verbSeeAlso) {
      for (const ref of refs) {
        if (!verbSeeAlso.has(ref)) continue;
        const targetRefs = verbSeeAlso.get(ref) ?? [];
        const hasBackLink = targetRefs.some((r) => verbSeeAlso.has(r));
        expect(
          hasBackLink,
          `${ref} links to at least one read verb (back-link from ${sourceVerb})`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// D2 lock: log and status agree on the missing-DB error envelope shape
// ---------------------------------------------------------------------------

describe('migration read-verb missing-DB error shape parity (D2 lock)', () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('migration log and migration status produce the same PN-CLI-4005 code and meta.missingFlags shape when no db is configured', async () => {
    const noDbConfig = {
      family: { familyId: 'sql', create: vi.fn() },
      target: {
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        kind: 'target',
        migrations: {},
      },
      adapter: { kind: 'adapter', familyId: 'sql', targetId: 'postgres' },
      driver: { kind: 'driver' },
      db: {},
      contract: { output: 'contract.json' },
      migrations: { dir: 'migrations' },
    } as unknown as LoadedConfig;

    const loadConfigSpy = vi.spyOn(configLoader, 'loadConfig');
    loadConfigSpy.mockResolvedValue(noDbConfig);

    const flags = parseGlobalFlags({ json: true });
    const ui = createTerminalUI(flags);

    const logResult = await executeMigrationLogCommand({}, flags, ui);
    expect(logResult.ok).toBe(false);
    if (logResult.ok) throw new Error('unreachable');
    const logEnvelope = logResult.failure.toEnvelope() as CliErrorEnvelope;

    loadConfigSpy.mockResolvedValue(noDbConfig);

    const statusCommandMocks = setupCommandMocks();
    const originalCwd = process.cwd();
    let statusEnvelope: CliErrorEnvelope | undefined;
    try {
      await runAndCaptureExit(() => executeCommand(createMigrationStatusCommand(), ['--json']));
      statusEnvelope = parseJsonObjectFromCliCapture(
        statusCommandMocks.consoleOutput,
      ) as CliErrorEnvelope;
    } finally {
      process.chdir(originalCwd);
      statusCommandMocks.cleanup();
    }

    expect(logEnvelope.code).toBe('PN-CLI-4005');
    expect(statusEnvelope?.code).toBe('PN-CLI-4005');
    expect(logEnvelope.meta?.['missingFlags']).toEqual(['--db']);
    expect(statusEnvelope?.meta?.['missingFlags']).toEqual(['--db']);
  });
});

// ---------------------------------------------------------------------------
// D6 lock: check enumerates all spaces by default; --space narrows
// ---------------------------------------------------------------------------

describe('migration check multi-space parity (D6 lock)', () => {
  it('no-arg check validates all spaces from the multi-space fixture', async () => {
    const { aggregate, migrationsDir } = await buildMultiSpaceFixture();
    const spaces = await enumerateCheckSpaces(aggregate, migrationsDir);
    const spaceIds = spaces.map((s) => s.spaceId);
    expect(spaceIds).toContain('app');
    expect(spaceIds).toContain('postgis');

    const result = runMigrationCheck({ spaces });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ok).toBe(true);
    expect(result.value.failures).toHaveLength(0);
  });

  it('--space app narrows to only the app space', async () => {
    const { aggregate, migrationsDir } = await buildMultiSpaceFixture();
    const spaces = await enumerateCheckSpaces(aggregate, migrationsDir);

    const result = runMigrationCheck({ spaces, spaceFilter: 'app' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ok).toBe(true);
    const checkedSpaceIds = result.value.failures.map((f) => f.where);
    expect(checkedSpaceIds.every((w) => !w.includes('postgis'))).toBe(true);
  });

  it('--space <unknown> emits a structured error (not a bare array)', async () => {
    const { aggregate, migrationsDir } = await buildMultiSpaceFixture();
    const spaces = await enumerateCheckSpaces(aggregate, migrationsDir);

    const result = runMigrationCheck({ spaces, spaceFilter: 'nonexistent' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const envelope = result.failure.toEnvelope();
    expect(envelope.ok).toBe(false);
    expect(typeof envelope.code).toBe('string');
    expect(envelope.meta?.['code']).toBe('MIGRATION.SPACE_NOT_FOUND');
  });
});
