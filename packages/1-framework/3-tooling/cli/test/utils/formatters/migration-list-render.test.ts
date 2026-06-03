import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { describe, expect, it } from 'vitest';
import {
  buildEdgeAnnotationsByHashFromListEntries,
  buildRefsByHashFromListEntries,
  IDENTITY_MIGRATION_LIST_STYLER,
  migrationGraphFromListEntries,
  renderMigrationList,
  renderMigrationListWithStyle,
} from '../../../src/utils/formatters/migration-list-render';
import type {
  MigrationListEntry,
  MigrationListResult,
  MigrationSpaceListEntry,
} from '../../../src/utils/formatters/migration-list-types';

const HASH_A = 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789ab';
const HASH_B = 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef12';
const HASH_C = 'sha256:4cb4256c30b7a8123456789012345678901234567890123456';
const HASH_D = 'sha256:55bada2f123456789012345678901234567890123456789012';
const HASH_E = 'sha256:2f45cc7123456789012345678901234567890123456789012';
const HASH_F = 'sha256:804e0181234567890123456789012345678901234567890123';

let migrationHashSeq = 0;

function migration(
  overrides: Pick<MigrationListEntry, 'dirName' | 'to'> &
    Partial<Omit<MigrationListEntry, 'dirName' | 'to'>>,
): MigrationListEntry {
  return {
    from: null,
    migrationHash: overrides.migrationHash ?? `sha256:list-mig-${migrationHashSeq++}`,
    operationCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    refs: [],
    providedInvariants: [],
    ...overrides,
  };
}

function result(spaces: readonly MigrationSpaceListEntry[], summary: string): MigrationListResult {
  return { ok: true, spaces, summary };
}

function renderListed(listResult: MigrationListResult): string {
  return renderMigrationList(listResult);
}

describe('migrationGraphFromListEntries', () => {
  it('builds a graph edge per list entry', () => {
    const entries = [
      migration({ dirName: 'init', from: null, to: HASH_A }),
      migration({ dirName: 'next', from: HASH_A, to: HASH_B }),
    ];
    const graph = migrationGraphFromListEntries(entries);
    expect(graph.migrationByHash.size).toBe(2);
    expect(graph.forwardChain.get(EMPTY_CONTRACT_HASH)?.[0]?.dirName).toBe('init');
  });

  it('maps edge annotations and refs from list entries', () => {
    const entries = [
      migration({
        dirName: 'backfill',
        from: HASH_D,
        to: HASH_D,
        operationCount: 3,
        providedInvariants: ['inv_a'],
        refs: ['production'],
      }),
    ];
    const annotations = buildEdgeAnnotationsByHashFromListEntries(entries);
    expect(annotations.get(entries[0]!.migrationHash)).toEqual({
      operationCount: 3,
      invariants: ['inv_a'],
    });
    expect(buildRefsByHashFromListEntries(entries).get(HASH_D)).toEqual(['production']);
  });
});

