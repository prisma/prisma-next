import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeMigrationPackage } from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import type { MigrationListResult } from '@prisma-next/migration-tools/migration-list-types';
import { writeRef } from '@prisma-next/migration-tools/refs';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  renderMigrationListHumanOutput,
  runMigrationList,
} from '../../src/commands/migration-list';
import { renderMigrationList } from '../../src/utils/formatters/migration-list-render';
import { parseGlobalFlags } from '../../src/utils/global-flags';
import { detectGlyphMode } from '../../src/utils/glyph-mode';
import { createTerminalUI } from '../../src/utils/terminal-ui';

/**
 * Verifies the `migration list` command's data-and-policy core:
 * enumeration, `--space` narrowing, structured-error surfacing, and
 * JSON shape. Tests exercise `runMigrationList` directly so coverage
 * doesn't depend on the CLI shell's `loadConfig` step. No `vi.mock` /
 * `vi.hoisted` / `vi.resetModules` dance: tests build a real
 * `migrations/` tree in a tmpdir, call the core, and assert on the
 * returned {@link MigrationListResult}.
 *
 * Human output is verified by piping the result through
 * {@link renderMigrationList} (the same renderer the CLI shell uses) —
 * the byte-for-byte spec-fixture and multi-space tests pin the
 * end-to-end string the user sees. JSON-shape tests inspect the raw
 * result. The structured `MIGRATION.SPACE_NOT_FOUND` error is asserted
 * via `result.failure.toEnvelope()` — no command-builder needed.
 */

const HASH_4cb4256 = `sha256:4cb4256${'0'.repeat(57)}`;
const HASH_55bada2 = `sha256:55bada2${'0'.repeat(57)}`;
const HASH_2f45cc7 = `sha256:2f45cc7${'0'.repeat(57)}`;
const HASH_804e018 = `sha256:804e018${'0'.repeat(57)}`;
const HASH_BRANCH_X = `sha256:${'a'.repeat(64)}`;
const HASH_BRANCH_Y = `sha256:${'b'.repeat(64)}`;
const HASH_FAN_BASE = `sha256:${'c'.repeat(64)}`;
const HASH_FAN_A = `sha256:${'d'.repeat(64)}`;
const HASH_FAN_B = `sha256:${'e'.repeat(64)}`;
const HASH_FAN_C = `sha256:${'f'.repeat(64)}`;
const HASH_POSTGIS = `sha256:9aabbcc${'0'.repeat(57)}`;
const HASH_SHARED = `sha256:shared0${'0'.repeat(57)}`;
const HASH_ROLLBACK_TIP = `sha256:tiprb00${'0'.repeat(57)}`;
const HASH_ROLLBACK_END = `sha256:endrb00${'0'.repeat(57)}`;
const HASH_LINEAR_MID = `sha256:linmid0${'0'.repeat(57)}`;
const HASH_LINEAR_TIP = `sha256:lintip0${'0'.repeat(57)}`;

const ADDITIVE_OP: MigrationPlanOperation = {
  id: 'table.users',
  label: 'Create table users',
  operationClass: 'additive',
};

const BACKFILL_OP = {
  id: 'data.backfill_emails',
  label: 'Backfill emails',
  operationClass: 'data',
  invariantId: 'backfill_emails_v1',
} as unknown as MigrationPlanOperation;

interface PackageSpec {
  readonly spaceId: string;
  readonly dirName: string;
  readonly from: string | null;
  readonly to: string;
  readonly ops?: readonly MigrationPlanOperation[];
  readonly providedInvariants?: readonly string[];
}

interface RefSpec {
  readonly spaceId: string;
  readonly name: string;
  readonly hash: string;
}

async function writePackage(migrationsRoot: string, spec: PackageSpec): Promise<void> {
  const pkgDir = join(migrationsRoot, spec.spaceId, spec.dirName);
  const ops = spec.ops ?? [ADDITIVE_OP];
  const baseMetadata = {
    from: spec.from,
    to: spec.to,
    hints: { used: [], applied: [], plannerVersion: '2.0.0' },
    labels: [],
    providedInvariants:
      spec.providedInvariants ??
      ops
        .map((op) =>
          typeof op === 'object' &&
          op !== null &&
          'invariantId' in op &&
          typeof op.invariantId === 'string'
            ? op.invariantId
            : undefined,
        )
        .filter((inv): inv is string => inv !== undefined),
    createdAt: '2026-02-25T14:30:00.000Z',
  } as Omit<MigrationMetadata, 'migrationHash'>;
  const metadata: MigrationMetadata = {
    ...baseMetadata,
    migrationHash: computeMigrationHash(baseMetadata, ops),
  };
  await writeMigrationPackage(pkgDir, metadata, ops);
}

async function writeRefFor(migrationsRoot: string, spec: RefSpec): Promise<void> {
  const refsDir = join(migrationsRoot, spec.spaceId, 'refs');
  await mkdir(refsDir, { recursive: true });
  await writeRef(refsDir, spec.name, { hash: spec.hash, invariants: [] });
}

interface Fixture {
  readonly cwd: string;
  readonly migrationsRoot: string;
}

const createdFixtures: Fixture[] = [];

async function setupFixture(): Promise<Fixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'cli-migration-list-'));
  const migrationsRoot = join(cwd, 'migrations');
  const fixture = { cwd, migrationsRoot };
  createdFixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  const fixtures = createdFixtures.splice(0);
  await Promise.all(fixtures.map((f) => rm(f.cwd, { recursive: true, force: true })));
});

function expectOk<T>(
  result: { ok: true; value: T } | { ok: false; failure: unknown },
): asserts result is { ok: true; value: T } {
  if (!result.ok) {
    throw new Error(`Expected ok result, got: ${JSON.stringify(result.failure)}`);
  }
}

function renderListed(listResult: MigrationListResult): string {
  return renderMigrationList(listResult);
}

function renderGraphListed(
  listResult: MigrationListResult,
  glyphMode: 'unicode' | 'ascii',
  useColor = false,
): string {
  return renderMigrationListHumanOutput(listResult, {
    graph: true,
    glyphMode,
    useColor,
  });
}