describe('renderMigrationList', () => {
  it('uses ASCII tree glyphs when glyph mode is ascii', () => {
    const eUsers = migration({ dirName: '20250115_add_users', from: null, to: HASH_A });
    const ePosts = migration({ dirName: '20250203_add_posts', from: HASH_A, to: HASH_B });
    const eComments = migration({ dirName: '20250310_add_comments', from: HASH_B, to: HASH_C });
    const eRollback = migration({
      dirName: '20250312_full_rollback',
      from: HASH_C,
      to: HASH_A,
      migrationHash: 'sha256:rollback-edge',
    });
    const output = renderMigrationListWithStyle(
      result(
        [
          {
            spaceId: 'app',
            migrations: [eRollback, eComments, ePosts, eUsers],
          },
        ],
        '4 migration(s) on disk',
      ),
      IDENTITY_MIGRATION_LIST_STYLER,
      'ascii',
    );
    expect(output).toContain('20250312_full_rollback');
    expect(output).toContain('->');
    expect(output).toContain('|v');
    expect(output).not.toContain('→');
    expect(output).not.toContain('↩');
  });

  it('renders a linear chain as a tree with operation counts', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260422T0720_initial',
                from: null,
                to: HASH_C,
              }),
            ],
          },
        ],
        '1 migration(s) on disk',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "○   4cb4256
      │↑  20260422T0720_initial  ∅       → 4cb4256  1 ops
      ∅

      1 migration(s) on disk"
    `);
  });

  it('renders refs on destination contract nodes', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260422T0742_migration',
                from: HASH_A,
                to: HASH_B,
                refs: ['production'],
              }),
            ],
          },
        ],
        '1 migration(s) on disk',
      ),
    );
    expect(output).toContain('(production)');
    expect(output).toContain('20260422T0742_migration');
    expect(output).toContain('1 ops');
  });

  it('renders invariants and operation count on edge rows', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260601T1200_backfill',
                from: HASH_D,
                to: HASH_D,
                operationCount: 2,
                providedInvariants: ['a', 'b'],
              }),
            ],
          },
        ],
        '1 migration(s) on disk',
      ),
    );
    expect(output).toContain('2 ops');
    expect(output).toContain('{a, b}');
    expect(output).toContain('│⟲');
  });

  it('renders branching topology as a diamond', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({ dirName: 'init', from: null, to: HASH_A }),
              migration({ dirName: 'branch_a', from: HASH_A, to: HASH_B }),
              migration({ dirName: 'branch_b', from: HASH_A, to: HASH_C }),
            ],
          },
        ],
        '3 migration(s) on disk',
      ),
    );
    expect(output).toContain('branch_a');
    expect(output).toContain('branch_b');
    expect(output).toMatch(/├─[╮╯]/);
  });

  it('renders skip-rollback with a down arrow in the tree gutter', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({ dirName: 'chain_a', from: null, to: HASH_A }),
              migration({ dirName: 'chain_b', from: HASH_A, to: HASH_B }),
              migration({ dirName: 'chain_c', from: HASH_B, to: HASH_C }),
              migration({
                dirName: 'skip_back',
                from: HASH_C,
                to: HASH_A,
                migrationHash: 'sha256:skip-back',
              }),
            ],
          },
        ],
        '4 migration(s) on disk',
      ),
    );
    expect(output).toContain('skip_back');
    expect(output).toContain('│↓');
  });

  it('renders multi-space output with headings and tree indent', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260518T1701_namespaces_bookend',
                from: HASH_D,
                to: HASH_F,
                refs: ['db'],
              }),
              migration({
                dirName: '20260422T0720_initial',
                from: null,
                to: HASH_D,
              }),
            ],
          },
          {
            spaceId: 'postgis',
            migrations: [
              migration({
                dirName: '20260601T0000_install_postgis_extension',
                from: null,
                to: 'sha256:9aabbcc123456789012345678901234567890123456789012',
              }),
            ],
          },
        ],
        '3 migration(s) across 2 contract space(s)',
      ),
    );
    expect(output).toContain('app:');
    expect(output).toContain('postgis:');
    expect(output).toContain('(db)');
    expect(output).toContain('20260518T1701_namespaces_bookend');
    expect(output).toContain('20260601T0000_install_postgis_extension');
  });

  it('suppresses heading for one-space output', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260422T0742_migration',
                from: HASH_A,
                to: HASH_B,
                refs: ['production'],
              }),
            ],
          },
        ],
        '1 migration(s) on disk',
      ),
    );
    expect(output).not.toContain('app:');
    expect(output).toContain('(production)');
  });

  it('renders empty state for single space', () => {
    const output = renderListed(
      result([{ spaceId: 'app', migrations: [] }], '0 migration(s) on disk'),
    );
    expect(output).toMatchInlineSnapshot(`"There are no migrations in migrations/app/ yet"`);
  });

  it('renders the slice-spec worked example as a package-annotated tree', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260601T1200_backfill_emails',
                from: HASH_D,
                to: HASH_D,
                providedInvariants: ['backfill_emails_v1'],
                refs: ['production'],
              }),
              migration({
                dirName: '20260518T1701_namespaces_bookend',
                from: HASH_E,
                to: HASH_F,
                refs: ['db'],
              }),
              migration({
                dirName: '20260422T0748_migration',
                from: HASH_D,
                to: HASH_E,
                refs: ['staging'],
              }),
              migration({
                dirName: '20260422T0742_migration',
                from: HASH_C,
                to: HASH_D,
                refs: ['production'],
              }),
              migration({
                dirName: '20260422T0720_initial',
                from: null,
                to: HASH_C,
              }),
            ],
          },
        ],
        '5 migration(s) on disk',
      ),
    );
    expect(output).toContain('20260601T1200_backfill_emails');
    expect(output).toContain('{backfill_emails_v1}');
    expect(output).toContain('(db)');
    expect(output).toContain('(staging)');
    expect(output).toContain('(production)');
    expect(output).toContain('1 ops');
    expect(output.trim().endsWith('5 migration(s) on disk')).toBe(true);
  });

  it('renders empty state for multiple spaces with per-space headings', () => {
    const output = renderListed(
      result(
        [
          { spaceId: 'app', migrations: [] },
          { spaceId: 'postgis', migrations: [] },
        ],
        '0 migration(s) across 2 contract space(s)',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "app:
        There are no migrations in migrations/app/ yet

      postgis:
        There are no migrations in migrations/postgis/ yet"
    `);
  });
});