describe('runMigrationList — slice-spec worked example', () => {
  it('renders the slice-spec worked example byte-for-byte (single space)', async () => {
    const { migrationsRoot } = await setupFixture();

    // Five-row spec example (slice spec § Per-line shape):
    //   20260601T1200_backfill_emails     55bada2 ⟲          {backfill_emails_v1} (production)
    //   20260518T1701_namespaces_bookend  2f45cc7 → 804e018  (db)
    //   20260422T0748_migration           55bada2 → 2f45cc7  (staging)
    //   20260422T0742_migration           4cb4256 → 55bada2  (production)
    //   20260422T0720_initial             ∅       → 4cb4256
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0720_initial',
      from: null,
      to: HASH_4cb4256,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0742_migration',
      from: HASH_4cb4256,
      to: HASH_55bada2,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0748_migration',
      from: HASH_55bada2,
      to: HASH_2f45cc7,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260518T1701_namespaces_bookend',
      from: HASH_2f45cc7,
      to: HASH_804e018,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260601T1200_backfill_emails',
      from: HASH_55bada2,
      to: HASH_55bada2,
      ops: [BACKFILL_OP],
    });
    await writeRefFor(migrationsRoot, {
      spaceId: 'app',
      name: 'production',
      hash: HASH_55bada2,
    });
    await writeRefFor(migrationsRoot, { spaceId: 'app', name: 'staging', hash: HASH_2f45cc7 });
    await writeRefFor(migrationsRoot, { spaceId: 'app', name: 'db', hash: HASH_804e018 });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    const expected =
      '⟲ 20260601T1200_backfill_emails     55bada2  {backfill_emails_v1} (production)\n' +
      '* 20260518T1701_namespaces_bookend  2f45cc7 → 804e018  (db)\n' +
      '* 20260422T0748_migration           55bada2 → 2f45cc7  (staging)\n' +
      '* 20260422T0742_migration           4cb4256 → 55bada2  (production)\n' +
      '* 20260422T0720_initial             ∅       → 4cb4256\n' +
      '\n' +
      '5 migration(s) on disk';
    expect(renderListed(result.value)).toBe(expected);
  });

  it('renders every on-disk migration as exactly one row (row-count guarantee)', async () => {
    // Six demo shapes from the slice DoD checklist:
    //   single-branch  — linear chain (A → B → C)
    //   sub-branches   — same source, two destinations (A → B, A → C)
    //   wide-fan       — same source, four destinations
    //   sequential-diamonds — convergence (X → Y, X′ → Y)
    //   rollback       — forward then "inverse" (A → B, B → A) — regular edges
    //   skip-rollback  — forward then jump back further (A → B → C, C → A) — regular edges
    // Each shape contributes a few migrations to one shared `app` space.
    // The assertion: every migration.json on disk → exactly one row, in
    // both the JSON shape and the rendered human string.
    const { migrationsRoot } = await setupFixture();

    const specs: PackageSpec[] = [
      // single-branch
      { spaceId: 'app', dirName: '20260101T0000_sb_a', from: null, to: HASH_FAN_BASE },
      { spaceId: 'app', dirName: '20260101T0001_sb_b', from: HASH_FAN_BASE, to: HASH_FAN_A },
      { spaceId: 'app', dirName: '20260101T0002_sb_c', from: HASH_FAN_A, to: HASH_FAN_B },
      // sub-branches
      { spaceId: 'app', dirName: '20260102T0000_sub_a', from: HASH_FAN_BASE, to: HASH_BRANCH_X },
      { spaceId: 'app', dirName: '20260102T0001_sub_b', from: HASH_FAN_BASE, to: HASH_BRANCH_Y },
      // wide-fan
      { spaceId: 'app', dirName: '20260103T0000_fan_a', from: HASH_FAN_BASE, to: HASH_FAN_A },
      { spaceId: 'app', dirName: '20260103T0001_fan_b', from: HASH_FAN_BASE, to: HASH_FAN_B },
      { spaceId: 'app', dirName: '20260103T0002_fan_c', from: HASH_FAN_BASE, to: HASH_FAN_C },
      // sequential-diamonds: convergence on HASH_FAN_C from two sources.
      {
        spaceId: 'app',
        dirName: '20260104T0000_diamond_left',
        from: HASH_BRANCH_X,
        to: HASH_FAN_C,
      },
      {
        spaceId: 'app',
        dirName: '20260104T0001_diamond_right',
        from: HASH_BRANCH_Y,
        to: HASH_FAN_C,
      },
      // rollback (A → B, B → A)
      { spaceId: 'app', dirName: '20260105T0000_rollback_fwd', from: HASH_FAN_A, to: HASH_FAN_B },
      { spaceId: 'app', dirName: '20260105T0001_rollback_back', from: HASH_FAN_B, to: HASH_FAN_A },
      // skip-rollback (C → A, jumping further back)
      { spaceId: 'app', dirName: '20260106T0000_skip_back', from: HASH_FAN_C, to: HASH_FAN_A },
    ];
    for (const spec of specs) {
      await writePackage(migrationsRoot, spec);
    }

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    // JSON pass — count and assertion are the trustworthy oracle for
    // "every on-disk migration shows up exactly once".
    expect(result.value.ok).toBe(true);
    expect(result.value.spaces).toHaveLength(1);
    const renderedDirs = result.value.spaces[0]!.migrations.map((m) => m.dirName).sort();
    const fixtureDirs = specs.map((s) => s.dirName).sort();
    expect(renderedDirs).toEqual(fixtureDirs);
    expect(renderedDirs).toHaveLength(specs.length);
    expect(result.value.summary).toBe(`${specs.length} migration(s) on disk`);

    // Human pass — confirm every dirName lands on its own row, no
    // dedup, no silent omission. Count rows directly.
    const human = renderListed(result.value);
    const rows = human.split('\n').filter((line) => /^(\s*)?[*↩⟲] \d{8}T\d{4}_/.test(line));
    expect(rows).toHaveLength(specs.length);
    for (const spec of specs) {
      expect(human).toContain(spec.dirName);
    }
    expect(human.trim().endsWith(`${specs.length} migration(s) on disk`)).toBe(true);
  });

  it('renders multi-contract-space output with per-space heading and 2-space indent', async () => {
    const { migrationsRoot } = await setupFixture();

    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0720_initial',
      from: null,
      to: HASH_4cb4256,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0742_migration',
      from: HASH_4cb4256,
      to: HASH_55bada2,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260518T1701_namespaces_bookend',
      from: HASH_55bada2,
      to: HASH_804e018,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'postgis',
      dirName: '20260601T0000_install_postgis_extension',
      from: null,
      to: HASH_POSTGIS,
    });
    await writeRefFor(migrationsRoot, {
      spaceId: 'app',
      name: 'production',
      hash: HASH_55bada2,
    });
    await writeRefFor(migrationsRoot, { spaceId: 'app', name: 'db', hash: HASH_804e018 });
    await writeRefFor(migrationsRoot, { spaceId: 'postgis', name: 'db', hash: HASH_POSTGIS });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    const expected =
      'app:\n' +
      '  * 20260518T1701_namespaces_bookend  55bada2 → 804e018  (db)\n' +
      '  * 20260422T0742_migration           4cb4256 → 55bada2  (production)\n' +
      '  * 20260422T0720_initial             ∅       → 4cb4256\n' +
      '\n' +
      'postgis:\n' +
      '  * 20260601T0000_install_postgis_extension  ∅       → 9aabbcc  (db)\n' +
      '\n' +
      '4 migration(s) across 2 contract space(s)';
    expect(renderListed(result.value)).toBe(expected);
    expect(result.value.summary).toBe('4 migration(s) across 2 contract space(s)');
  });

  it('renders convergence: the same ref decorates every row landing on the convergence hash', async () => {
    const { migrationsRoot } = await setupFixture();

    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0000_left',
      from: HASH_BRANCH_X,
      to: HASH_FAN_C,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0001_right',
      from: HASH_BRANCH_Y,
      to: HASH_FAN_C,
    });
    await writeRefFor(migrationsRoot, { spaceId: 'app', name: 'production', hash: HASH_FAN_C });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    // Both converging rows carry the same ref decoration on the same destination.
    const migrations = result.value.spaces[0]!.migrations;
    expect(migrations).toHaveLength(2);
    for (const m of migrations) {
      expect(m.to).toBe(HASH_FAN_C);
      expect(m.refs).toEqual(['production']);
    }
    const human = renderListed(result.value);
    const matches = [...human.matchAll(/\(production\)/g)];
    expect(matches).toHaveLength(2);
  });

  it('renders useless self-edge (from === to, zero providedInvariants) as a `⟲` row with empty decoration', async () => {
    // New edge-case-table entry (slice spec amended this round): self-edge
    // with zero invariants is no longer rejected; it lists like any other
    // migration with an empty decoration column.
    const { migrationsRoot } = await setupFixture();

    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0000_useless_self_edge',
      from: HASH_4cb4256,
      to: HASH_4cb4256,
      ops: [],
      providedInvariants: [],
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);
    const [entry] = result.value.spaces[0]!.migrations;
    expect(entry?.from).toBe(HASH_4cb4256);
    expect(entry?.to).toBe(HASH_4cb4256);
    expect(entry?.providedInvariants).toEqual([]);
    expect(entry?.refs).toEqual([]);

    // The `⟲` row has hash-width pad in the destination slot and no
    // decoration block at all. Trailing newline + summary follows.
    const expected =
      '⟲ 20260101T0000_useless_self_edge  4cb4256\n' + '\n' + '1 migration(s) on disk';
    expect(renderListed(result.value)).toBe(expected);
  });

  it('renders self-edge with invariants as `⟲ … {invariant_id}`', async () => {
    const { migrationsRoot } = await setupFixture();

    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260601T1200_backfill_emails',
      from: HASH_55bada2,
      to: HASH_55bada2,
      ops: [BACKFILL_OP],
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);
    expect(result.value.spaces[0]!.migrations[0]!.providedInvariants).toEqual([
      'backfill_emails_v1',
    ]);

    const human = renderListed(result.value);
    expect(human).toMatch(/^⟲ 20260601T1200_backfill_emails/);
    expect(human).toMatch(/55bada2 {2}\{backfill_emails_v1\}/);
    expect(human).not.toContain('→');
  });

  it('renders the empty-state line when the migrations directory does not exist', async () => {
    const { cwd } = await setupFixture();
    const result = await runMigrationList({ migrationsDir: join(cwd, 'no-such-migrations') });
    expectOk(result);
    // Empty-state synthesizes the app space so the renderer can name a
    // directory.
    expect(result.value.spaces).toEqual([{ spaceId: 'app', migrations: [] }]);
    expect(renderListed(result.value)).toBe('There are no migrations in migrations/app/ yet');
  });

  it('renders the empty-state line for an existing-but-empty default scope (only stray non-space dirs)', async () => {
    const { migrationsRoot } = await setupFixture();
    // The migrations/ dir exists but contains no valid space directory
    // (or it's entirely empty). Still synthesizes the app empty-state
    // so the user sees a directory name.
    await mkdir(migrationsRoot, { recursive: true });
    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);
    expect(renderListed(result.value)).toBe('There are no migrations in migrations/app/ yet');
  });

  it('threads topology classification so skip-rollback shows a leading ↩ glyph', async () => {
    const { migrationsRoot } = await setupFixture();
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0000_chain_a',
      from: null,
      to: HASH_FAN_BASE,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0001_chain_b',
      from: HASH_FAN_BASE,
      to: HASH_FAN_A,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0002_chain_c',
      from: HASH_FAN_A,
      to: HASH_FAN_B,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260106T0000_skip_back',
      from: HASH_FAN_B,
      to: HASH_FAN_BASE,
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);
    const human = renderListed(result.value);
    expect(human).toMatch(/^↩ 20260106T0000_skip_back/m);
    expect(human).toContain('* 20260101T0002_chain_c');
  });
});

describe('runMigrationList — --space flag', () => {
  it('narrows to a single contract space and suppresses the per-space heading', async () => {
    const { migrationsRoot } = await setupFixture();

    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0720_initial',
      from: null,
      to: HASH_4cb4256,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'postgis',
      dirName: '20260601T0000_install_postgis_extension',
      from: null,
      to: HASH_POSTGIS,
    });

    const result = await runMigrationList({
      migrationsDir: migrationsRoot,
      spaceFilter: 'postgis',
    });
    expectOk(result);
    expect(result.value.spaces).toHaveLength(1);
    expect(result.value.spaces[0]!.spaceId).toBe('postgis');
    expect(result.value.spaces[0]!.migrations.map((m) => m.dirName)).toEqual([
      '20260601T0000_install_postgis_extension',
    ]);

    const human = renderListed(result.value);
    // Single-space output → no per-space heading.
    expect(human).not.toContain('app:');
    expect(human).not.toContain('postgis:');
    expect(human).toContain('20260601T0000_install_postgis_extension');
    expect(human).not.toContain('20260422T0720_initial');
    expect(human.trim().endsWith('1 migration(s) on disk')).toBe(true);
  });

  it('renders empty-state for --space <id> on an existing-but-empty space dir (exit 0 equivalent)', async () => {
    const { migrationsRoot } = await setupFixture();
    await mkdir(join(migrationsRoot, 'postgis'), { recursive: true });

    const result = await runMigrationList({
      migrationsDir: migrationsRoot,
      spaceFilter: 'postgis',
    });
    expectOk(result);
    expect(result.value.spaces).toEqual([{ spaceId: 'postgis', migrations: [] }]);
    expect(renderListed(result.value)).toBe('There are no migrations in migrations/postgis/ yet');
  });

  it('emits MIGRATION.SPACE_NOT_FOUND when --space names a non-existent contract space', async () => {
    const { migrationsRoot } = await setupFixture();

    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0720_initial',
      from: null,
      to: HASH_4cb4256,
    });

    const result = await runMigrationList({
      migrationsDir: migrationsRoot,
      spaceFilter: 'postgis',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    const envelope = result.failure.toEnvelope();
    expect(envelope.meta?.['code']).toBe('MIGRATION.SPACE_NOT_FOUND');
    expect(envelope.meta?.['spaceId']).toBe('postgis');
    expect(envelope.meta?.['availableSpaces']).toEqual(['app']);
    expect(envelope.summary).toBe('Unknown contract space: postgis');
  });

  it('emits MIGRATION.SPACE_NOT_FOUND with empty available list when migrations/ is missing', async () => {
    const { cwd } = await setupFixture();
    const result = await runMigrationList({
      migrationsDir: join(cwd, 'no-such-migrations'),
      spaceFilter: 'postgis',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    const envelope = result.failure.toEnvelope();
    expect(envelope.meta?.['code']).toBe('MIGRATION.SPACE_NOT_FOUND');
    expect(envelope.meta?.['availableSpaces']).toEqual([]);
  });

  it('emits MIGRATION.INVALID_SPACE_ID when --space value violates the naming rule', async () => {
    const { migrationsRoot } = await setupFixture();
    const result = await runMigrationList({
      migrationsDir: migrationsRoot,
      spaceFilter: '../escape',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    const envelope = result.failure.toEnvelope();
    expect(envelope.meta?.['code']).toBe('MIGRATION.INVALID_SPACE_ID');
    expect(envelope.meta?.['spaceId']).toBe('../escape');
  });

  it('emits MIGRATION.SPACE_NOT_FOUND for --space refs (reserved per-space subdirectory name)', async () => {
    const { migrationsRoot } = await setupFixture();

    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0720_initial',
      from: null,
      to: HASH_4cb4256,
    });
    // A stray top-level `migrations/refs/` directory: `refs` is the
    // reserved per-space ref-store name, never a contract space. The
    // syntactic name check passes, but enumeration excludes it, so the
    // request must fail rather than wrongly render the app empty-state.
    await writeRef(join(migrationsRoot, 'refs'), 'production', {
      hash: HASH_55bada2,
      invariants: [],
    });

    const result = await runMigrationList({
      migrationsDir: migrationsRoot,
      spaceFilter: 'refs',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    const envelope = result.failure.toEnvelope();
    expect(envelope.meta?.['code']).toBe('MIGRATION.SPACE_NOT_FOUND');
    expect(envelope.meta?.['spaceId']).toBe('refs');
    expect(envelope.meta?.['availableSpaces']).toEqual(['app']);
  });
});

describe('runMigrationList — JSON output shape', () => {
  it('JSON output is unconditionally grouped by contract space (single-space)', async () => {
    const { migrationsRoot } = await setupFixture();

    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0720_initial',
      from: null,
      to: HASH_4cb4256,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0742_migration',
      from: HASH_4cb4256,
      to: HASH_55bada2,
    });
    await writeRefFor(migrationsRoot, {
      spaceId: 'app',
      name: 'production',
      hash: HASH_55bada2,
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    // Shape mirrors MigrationListResult — top-level keys, then per-space
    // groups even for a single space.
    const json: MigrationListResult = result.value;
    expect(json.ok).toBe(true);
    expect(json.summary).toBe('2 migration(s) on disk');
    expect(json.spaces).toHaveLength(1);
    expect(json.spaces[0]!.spaceId).toBe('app');

    // Migrations latest-first.
    const latest = json.spaces[0]!.migrations[0]!;
    const oldest = json.spaces[0]!.migrations[1]!;
    expect(latest.dirName).toBe('20260422T0742_migration');
    expect(oldest.dirName).toBe('20260422T0720_initial');

    // Full sha256 hash preserved in JSON (no abbreviation).
    expect(latest.migrationHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(latest.from).toBe(HASH_4cb4256);
    expect(latest.to).toBe(HASH_55bada2);

    // refs / providedInvariants / operationCount / createdAt populated
    // on every entry, even when empty.
    expect(latest.refs).toEqual(['production']);
    expect(oldest.refs).toEqual([]);
    expect(latest.providedInvariants).toEqual([]);
    expect(latest.operationCount).toBe(1);
    expect(typeof latest.createdAt).toBe('string');
  });

  it('JSON output is unconditionally grouped by contract space (multi-space)', async () => {
    const { migrationsRoot } = await setupFixture();

    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0720_initial',
      from: null,
      to: HASH_4cb4256,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'postgis',
      dirName: '20260601T0000_install_postgis_extension',
      from: null,
      to: HASH_POSTGIS,
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);
    expect(result.value.spaces.map((s) => s.spaceId)).toEqual(['app', 'postgis']);
    expect(result.value.summary).toBe('2 migration(s) across 2 contract space(s)');
  });
});

describe('runMigrationList — per-space topology classification', () => {
  it('classifies the same contract hash differently across spaces', async () => {
    const { migrationsRoot } = await setupFixture();

    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0000_init',
      from: null,
      to: HASH_SHARED,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0001_continue',
      from: HASH_SHARED,
      to: HASH_ROLLBACK_TIP,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0002_rollback',
      from: HASH_ROLLBACK_TIP,
      to: HASH_SHARED,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0003_after',
      from: HASH_SHARED,
      to: HASH_ROLLBACK_END,
    });

    await writePackage(migrationsRoot, {
      spaceId: 'ext',
      dirName: '20260101T0000_init',
      from: null,
      to: HASH_SHARED,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'ext',
      dirName: '20260101T0001_mid',
      from: HASH_SHARED,
      to: HASH_LINEAR_MID,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'ext',
      dirName: '20260101T0002_tip',
      from: HASH_LINEAR_MID,
      to: HASH_LINEAR_TIP,
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    const flat = renderListed(result.value);
    const appBlock = flat.split('\n\next:')[0] ?? '';
    const extBlock = flat.split('\n\next:')[1]?.split('\n\n')[0] ?? '';

    expect(appBlock).toContain('↩ 20260101T0002_rollback');
    expect(appBlock).toContain('* 20260101T0003_after');
    expect(extBlock).not.toContain('↩');
    expect(extBlock).toMatch(/^\s+\* 20260101T0002_tip/m);
  });
});

describe('migration list --graph human output', () => {
  it('renders linear history byte-identical to the flat list', async () => {
    const { migrationsRoot } = await setupFixture();
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0000_chain_a',
      from: null,
      to: HASH_FAN_BASE,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0001_chain_b',
      from: HASH_FAN_BASE,
      to: HASH_FAN_A,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0002_chain_c',
      from: HASH_FAN_A,
      to: HASH_FAN_B,
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    const flat = renderListed(result.value);
    const graph = renderGraphListed(result.value, 'unicode');
    const flatRows = flat.split('\n').slice(0, 3).join('\n');
    expect(graph.split('\n').slice(0, 3).join('\n')).toBe(flatRows);
  });

  it('renders a branched convergence tree with node-line and lane gutters', async () => {
    const { migrationsRoot } = await setupFixture();
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0000_left',
      from: HASH_BRANCH_X,
      to: HASH_FAN_C,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0001_right',
      from: HASH_BRANCH_Y,
      to: HASH_FAN_C,
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    const graph = renderGraphListed(result.value, 'unicode');
    expect(graph).toBe(
      'o   fffffff\n' +
        '├─┐\n' +
        '* │ 20260101T0001_right  bbbbbbb → fffffff\n' +
        '│ * 20260101T0000_left   aaaaaaa → fffffff\n' +
        '\n' +
        '2 migration(s) on disk',
    );
  });

  it('forces ASCII glyphs when glyph mode is ascii', async () => {
    const { migrationsRoot } = await setupFixture();
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0000_left',
      from: HASH_BRANCH_X,
      to: HASH_FAN_C,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0001_right',
      from: HASH_BRANCH_Y,
      to: HASH_FAN_C,
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    const graph = renderGraphListed(result.value, 'ascii');
    expect(graph).toContain('+-\\');
    expect(graph).toContain('->');
    expect(graph).not.toContain('→');
  });

  it('picks ASCII for non-TTY stdout via injected runtime', () => {
    const ui = createTerminalUI(parseGlobalFlags({}), {
      isTTY: false,
      env: { LANG: 'en_US.UTF-8' },
    });
    expect(ui.resolveGlyphMode(false)).toBe('ascii');
    expect(detectGlyphMode(ui.glyphModeInput())).toBe('ascii');
  });

  it('picks Unicode on a UTF-8 TTY via injected runtime', () => {
    const ui = createTerminalUI(parseGlobalFlags({}), {
      isTTY: true,
      env: { LANG: 'en_US.UTF-8' },
    });
    expect(ui.resolveGlyphMode(false)).toBe('unicode');
  });

  it('lets --ascii override a UTF-8 TTY', () => {
    const ui = createTerminalUI(parseGlobalFlags({}), {
      isTTY: true,
      env: { LANG: 'en_US.UTF-8' },
    });
    expect(ui.resolveGlyphMode(true)).toBe('ascii');
  });

  it('keeps Unicode glyphs when color is disabled', async () => {
    const { migrationsRoot } = await setupFixture();
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0000_left',
      from: HASH_BRANCH_X,
      to: HASH_FAN_C,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0001_right',
      from: HASH_BRANCH_Y,
      to: HASH_FAN_C,
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    const coloredOff = renderGraphListed(result.value, 'unicode', false);
    const ascii = renderGraphListed(result.value, 'ascii', false);
    expect(coloredOff).toContain('→');
    expect(coloredOff).not.toContain('->');
    expect(ascii).toContain('->');
  });

  it('keeps ANSI styling when ASCII glyph mode is on', async () => {
    const { migrationsRoot } = await setupFixture();
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0000_left',
      from: HASH_BRANCH_X,
      to: HASH_FAN_C,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0001_right',
      from: HASH_BRANCH_Y,
      to: HASH_FAN_C,
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    const wrapSgr =
      (open: string, close: string) =>
      (text: string): string =>
        `${open}${text}${close}`;
    vi.doMock('colorette', () => ({
      bold: wrapSgr('\u001b[1m', '\u001b[22m'),
      dim: wrapSgr('\u001b[2m', '\u001b[22m'),
      cyan: wrapSgr('\u001b[36m', '\u001b[39m'),
      cyanBright: wrapSgr('\u001b[96m', '\u001b[39m'),
      yellow: wrapSgr('\u001b[33m', '\u001b[39m'),
      green: wrapSgr('\u001b[32m', '\u001b[39m'),
      greenBright: wrapSgr('\u001b[92m', '\u001b[39m'),
    }));
    vi.resetModules();
    try {
      const { parseGlobalFlags: parseFlags } = await import('../../src/utils/global-flags');
      const { createTerminalUI: createUi } = await import('../../src/utils/terminal-ui');
      const { renderMigrationListHumanOutput: renderHuman } = await import(
        '../../src/commands/migration-list'
      );
      const ui = createUi(parseFlags({}), {
        isTTY: true,
        env: { LANG: 'en_US.UTF-8' },
      });
      const graph = renderHuman(result.value, {
        graph: true,
        glyphMode: ui.resolveGlyphMode(true),
        useColor: true,
      });
      expect(graph).toContain('\u001b[');
      expect(graph).toContain('->');
      expect(graph).not.toContain('→');
    } finally {
      vi.doUnmock('colorette');
      vi.resetModules();
    }
  });

  it('scopes graph output with --space', async () => {
    const { migrationsRoot } = await setupFixture();
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0720_initial',
      from: null,
      to: HASH_4cb4256,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'postgis',
      dirName: '20260101T0000_left',
      from: HASH_BRANCH_X,
      to: HASH_FAN_C,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'postgis',
      dirName: '20260101T0001_right',
      from: HASH_BRANCH_Y,
      to: HASH_FAN_C,
    });

    const result = await runMigrationList({
      migrationsDir: migrationsRoot,
      spaceFilter: 'postgis',
    });
    expectOk(result);

    const graph = renderGraphListed(result.value, 'unicode');
    expect(graph).not.toContain('app:');
    expect(graph).not.toContain('20260422T0720_initial');
    expect(graph).toContain('20260101T0000_left');
    expect(graph).toContain('o   fffffff');
  });

  it('renders multi-space graph blocks with headings and summary', async () => {
    const { migrationsRoot } = await setupFixture();
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260422T0720_initial',
      from: null,
      to: HASH_4cb4256,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'postgis',
      dirName: '20260101T0000_left',
      from: HASH_BRANCH_X,
      to: HASH_FAN_C,
    });
    await writePackage(migrationsRoot, {
      spaceId: 'postgis',
      dirName: '20260101T0001_right',
      from: HASH_BRANCH_Y,
      to: HASH_FAN_C,
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    const graph = renderGraphListed(result.value, 'unicode');
    expect(graph).toBe(
      'app:\n' +
        '  * 20260422T0720_initial  ∅       → 4cb4256\n' +
        '\n' +
        'postgis:\n' +
        '  o   fffffff\n' +
        '  ├─┐\n' +
        '  * │ 20260101T0001_right  bbbbbbb → fffffff\n' +
        '  │ * 20260101T0000_left   aaaaaaa → fffffff\n' +
        '\n' +
        '3 migration(s) across 2 contract space(s)',
    );
  });

  it('leaves JSON serialization unchanged by graph rendering options', async () => {
    const { migrationsRoot } = await setupFixture();
    await writePackage(migrationsRoot, {
      spaceId: 'app',
      dirName: '20260101T0000_left',
      from: HASH_BRANCH_X,
      to: HASH_FAN_C,
    });

    const result = await runMigrationList({ migrationsDir: migrationsRoot });
    expectOk(result);

    const json = JSON.stringify(result.value, null, 2);
    expect(json).toContain('20260101T0000_left');
    expect(json).not.toContain('├─┐');
    expect(JSON.parse(json)).toEqual(result.value);
  });
});
